import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
const w = createRequire(import.meta.url)(
  process.env.RAINFALL_TME_AI_BROKER_BUNDLE,
);
function setup(t, options = {}) {
  const root = path.resolve("output/test-runs/ai-broker-" + randomUUID());
  fs.mkdirSync(root, { recursive: true });
  const workId = randomUUID(),
    repo = new w.Repository(path.join(root, "db.sqlite"));
  t.after(() => repo.close());
  const source = "a".repeat(64),
    pcm = path.join(root, "approved-A.wav"),
    cover = path.join(root, "cover.png");
  const seconds = options.durationSeconds ?? 210;
  const header = Buffer.alloc(44),
    dataBytes = seconds * 16000;
  header.write("RIFF");
  header.writeUInt32LE(dataBytes + 36, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  fs.writeFileSync(pcm, Buffer.concat([header, Buffer.alloc(dataBytes)]));
  fs.writeFileSync(cover, "offline image fixture");
  const m = {
      title: "原创测试",
      albumTitle: "原创测试",
      albumDescription: "本地原创测试专辑",
      artistName: "测试艺人",
      lyricist: "测试艺人",
      composer: "测试艺人",
      ownLyrics: true,
      ownComposition: true,
      aiTool: "offline tool",
      generatedOn: "2026-10-16",
      allowCover: true,
      genre: "流行",
      language: "国语",
      version: "完整版",
      releaseMode: "审核通过即发布",
    },
    lyrics = "原创离线歌词，无外部内容";
  const scope = {
    workId,
    variant: "A",
    prepareOnly: true,
    consent: true,
    sourceAudio: { assetId: randomUUID(), sha256: source, variant: "A" },
    upload: {
      path: pcm,
      sha256: w.hash(fs.readFileSync(pcm)),
      format: "pcm_wav",
      derivedFromSha256: source,
    },
    cover: { assetId: randomUUID(), sha256: w.hash(fs.readFileSync(cover)) },
    lyricsHash: w.hash(lyrics),
    metadata: m,
    existingAudioEvidence: {
      sourceSha256: source,
      derivativeSha256: w.hash(fs.readFileSync(pcm)),
      uploadAcceptanceProven: true,
      confirmationMethod:
        "UIA exact Shell file ListItem selection and InvokePattern; same pending picker",
    },
  };
  fs.mkdirSync(path.join(root, "authorizations", "tme-ai"), {
    recursive: true,
  });
  const write = () =>
    fs.writeFileSync(
      path.join(root, "authorizations", "tme-ai", workId + ".json"),
      JSON.stringify(scope),
    );
  write();
  const verifierCalls = [];
  const serviceOptions = {
    verifyAssets: () => true,
    verifyResumePicker: (g, dialog) => {
      verifierCalls.push({ kind: "picker", dialog: structuredClone(dialog) });
      return path.resolve(dialog.actualDirectory) === path.dirname(cover);
    },
    verifyResumeCrop: (g, selection) => {
      verifierCalls.push({
        kind: "crop",
        selection: structuredClone(selection),
      });
      return selection.path === cover && selection.sha256 === g.cover.sha256;
    },
    ...options.service,
  };
  const service = new w.TmeAiPrepareService(repo, serviceOptions),
    calls = [],
    rpcCalls = [];
  let mode = "editor",
    failure = null,
    loseObservation = false,
    phase = options.recoverCover ? "unselected" : "selected",
    generation = 1,
    hostSourceHash = "d".repeat(64);
  const picker = {
    handle: "987",
    owner: "456",
    pid: 124,
    name: "打开",
    actualDirectory: path.dirname(cover),
    selectedFileName: null,
  };
  const crop = {
    groupId: "42.18.7",
    heading: "调整图片",
    confirmName: "确认",
    imageCount: 1,
  };
  const raw = () => ({
    binding: {
      pid: 123,
      handle: "456",
      started: "2026-10-16T09:00:00Z",
      documentId: "offline-editor",
    },
    identity: {
      kugouId: "123456789",
      qqDisplayName: "测试QQ",
      artistName: m.artistName,
      selectedTab: "绑定其他平台账号",
    },
    observedAt: new Date().toISOString(),
    route: "https://y.tencentmusic.com/#/user/manage/aiChoose/add",
    mode,
    modeText: mode === "ai_authorization" ? "非独家授权；授权3年" : "editor",
    visibleSubmitButton: mode === "ai_authorization",
    termsText:
      mode === "ai_authorization"
        ? "非独家授权，授权3年，期间歌曲不可独家授权其他平台"
        : null,
    form: {
      title: m.title,
      lyrics,
      aiTool: m.aiTool,
      generatedOn: m.generatedOn,
      genre: m.genre,
      language: m.language,
      albumLanguage: m.language,
      albumGenre: m.genre,
      albumType: "录音室专辑",
      albumTitle: m.albumTitle,
      albumDescription: m.albumDescription,
      ownLyrics: true,
      ownComposition: true,
      allowCover: true,
      version: true,
      releaseMode: true,
      text: `${path.basename(pcm)} 03:30\n歌手名\n测试艺人\n曲风\n作词\n测试艺人\n作曲\n测试艺人\nAI制作信息\n专辑歌手\n测试艺人\n专辑类型`,
    },
  });
  const nativeRaw = raw;
  const observed = () => {
    const value = nativeRaw();
    value.form.text = value.form.text.replace(
      "03:30",
      options.durationText ?? "03:30",
    );
    if (phase === "crop") value.form.text += "\n调整图片";
    value.form.text += options.formTextSuffix ?? "";
    return {
      ...value,
      coverState: {
        manualSelected: phase === "selected",
        generatorBanner: phase === "unselected",
      },
      saveEvidence: {
        source: "local_material_snapshot",
        remoteSavedVerified: false,
        text: "保存成功",
        observedAt: new Date().toISOString(),
      },
    };
  };
  const snap = w.nativeSnapshot(observed());
  scope.adoptExistingAudio = {
    subjectHash: snap.identity.subjectHash,
    binding: snap.binding,
    title: m.title,
    fileName: path.basename(pcm),
    duration: options.durationText ?? "03:30",
    remoteContentShaVerified: false,
  };
  write();
  const port = {
    async request(action, input) {
      calls.push({ action, step: input.step, input: structuredClone(input) });
      await options.onNative?.(action, input);
      if (action === "step" && input.step === failure)
        throw Error("NATIVE_CONTROL_CONTRACT_FAILED");
      if (action === "observe" && loseObservation) throw Error("WINDOW_GONE");
      if (
        options.recoverCover &&
        action === "step" &&
        input.step === "set_cover"
      )
        throw Error("FILE_NAME_CONTROL_REQUIRED");
      if (action === "inspect_picker" || action === "locate_cover_picker")
        return { snapshot: observed(), dialog: structuredClone(picker) };
      if (action === "resume_cover_picker") {
        phase = "crop";
        throw Error("CROP_DIALOG_SCOPE_REQUIRED");
      }
      if (action === "inspect_crop")
        return { snapshot: observed(), crop: structuredClone(crop) };
      if (action === "confirm_existing_crop") {
        phase = "selected";
        if (options.cropOutcome === "success") return {snapshot: observed(), status: "applied"};
        throw Error(options.cropError ?? "NATIVE_CONTROL_CONTRACT_FAILED");
      }
      if (input.step === "advance_to_terms") mode = "ai_authorization";
      return {
        snapshot: observed(),
        status:
          input.step === "upload_audio" || input.step === "locate_intake"
            ? "verified_existing"
            : "applied",
        receipt: input.step === "set_cover" ? { selectedPath: cover } : null,
      };
    },
  };
  const rpc = async (method, input = {}) => {
    try {
      const a = method.replace("internal.tmeAiPrepare.", "");
      rpcCalls.push({ action: a, input: structuredClone(input) });
      let value;
      if (a === "context") {
        value = {
          ...service.context(input.id),
          lyricsText: lyrics,
          coverPath: cover,
        };
      } else if (a === "contextPublic") value = service.contextPublic(input.id);
      else if (a === "listPublic") value = service.listPublic();
      else value = service[a](input);
      await options.afterRpc?.(a, value);
      return { ok: true, value };
    } catch (e) {
      return { ok: false, error: { code: e.message } };
    }
  };
  const broker = w.createTmeAiPrepareBroker({
    root,
    rpc,
    port,
    available: () => true,
    generation: () => generation,
    nativeHostHash: () => hostSourceHash,
    readbackTimeoutMs: options.readbackTimeoutMs,
  });
  const start = async () => {
    const g = await broker.ui("register", { workId, consent: true });
    return broker.ui("start", {
      grantId: g.id,
      expectedRevision: g.revision,
      consent: true,
    });
  };
  const manifest = (job) => {
    scope.cropRecovery = {
      operationId: service.context(job.id).job.operationId,
      jobId: job.id,
      provenance: "phase_contract_reconstruction",
      hostSourceHash,
      groupId: crop.groupId,
    };
    write();
  };
  return {
    broker,
    service,
    serviceOptions,
    repo,
    calls,
    rpcCalls,
    verifierCalls,
    start,
    scope,
    write,
    raw,
    picker,
    crop,
    cover,
    manifest,
    generation: (n) => {
      generation = n;
    },
    hostHash: (s) => {
      hostSourceHash = s;
    },
    fail: (s, lose) => {
      failure = s;
      loseObservation = lose;
    },
  };
}
test("preparation derives the new song duration from its PCM bytes instead of assuming 03:30", async (t) => {
  const x = setup(t, { durationSeconds: 175, durationText: "02:55" }),
    c = await x.start();
  const r = await x.broker.ui("run", {
    id: c.job.id,
    expectedRevision: c.job.revision,
    consent: true,
  });
  assert.equal(r.job.state, "awaiting_terms_review");
  const upload = x.calls.find((c) => c.step === "upload_audio");
  assert.equal(upload.input.expectedAudioDuration, "02:55");
});
test("actual broker/native boundary stops at fresh terms, hashes local selected cover and never offers submit", async (t) => {
  const x = setup(t),
    c = await x.start();
  const result = await x.broker.ui("run", {
    id: c.job.id,
    expectedRevision: c.job.revision,
    consent: true,
  });
  assert.equal(result.job.state, "awaiting_terms_review");
  assert.equal(result.job.remoteId, null);
  assert.equal(result.job.submissionByClient, false);
  assert.equal(x.calls.filter((c) => c.action === "step").length, 6);
  await x.broker.ui("run", {
    id: result.job.id,
    expectedRevision: result.job.revision,
    consent: true,
  });
  assert.equal(x.calls.filter((c) => c.action === "step").length, 6);
  for (const action of ["submit", "accept", "record", "claim"])
    await assert.rejects(x.broker.ui(action, {}), /ACTION_NOT_ALLOWED/);
  assert.equal(
    JSON.stringify(await x.broker.ui("list")).includes("123456789"),
    false,
  );
});
test("missing historical A selection provenance freezes instead of reuploading or manufacturing remote hashes", async (t) => {
  const x = setup(t);
  delete x.scope.existingAudioEvidence;
  x.write();
  const c = await x.start(),
    r = await x.broker.ui("run", {
      id: c.job.id,
      expectedRevision: c.job.revision,
      consent: true,
    });
  assert.equal(r.job.state, "reconcile_required");
  assert.equal(r.job.reason, "EXISTING_AUDIO_PROVENANCE_REQUIRED");
  const count = x.calls.length;
  await x.broker.ui("run", {
    id: r.job.id,
    expectedRevision: r.job.revision,
    consent: true,
  });
  assert.equal(x.calls.length, count);
});
test("lost native window durably interrupts without fabricating a fresh observation", async (t) => {
  const x = setup(t);
  x.fail("set_cover", true);
  const c = await x.start(),
    r = await x.broker.ui("run", {
      id: c.job.id,
      expectedRevision: c.job.revision,
      consent: true,
    });
  assert.equal(r.job.state, "reconcile_required");
  const op = x.service.context(r.job.id).operations.at(-1);
  assert.equal(op.state, "unknown");
  assert.equal(op.result, undefined);
});
test("renderer cannot register B, inject paths/identity, or invoke private evidence methods", async (t) => {
  const x = setup(t);
  await assert.rejects(
    x.broker.ui("register", {
      workId: x.scope.workId,
      consent: true,
      upload: { path: "B.wav" },
    }),
  );
  await assert.rejects(
    x.broker.ui("register", { workId: randomUUID(), consent: true }),
  );
  const raw = x.raw();
  raw.form.ownLyrics = false;
  assert.throws(
    () => w.verifyNativeMetadata(raw, x.scope, raw.form.lyrics),
    /METADATA_READBACK_REQUIRED/,
  );
  raw.form.ownLyrics = true;
  raw.form.text = raw.form.text.replace("作词\n测试艺人", "作词\n别人");
  assert.throws(
    () => w.verifyNativeMetadata(raw, x.scope, raw.form.lyrics),
    /AUTHOR_CHIP/,
  );
});

const execute = (x, action, job) =>
  x.broker.ui(action, {
    id: job.id,
    expectedRevision: job.revision,
    consent: true,
  });
async function pendingPicker(x) {
  const c = await x.start();
  return (await execute(x, "run", c.job)).job;
}
async function pendingCrop(x) {
  const picker = await pendingPicker(x);
  assert.equal(picker.reason, "FILE_NAME_CONTROL_REQUIRED");
  const crop = (await execute(x, "resumePicker", picker)).job;
  assert.equal(crop.reason, "CROP_DIALOG_SCOPE_REQUIRED");
  x.manifest(crop);
  return crop;
}
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("picker to crop to read-only cover reconciliation retains the original operation and never repeats upload", async (t) => {
  const x = setup(t, { recoverCover: true });
  let job = await pendingPicker(x);
  const original = x.service.context(job.id).operations.at(-1),
    operationId = original.id;
  assert.equal(original.step, "set_cover");
  assert.equal(original.state, "unknown");
  job = (await execute(x, "resumePicker", job)).job;
  x.manifest(job);
  const pickerCall = x.calls.find((c) => c.action === "resume_cover_picker");
  assert.equal(pickerCall.input.dialogHandle, x.picker.handle);
  assert.equal(pickerCall.input.coverPath, x.cover);
  assert.deepEqual(
    pickerCall.input.binding,
    x.scope.adoptExistingAudio.binding,
  );
  assert.equal(
    x.repo.get("operations", operationId).pickerResume.original.id,
    operationId,
  );
  job = (await execute(x, "resumeCrop", job)).job;
  assert.equal(job.reason, "NATIVE_CONTROL_CONTRACT_FAILED");
  const cropCall = x.calls.find((c) => c.action === "confirm_existing_crop");
  assert.deepEqual(cropCall.input, {
    binding: x.scope.adoptExistingAudio.binding,
    artistName: x.scope.metadata.artistName,
    groupId: x.crop.groupId,
  });
  const operation = x.repo.get("operations", operationId);
  assert.equal(operation.cropResume.original.id, operationId);
  assert.equal(
    operation.cropResume.selection.provenance,
    "phase_contract_reconstruction",
  );
  assert.equal(operation.cropResume.selection.remoteContentShaVerified, false);
  assert.equal(operation.cropResume.selection.dialogHandle, x.picker.handle);
  assert.equal(
    operation.cropResume.selection.hostSourceHash,
    x.scope.cropRecovery.hostSourceHash,
  );
  const count = x.calls.length,
    ops = x.service.context(job.id).operations.length;
  const read = await x.broker.ui("reconcile", { id: job.id });
  assert.equal(read.job.state, "ready");
  assert.equal(read.job.step, "save_album");
  const reconciliationReads=x.calls.slice(count);
  assert.ok(reconciliationReads.length>=3);
  assert.ok(reconciliationReads.every(c=>c.action==="observe"));
  assert.equal(x.service.context(job.id).operations.length, ops);
  const settled = x.repo.get("operations", operationId);
  assert.equal(settled.state, "complete");
  assert.equal(settled.result.status, "verified_existing");
  assert.equal(
    settled.readOnlyCoverReconciliation.original.cropResume.original
      .pickerResume.original.result.reason,
    "FILE_NAME_CONTROL_REQUIRED",
  );
  assert.equal(
    x.calls.filter((c) => c.action === "step" && c.step === "upload_audio")
      .length,
    1,
  );
  assert.equal(
    x.calls.filter((c) => c.action === "step" && c.step === "set_cover").length,
    1,
  );
  assert.equal(
    x.calls.filter((c) => c.action === "resume_cover_picker").length,
    1,
  );
  assert.equal(
    x.calls.filter((c) => c.action === "confirm_existing_crop").length,
    1,
  );
  assert.ok(
    x.verifierCalls.some(
      (c) => c.kind === "crop" && c.selection.path === x.cover,
    ),
  );
  const beforeRepeat = x.calls.length;
  await assert.rejects(
    execute(x, "resumeCrop", read.job),
    /CROP_RECONSTRUCTION_SCOPE_REQUIRED/,
  );
  assert.equal(x.calls.length, beforeRepeat);
  assert.equal(read.job.remoteId, null);
  assert.equal(read.job.submissionByClient, false);
});

test("a pending inspection excludes concurrent inspect and run until its asynchronous native read settles", async (t) => {
  const entered = deferred(),
    release = deferred();
  let pause = false;
  const x = setup(t, {
    onNative: async (action) => {
      if (pause && action === "inspect") {
        entered.resolve();
        await release.promise;
      }
    },
  });
  const c = await x.start();
  pause = true;
  const first = x.broker.ui("inspect", {});
  await entered.promise;
  try {
    const count = x.calls.length;
    await assert.rejects(x.broker.ui("inspect", {}), /NATIVE_PREPARATION_BUSY/);
    await assert.rejects(execute(x, "run", c.job), /NATIVE_PREPARATION_BUSY/);
    assert.equal(x.calls.length, count);
  } finally {
    pause = false;
    release.resolve();
    await first;
  }
  assert.ok((await x.broker.ui("inspect", {})).identity.maskedKugouId);
});

test("a pending native step holds busy against both inspect and a duplicate run", async (t) => {
  const entered = deferred(),
    release = deferred();
  const x = setup(t, {
    onNative: async (action, input) => {
      if (action === "step" && input.step === "locate_intake") {
        entered.resolve();
        await release.promise;
      }
    },
  });
  const c = await x.start(),
    first = execute(x, "run", c.job);
  await entered.promise;
  try {
    await assert.rejects(x.broker.ui("inspect", {}), /NATIVE_PREPARATION_BUSY/);
    await assert.rejects(execute(x, "run", c.job), /NATIVE_PREPARATION_BUSY/);
    assert.equal(x.calls.filter((c) => c.action === "step").length, 1);
  } finally {
    release.resolve();
    await first;
  }
  assert.equal(
    (await x.broker.ui("context", { id: c.job.id })).job.state,
    "awaiting_terms_review",
  );
});

test("a workspace generation change immediately after a durable claim prevents native dispatch", async (t) => {
  let x;
  x = setup(t, {
    afterRpc: (action) => {
      if (action === "claim") x.generation(2);
    },
  });
  const c = await x.start();
  await assert.rejects(execute(x, "run", c.job), /WORKSPACE_CHANGED/);
  assert.equal(x.calls.filter((c) => c.action === "step").length, 0);
  const before = x.service.context(c.job.id);
  assert.equal(before.operations.length, 1);
  assert.equal(before.operations[0].state, "dispatching");
  const recovered = new w.TmeAiPrepareService(x.repo, x.serviceOptions);
  assert.equal(recovered.context(c.job.id).job.state, "reconcile_required");
  assert.equal(recovered.context(c.job.id).operations[0].state, "unknown");
  const count = x.calls.length;
  await execute(x, "run", recovered.context(c.job.id).job);
  assert.equal(x.calls.length, count);
});

test("a workspace change after resuming a picker claim prevents any picker continuation", async (t) => {
  let x;
  x = setup(t, {
    recoverCover: true,
    afterRpc: (action) => {
      if (action === "resumeInterruptedPicker") x.generation(2);
    },
  });
  const job = await pendingPicker(x);
  await assert.rejects(execute(x, "resumePicker", job), /WORKSPACE_CHANGED/);
  assert.equal(
    x.calls.filter((c) => c.action === "resume_cover_picker").length,
    0,
  );
  assert.equal(
    x.service.context(job.id).operations.at(-1).state,
    "dispatching",
  );
});

test("other unknown outcomes cannot enter either picker or crop recovery and reconciliation stays read-only", async (t) => {
  const x = setup(t);
  x.fail("set_cover", false);
  const job = await pendingPicker(x);
  assert.equal(job.reason, "NATIVE_CONTROL_CONTRACT_FAILED");
  const count = x.calls.length;
  await assert.rejects(execute(x, "resumePicker", job), /PICKER_RESUME_SCOPE/);
  await assert.rejects(
    execute(x, "resumeCrop", job),
    /CROP_RECONSTRUCTION_SCOPE_REQUIRED/,
  );
  const read = await x.broker.ui("reconcile", { id: job.id });
  assert.equal(read.job.state, "reconcile_required");
  assert.equal(x.calls.length, count);
});

test("crop continuation is bound to the private job operation manifest and current native host source hash", async (t) => {
  const x = setup(t, { recoverCover: true }),
    job = await pendingCrop(x),
    valid = structuredClone(x.scope.cropRecovery);
  for (const recovery of [
    undefined,
    { ...valid, jobId: randomUUID() },
    { ...valid, operationId: randomUUID() },
    { ...valid, provenance: "native_returned_receipt" },
    { ...valid, hostSourceHash: "e".repeat(64) },
  ]) {
    x.scope.cropRecovery = recovery;
    x.write();
    const count = x.calls.length;
    await assert.rejects(
      execute(x, "resumeCrop", job),
      /CROP_RECONSTRUCTION_SCOPE_REQUIRED/,
    );
    assert.equal(x.calls.length, count);
  }
  x.scope.cropRecovery = valid;
  x.write();
  x.hostHash("f".repeat(64));
  await assert.rejects(
    execute(x, "resumeCrop", job),
    /CROP_RECONSTRUCTION_SCOPE_REQUIRED/,
  );
  assert.equal(
    x.calls.filter((c) => c.action === "confirm_existing_crop").length,
    0,
  );
  const count = x.calls.length;
  await assert.rejects(
    x.broker.ui("resumeCrop", {
      id: job.id,
      expectedRevision: job.revision,
      consent: true,
      hostSourceHash: valid.hostSourceHash,
    }),
  );
  assert.equal(x.calls.length, count);
});

test("a different crop group cannot be confirmed and leaves the original unknown operation unchanged", async (t) => {
  const x = setup(t, { recoverCover: true }),
    job = await pendingCrop(x),
    op = structuredClone(x.service.context(job.id).operations.at(-1));
  x.crop.groupId = "42.18.8";
  await assert.rejects(execute(x, "resumeCrop", job), /CROP_GROUP_CHANGED/);
  assert.equal(
    x.calls.filter((c) => c.action === "confirm_existing_crop").length,
    0,
  );
  assert.deepEqual(x.service.context(job.id).operations.at(-1), op);
});

test("picker continuation rejects an alien owner or a selected file without dispatching a second selection", async (t) => {
  for (const patch of [{ owner: "999" }, { selectedFileName: "other.png" }]) {
    const x = setup(t, { recoverCover: true }),
      job = await pendingPicker(x);
    Object.assign(x.picker, patch);
    await assert.rejects(execute(x, "resumePicker", job));
    assert.equal(
      x.calls.filter((c) => c.action === "resume_cover_picker").length,
      0,
    );
    assert.equal(x.service.context(job.id).job.state, "reconcile_required");
  }
});

test("a native host source change while crop inspection awaits cannot authorize confirming with old phase evidence", async (t) => {
  let x;
  x = setup(t, {
    recoverCover: true,
    onNative: (action) => {
      if (action === "inspect_crop") x.hostHash("e".repeat(64));
    },
  });
  const job = await pendingCrop(x);
  await assert.rejects(
    execute(x, "resumeCrop", job),
    /CROP_RECONSTRUCTION_SCOPE_REQUIRED|HOST_SOURCE_CHANGED/,
  );
  assert.equal(
    x.calls.filter((c) => c.action === "confirm_existing_crop").length,
    0,
  );
  assert.equal(
    x.service.context(job.id).operations.at(-1).cropResume,
    undefined,
  );
});

test("a native host source change after the crop claim freezes its original operation before confirming", async (t) => {
  let x;
  x = setup(t, {
    recoverCover: true,
    afterRpc: (action) => {
      if (action === "resumeInterruptedCrop") x.hostHash("e".repeat(64));
    },
  });
  const job = await pendingCrop(x),
    result = await execute(x, "resumeCrop", job);
  assert.equal(result.job.state, "reconcile_required");
  assert.match(result.job.reason, /HOST_SOURCE_CHANGED/);
  assert.equal(
    x.calls.filter((c) => c.action === "confirm_existing_crop").length,
    0,
  );
  const op = x.service.context(job.id).operations.at(-1);
  assert.equal(op.state, "unknown");
  assert.equal(
    op.cropResume.selection.hostSourceHash,
    x.scope.cropRecovery.hostSourceHash,
  );
});

test("a workspace change after the crop claim prevents confirming and retains the durable claim", async (t) => {
  let x;
  x = setup(t, {
    recoverCover: true,
    afterRpc: (action) => {
      if (action === "resumeInterruptedCrop") x.generation(2);
    },
  });
  const job = await pendingCrop(x);
  await assert.rejects(execute(x, "resumeCrop", job), /WORKSPACE_CHANGED/);
  assert.equal(
    x.calls.filter((c) => c.action === "confirm_existing_crop").length,
    0,
  );
  const op = x.service.context(job.id).operations.at(-1);
  assert.equal(op.state, "dispatching");
  assert.ok(op.cropResume);
});


test("read-only cover reconciliation does not mistake lyric crop words for a live modal", async (t) => {
 const x=setup(t,{recoverCover:true,formTextSuffix:"\n歌词：调整图片与裁剪图片只是故事。"});
 let job=await pendingCrop(x);job=(await execute(x,"resumeCrop",job)).job;
 const count=x.calls.length,opId=x.service.context(job.id).job.operationId;
 const read=await x.broker.ui("reconcile",{id:job.id});
 assert.equal(read.job.state,"ready");assert.equal(read.job.step,"save_album");
 assert.ok(x.calls.slice(count).every(c=>c.action==="observe"));
 assert.equal(x.repo.get("operations",opId).state,"complete");
 assert.equal(x.calls.filter(c=>c.action==="confirm_existing_crop").length,1);
});
test("a successful existing crop resumes once through the local snapshot to the unaccepted terms page", async (t) => {
 const x=setup(t,{recoverCover:true,cropOutcome:"success"});
 const job=await pendingCrop(x),before=x.service.context(job.id).operations.length;
 const result=await execute(x,"resumeCrop",job);
 assert.equal(result.job.state,"awaiting_terms_review");
 assert.equal(x.calls.filter(c=>c.action==="confirm_existing_crop").length,1);
 assert.equal(x.calls.filter(c=>c.action==="resume_cover_picker").length,1);
 assert.equal(x.calls.filter(c=>c.action==="step"&&c.step==="set_cover").length,1);
 assert.equal(result.job.submissionByClient,false);assert.equal(result.job.remoteId,null);
 assert.equal(x.service.context(job.id).operations.length,before+2);
});
test("a crop timeout preserves the original claim and cannot trigger another confirm or upload", async (t) => {
 const x=setup(t,{recoverCover:true,cropError:"MANUAL_COVER_ACCEPTANCE_REQUIRED"});
 let job=await pendingCrop(x);job=(await execute(x,"resumeCrop",job)).job;
 assert.equal(job.state,"reconcile_required");
 const calls=x.calls.length;
 await assert.rejects(execute(x,"resumeCrop",job),/CROP_RECONSTRUCTION_SCOPE_REQUIRED/);
 assert.equal(x.calls.length,calls);assert.equal(x.calls.filter(c=>c.action==="confirm_existing_crop").length,1);
 assert.equal(x.service.context(job.id).operations.at(-1).reason,"MANUAL_COVER_ACCEPTANCE_REQUIRED");
});

test("a delayed successful crop readback can recover from its timeout without another mutation", async (t) => {
 const x=setup(t,{recoverCover:true,cropError:"MANUAL_COVER_ACCEPTANCE_REQUIRED"});
 let job=await pendingCrop(x);job=(await execute(x,"resumeCrop",job)).job;
 const calls=x.calls.length,operationId=x.service.context(job.id).job.operationId;
 const result=await x.broker.ui("reconcile",{id:job.id});
 assert.equal(result.job.state,"ready");assert.equal(result.job.step,"save_album");
 assert.ok(x.calls.slice(calls).every(c=>c.action==="observe"));
 assert.equal(x.calls.filter(c=>c.action==="confirm_existing_crop").length,1);
 assert.equal(x.calls.filter(c=>c.action==="resume_cover_picker").length,1);
 assert.equal(x.repo.get("operations",operationId).readOnlyCoverReconciliation.original.reason,"MANUAL_COVER_ACCEPTANCE_REQUIRED");
});
test("a timed out in-flight observation keeps native operations locked until that exact request settles", async (t) => {
 const started=deferred(),release=deferred();let stall=false;
 const x=setup(t,{recoverCover:true,readbackTimeoutMs:20,onNative:async action=>{if(stall&&action==="observe"){started.resolve();await release.promise;}}});
 let job=await pendingCrop(x);job=(await execute(x,"resumeCrop",job)).job;
 stall=true;const pending=x.broker.ui("reconcile",{id:job.id});
 await started.promise;
 await assert.rejects(pending,/MANUAL_COVER_ACCEPTANCE_REQUIRED/);
 const calls=x.calls.length;
 await assert.rejects(x.broker.ui("inspect",{workId:x.scope.workId}),/NATIVE_PREPARATION_BUSY/);
 assert.equal(x.calls.length,calls);
 release.resolve();await new Promise(resolve=>setTimeout(resolve,0));
 stall=false;await x.broker.ui("inspect",{workId:x.scope.workId});
 assert.equal(x.calls.length,calls+1);
});
