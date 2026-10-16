import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ZipArchive } from "archiver";
import yauzl from "yauzl";
import { pipeline } from "node:stream/promises";
import { Repository } from "./database";
import { assetPath, digest } from "./assets";
import type { Studio } from "./studio";
export async function zip(
  destination: string,
  files: { name: string; file?: string; text?: string }[],
) {
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(destination);
    const archive = new ZipArchive({ zlib: { level: 6 } });
    out.on("close", resolve);
    out.on("error", reject);
    archive.on("error", reject);
    archive.pipe(out);
    for (const f of files) {
      if (f.file) archive.file(f.file, { name: f.name });
      else archive.append(f.text || "", { name: f.name });
    }
    archive.finalize().catch(reject);
  });
}
export async function backup(s: Studio, destination: string) {
  const dir = path.join(s.root, "staging", "backup-" + randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  try {
    const db = path.join(dir, "database.sqlite");
    await s.db.backup(db);
    const copy = new Repository(db);
    copy.db.prepare("DELETE FROM approvals").run();
    copy.close();
    const files = [
      { name: "database.sqlite", file: db },
      ...s.all("assets").map((a) => ({
        name: path.relative(s.root, assetPath(s, a)).split(path.sep).join("/"),
        file: assetPath(s, a),
      })),
    ];
    const manifest = {
      formatVersion: 1,
      schemaVersion: 3,
      appVersion: "0.2.0",
      mode: s.mode,
      createdAt: s.now().toISOString(),
      files: files.map((f) => ({
        name: f.name,
        bytes: fs.statSync(f.file).size,
        sha256: digest(f.file),
      })),
    };
    await zip(destination, [
      ...files,
      { name: "manifest.json", text: JSON.stringify(manifest, null, 2) },
    ]);
    s.repo.audit("backup.export", "workspace", { assets: files.length - 1 });
    return {
      path: destination,
      assets: files.length - 1,
      sha256: digest(destination),
      secretsIncluded: false,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
async function unzip(source: string, dir: string) {
  await new Promise<void>((resolve, reject) => {
    yauzl.open(
      source,
      { lazyEntries: true, validateEntrySizes: true },
      (err, zipfile) => {
        if (err || !zipfile) {
          reject(err);
          return;
        }
        let total = 0,
          count = 0;
        const seen = new Set<string>();
        let failed = false;
        const fail = (e: any) => {
          if (failed) return;
          failed = true;
          zipfile.close();
          reject(e);
        };
        zipfile.on("error", fail);
        zipfile.on("end", () => {
          if (!failed) resolve();
        });
        zipfile.on("entry", async (entry) => {
          try {
            const name = entry.fileName;
            const normalized = name.replace(/\\/g, "/");
            if (
              name !== normalized ||
              path.isAbsolute(name) ||
              name.includes(":") ||
              name
                .split("/")
                .some((x: string) => x === ".." || x === "." || !x) ||
              seen.has(name.toLowerCase()) ||
              ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000
            )
              throw Error("ARCHIVE_PATH_REJECTED");
            if (
              !/^(manifest\.json|database\.sqlite|media\/sha256\/[a-f0-9]{2}\/[a-f0-9]{64}\.[a-z0-9]+)$/.test(
                name,
              )
            )
              throw Error("ARCHIVE_ENTRY_REJECTED");
            seen.add(name.toLowerCase());
            total += entry.uncompressedSize;
            count++;
            const free = fs.statfsSync(dir);
            if (
              count > 100000 ||
              total > 500 * 1024 ** 3 ||
              total > Number(free.bavail) * Number(free.bsize) - 20 * 1024 ** 2
            )
              throw Error("ARCHIVE_LIMIT");
            const dest = path.join(dir, name);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            const stream = await new Promise<NodeJS.ReadableStream>(
              (res, rej) =>
                zipfile.openReadStream(entry, (e, s) =>
                  e || !s ? rej(e) : res(s),
                ),
            );
            await pipeline(stream, fs.createWriteStream(dest, { flags: "wx" }));
            zipfile.readEntry();
          } catch (e) {
            fail(e);
          }
        });
        zipfile.readEntry();
      },
    );
  });
}
export function assertRestoreSafe(s: Studio) {
  let reserved = 0;
  for (const e of s.all("workflowLedger")) {
    if (e.kind === "reserve") reserved += e.amount;
    if (e.kind === "settle" || e.kind === "release") reserved -= e.amount;
  }
  if (
    reserved > 0 ||
    s
      .all("operations")
      .some(
        (o) =>
          ["dispatching", "unknown"].includes(o.state) ||
          o.costState === "unknown",
      )
  )
    throw Error("RESTORE_RECONCILIATION_REQUIRED");
}
export async function restore(s: Studio, source: string) {
  assertRestoreSafe(s);
  const stage = path.join(s.root, "staging", "restore-" + randomUUID());
  fs.mkdirSync(stage, { recursive: true });
  try {
    await unzip(source, stage);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(stage, "manifest.json"), "utf8"),
    );
    if (
      manifest.formatVersion !== 1 ||
      ![1, 2, 3].includes(manifest.schemaVersion) ||
      manifest.mode !== s.mode ||
      !Array.isArray(manifest.files)
    )
      throw Error("BACKUP_VERSION_OR_MODE");
    const names = new Set<string>();
    for (const f of manifest.files) {
      if (
        typeof f.name !== "string" ||
        !/^(database\.sqlite|media\/sha256\/[a-f0-9]{2}\/[a-f0-9]{64}\.[a-z0-9]+)$/.test(
          f.name,
        ) ||
        names.has(f.name)
      )
        throw Error("MANIFEST_PATH");
      names.add(f.name);
      const file = path.join(stage, f.name);
      if (
        !fs.existsSync(file) ||
        fs.statSync(file).size !== f.bytes ||
        digest(file) !== f.sha256
      )
        throw Error("BACKUP_HASH");
    }
    if (!names.has("database.sqlite")) throw Error("DATABASE_MISSING");
    const candidate = new Repository(path.join(stage, "database.sqlite"));
    try {
      assertRestoreSafe(s);
      for (const table of [
        "inboxBatches",
        "inboxReceipts",
        "textCandidates",
      ] as const) {
        const saved = candidate.all(table);
        if (
          s
            .all(table)
            .some(
              (row) =>
                !saved.some(
                  (old) =>
                    old.id === row.id &&
                    JSON.stringify(old) === JSON.stringify(row),
                ),
            )
        )
          throw Error("RESTORE_POST_SNAPSHOT_INBOX");
      }
      const savedLedger = candidate.all("workflowLedger");
      if (
        s
          .all("workflowLedger")
          .some(
            (e) =>
              !savedLedger.some(
                (old) =>
                  old.eventKey === e.eventKey &&
                  JSON.stringify(old) === JSON.stringify(e),
              ),
          )
      )
        throw Error("RESTORE_POST_SNAPSHOT_ACTIVITY");
      if (
        candidate.db.pragma("integrity_check", { simple: true }) !== "ok" ||
        (candidate.db.pragma("foreign_key_check") as unknown[]).length
      )
        throw Error("DATABASE_INTEGRITY");
      for (const a of candidate.all("assets")) {
        const rel = path
          .relative(s.root, assetPath(s, a))
          .split(path.sep)
          .join("/");
        if (!names.has(rel)) throw Error("ASSET_NOT_IN_MANIFEST");
      }
      candidate.db.prepare("DELETE FROM approvals").run();
      const inboxChannel = candidate.maybe("settings", "inbox-channel");
      if (inboxChannel)
        candidate.save("settings", { ...inboxChannel, enabled: false });
      for (const account of candidate.all("accounts"))
        candidate.save("accounts", {
          ...account,
          authStatus: "reauth_required",
          scopes: [],
        });
      for (const p of candidate.all("plans"))
        candidate.save("plans", { ...p, enabled: false });
      for (const p of candidate.all("dailyPlans"))
        candidate.save("dailyPlans", {
          ...p,
          state: "draft",
          enabled: false,
          authorizationRevision: null,
        });
      for (const o of candidate.all("operations"))
        if (o.state === "dispatching")
          candidate.save("operations", { ...o, state: "unknown" });
      for (const t of candidate.all("creativeTurns"))
        if (["queued", "running"].includes(t.state))
          candidate.save("creativeTurns", {
            ...t,
            state: "paused",
            reasons: ["RESTORED_REQUIRES_REVIEW"],
          });
      for (const u of candidate.all("units")) {
        if (["COMMITTING", "SUBMISSION_UNKNOWN"].includes(u.state))
          candidate.save("units", { ...u, state: "SUBMISSION_UNKNOWN" });
        else if (!["SUBMITTED", "CANCELLED", "DUPLICATE"].includes(u.state))
          candidate.save("units", {
            ...u,
            previousState: u.state,
            state: "PAUSED",
          });
      }
      for (const r of candidate.all("runs"))
        if (r.state !== "succeeded")
          candidate.save("runs", {
            ...r,
            state: r.state === "unknown" ? "unknown" : "waiting_confirmation",
          });
    } finally {
      candidate.close();
    }
    for (const f of manifest.files.filter((x: any) =>
      x.name.startsWith("media/"),
    )) {
      const dest = path.join(s.root, f.name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (!fs.existsSync(dest)) fs.copyFileSync(path.join(stage, f.name), dest);
      else if (digest(dest) !== f.sha256) throw Error("EXISTING_ASSET_CORRUPT");
    }
    assertRestoreSafe(s);
    const filename = s.repo.filename;
    s.repo.close();
    const previous = filename + `.previous-${Date.now()}`;
    fs.renameSync(filename, previous);
    try {
      fs.copyFileSync(path.join(stage, "database.sqlite"), filename);
      s.repo = new Repository(filename);
    } catch (e) {
      if (fs.existsSync(filename)) fs.unlinkSync(filename);
      fs.renameSync(previous, filename);
      s.repo = new Repository(filename);
      throw e;
    }
    s.repo.audit("backup.restore", "workspace", { sourceHash: digest(source) });
    return {
      restored: true,
      previous,
      accountsRequireAuthorization: true,
      plansDisabled: true,
    };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
