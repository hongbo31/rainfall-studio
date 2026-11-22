import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compileFunction } from "node:vm";
import { buildSync } from "esbuild";

const { outputFiles } = buildSync({
  entryPoints: [path.join(import.meta.dirname, "../src/core/plan-fanqie-directory.ts")],
  bundle: true, write: false, platform: "node", packages: "external", format: "cjs",
});
const mod = { exports: {} };
compileFunction(outputFiles[0].text, ["module", "exports", "require"])(mod, mod.exports, createRequire(import.meta.url));
const { isFanqieDirectoryDisconnectedBeforeUpload: checkpoint } = mod.exports;
const issue = "FANQIE_BROWSER_CONNECTION_REQUIRED";
const defaultAccountId = "ea76a486-a79d-4ee7-aa4d-c68e4577f975";

function fixture(t, { accountId = randomUUID(), frozenHashes = true } = {}) {
  const temp = fs.realpathSync.native(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temp, "rainfall-fanqie-checkpoint-"));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync.native(root)), temp);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const fanqie = path.join(root, "production", "fanqie");
  const account = accountId === defaultAccountId ? fanqie : path.join(fanqie, "accounts", accountId);
  const accountKey = "a".repeat(64), configurationHash = "b".repeat(64);
  const target = { platform: "fanqie", accountId, ...(frozenHashes ? { accountKey, configurationHash } : {}) };
  const run = { id: randomUUID(), state: "blocked", source: "publication_task", stopRequested: false, reason: issue,
    prepareContract: false, snapshot: { authorization: { publish: true },
      workflow: { graph: { nodes: ["publish:fanqie"], edges: [] }, publications: [target] } } };
  const batchFolder = path.join(account, "download-runs", run.id);
  const uploads = path.join(account, "uploads");
  const batchFile = path.join(batchFolder, "batch.json");
  fs.mkdirSync(batchFolder, { recursive: true });
  fs.mkdirSync(uploads);
  const items = ["一", "二"].map((suffix, index) => ({
    id: "track-" + index, title: "歌曲" + suffix, state: "needs_review", issue, round: 1,
  }));
  const batch = { id: run.id, state: "needs_review", issue, accountKey, configurationHash, round: 1,
    preferences: { limit: 10, signContract: false }, items,
    active: { number: 1, trackIds: items.map(item => item.id), signContract: false } };
  const jobs = items.map((item, index) => ({
    id: String(index + 1).repeat(64), title: item.title, phase: "unknown", pending: "opening-form", reason: issue,
    accountKey, download: { batchId: run.id, id: item.id },
  }));
  const saveBatch = (data = batch) => fs.writeFileSync(batchFile, JSON.stringify(data));
  const jobFile = job => path.join(uploads, job.id + ".json");
  const saveJob = job => fs.writeFileSync(jobFile(job), JSON.stringify(job));
  saveBatch();
  jobs.forEach(saveJob);
  return { root, fanqie, uploads, batchFolder, run, batch, jobs, batchFile, jobFile, saveBatch, saveJob };
}

test("accepts a disconnected record for every song in the first upload round", t => {
  const f = fixture(t, { frozenHashes: false });
  assert.equal(checkpoint(f.root, f.run), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.batchFile, "utf8")), f.batch);
  for (const job of f.jobs) assert.deepEqual(JSON.parse(fs.readFileSync(f.jobFile(job), "utf8")), job);
});

test("recognizes a pre-upload disconnect when the batch will generate an unsigned contract", t => {
  const f = fixture(t);
  f.saveBatch({ ...f.batch, prepareContracts: true, requireSecurityVerification: true });
  assert.equal(checkpoint(f.root, f.run), true);
  f.saveJob({ ...f.jobs[0], pending: "first-step:confirm-upload" });
  assert.equal(checkpoint(f.root, f.run), false);
});

test("finds legacy default-account journals when plan snapshots lack account hashes", t => {
  const f = fixture(t, { accountId: defaultAccountId, frozenHashes: false });
  f.saveBatch({ ...f.batch, active: { ...f.batch.active, signContract: undefined, contractPrepared: false } });
  assert.equal(checkpoint(f.root, f.run), true);
});

test("ignores upload receipts from a different batch or account", t => {
  const f = fixture(t);
  const [job] = f.jobs;
  const received = { ...job, phase: "recorded", pending: null, officialRecord: { id: "70001" } };
  f.saveJob({ ...received, id: "3".repeat(64), download: { ...job.download, batchId: randomUUID() } });
  const defaultUploads = path.join(f.fanqie, "uploads");
  fs.mkdirSync(defaultUploads);
  fs.writeFileSync(path.join(defaultUploads, job.id + ".json"), JSON.stringify(received));
  assert.equal(checkpoint(f.root, f.run), true);
});

test("rejects uncertain or contradictory batch journals", async t => {
  const cases = [
    ["the batch journal is missing", f => fs.unlinkSync(f.batchFile)],
    ["the configuration hash changed", f => f.saveBatch({ ...f.batch, configurationHash: "c".repeat(64) })],
    ["an earlier round might have submitted songs", f => f.saveBatch({ ...f.batch, active: { ...f.batch.active, number: 2 } })],
    ["an item is missing from the active round", f => f.saveBatch({ ...f.batch, active: { ...f.batch.active, trackIds: [f.batch.items[0].id] } })],
    ["the batch has duplicate items", f => f.saveBatch({ ...f.batch, items: [f.batch.items[0], f.batch.items[0]] })],
    ["the active list includes a track twice", f => f.saveBatch({ ...f.batch, active: { ...f.batch.active, trackIds: [f.batch.items[0].id, f.batch.items[0].id] } })],
    ["an item has a work receipt", f => f.saveBatch({ ...f.batch, items: [{ ...f.batch.items[0], workId: "70001" }, f.batch.items[1]] })],
    ["the batch requested contract preparation", f => f.saveBatch({ ...f.batch, prepareContracts: true })],
    ["the round prepared a contract", f => f.saveBatch({ ...f.batch, active: { ...f.batch.active, contractPrepared: true } })],
    ["the round previously requested contract generation", f => f.saveBatch({ ...f.batch, active: { ...f.batch.active, contractGenerationRequestedAt: 1 } })],
    ["a contract verification journal exists", f => fs.writeFileSync(path.join(f.batchFolder, "verification-1.json"), "{}")],
  ];
  for (const [name, mutate] of cases) await t.test(name, t => {
    const f = fixture(t);
    mutate(f);
    assert.equal(checkpoint(f.root, f.run), false);
  });
});

test("rejects missing, duplicate, or advanced upload journals", async t => {
  const cases = [
    ["the job is missing", (f, job) => fs.unlinkSync(f.jobFile(job))],
    ["the job is malformed", (f, job) => fs.writeFileSync(f.jobFile(job), "{")],
    ["the same track has a second job", (f, job) => f.saveJob({ ...job, id: "3".repeat(64) })],
    ["a job in this batch points to an extra track", (f, job) => f.saveJob({ ...job, id: "3".repeat(64), download: { ...job.download, id: "extra-track" } })],
    ["the stored job file is named for another job", (f, job) => fs.writeFileSync(f.jobFile(job), JSON.stringify({ ...job, id: "3".repeat(64) }))],
    ["the job points to another account", (f, job) => f.saveJob({ ...job, accountKey: "c".repeat(64) })],
    ["the job title disagrees with the batch item", (f, job) => f.saveJob({ ...job, title: "另一首歌" })],
    ["the browser was disconnected after confirmation intent", (f, job) => f.saveJob({ ...job, pending: "first-step:confirm-upload" })],
    ["the job is awaiting a contract", (f, job) => f.saveJob({ ...job, phase: "contract_pending" })],
    ["the job carries an official receipt", (f, job) => f.saveJob({ ...job, officialRecord: { id: "70001" } })],
  ];
  for (const [name, mutate] of cases) await t.test(name, t => {
    const f = fixture(t);
    mutate(f, f.jobs[0]);
    assert.equal(checkpoint(f.root, f.run), false);
  });
});

test("rejects upload journals redirected through a linked directory", t => {
  const f = fixture(t);
  const redirected = path.join(f.root, "other-uploads");
  assert.equal(path.relative(f.root, fs.realpathSync.native(f.uploads)), path.relative(f.root, f.uploads));
  fs.renameSync(f.uploads, redirected);
  fs.symlinkSync(redirected, f.uploads, process.platform === "win32" ? "junction" : "dir");
  assert.equal(checkpoint(f.root, f.run), false);
});
