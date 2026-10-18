const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Studio } = require("../../build/core.cjs");
const profile = (providerId = "yourmusic") => ({
  id: randomUUID(),
  kind: providerId === "text_pending" ? "text" : "music",
  providerId,
  label: "QA profile",
  modelId: null,
  executionEnabled: false,
});
const setup = () => {
  const root = path.resolve("output/test-runs", randomUUID());
  return { root, s: new Studio(root, "production") };
};

test("API profile metadata survives restart and remains separate by mode", async () => {
  const { root, s } = setup();
  const p = profile();
  const saved = await s.call("apiProfile.save", {
    profile: p,
    expectedRevision: null,
  });
  assert.equal(saved.revision, 1);
  assert.equal(saved.executionEnabled, false);
  s.close();
  const restarted = new Studio(root, "production");
  try {
    assert.deepEqual(await restarted.call("apiProfile.list"), [saved]);
    const sim = new Studio(root, "simulation");
    try {
      assert.deepEqual(await sim.call("apiProfile.list"), []);
    } finally {
      sim.close();
    }
    assert.equal(restarted.externalRequests, 0);
  } finally {
    restarted.close();
  }
});

test("API profile revisions and identities cannot be bypassed by client input", async () => {
  const { s } = setup();
  const p = profile();
  try {
    await s.call("apiProfile.save", { profile: p, expectedRevision: null });
    await assert.rejects(
      s.call("apiProfile.save", { profile: p, expectedRevision: null }),
      /REVISION_CONFLICT/,
    );
    await assert.rejects(
      s.call("apiProfile.save", {
        profile: { ...p, providerId: "suno" },
        expectedRevision: 1,
      }),
      /IDENTITY_IMMUTABLE/,
    );
    const next = await s.call("apiProfile.save", {
      profile: { ...p, label: "Updated" },
      expectedRevision: 1,
    });
    assert.equal(next.revision, 2);
    assert.equal(next.label, "Updated");
  } finally {
    s.close();
  }
});

test("API metadata rejects secrets, arbitrary hosts and unknown or enabled capabilities", async () => {
  const { s } = setup();
  try {
    for (const fields of [
      { secret: "QA_NEVER_A_REAL_KEY" },
      { baseUrl: "http://127.0.0.1" },
      { providerId: "unknown" },
      { kind: "text" },
      { executionEnabled: true },
    ]) {
      await assert.rejects(
        s.call("apiProfile.save", {
          profile: { ...profile(), ...fields },
          expectedRevision: null,
        }),
      );
    }
    await assert.rejects(
      s.call("settings.save", {
        id: "api-profile:" + randomUUID(),
        secret: "QA",
      }),
    );
    assert.deepEqual(await s.call("apiProfile.list"), []);
    assert(!JSON.stringify(s.all("settings")).includes("QA_NEVER_A_REAL_KEY"));
  } finally {
    s.close();
  }
});

test("API profile backup restores metadata without execution permission or fake connection", async () => {
  const { root, s } = setup();
  const p = profile("text_pending");
  try {
    await s.call("apiProfile.save", { profile: p, expectedRevision: null });
    const file = path.join(root, "profiles.zip");
    await s.backup(file);
    await s.call("apiProfile.save", {
      profile: { ...p, label: "Later" },
      expectedRevision: 1,
    });
    await s.restore(file);
    const rows = await s.call("apiProfile.list");
    assert.equal(rows[0].label, "QA profile");
    assert.equal(rows[0].executionEnabled, false);
    assert.equal(rows[0].modelId, null);
    assert(!JSON.stringify(rows).includes("connected"));
    assert(fs.existsSync(file));
  } finally {
    s.close();
  }
});
