import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
const require = createRequire(import.meta.url),
  core = require("../build/core.cjs");
function setup() {
  const root = path.resolve("output/test-runs", randomUUID()),
    s = new core.Studio(root, "production"),
    svc = s.tmeDraftService();
  const account = s.save("accounts", {
    id: randomUUID(),
    provider: "tme",
    name: "fixture",
    authStatus: "not_connected",
  });
  function work(title = "原创测试", audio = "fixture-" + randomUUID()) {
    const w = s.saveWork({
      title,
      artistId: s.all("artists")[0].id,
      story: "",
      lyrics: "这是一首原创测试歌词\n只用于本地离线的接口测试",
      prompt: "",
      parameters: {},
      rights: "原创",
      ai: "generated",
    });
    const bytes = Buffer.from(audio),
      sha256 = createHash("sha256").update(bytes).digest("hex"),
      dir = path.join(root, "media/sha256", sha256.slice(0, 2));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, sha256 + ".wav"), bytes);
    const a = s.save("assets", {
      id: randomUUID(),
      sha256,
      ext: "wav",
      mime: "audio/wav",
      bytes: bytes.length,
    });
    w.assets.audio_A = a.id;
    s.save("works", w);
    return w;
  }
  function prepare(w) {
    const metadata = {
      lyricist: "fixture",
      composer: "fixture",
      ownLyricist: true,
      ownComposer: true,
      aiMusic: "yes",
      aiTool: "Suno",
      generatedOn: "2026-10-15",
      statement: "",
      proofAssetId: "",
      existingRemoteId: "",
      authorizationMode: "",
      lyrics: w.lyrics,
      albumId: "100",
      coverPolicy: "preserve_album",
    };
    const input = {
      workId: w.id,
      accountId: account.id,
      metadata,
      confirmations: {},
    };
    const p = svc.preview(input);
    input.confirmations = {
      rights: true,
      authors: true,
      ai: true,
      lyricsHash: p.lyricsHash,
      recordingHash: p.audio.sha256,
      reviewHash: p.reviewHash,
    };
    return svc.prepare(input);
  }
  return { root, s, svc, account, work, prepare };
}
test("existing-album preflight preserves shared cover and permits optional original proof", () => {
  const x = setup();
  try {
    const d = x.prepare(x.work());
    assert.deepEqual(d.issues, []);
    assert.equal(d.assets.cover, null);
    assert.equal(d.assets.proof, null);
    assert.equal(d.metadata.albumId, "100");
    assert.equal(d.metadata.coverPolicy, "preserve_album");
  } finally {
    x.s.close();
  }
});
test("selected batch stores per-item preflight without dropping blocked works or including unselected work", () => {
  const x = setup();
  try {
    const a = x.work("可用"),
      b = x.work("未预检"),
      c = x.work("未选择");
    x.prepare(a);
    const batch = x.svc.planBatch({
      workIds: [a.id, b.id],
      accountId: x.account.id,
    });
    const units = x.svc.batchUnits(batch.id);
    assert.equal(units.length, 2);
    assert.equal(units.find((u) => u.workId === a.id).state, "TME_READY");
    assert.equal(units.find((u) => u.workId === b.id).state, "TME_BLOCKED");
    assert(!units.some((u) => u.workId === c.id));
    assert.equal(
      x.svc.planBatch({ workIds: [a.id, b.id], accountId: x.account.id }).id,
      batch.id,
    );
  } finally {
    x.s.close();
  }
});
test("same audio bound to same visible remote account cannot be claimed via another local remark", () => {
  const x = setup();
  try {
    const a = x.prepare(x.work()),
      identity = {
        subject: "visible:fixture",
        displayName: "fixture",
        device: "fixture",
        session: "session",
        source: "browser",
      };
    const b = x.svc.planBatch({ workIds: [a.workId], accountId: x.account.id }),
      u = x.svc.batchUnits(b.id)[0];
    x.svc.claimUnit(u.id, identity);
    assert.equal(x.s.all("claims").length, 1);
    const acc = x.s.save("accounts", { ...x.account, id: randomUUID() });
    const d = { ...a, id: randomUUID(), accountId: acc.id };
    x.s.save("settings", {
      id: "tme-draft:" + d.id,
      kind: "tme-draft",
      draft: d,
    });
    const other = x.svc.planBatch({ workIds: [a.workId], accountId: acc.id }),
      v = x.svc.batchUnits(other.id)[0];
    assert.throws(
      () => x.svc.claimUnit(v.id, identity),
      /DUPLICATE_REMOTE_RECORDING/,
    );
  } finally {
    x.s.close();
  }
});
test("restart converts live intents to reconciliation and preserves duplicate claim", () => {
  const x = setup();
  let s;
  try {
    const d = x.prepare(x.work()),
      b = x.svc.planBatch({ workIds: [d.workId], accountId: x.account.id }),
      u = x.svc.batchUnits(b.id)[0];
    x.svc.claimUnit(u.id, {
      subject: "visible:fixture",
      displayName: "fixture",
      device: "fixture",
      session: "s",
      source: "browser",
    });
    x.svc.updateUnit(u.id, { state: "TME_STAGING", pendingAction: "stage" });
    x.s.close();
    s = new core.Studio(x.root, "production");
    const svc = s.tmeDraftService();
    assert.equal(svc.batchUnits(b.id)[0].state, "TME_RECONCILE_REQUIRED");
    assert.equal(s.all("claims").length, 1);
  } finally {
    (s || x.s).close();
  }
});
const live = () => require("../build/tme-live.cjs");
function harness(states = ["ready", "ready"]) {
  let busy = 0,
    max = 0;
  const calls = [],
    units = states.map((s, i) => ({
      id: randomUUID(),
      batchId: "batch",
      workId: "work" + i,
      accountId: "account",
      draftId: "draft" + i,
      reviewHash: "a".repeat(64),
      state: s === "blocked" ? "TME_BLOCKED" : "TME_READY",
      issues: s === "blocked" ? ["bad"] : [],
      pendingAction: null,
      reason: "",
      attempts: 0,
      kind: "tme_uia",
    }));
  const drafts = units.map((u, i) => ({
    id: u.draftId,
    workId: u.workId,
    accountId: u.accountId,
    reviewHash: u.reviewHash,
    title: "原创" + i,
    source: "local",
    issues: [],
    metadata: { albumId: "100", coverPolicy: "preserve_album" },
    assets: { audio: { sha256: "b".repeat(64) }, cover: null, proof: null },
  }));
  let snapshot = {
    binding: { pid: 1, handle: "1", started: "time", account: "fixture" },
    url: "https://y.tencentmusic.com/#/user/manage/songlist/100",
    mode: "album",
    albumId: "100",
    rows: [],
    form: null,
    agreement: null,
  };
  const port = {
    async observe() {
      return structuredClone(snapshot);
    },
    async stage(d) {
      busy++;
      max = Math.max(max, busy);
      calls.push("stage:" + d.id);
      await new Promise((r) => setTimeout(r, 5));
      busy--;
      snapshot = {
        ...snapshot,
        mode: "authorization",
        form: { title: d.title },
        agreement: {
          text: "fixture agreement",
          checked: false,
          modeText: "three year nonexclusive",
        },
      };
      return structuredClone(snapshot);
    },
    async accept() {
      calls.push("accept");
      snapshot.agreement.checked = true;
      return structuredClone(snapshot);
    },
    async submit() {
      calls.push("submit");
      snapshot = {
        ...snapshot,
        mode: "success",
        rows: [
          {
            title: snapshot.form.title,
            status: "reviewing",
            songId: null,
            reason: "",
          },
        ],
      };
      return structuredClone(snapshot);
    },
  };
  const store = {
    async units(id) {
      return units
        .filter((u) => !id || u.batchId === id)
        .map((u) => structuredClone(u));
    },
    async batches() {
      return [{ id: "batch", accountId: "account", cancelled: false }];
    },
    async get(id) {
      return structuredClone(drafts.find((d) => d.id === id));
    },
    async assertCurrent() {},
    async updateUnit(id, p) {
      const u = units.find((u) => u.id === id);
      Object.assign(u, p);
      return structuredClone(u);
    },
    async updateBatch(id, p) {
      Object.assign(batch, p);
      return batch;
    },
    async claim(id, identity) {
      const u = units.find((u) => u.id === id);
      u.identity = identity;
      return structuredClone(u);
    },
    async start(id) {
      const u = units.find((u) => u.id === id);
      Object.assign(u, {
        state: "TME_STAGING",
        pendingAction: "stage",
        attempts: u.attempts + 1,
      });
      return structuredClone(u);
    },
  };
  const batch = { id: "batch", accountId: "account", cancelled: false };
  store.batches = async () => [structuredClone(batch)];
  const Manager = live().TmeLiveManager;
  assert.equal(typeof Manager, "function");
  const manager = new Manager(store, port, "fixture");
  return {
    manager,
    port,
    store,
    units,
    drafts,
    calls,
    setSnapshot(s) {
      snapshot = { ...snapshot, ...s };
    },
    get max() {
      return max;
    },
  };
}
test("live manager needs explicit visible-account binding and rejects account changes before staging", async () => {
  const x = harness();
  await assert.rejects(
    x.manager.runBatch({ batchId: "batch", confirmed: true }),
    /WINDOW_BINDING_REQUIRED/,
  );
  await x.manager.inspect({ expectedAccount: "fixture", accountId: "account" });
  x.setSnapshot({
    binding: { pid: 1, handle: "1", started: "time", account: "other" },
  });
  await assert.rejects(
    x.manager.runBatch({ batchId: "batch", confirmed: true }),
    /ACCOUNT_CHANGED/,
  );
  assert.deepEqual(x.calls, []);
});
test("batch skips known blocked items, stages serially and stops at per-song agreement", async () => {
  const x = harness(["blocked", "ready", "ready"]);
  await x.manager.inspect({ expectedAccount: "fixture", accountId: "account" });
  await x.manager.runBatch({ batchId: "batch", confirmed: true });
  assert.equal(x.calls.length, 1);
  assert.equal(x.units[1].state, "TME_AWAITING_AUTHORIZATION");
  assert.equal(x.units[2].state, "TME_READY");
  assert.equal(x.max, 1);
  assert(!x.calls.includes("accept"));
  assert(!x.calls.includes("submit"));
});
test("timeout persists unknown intent; retry never repeats upload", async () => {
  const x = harness();
  await x.manager.inspect({ expectedAccount: "fixture", accountId: "account" });
  x.port.stage = async () => {
    x.calls.push("stage");
    throw Error("UIA_TIMEOUT");
  };
  await x.manager.runBatch({ batchId: "batch", confirmed: true });
  assert.equal(x.units[0].state, "TME_RECONCILE_REQUIRED");
  await x.manager.runBatch({ batchId: "batch", confirmed: true });
  assert.deepEqual(x.calls, ["stage"]);
});
test("agreement acceptance and submit require independent single-use permits and matching current agreement", async () => {
  const x = harness(["ready"]);
  await x.manager.inspect({ expectedAccount: "fixture", accountId: "account" });
  await x.manager.runBatch({ batchId: "batch", confirmed: true });
  const id = x.units[0].id;
  const review = await x.manager.review({ unitId: id });
  assert.equal(review.action, "accept");
  await assert.rejects(
    x.manager.act({
      unitId: id,
      action: "submit",
      permit: review.permit,
      reviewHash: "a".repeat(64),
      confirmed: true,
    }),
    /ACTION_PERMIT_REQUIRED/,
  );
  const again = await x.manager.review({ unitId: id });
  await x.manager.act({
    unitId: id,
    action: "accept",
    permit: again.permit,
    reviewHash: "a".repeat(64),
    confirmed: true,
  });
  assert.deepEqual(x.calls, ["stage:draft0", "accept"]);
  await assert.rejects(
    x.manager.act({
      unitId: id,
      action: "accept",
      permit: again.permit,
      reviewHash: "a".repeat(64),
      confirmed: true,
    }),
    /ACTION_PERMIT_REQUIRED/,
  );
  const submit = await x.manager.review({ unitId: id });
  assert.equal(submit.action, "submit");
  await x.manager.act({
    unitId: id,
    action: "submit",
    permit: submit.permit,
    reviewHash: "a".repeat(64),
    confirmed: true,
  });
  assert.equal(x.units[0].state, "TME_REVIEWING");
  assert.equal(x.units[0].receipt.songId, null);
  assert.equal(x.units[0].receipt.albumId, "100");
  assert.equal(x.calls.filter((c) => c === "submit").length, 1);
});
test("batch cancel while a song stages prevents starting the next song", async () => {
  const x = harness();
  await x.manager.inspect({ expectedAccount: "fixture", accountId: "account" });
  const running = x.manager.runBatch({ batchId: "batch", confirmed: true });
  await x.manager.cancel({ batchId: "batch" });
  await running.catch((e) => assert.match(e.message, /BATCH_CANCELLED/));
  assert(x.calls.length <= 1);
  assert.equal(x.units[1].state, "TME_READY");
  await assert.rejects(
    x.manager.runBatch({ batchId: "batch", confirmed: true }),
    /BATCH_CANCELLED/,
  );
});
test("known preflight failure continues to the next eligible song without uploading failed item", async () => {
  const x = harness();
  x.port.preflight = (d) =>
    d.id === "draft0" ? "AUTHOR_ACCOUNT_READBACK_MISMATCH" : null;
  await x.manager.inspect({ expectedAccount: "fixture", accountId: "account" });
  await x.manager.runBatch({ batchId: "batch", confirmed: true });
  assert.deepEqual(x.calls, ["stage:draft1"]);
  assert.equal(x.units[0].state, "TME_BLOCKED");
  assert.equal(x.units[1].state, "TME_AWAITING_AUTHORIZATION");
});
test("duplicate run while busy cannot stage a song twice", async () => {
  const x = harness();
  await x.manager.inspect({ expectedAccount: "fixture", accountId: "account" });
  const a = x.manager.runBatch({ batchId: "batch", confirmed: true });
  await assert.rejects(
    x.manager.runBatch({ batchId: "batch", confirmed: true }),
    /TME_BUSY/,
  );
  await a;
  assert.equal(x.calls.length, 1);
});
test("agreement change after permit read blocks acceptance before platform write", async () => {
  const x = harness(["ready"]);
  await x.manager.inspect({ expectedAccount: "fixture", accountId: "account" });
  await x.manager.runBatch({ batchId: "batch", confirmed: true });
  const review = await x.manager.review({ unitId: x.units[0].id });
  x.setSnapshot({
    agreement: {
      text: "changed agreement",
      modeText: "three year nonexclusive",
      checked: false,
    },
  });
  await assert.rejects(
    x.manager.act({
      unitId: x.units[0].id,
      action: "accept",
      permit: review.permit,
      reviewHash: "a".repeat(64),
      confirmed: true,
    }),
    /AGREEMENT_CHANGED/,
  );
  assert.equal(x.calls.length, 1);
});
test("read-only row observation keeps song ID unknown and never claims client submission", async () => {
  const x = harness();
  await x.manager.inspect({ expectedAccount: "fixture", accountId: "account" });
  x.setSnapshot({
    rows: [
      { title: "外部提交作品", status: "reviewing", songId: null, reason: "" },
    ],
  });
  const r = await x.manager.sync({ title: "外部提交作品", albumId: "100" });
  assert.equal(r.receipt.songId, null);
  assert.equal(r.receipt.submissionByClient, false);
  assert.equal(r.receipt.match, "visible_title_album");
  assert.deepEqual(x.calls, []);
});
test("unknown timeout after submission is never converted into success or retried", async () => {
  const x = harness(["ready"]);
  await x.manager.inspect({ expectedAccount: "fixture", accountId: "account" });
  await x.manager.runBatch({ batchId: "batch", confirmed: true });
  let r = await x.manager.review({ unitId: x.units[0].id });
  await x.manager.act({
    unitId: r.unitId,
    action: "accept",
    permit: r.permit,
    reviewHash: r.reviewHash,
    confirmed: true,
  });
  r = await x.manager.review({ unitId: r.unitId });
  x.port.submit = async () => {
    x.calls.push("submit-timeout");
    throw Error("UIA_TIMEOUT");
  };
  await x.manager.act({
    unitId: r.unitId,
    action: "submit",
    permit: r.permit,
    reviewHash: r.reviewHash,
    confirmed: true,
  });
  assert.equal(x.units[0].state, "TME_RECONCILE_REQUIRED");
  assert.equal(x.units[0].pendingAction, "submit");
  await x.manager.runBatch({ batchId: "batch", confirmed: true });
  assert.equal(x.calls.filter((x) => x === "submit-timeout").length, 1);
  assert.equal(x.units[0].receipt, undefined);
});
test("live IPC rejects forged origins, extra payload and workspace changes before any platform call", async () => {
  const { registerTmeLiveHandlers } = require("../build/tme-live-ipc.cjs");
  const x = harness();
  let handler,
    generation = 1;
  registerTmeLiveHandlers(
    (n, f) => (handler = f),
    (e) => {
      if (!e.trusted) throw Error("IPC_SOURCE_REJECTED");
    },
    x.manager,
    {
      mode: () => "production",
      generation: () => generation,
      unavailable: () => false,
    },
  );
  assert.equal(
    (
      await handler(
        { trusted: false },
        {
          action: "inspect",
          input: { expectedAccount: "fixture", accountId: "account" },
        },
      )
    ).ok,
    false,
  );
  assert.equal(
    (
      await handler(
        { trusted: true },
        {
          action: "inspect",
          input: {
            expectedAccount: "fixture",
            accountId: "account",
            cookie: "no",
          },
        },
      )
    ).ok,
    false,
  );
  assert.equal(
    (
      await handler(
        { trusted: true },
        {
          action: "inspect",
          input: { expectedAccount: "fixture", accountId: "account" },
        },
      )
    ).ok,
    true,
  );
  generation++;
  assert.equal(
    (
      await handler(
        { trusted: true },
        { action: "run", input: { batchId: "batch", confirmed: true } },
      )
    ).error.code,
    "WORKSPACE_CHANGED",
  );
  assert.deepEqual(x.calls, []);
});
test("client disposal invalidates permits and terminates the short-lived native transport", async () => {
  const x = harness();
  let disposed = false;
  x.port.dispose = () => {
    disposed = true;
  };
  await x.manager.inspect({ expectedAccount: "fixture", accountId: "account" });
  x.manager.dispose();
  assert.equal(disposed, true);
  await assert.rejects(
    x.manager.sync({ title: "原创0", albumId: "100" }),
    /WINDOW_BINDING_REQUIRED/,
  );
});
test("local batch cancellation works before any browser binding", async () => {
  const x = setup();
  try {
    const d = x.prepare(x.work()),
      b = x.svc.planBatch({ workIds: [d.workId], accountId: x.account.id });
    const r = await x.s.call("tme.batchCancel", { id: b.id });
    assert.equal(r.cancelled, true);
    assert.equal(x.svc.batches()[0].state, "TME_CANCELLED");
    assert.equal(x.s.all("claims").length, 0);
  } finally {
    x.s.close();
  }
});
test("a fresh inspected session may reconcile old evidence but cannot resume old writes", async () => {
  const x = harness(["ready"]);
  await x.manager.inspect({ expectedAccount: "fixture", accountId: "account" });
  await x.manager.runBatch({ batchId: "batch", confirmed: true });
  x.units[0].state = "TME_RECONCILE_REQUIRED";
  x.units[0].pendingAction = "submit";
  x.manager.invalidate();
  await x.manager.inspect({ expectedAccount: "fixture", accountId: "account" });
  x.setSnapshot({
    mode: "album",
    form: null,
    agreement: null,
    rows: [{ title: "原创0", status: "reviewing", songId: null, reason: "" }],
  });
  const r = await x.manager.reconcile({ unitId: x.units[0].id });
  assert.equal(r.state, "TME_OBSERVED_EXISTING");
  assert.equal(r.receipt.submissionByClient, false);
  assert.equal(r.pendingAction, null);
  assert.equal(x.calls.length, 1);
});
test("claiming an external activity freezes its local reviewed draft", () => {
  const x = setup();
  try {
    const d = x.prepare(x.work()),
      b = x.svc.planBatch({ workIds: [d.workId], accountId: x.account.id }),
      u = x.svc.batchUnits(b.id)[0];
    x.svc.claimUnit(u.id, {
      subject: "visible:fixture",
      displayName: "fixture",
      device: "fixture",
      session: "s",
      source: "browser",
    });
    assert.equal(x.svc.get(d.id).identity.subject, "visible:fixture");
  } finally {
    x.s.close();
  }
});
test("a cancelled untouched batch can be planned again while keeping its history", () => {
  const x = setup();
  try {
    const d = x.prepare(x.work()),
      input = { workIds: [d.workId], accountId: x.account.id },
      a = x.svc.planBatch(input);
    x.svc.updateBatch(a.id, { cancelled: true, state: "TME_CANCELLED" });
    const b = x.svc.planBatch(input);
    assert.notEqual(b.id, a.id);
    assert.equal(x.svc.batches().length, 2);
  } finally {
    x.s.close();
  }
});
test("workspace invalidation interrupts any active native request and clears ownership", async () => {
  const x = harness();
  let count = 0;
  x.port.interrupt = () => {
    count++;
  };
  await x.manager.inspect({ expectedAccount: "fixture", accountId: "account" });
  const before = count;
  x.manager.invalidate();
  assert.equal(count, before + 1);
  await assert.rejects(
    x.manager.sync({ title: "原创0", albumId: "100" }),
    /WINDOW_BINDING_REQUIRED/,
  );
});
test("publish center remount safely excludes specialized Tencent batches and units", () => {
  const { renderPublishCenter } = require("../build/tme-publish-render.cjs");
  const html = renderPublishCenter({
    mode: "production",
    works: [],
    accounts: [],
    bindings: [],
    exceptions: [],
    targets: [],
    batches: [
      {
        id: "tme-specialized",
        kind: "tme_uia",
        workIds: ["w"],
        state: "TME_READY",
      },
    ],
    units: [
      {
        id: "u",
        kind: "tme_uia",
        batchId: "tme-specialized",
        state: "TME_READY",
      },
    ],
  });
  assert(html.includes("腾讯音乐人逐首资料与连接验证"));
  assert(!html.includes("tme-spec"));
});
test("generic publishing mutations reject specialized Tencent batch and unit IDs unchanged", async () => {
  const x = setup();
  try {
    const d = x.prepare(x.work()),
      b = x.svc.planBatch({ workIds: [d.workId], accountId: x.account.id }),
      u = x.svc.batchUnits(b.id)[0];
    for (const method of ["publish.pause", "publish.cancel", "publish.retry"])
      await assert.rejects(
        x.s.call(method, { id: b.id }),
        /TME_SPECIALIZED_CHANNEL_REQUIRED/,
      );
    await assert.rejects(
      x.s.call("publish.reconcile", { id: u.id }),
      /TME_SPECIALIZED_CHANNEL_REQUIRED/,
    );
    assert.equal(x.svc.batchUnits(b.id)[0].state, "TME_READY");
    assert.equal(x.svc.batches()[0].state, "TME_READY");
  } finally {
    x.s.close();
  }
});
test("native transport never invents song ownership after leaving and returning to title-less authorization", async () => {
  const { WindowsUiaTransport } = require("../build/tme-uia.cjs");
  const port = new WindowsUiaTransport("unused");
  const binding = { pid: 1, handle: "1", started: "ticks", account: "fixture" },
    url = "https://y.tencentmusic.com/#/user/manage/uploadToAlbum/100";
  port.owned = { title: "A", albumId: "100", url, binding };
  let snapshot = {
    binding,
    url,
    mode: "album",
    albumId: "100",
    rows: [],
    form: null,
    agreement: null,
  };
  port.request = async () => structuredClone(snapshot);
  await port.observe(binding);
  snapshot = {
    ...snapshot,
    mode: "authorization",
    agreement: { text: "agreement", modeText: "nonexclusive", checked: false },
  };
  const s = await port.observe(binding);
  assert.equal(s.form, null);
});
test("cancellation while claim is pending releases only a provably unstarted reservation", async () => {
  const x = setup();
  try {
    const d = x.prepare(x.work()),
      input = { workIds: [d.workId], accountId: x.account.id },
      batch = x.svc.planBatch(input);
    let signalClaim, releaseClaim;
    const entered = new Promise((r) => (signalClaim = r)),
      hold = new Promise((r) => (releaseClaim = r));
    let writes = 0;
    const snapshot = {
      binding: { pid: 1, handle: "1", started: "stamp", account: "fixture" },
      url: "https://y.tencentmusic.com/#/user/manage/songlist/100",
      mode: "album",
      albumId: "100",
      rows: [],
      form: null,
      agreement: null,
    };
    const store = {
      units: async (id) => x.svc.batchUnits(id),
      batches: async () => x.svc.batches(),
      get: async (id) => x.svc.get(id),
      assertCurrent: async (d) => x.svc.assertCurrent(d),
      updateUnit: async (id, p) => x.svc.updateUnit(id, p),
      updateBatch: async (id, p) => x.svc.updateBatch(id, p),
      claim: async (id, i) => {
        const u = x.svc.claimUnit(id, i);
        signalClaim();
        await hold;
        return u;
      },
      start: async (id) => x.svc.startUnit(id),
    };
    const manager = new (live().TmeLiveManager)(
      store,
      {
        observe: async () => structuredClone(snapshot),
        stage: async () => {
          writes++;
          throw Error("SHOULD_NOT_STAGE");
        },
      },
      "fixture",
    );
    await manager.inspect({
      expectedAccount: "fixture",
      accountId: x.account.id,
    });
    const run = manager.runBatch({ batchId: batch.id, confirmed: true });
    await entered;
    await manager.cancel({ batchId: batch.id });
    releaseClaim();
    await run;
    assert.equal(writes, 0);
    assert.equal(x.s.all("claims").length, 0);
    assert.equal(x.svc.get(d.id).identity, null);
    const next = x.svc.planBatch(input);
    assert.notEqual(next.id, batch.id);
    assert.equal(x.svc.batchUnits(next.id)[0].state, "TME_READY");
  } finally {
    x.s.close();
  }
});
test("cancelling after durable staging intent never releases claim or draft identity", () => {
  const x = setup();
  try {
    const d = x.prepare(x.work()),
      b = x.svc.planBatch({ workIds: [d.workId], accountId: x.account.id }),
      u = x.svc.batchUnits(b.id)[0];
    x.svc.claimUnit(u.id, {
      subject: "visible:fixture",
      displayName: "fixture",
      device: "fixture",
      session: "s",
      source: "browser",
    });
    x.svc.startUnit(u.id);
    x.svc.updateBatch(b.id, { cancelled: true, state: "TME_CANCELLED" });
    assert.equal(x.s.all("claims").length, 1);
    assert.equal(x.svc.get(d.id).identity.subject, "visible:fixture");
    assert.equal(x.svc.batchUnits(b.id)[0].pendingAction, "stage");
  } finally {
    x.s.close();
  }
});
test("nickname-only native identity blocks batch writes before any reservation or stage", async () => {
  const x = harness(["ready"]),
    { WindowsUiaTransport } = require("../build/tme-uia.cjs");
  let claims = 0,
    writes = 0;
  x.store.claim = async () => {
    claims++;
    throw Error("NO_CLAIM");
  };
  const port = new WindowsUiaTransport("unused"),
    binding = { pid: 1, handle: "1", started: "stamp", account: "fixture" };
  port.observe = async () => ({
    binding,
    url: "https://y.tencentmusic.com/#/user/manage/songlist/100",
    mode: "album",
    albumId: "100",
    rows: [],
    form: null,
    agreement: null,
  });
  port.stage = async () => {
    writes++;
    throw Error("NO_WRITE");
  };
  Object.assign(x.drafts[0].metadata, {
    ownLyricist: true,
    ownComposer: true,
    lyricist: "fixture",
    composer: "fixture",
  });
  const manager = new (live().TmeLiveManager)(x.store, port, "fixture");
  const c = await manager.inspect({
    expectedAccount: "fixture",
    accountId: "account",
  });
  assert.equal(c.writeAllowed, false);
  await assert.rejects(
    manager.runBatch({ batchId: "batch", confirmed: true }),
    /ACCOUNT_UNIQUE_ID_REQUIRED/,
  );
  assert.equal(claims, 0);
  assert.equal(writes, 0);
});
test("native transport itself rejects writes even if coordinator is bypassed", async () => {
  const { WindowsUiaTransport } = require("../build/tme-uia.cjs"),
    port = new WindowsUiaTransport("unused");
  let requests = 0;
  port.request = async () => {
    requests++;
    return { form: { title: "fixture", lyrics: "fixture" } };
  };
  const d = {
    title: "fixture",
    assets: {
      audio: { file: path.resolve("tests/tme-live.test.mjs"), sha256: "x" },
    },
    metadata: {
      ownLyricist: true,
      ownComposer: true,
      coverPolicy: "preserve_album",
      albumId: "100",
      lyrics: "fixture",
    },
  };
  await assert.rejects(
    port.stage(d, { account: "fixture" }),
    /ACCOUNT_UNIQUE_ID_REQUIRED/,
  );
  assert.equal(requests, 0);
});
test('restart releases an unstarted reservation but keeps its audit trail',()=>{const x=setup();let s;try{const d=x.prepare(x.work()),b=x.svc.planBatch({workIds:[d.workId],accountId:x.account.id}),u=x.svc.batchUnits(b.id)[0];x.svc.claimUnit(u.id,{subject:'visible:fixture',displayName:'fixture',device:'fixture',session:'s',source:'browser'});x.s.close();s=new core.Studio(x.root,'production');const svc=s.tmeDraftService();assert.equal(s.all('claims').length,0);assert.equal(svc.get(d.id).identity,null);assert.equal(svc.batchUnits(b.id)[0].state,'TME_READY');assert(s.all('audit').some(a=>a.type==='tme.release_unstarted'));}finally{(s||x.s).close()}});
test('blank genre and language normalize before review hash and persisted confirmation',()=>{const x=setup();try{const d=x.prepare(x.work()),input={workId:d.workId,accountId:d.accountId,metadata:{...d.metadata,genre:'',language:' \t'},confirmations:{}};const p=x.svc.preview(input),canonical=x.svc.preview({...input,metadata:{...input.metadata,genre:'流行',language:'国语'}});assert.equal(p.metadata.genre,'流行');assert.equal(p.metadata.language,'国语');assert.equal(p.reviewHash,canonical.reviewHash);const saved=x.svc.prepare({...input,confirmations:{rights:true,authors:true,ai:true,lyricsHash:p.lyricsHash,recordingHash:p.audio.sha256,reviewHash:p.reviewHash}});assert.equal(saved.metadata.genre,'流行');assert.equal(saved.metadata.language,'国语');assert.deepEqual(saved.issues,[]);}finally{x.s.close()}});
