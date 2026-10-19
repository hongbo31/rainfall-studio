import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const w = createRequire(import.meta.url)(process.env.RAINFALL_TEXT_EVALUATION_BUNDLE);
const usage = { prompt_tokens: 100, completion_tokens: 200, prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 80 };
const input = (changes = {}) => ({
  operationId: randomUUID(), modelId: 'deepseek-flash', maxOutputTokens: 2048,
  revisionId: randomUUID(), intent: 'A quiet homecoming with warm, restrained everyday imagery.',
  pair: { lyrics: 'I leave a light beside the door\nOur ordinary evening holds the rain', musicPrompt: 'Warm intimate piano and acoustic guitar with restrained drums.' },
  ...changes,
});
const scoring = (request, changes = {}) => ({
  revisionId: request.revisionId, dimensions: { lyrics: 60, style: 80, coherence: 70 },
  findings: ['[lyrics] 「I leave a light」 supports the everyday scene, but the hook needs a stronger contrast.'],
  overall: 100, passed: true, ...changes,
});
function setup(request, scoreChanges = {}, responseChanges = {}) {
  const calls = []; let credentialReads = 0;
  const adapter = new w.DeepSeekAdapter({
    credential: async () => { credentialReads++; return 'SYNTHETIC_EVALUATION_SECRET'; },
    request: async (call) => {
      calls.push(call);
      return { status: 200, body: { id: 'evaluation-provider-id', model: request.modelId,
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(scoring(request, scoreChanges)) } }],
        usage, ...responseChanges } };
    },
  });
  return { adapter, calls, reads: () => credentialReads };
}

test('bounded evaluation schemas and adapter entrypoint exist', () => {
  assert.equal(typeof w.TextEvaluationRequestSchema?.parse, 'function', 'EVALUATION_REQUEST_SCHEMA_MISSING');
  assert.equal(typeof w.TextEvaluationScoreSchema?.parse, 'function');
  assert.equal(typeof w.TextEvaluationResultSchema?.parse, 'function');
  assert.equal(typeof w.DeepSeekAdapter.prototype.evaluate, 'function');
});

test('evaluation uses official fixed JSON request, retains usage and computes its own weighted score and threshold', async () => {
  const request = input({ threshold: 80 }), x = setup(request);
  assert.equal(typeof x.adapter.evaluate, 'function', 'EVALUATION_ADAPTER_MISSING');
  const result = await x.adapter.evaluate(request);
  assert.equal(x.calls.length, 1);
  assert.equal(x.calls[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(x.calls[0].method, 'POST');
  assert.equal(x.calls[0].body.model, 'deepseek-flash');
  assert.equal(x.calls[0].body.max_tokens, request.maxOutputTokens);
  assert.deepEqual(x.calls[0].body.response_format, { type: 'json_object' });
  assert.deepEqual(x.calls[0].body.thinking, { type: 'disabled' });
  assert.equal(x.calls[0].body.stream, false);
  assert(x.calls[0].body.messages[1].content.includes(request.revisionId));
  assert(x.calls[0].body.messages[1].content.includes(request.pair.lyrics.split('\n')[0]));
  assert.equal(result.status, 'complete');
  assert.equal(result.operationId, request.operationId);
  assert.equal(result.revisionId, request.revisionId);
  assert.equal(result.providerRequestId, 'evaluation-provider-id');
  assert.equal(result.providerModel, 'deepseek-flash');
  assert.deepEqual(result.usage, usage);
  assert.equal(result.estimatedCostMicros, 270);
  assert.equal(result.score.overall, 69);
  assert.equal(result.score.threshold, 80);
  assert.equal(result.score.passed, false);
  assert.equal(result.score.source, 'model-scored');
  assert.equal(result.score.calibration, 'not_human_calibrated');
  assert(w.TextEvaluationResultSchema.safeParse(result).success);
  assert(!JSON.stringify(result).includes('SYNTHETIC_EVALUATION_SECRET'));
});

test('default and configured thresholds use the unrounded local weighted score', async () => {
  const request = input(), x = setup(request, { dimensions: { lyrics: 75, style: 74.99, coherence: 75 } });
  assert.equal(typeof x.adapter.evaluate, 'function', 'EVALUATION_ADAPTER_MISSING');
  const result = await x.adapter.evaluate(request);
  assert.equal(result.score.threshold, 75);
  assert(result.score.overall < 75);
  assert.equal(result.score.passed, false);
  const lower = await x.adapter.evaluate({ ...request, threshold: 74 });
  assert.equal(lower.score.passed, true);
});

test('empty, generic or fabricated findings cannot become a score but retain the paid usage estimate', async () => {
  const request = input();
  for (const findings of [[], ['   '], ['Everything is perfect and deserves the highest score.'], ['[lyrics] 「This phrase does not occur」 lacks a clear concrete image.'], ['「I leave a light」']]) {
    const x = setup(request, { findings });
    assert.equal(typeof x.adapter.evaluate, 'function', 'EVALUATION_ADAPTER_MISSING');
    const result = await x.adapter.evaluate(request);
    assert.equal(result.status, 'invalid');
    assert.equal(result.score, null);
    assert.deepEqual(result.usage, usage);
    assert.equal(result.estimatedCostMicros, 270);
  }
});

test('wrong revision, out-of-bounds dimensions and malformed scoring output cannot pass', async () => {
  const request = input();
  for (const changes of [{ revisionId: randomUUID() }, { dimensions: { lyrics: 101, style: 80, coherence: 80 } }, { dimensions: { lyrics: -1, style: 80, coherence: 80 } }, { dimensions: { lyrics: 80, style: 80 } }, { unexpected: 'not allowed' }]) {
    const x = setup(request, changes);
    assert.equal(typeof x.adapter.evaluate, 'function', 'EVALUATION_ADAPTER_MISSING');
    const result = await x.adapter.evaluate(request);
    assert.equal(result.status, 'invalid'); assert.equal(result.score, null);
    assert.equal(result.estimatedCostMicros, 270);
  }
});

test('truncated and non-JSON responses preserve the charge and never claim an evaluation', async () => {
  const request = input();
  for (const choices of [[{ finish_reason: 'length', message: { content: JSON.stringify(scoring(request)) } }], [{ finish_reason: 'stop', message: { content: '{bad JSON' } }]]) {
    const x = setup(request, {}, { choices });
    assert.equal(typeof x.adapter.evaluate, 'function', 'EVALUATION_ADAPTER_MISSING');
    const result = await x.adapter.evaluate(request);
    assert.equal(result.status, 'invalid'); assert.equal(result.score, null);
    assert.deepEqual(result.usage, usage); assert.equal(result.estimatedCostMicros, 270);
  }
});

test('model mismatch retains actual usage and provider model while cost remains unknown', async () => {
  const request = input(), x = setup(request, {}, { model: 'deepseek-v4-pro' });
  assert.equal(typeof x.adapter.evaluate, 'function', 'EVALUATION_ADAPTER_MISSING');
  const result = await x.adapter.evaluate(request);
  assert.equal(result.status, 'invalid'); assert.equal(result.score, null);
  assert.equal(result.providerModel, 'deepseek-v4-pro');
  assert.deepEqual(result.usage, usage); assert.equal(result.estimatedCostMicros, null);
  assert(w.TextEvaluationResultSchema.safeParse(result).success);
});

test('missing usage and ambiguous transport freeze without automatic retries or reflected secrets', async () => {
  const request = input(), x = setup(request, {}, { usage: undefined });
  assert.equal(typeof x.adapter.evaluate, 'function', 'EVALUATION_ADAPTER_MISSING');
  const missing = await x.adapter.evaluate(request);
  assert.equal(missing.status, 'unknown'); assert.equal(missing.score, null);
  assert.equal(missing.estimatedCostMicros, null); assert.equal(x.calls.length, 1);
  let calls = 0;
  const adapter = new w.DeepSeekAdapter({ credential: async () => 'SYNTHETIC_ONLY', request: async () => { calls++; throw Error('DO_NOT_REFLECT_SYNTHETIC_SECRET'); } });
  const unknown = await adapter.evaluate(request);
  assert.equal(unknown.status, 'unknown'); assert.equal(unknown.score, null);
  assert.equal(calls, 1); assert(!JSON.stringify(unknown).includes('DO_NOT_REFLECT'));
});

test('strict requests reject caller-supplied messages or endpoints before credential access', async () => {
  const request = input(), x = setup(request);
  assert.equal(typeof x.adapter.evaluate, 'function', 'EVALUATION_ADAPTER_MISSING');
  for (const bad of [{ ...request, messages: [] }, { ...request, url: 'https://example.com' }, { ...request, threshold: 101 }, { ...request, revisionId: 'another' }, { ...request, maxOutputTokens: 999999 }])
    await assert.rejects(x.adapter.evaluate(bad));
  assert.equal(x.reads(), 0); assert.equal(x.calls.length, 0);
});

test('the durable score contract rejects spoofed overall, pass flags and revision identity', async () => {
  const request = input(), x = setup(request);
  assert.equal(typeof x.adapter.evaluate, 'function', 'EVALUATION_ADAPTER_MISSING');
  const result = await x.adapter.evaluate(request);
  for (const score of [{ ...result.score, overall: 100 }, { ...result.score, passed: true }, { ...result.score, revisionId: randomUUID() }, { ...result.score, source: 'human-calibrated' }])
    assert.equal(w.TextEvaluationResultSchema.safeParse({ ...result, score }).success, false);
});

test('durable evaluation validation binds operation, model, revision, threshold and source excerpts to the original request', async () => {
  const request = input(), x = setup(request);
  assert.equal(typeof w.parseTextEvaluationResult, 'function', 'REQUEST_BOUND_EVALUATION_VALIDATION_MISSING');
  const result = await x.adapter.evaluate(request);
  assert.equal(w.parseTextEvaluationResult(result, request).score.overall, 69);
  for (const changes of [{ operationId: randomUUID() }, { revisionId: randomUUID() }, { modelId: 'deepseek-v4-pro' }, { threshold: 10 }, { pair: { ...request.pair, lyrics: 'Unrelated source lyrics without the quoted excerpt.' } }])
    assert.throws(() => w.parseTextEvaluationResult(result, { ...request, ...changes }));
});

test('Chinese curved quotation marks ground actual excerpts without admitting invented evidence', async () => {
  const request = input();
  const good = setup(request, { findings: ['[style] “Warm intimate piano” supports the restrained arrangement, although the contrast could be more precise.'] });
  const result = await good.adapter.evaluate(request);
  assert.equal(result.status, 'complete');
  assert.equal(w.parseTextEvaluationResult(result, request).score.overall, 69);
  const bad = setup(request, { findings: ['[style] “Invented harp and orchestra” provides a timbral contrast that is not in the supplied material.'] });
  const invalid = await bad.adapter.evaluate(request);
  assert.equal(invalid.status, 'invalid');
  assert.equal(invalid.score, null);
  assert.equal(invalid.estimatedCostMicros, 270);
});
