import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
export type Row = Record<string, any>;
export const tables = [
  "artists",
  "accounts",
  "bindings",
  "works",
  "revisions",
  "assets",
  "series",
  "plans",
  "runs",
  "steps",
  "batches",
  "units",
  "targets",
  "claims",
  "buckets",
  "ledger",
  "completions",
  "metrics",
  "imports",
  "exceptions",
  "approvals",
  "settings",
  "audit",
  "creativeSessions",
  "creativeTurns",
  "drafts",
  "evaluations",
  "operations",
  "candidates",
  "dailyPlans",
  "occurrences",
  "workflowLedger",
  "selectionEvents",
  "seriesCheckpoints",
  "inboxBatches",
  "inboxReceipts",
  "textCandidates",
] as const;
export type Table = (typeof tables)[number];
const columns: Partial<Record<Table, string[]>> = {
  bindings: ["artistId", "accountId"],
  works: ["artistId"],
  revisions: ["workId"],
  runs: ["planId", "date", "slot"],
  units: ["batchId", "fingerprint"],
  targets: ["batchId", "unitId"],
  claims: ["claimKey"],
  ledger: ["operationId", "bucketId", "eventKey"],
  completions: ["planKey", "workId"],
  metrics: ["metricKey"],
  creativeTurns: ["requestId"],
  operations: ["operationKey"],
  candidates: ["outputIdentity"],
  occurrences: ["occurrenceKey"],
  workflowLedger: ["eventKey"],
  selectionEvents: ["requestId", "candidateId", "checkpointKey"],
  inboxBatches: ["batchKey"],
  inboxReceipts: ["receiptKey"],
  textCandidates: ["itemKey"],
};
export function hash(value: any) {
  return createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value),
    )
    .digest("hex");
}
export class Repository {
  db: Database.Database;
  constructor(public filename: string) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new Database(filename);
    const version = this.db.pragma("user_version", { simple: true }) as number;
    if (version > 3) {
      this.db.close();
      throw Error("FUTURE_SCHEMA");
    }
    this.db.pragma("foreign_keys=ON");
    this.db.pragma("journal_mode=WAL");
    this.db.pragma("synchronous=FULL");
    this.db.pragma("busy_timeout=5000");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS artists(id TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,data TEXT NOT NULL);`,
    );
    for (const table of tables) {
      if (table === "artists" || table === "accounts") continue;
      let extras = (columns[table] || []).map((c) => `${c} TEXT`).join(",");
      if (table === "bindings")
        extras +=
          ",FOREIGN KEY(artistId) REFERENCES artists(id),FOREIGN KEY(accountId) REFERENCES accounts(id)";
      if (table === "works")
        extras += ",FOREIGN KEY(artistId) REFERENCES artists(id)";
      if (table === "revisions")
        extras += ",FOREIGN KEY(workId) REFERENCES works(id)";
      if (table === "units")
        extras +=
          ",FOREIGN KEY(batchId) REFERENCES batches(id),UNIQUE(fingerprint)";
      if (table === "targets")
        extras +=
          ",FOREIGN KEY(batchId) REFERENCES batches(id),FOREIGN KEY(unitId) REFERENCES units(id)";
      if (table === "claims") extras += ",UNIQUE(claimKey)";
      if (table === "runs") extras += ",UNIQUE(planId,date,slot)";
      if (table === "ledger")
        extras +=
          ",FOREIGN KEY(bucketId) REFERENCES buckets(id),UNIQUE(eventKey)";
      if (table === "completions") extras += ",UNIQUE(planKey,workId)";
      if (table === "metrics") extras += ",UNIQUE(metricKey)";
      const unique: Partial<Record<Table, string>> = {
        creativeTurns: "requestId",
        operations: "operationKey",
        candidates: "outputIdentity",
        occurrences: "occurrenceKey",
        workflowLedger: "eventKey",
        selectionEvents: "requestId",
        inboxBatches: "batchKey",
        inboxReceipts: "receiptKey",
        textCandidates: "itemKey",
      };
      if (unique[table]) extras += `,UNIQUE(${unique[table]})`;
      if (table === "selectionEvents")
        extras += ",UNIQUE(candidateId),UNIQUE(checkpointKey)";
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY,data TEXT NOT NULL${extras ? "," + extras : ""})`,
      );
    }
    const selectionColumns = (
      this.db.pragma("table_info(selectionEvents)") as { name: string }[]
    ).map((c) => c.name);
    for (const col of ["candidateId", "checkpointKey"])
      if (!selectionColumns.includes(col))
        this.db.exec(`ALTER TABLE selectionEvents ADD COLUMN ${col} TEXT`);
    this.db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS selection_candidate_unique ON selectionEvents(candidateId);CREATE UNIQUE INDEX IF NOT EXISTS selection_checkpoint_unique ON selectionEvents(checkpointKey)",
    );
    this.db.pragma("user_version=3");
  }
  all(table: Table): Row[] {
    return (
      this.db
        .prepare(`SELECT data FROM ${this.check(table)} ORDER BY rowid`)
        .all() as { data: string }[]
    ).map((x) => JSON.parse(x.data));
  }
  get(table: Table, id: string): Row {
    const r = this.db
      .prepare(`SELECT data FROM ${this.check(table)} WHERE id=?`)
      .get(id) as { data: string } | undefined;
    if (!r) throw Error("NOT_FOUND");
    return JSON.parse(r.data);
  }
  maybe(table: Table, id: string) {
    try {
      return this.get(table, id);
    } catch {
      return undefined;
    }
  }
  save(table: Table, row: Row): Row {
    const cols = columns[table] || [];
    const names = ["id", "data", ...cols];
    this.db
      .prepare(
        `INSERT INTO ${this.check(table)}(${names.join(",")}) VALUES(${names.map(() => "?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${names
          .slice(1)
          .map((x) => `${x}=excluded.${x}`)
          .join(",")}`,
      )
      .run(row.id, JSON.stringify(row), ...cols.map((c) => row[c] ?? null));
    return row;
  }
  append(table: Table, row: Row) {
    if (this.maybe(table, row.id)) return this.get(table, row.id);
    return this.save(table, row);
  }
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }
  audit(type: string, entityId: string, details: Row = {}) {
    const last = this.db
      .prepare("SELECT data FROM audit ORDER BY rowid DESC LIMIT 1")
      .get() as { data: string } | undefined;
    const prev = last ? JSON.parse(last.data).hash : "0".repeat(64);
    const row = {
      id: randomUUID(),
      type,
      entityId,
      details,
      at: new Date().toISOString(),
      prev,
    };
    return this.save("audit", { ...row, hash: hash(row) });
  }
  close() {
    if (this.db.open) this.db.close();
  }
  private check(t: Table) {
    if (!tables.includes(t)) throw Error("TABLE");
    return t;
  }
}
