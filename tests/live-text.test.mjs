import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import path from "node:path";
const require = createRequire(import.meta.url);
const w = require(process.env.RAINFALL_LIVE_TEXT_BUNDLE);
const { draft } = require("./fixtures/workflow.cjs");
const usage = {
  prompt_tokens: 100,
  completion_tokens: 200,
  prompt_cache_hit_tokens: 20,
  prompt_cache_miss_tokens: 80,
};
const response = (changes = {}) => ({
  id: "remote-completion-1",
  model: "deepseek-flash",
  choices: [
    { finish_reason: "stop", message: { content: JSON.stringify(draft()) } },
  ],
  usage,
  ...changes,
});
const request = () => ({
  operationId: randomUUID(),
  modelId: "deepseek-flash",
  maxOutputTokens: 2048,
  messages: [
    { role: "system", content: "Return JSON." },
    { role: "user", content: "Write an original song." },
  ],
});

test("DeepSeek adapter uses only the official fixed JSON completion contract and records usage estimates", async () => {
  assert.equal(typeof w.DeepSeekAdapter, "function");
  const calls = [];
  const adapter = new w.DeepSeekAdapter({
    credential: async () => "FAKE_UNIT_SECRET",
    request: async (input) => {
      calls.push(input);
      return { status: 200, body: response() };
    },
  });
  const result = await adapter.invoke(request());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.deepseek.com/chat/completions");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body.thinking, { type: "disabled" });
  assert.deepEqual(calls[0].body.response_format, { type: "json_object" });
  assert.equal(calls[0].body.max_tokens, 2048);
  assert.equal(calls[0].body.stream, false);
  assert.equal(result.status, "complete");
  assert.equal(result.providerModel, "deepseek-flash");
  assert.equal(result.providerRequestId, "remote-completion-1");
  assert.deepEqual(result.usage, usage);
  assert.equal(result.estimatedCostMicros, 270);
  assert.equal(result.priceVersion, "deepseek-peak-usd-2026-10-16");
  assert.equal(result.draft.title, draft().title);
  assert(!JSON.stringify(result).includes("FAKE_UNIT_SECRET"));
});

test("invalid JSON, truncation and empty content retain real usage and nonzero estimated charges", async () => {
  for (const choices of [
    [{ finish_reason: "stop", message: { content: "{bad" } }],
    [
      {
        finish_reason: "length",
        message: { content: JSON.stringify(draft()) },
      },
    ],
    [{ finish_reason: "stop", message: { content: "" } }],
  ]) {
    const adapter = new w.DeepSeekAdapter({
      credential: async () => "FAKE",
      request: async () => ({ status: 200, body: response({ choices }) }),
    });
    const result = await adapter.invoke(request());
    assert.equal(result.status, "invalid");
    assert.deepEqual(result.usage, usage);
    assert.equal(result.estimatedCostMicros, 270);
    assert.equal(result.draft, null);
  }
});

test("missing usage and ambiguous transport outcomes freeze instead of inventing zero cost or retrying", async () => {
  let calls = 0;
  for (const transport of [
    async () => {
      calls++;
      throw Error("FAKE_SECRET_FROM_REMOTE");
    },
    async () => {
      calls++;
      return { status: 200, body: response({ usage: undefined }) };
    },
  ]) {
    const adapter = new w.DeepSeekAdapter({
      credential: async () => "FAKE",
      request: transport,
    });
    const result = await adapter.invoke(request());
    assert.equal(result.status, "unknown");
    assert.equal(result.estimatedCostMicros, null);
    assert(!JSON.stringify(result).includes("FAKE_SECRET_FROM_REMOTE"));
  }
  assert.equal(calls, 2);
});

test("read-only model check never submits a completion and exposes only supported model ids", async () => {
  const calls = [];
  const adapter = new w.DeepSeekAdapter({
    credential: async () => "FAKE",
    request: async (input) => {
      calls.push(input);
      return {
        status: 200,
        body: {
          data: [
            { id: "deepseek-flash" },
            { id: "deepseek-v4-pro" },
            { id: "unverified-model" },
          ],
        },
      };
    },
  });
  const result = await adapter.checkConnection();
  assert.equal(calls[0].url, "https://api.deepseek.com/models");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].body, undefined);
  assert.deepEqual(result.modelIds, ["deepseek-flash", "deepseek-v4-pro"]);
  assert.equal(result.paidGenerationRequested, false);
});

function setup(t) {
  assert.equal(typeof w.LiveTextService, "function");
  const repo = new w.Repository(
    path.resolve(
      "output/test-runs",
      "live-text-" + randomUUID(),
      "library.sqlite",
    ),
  );
  t.after(() => repo.close());
  const artistId = randomUUID(),
    profileId = randomUUID();
  repo.save("artists", {
    id: artistId,
    revision: 1,
    name: "Offline artist",
    defaults: { language: "Chinese", genre: "pop" },
  });
  repo.save("settings", {
    id: "api-profile:" + profileId,
    kind: "text",
    providerId: "deepseek",
    label: "Offline test",
    modelId: null,
    executionEnabled: false,
    revision: 1,
  });
  const service = new w.LiveTextService(repo);
  const input = {
    requestId: randomUUID(),
    profileId,
    expectedProfileRevision: 1,
    artistId,
    instruction: "Write an original song about a quiet homecoming.",
    parentDraftId: null,
    modelId: "deepseek-flash",
    maxOutputTokens: 2048,
    budgetMicros: 100000,
    maxRevisions: 2,
    consent: true,
  };
  return { repo, service, input };
}
async function completed(claim, changes = {}) {
  const adapter = new w.DeepSeekAdapter({
    credential: async () => "FAKE",
    request: async () => ({ status: 200, body: response(changes) }),
  });
  return adapter.invoke(claim.request);
}

test("preparation validates explicit consent, profile revision and parent artist without making a call", (t) => {
  const { repo, service, input } = setup(t);
  assert.throws(() => service.prepare({ ...input, consent: false }));
  assert.throws(
    () => service.prepare({ ...input, expectedProfileRevision: 2 }),
    /REVISION_CONFLICT/,
  );
  const parent = { id: randomUUID(), artistId: randomUUID(), draft: draft() };
  repo.save("drafts", parent);
  assert.throws(
    () => service.prepare({ ...input, parentDraftId: parent.id }),
    /DRAFT_SCOPE/,
  );
  const job = service.prepare(input);
  assert.equal(job.state, "prepared");
  assert.equal(service.prepare(input).id, job.id);
  assert.throws(
    () => service.prepare({ ...input, instruction: "changed instruction" }),
    /IDEMPOTENCY_CONFLICT/,
  );
  assert.equal(repo.all("operations").length, 0);
});

test("claim reserves a bounded estimate before dispatch and enforces CAS and insufficient budgets", (t) => {
  const { repo, service, input } = setup(t);
  const small = service.prepare({ ...input, budgetMicros: 1 });
  assert.throws(
    () => service.claim({ id: small.id, expectedRevision: small.revision }),
    /BUDGET_INSUFFICIENT/,
  );
  const job = service.prepare({ ...input, requestId: randomUUID() });
  assert.throws(
    () => service.claim({ id: job.id, expectedRevision: job.revision + 1 }),
    /REVISION_CONFLICT/,
  );
  const claimed = service.claim({ id: job.id, expectedRevision: job.revision });
  assert.equal(
    repo.get("operations", claimed.operation.id).state,
    "dispatching",
  );
  assert.ok(claimed.operation.reservedMicros > 0);
  assert.equal(claimed.request.operationId, claimed.operation.id);
  assert.equal(claimed.request.messages[0].role, "system");
  assert.match(claimed.request.messages[0].content, /JSON/);
  assert.equal(service.context(job.id).currentProfile.revision, 1);
  assert.throws(
    () => service.claim({ id: job.id, expectedRevision: claimed.job.revision }),
    /TEXT_TASK_BUSY/,
  );
});

test("recording a completion persists real model provenance and draft once without model quality approval", async (t) => {
  const { repo, service, input } = setup(t);
  const job = service.prepare(input),
    claim = service.claim({ id: job.id, expectedRevision: job.revision });
  const result = await completed(claim);
  const recorded = service.record({
    id: job.id,
    operationId: claim.operation.id,
    result,
  });
  assert.equal(recorded.state, "complete");
  assert.equal(recorded.spentMicros, 270);
  assert.equal(recorded.reservedMicros, 0);
  const d = repo.get("drafts", recorded.draftId);
  assert.equal(d.source, "deepseek-api");
  assert.equal(d.pair.generator.modelId, "deepseek-flash");
  assert.equal(d.qualityState, "local_rules_only");
  assert.equal(d.providerRequestId, "remote-completion-1");
  assert.equal(repo.all("evaluations").length, 0);
  assert.equal(
    service.record({ id: job.id, operationId: claim.operation.id, result })
      .draftId,
    recorded.draftId,
  );
  assert.equal(repo.all("drafts").length, 1);
  assert.equal(repo.all("operations").length, 1);
  assert.equal(service.list().length, 1);
});

test("known invalid outputs spend their real usage estimate and revisions cannot reuse that budget", async (t) => {
  const { service, input } = setup(t);
  let job = service.prepare({ ...input, maxRevisions: 0 });
  const claim = service.claim({ id: job.id, expectedRevision: job.revision });
  job = service.record({
    id: job.id,
    operationId: claim.operation.id,
    result: await completed(claim, {
      choices: [{ finish_reason: "length", message: { content: "" } }],
    }),
  });
  assert.equal(job.state, "invalid");
  assert.equal(job.spentMicros, 270);
  assert.equal(job.draftId, null);
  assert.throws(
    () => service.claim({ id: job.id, expectedRevision: job.revision }),
    /REVISION_LIMIT/,
  );
});

test("authorized revisions are explicit, preserve prior versions and stop at two rewrites", async (t) => {
  const { repo, service, input } = setup(t);
  let job = service.prepare(input);
  for (let attempt = 0; attempt < 3; attempt++) {
    const claim = service.claim({
      id: job.id,
      expectedRevision: job.revision,
      ...(attempt
        ? { feedback: "Make the chorus simpler while preserving the subject." }
        : {}),
    });
    job = service.record({
      id: job.id,
      operationId: claim.operation.id,
      result: await completed(claim),
    });
  }
  assert.equal(repo.all("drafts").length, 3);
  assert.equal(job.spentMicros, 810);
  assert.throws(
    () =>
      service.claim({
        id: job.id,
        expectedRevision: job.revision,
        feedback: "Again",
      }),
    /REVISION_LIMIT/,
  );
});

test("restart turns dispatching into unknown and never permits a duplicate or another risky provider call", (t) => {
  const { repo, service, input } = setup(t);
  const job = service.prepare(input),
    claim = service.claim({ id: job.id, expectedRevision: job.revision });
  const restarted = new w.LiveTextService(repo),
    saved = restarted.context(job.id).job;
  assert.equal(saved.state, "unknown");
  assert.equal(repo.get("operations", claim.operation.id).state, "unknown");
  assert.ok(saved.reservedMicros > 0);
  assert.throws(
    () => restarted.claim({ id: job.id, expectedRevision: saved.revision }),
    /OUTCOME_UNKNOWN/,
  );
  const other = restarted.prepare({ ...input, requestId: randomUUID() });
  assert.throws(
    () => restarted.claim({ id: other.id, expectedRevision: other.revision }),
    /PROVIDER_RISK_FROZEN/,
  );
  assert.equal(repo.all("operations").length, 1);
});

test("violated locked quotes still settle observed usage and retain the previous draft", async (t) => {
  const { repo, service, input } = setup(t);
  const parentId = randomUUID(),
    previous = draft();
  previous.sections[0].lines[0] = "A fixed original line";
  repo.save("drafts", {
    id: parentId,
    artistId: input.artistId,
    draft: previous,
    source: "local-inbox",
  });
  const job = service.prepare({
    ...input,
    parentDraftId: parentId,
    lockedQuotes: ["A fixed original line"],
  });
  const claim = service.claim({ id: job.id, expectedRevision: job.revision });
  const recorded = service.record({
    id: job.id,
    operationId: claim.operation.id,
    result: await completed(claim),
  });
  assert.equal(recorded.state, "invalid");
  assert.ok(recorded.reasons.includes("LOCKED_CONTENT_CHANGED"));
  assert.equal(recorded.spentMicros, 270);
  assert.equal(repo.all("drafts").length, 1);
});

test("recovery also freezes a job when another recovery component already marked its operation unknown", (t) => {
  const { repo, service, input } = setup(t);
  const job = service.prepare(input),
    claim = service.claim({ id: job.id, expectedRevision: job.revision });
  repo.save("operations", { ...claim.operation, state: "unknown" });
  const restarted = new w.LiveTextService(repo);
  assert.equal(restarted.context(job.id).job.state, "unknown");
});

test("a second job cannot dispatch while the same profile has a call in flight", (t) => {
  const { service, input } = setup(t);
  const first = service.prepare(input);
  service.claim({ id: first.id, expectedRevision: first.revision });
  const second = service.prepare({ ...input, requestId: randomUUID() });
  assert.throws(
    () => service.claim({ id: second.id, expectedRevision: second.revision }),
    /TEXT_PROVIDER_BUSY/,
  );
});

test("late duplicate receipts stay idempotent even after a later revision has been claimed", async (t) => {
  const { repo, service, input } = setup(t);
  const prepared = service.prepare(input),
    first = service.claim({
      id: prepared.id,
      expectedRevision: prepared.revision,
    });
  const receipt = {
    id: prepared.id,
    operationId: first.operation.id,
    result: await completed(first),
  };
  const saved = service.record(receipt);
  service.claim({
    id: saved.id,
    expectedRevision: saved.revision,
    feedback: "A gentler bridge.",
  });
  const duplicate = service.record(receipt);
  assert.equal(duplicate.state, "dispatching");
  assert.equal(duplicate.spentMicros, 270);
  assert.equal(repo.all("drafts").length, 1);
});

test("pro pricing and invalid usage cannot be silently settled with the flash or zero estimate", async (t) => {
  const calls = [];
  const adapter = new w.DeepSeekAdapter({
    credential: async () => "FAKE",
    request: async (r) => {
      calls.push(r);
      return { status: 200, body: response({ model: "deepseek-v4-pro" }) };
    },
  });
  const result = await adapter.invoke({
    ...request(),
    modelId: "deepseek-v4-pro",
  });
  assert.equal(result.estimatedCostMicros, 924);
  assert.equal(calls[0].body.model, "deepseek-v4-pro");
  const { service, input } = setup(t);
  const job = service.prepare(input),
    claim = service.claim({ id: job.id, expectedRevision: job.revision });
  const receipt = await completed(claim);
  assert.throws(
    () =>
      service.record({
        id: job.id,
        operationId: claim.operation.id,
        result: { ...receipt, estimatedCostMicros: 0 },
      }),
    /COST_ESTIMATE_MISMATCH/,
  );
  assert.equal(service.context(job.id).job.spentMicros, 0);
  assert.equal(service.context(job.id).job.state, "dispatching");
});

test("only documented response aliases verify the requested model price while preserving the actual model", async () => {
  for (const [modelId, providerModel, estimatedCostMicros] of [
    ["deepseek-flash", "DeepSeek-V4.1-Flash", 270],
    ["deepseek-flash", "DEEPSEEK-FLASH", 270],
    ["deepseek-v4-pro", "DeepSeek-V4-Pro-0813", 924],
    ["deepseek-v4-pro", "deepseek-v4-pro", 924],
  ]) {
    const adapter = new w.DeepSeekAdapter({
      credential: async () => "FAKE",
      request: async () => ({
        status: 200,
        body: response({ model: providerModel }),
      }),
    });
    const result = await adapter.invoke({ ...request(), modelId });
    assert.equal(result.status, "complete");
    assert.equal(result.providerModel, providerModel);
    assert.equal(result.estimatedCostMicros, estimatedCostMicros);
  }
});

test("mismatched and unknown returned models retain usage but freeze the estimate and original reservation", async (t) => {
  for (const providerModel of [
    "deepseek-v4-pro",
    "DeepSeek-V4-Pro-0813",
    "unverified-future-model",
    "deepseek-flash-attacker-alias",
  ]) {
    const { repo, service, input } = setup(t);
    const prepared = service.prepare(input),
      claim = service.claim({
        id: prepared.id,
        expectedRevision: prepared.revision,
      });
    const adapter = new w.DeepSeekAdapter({
      credential: async () => "FAKE",
      request: async () => ({
        status: 200,
        body: response({ model: providerModel }),
      }),
    });
    const result = await adapter.invoke(claim.request);
    assert.equal(result.status, "invalid");
    assert.equal(result.providerModel, providerModel);
    assert.equal(result.providerRequestId, "remote-completion-1");
    assert.deepEqual(result.usage, usage);
    assert.equal(result.estimatedCostMicros, null);
    assert.equal(result.draft, null);
    assert.ok(result.reasons.includes("TEXT_MODEL_PRICE_UNVERIFIED"));
    const recorded = service.record({
      id: prepared.id,
      operationId: claim.operation.id,
      result,
    });
    assert.equal(recorded.state, "invalid");
    assert.equal(recorded.reservedMicros, claim.operation.reservedMicros);
    assert.equal(recorded.spentMicros, 0);
    const operation = service.context(prepared.id).operation;
    assert.equal(operation.costState, "unknown");
    assert.equal(operation.providerModel, providerModel);
    assert.deepEqual(operation.usage, usage);
    assert.equal(operation.estimatedCostMicros, null);
    assert.equal(
      repo
        .all("workflowLedger")
        .filter((row) => ["settle", "release"].includes(row.kind)).length,
      0,
    );
    assert.equal(repo.all("drafts").length, 0);
    assert.throws(
      () =>
        service.claim({ id: prepared.id, expectedRevision: recorded.revision }),
      /PROVIDER_RISK_FROZEN/,
    );
    const other = service.prepare({ ...input, requestId: randomUUID() });
    assert.throws(
      () => service.claim({ id: other.id, expectedRevision: other.revision }),
      /PROVIDER_RISK_FROZEN/,
    );
  }
});

test("record independently refuses to settle a cheap estimate attached to a mismatched response model", async (t) => {
  const { repo, service, input } = setup(t);
  const prepared = service.prepare(input),
    claim = service.claim({
      id: prepared.id,
      expectedRevision: prepared.revision,
    });
  const result = {
    ...(await completed(claim)),
    providerModel: "DeepSeek-V4-Pro-0813",
  };
  const recorded = service.record({
    id: prepared.id,
    operationId: claim.operation.id,
    result,
  });
  assert.equal(recorded.state, "invalid");
  assert.equal(recorded.reservedMicros, claim.operation.reservedMicros);
  assert.equal(
    service.context(prepared.id).operation.estimatedCostMicros,
    null,
  );
  assert.equal(repo.all("workflowLedger").length, 1);
});
