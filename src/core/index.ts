import { materialEntries } from "./materials";
export { materialEntries };
export { probe } from "./assets";
import { Studio } from "./studio";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { zip } from "./backup";
import { exportCover } from "./assets";
import { hash } from "./database";
export { Studio };
export { listApiProfiles, saveApiProfile } from "./api-profiles";

export function previewLegacy(file: string) {
  if (fs.statSync(file).size > 50 * 1024 * 1024) throw Error("LEGACY_LIMIT");
  const body = fs.readFileSync(file, "utf8"),
    data = JSON.parse(body),
    rows = data.works || data.state?.works;
  if (!Array.isArray(rows) || rows.length > 10000) throw Error("LEGACY_SCHEMA");
  for (const w of rows) {
    if (
      !w ||
      typeof w.title !== "string" ||
      !w.title.trim() ||
      w.title.length > 200
    )
      throw Error("LEGACY_SCHEMA");
    for (const [field, max] of Object.entries({
      story: 20000,
      lyrics: 100000,
      prompt: 100000,
      rights: 4000,
    }))
      if (
        w[field] !== undefined &&
        (typeof w[field] !== "string" || w[field].length > max)
      )
        throw Error("LEGACY_SCHEMA");
    if (
      typeof w.cover === "string" &&
      w.cover.startsWith("data:image/") &&
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(w.cover)
    )
      throw Error("LEGACY_COVER_FORMAT");
  }
  return {
    rows,
    sourceHash: hash(body),
    works: rows.length,
    missingAudio: rows.length,
  };
}
export async function importLegacy(s: Studio, file: string) {
  if (s.mode !== "simulation") throw Error("LEGACY_USE_SIMULATION");
  const preview = previewLegacy(file);
  if (s.all("imports").some((x) => x.sourceHash === preview.sourceHash))
    return { alreadyImported: true };
  const artist = s.all("artists")[0];
  const prepared: { w: Record<string, any>; coverId?: string }[] = [];
  for (const w of preview.rows) {
    let coverId: string | undefined;
    if (
      typeof w.cover === "string" &&
      /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(w.cover)
    ) {
      const f = path.join(s.root, "staging", randomUUID() + ".img");
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, Buffer.from(w.cover.split(",")[1], "base64"));
      try {
        coverId = (await s.importFile(f, "cover")).id;
      } finally {
        fs.unlinkSync(f);
      }
    }
    prepared.push({ w, coverId });
  }
  s.repo.transaction(() => {
    for (const { w, coverId } of prepared) {
      const created = s.saveWork({
        title: w.title,
        artistId: artist.id,
        story: w.story || "",
        lyrics: w.lyrics || "",
        prompt: w.prompt || "",
        parameters: {},
        rights: w.rights || "原型导入，权益待确认",
        ai: "unknown",
      });
      if (coverId)
        s.save("works", {
          ...created,
          assets: { cover: coverId },
          assetHistory: [coverId],
        });
    }
    s.save("imports", {
      id: randomUUID(),
      sourceHash: preview.sourceHash,
      works: preview.works,
      missingAudio: preview.missingAudio,
    });
  });
  const receipts = path.join(s.root, "migration-receipts");
  fs.mkdirSync(receipts, { recursive: true });
  fs.copyFileSync(file, path.join(receipts, preview.sourceHash + ".json"));
  return {
    works: preview.works,
    missingAudio: preview.missingAudio,
    notice: "旧音频blob无法迁移，请重新导入；旧发布状态未导为真实任务。",
  };
}
const port = (process as any).parentPort;
if (port) {
  const studio = new Studio(
    process.argv[2],
    process.argv[3] === "simulation" ? "simulation" : "production",
  );
  let chain = Promise.resolve().then(() => studio.scanInbox());
  const execute = async (method: string, input: any) => {
    if (method === "internal.pauseAutomation") {
      for (const p of studio.all("dailyPlans"))
        studio.save("dailyPlans", { ...p, state: "paused", enabled: false });
      return { paused: true };
    }
    if (method === "internal.previewLegacy") {
      if (studio.mode !== "simulation") throw Error("LEGACY_USE_SIMULATION");
      const p = previewLegacy(input.source);
      return {
        works: p.works,
        missingAudio: p.missingAudio,
        sourceHash: p.sourceHash,
      };
    }
    if (method === "internal.close") {
      studio.close();
      return true;
    }
    if (method === "internal.locate") return studio.locate(input.id);
    if (method === "internal.import") {
      if (input.role === "backup") return studio.restore(input.source);
      if (input.role === "report") return studio.importReport(input.source);
      if (input.role === "legacy") return importLegacy(studio, input.source);
      return studio.importFile(input.source, input.role, input.workId);
    }
    if (method === "internal.export") {
      if (input.kind === "backup") return studio.backup(input.destination);
      if (input.kind === "cover")
        return exportCover(
          studio,
          input.input.workId,
          input.destination,
          input.input,
        );
      if (input.kind === "coverTask") {
        const task = await studio.call("cover.task", {
          workId: input.input.workId,
          brief: input.input.brief || "",
        });
        const edited = input.input.editedText;
        if (
          edited !== undefined &&
          (typeof edited !== "string" || edited.length > 200000)
        )
          throw Error("COVER_TASK_INVALID");
        const text = edited || task.text;
        fs.writeFileSync(input.destination, text, "utf8");
        const work = studio.get("works", input.input.workId);
        studio.save("works", {
          ...work,
          coverTaskText: text,
          coverBrief: input.input.brief || "",
        });
        return { path: input.destination };
      }
      if (input.kind === "materials") {
        const files = materialEntries(studio, input.input.batchId);
        await zip(input.destination, files);
        return { path: input.destination, uploaded: false };
      }
      if (input.kind === "diagnostics") {
        fs.writeFileSync(
          input.destination,
          JSON.stringify(
            {
              mode: studio.mode,
              versions: process.versions,
              capabilities: studio.snapshot().capabilities,
              externalRequests: studio.externalRequests,
              audit: studio
                .all("audit")
                .map(({ type, entityId, at }) => ({ type, entityId, at })),
            },
            null,
            2,
          ),
        );
        return { path: input.destination };
      }
    }
    return studio.call(method, input);
  };
  port.on("message", ({ data }: any) => {
    chain = chain.then(async () => {
      try {
        const value = await execute(data.method, data.input);
        port.postMessage({ id: data.id, result: { ok: true, value } });
      } catch (e: any) {
        const code =
          typeof e.code === "string"
            ? e.code
            : typeof e.message === "string" && /^[A-Z0-9_]+$/.test(e.message)
              ? e.message
              : "OPERATION_FAILED";
        port.postMessage({
          id: data.id,
          result: {
            ok: false,
            error: {
              code,
              message:
                "操作未完成：" +
                code +
                "。请检查输入、文件、授权范围或所需步骤。",
            },
          },
        });
      }
    });
  });
  setInterval(() => {
    chain = chain
      .then(() => (studio.closing ? undefined : studio.tick()))
      .catch(() => undefined);
  }, 1000).unref();
  port.postMessage({ ready: true });
}
export {};
