// Offline development units; no credentials, transport calls or user acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const w = require(process.env.RAINFALL_TEXT_CONFIG_BUNDLE);

// Break caught: a newly created text profile silently chooses an unspecified provider or runs.
test('default text configuration selects DeepSeek but keeps model and execution unapproved', () => {
  const config = w.parseTextProviderProfile({});
  assert.equal(config.providerId, 'deepseek');
  assert.equal(config.endpoint, 'https://api.deepseek.com');
  assert.equal(config.modelId, null);
  assert.equal(config.executionEnabled, false);
  assert.equal(config.automaticEvaluation, false);
  const reasons = w.textProviderReadiness(config);
  assert.ok(reasons.includes('TEXT_MODEL_MISSING'));
  assert.ok(reasons.includes('LIVE_EXECUTION_DISABLED'));
});

// Break caught: endpoint edit exfiltrates the saved Key to a nonofficial URL.
test('DeepSeek configuration rejects alternate hosts credentials paths and transport', () => {
  assert.equal(typeof w.parseTextProviderProfile, 'function');
  for (const endpoint of [
    'https://api.deepseek.com.attacker.invalid', 'http://api.deepseek.com',
    'https://key:secret@api.deepseek.com', 'https://api.deepseek.com?key=secret',
    'https://api.deepseek.com/#secret', 'https://api.deepseek.com/custom-proxy',
  ]) assert.throws(() => w.parseTextProviderProfile({ providerId: 'deepseek', endpoint }));
});

// Break caught: incoming configuration carries a secret, enables execution, or borrows login.
test('configuration is metadata only and cannot enable calls or embed credentials', () => {
  assert.equal(typeof w.parseTextProviderProfile, 'function');
  for (const input of [
    { secret: 'fake-never-a-real-key' }, { authToken: 'fake-login-token' },
    { executionEnabled: true }, { automaticEvaluation: true },
    { credentialFile: 'C:/not-read/auth.json' }, { useSubscriptionAsApi: true },
  ]) assert.throws(() => w.parseTextProviderProfile(input));
});

// Break caught: a user selecting optional tooling is told it is ready without installation/auth.
test('Codex and Claude Code remain explicit unconfigured optional capabilities', () => {
  for (const providerId of ['codex_cli', 'claude_code']) {
    const config = w.parseTextProviderProfile({ providerId });
    assert.equal(config.endpoint, null);
    assert.equal(config.executionEnabled, false);
    assert.ok(w.textProviderReadiness(config).includes('LOCAL_ADAPTER_UNCONFIGURED'));
  }
});
