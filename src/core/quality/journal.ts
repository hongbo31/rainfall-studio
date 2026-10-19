import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  JournalEventSchema,
  type Journal,
  type JournalEvent,
} from "./contracts";
import { canonical, hashValue } from "./scoring";

export function openFixtureJournal(root: string): Journal {
  const base = path.resolve("output/test-runs"),
    dir = path.resolve(root);
  if (
    path.dirname(dir) !== base ||
    !/^quality-[A-Za-z0-9_-]+$/.test(path.basename(dir))
  )
    throw Error("JOURNAL_PATH");
  function safeRoot() {
    for (const p of [path.resolve("output"), base, dir])
      if (
        fs.existsSync(p) &&
        (fs.lstatSync(p).isSymbolicLink() || !fs.lstatSync(p).isDirectory())
      )
        throw Error("JOURNAL_PATH");
  }
  safeRoot();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  let closed = false,
    ownLock = false;
  const lock = path.join(dir, ".append-lock");
  function scan() {
    if (closed) throw Error("JOURNAL_CLOSED");
    safeRoot();
    const entries: JournalEvent[] = [],
      files = fs.readdirSync(dir).sort();
    let prev = "0".repeat(64);
    const fail = () => {
      throw Object.assign(Error("JOURNAL_INTEGRITY"), { events: entries });
    };
    for (const name of files.filter((n) => /^\d{8}\.json$/.test(n))) {
      if (name !== String(entries.length + 1).padStart(8, "0") + ".json")
        fail();
      const file = path.join(dir, name);
      if (fs.lstatSync(file).isSymbolicLink() || !fs.lstatSync(file).isFile())
        fail();
      try {
        const row = JSON.parse(fs.readFileSync(file, "utf8"));
        const event = JournalEventSchema.parse(row.event);
        if (
          row.seq !== entries.length + 1 ||
          row.prev !== prev ||
          row.hash !== hashValue({ seq: row.seq, prev: row.prev, event })
        )
          fail();
        if (entries.some((e) => e.eventKey === event.eventKey)) fail();
        entries.push(event);
        prev = row.hash;
      } catch {
        fail();
      }
    }
    if (
      files.some(
        (n) => !/^\d{8}\.json$/.test(n) && !(n === ".append-lock" && ownLock),
      )
    )
      fail();
    return { entries, prev };
  }
  return {
    read: () => structuredClone(scan().entries),
    append(raw) {
      const event = JournalEventSchema.parse(raw);
      canonical(event);
      safeRoot();
      let handle: number | undefined, temp: string | undefined;
      try {
        handle = fs.openSync(lock, "wx", 0o600);
        ownLock = true;
        const { entries, prev } = scan(),
          existing = entries.find((e) => e.eventKey === event.eventKey);
        if (existing) {
          if (canonical(existing) !== canonical(event))
            throw Error("IDEMPOTENCY_CONFLICT");
          return;
        }
        const seq = entries.length + 1,
          record = { seq, prev, event };
        const file = path.join(dir, String(seq).padStart(8, "0") + ".json");
        if (fs.existsSync(file)) throw Error("JOURNAL_INTEGRITY");
        temp = file + ".tmp-" + randomUUID();
        const out = fs.openSync(temp, "wx", 0o600);
        try {
          fs.writeFileSync(
            out,
            canonical({ ...record, hash: hashValue(record) }),
            "utf8",
          );
          fs.fsyncSync(out);
        } finally {
          fs.closeSync(out);
        }
        fs.renameSync(temp, file);
        temp = undefined;
      } finally {
        if (temp && fs.existsSync(temp)) fs.unlinkSync(temp);
        if (handle !== undefined) {
          fs.closeSync(handle);
          ownLock = false;
          fs.unlinkSync(lock);
        }
      }
    },
    close() {
      closed = true;
    },
  };
}
