const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  randomUUID,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} = require("node:crypto");
const { Studio } = require("../../build/core.cjs");
const { CredentialVault } = require("../../build/vault.cjs");

for (const operation of [
  "writeApiCredential",
  "clearApiCredential",
  "apiCredentialStatus",
]) {
  test(
    "queued simulation-origin " + operation + " cannot adopt production scope",
    async () => {
      const x = await setup();
      let vaultCalls = 0;
      const vault = {
        isAvailable: () => {
          vaultCalls++;
          return true;
        },
        has: () => {
          vaultCalls++;
          return true;
        },
        put: () => {
          vaultCalls++;
        },
        delete: () => {
          vaultCalls++;
        },
      };
      try {
        x.setMode("simulation");
        const service = new (api().ApiCredentials)({ ...x.options, vault });
        const transition = service.runExclusive(async () =>
          x.setMode("production"),
        );
        const request = service[operation](
          operation === "apiCredentialStatus"
            ? { profileId: x.p.id }
            : {
                profileId: x.p.id,
                expectedRevision: 1,
                ...(operation === "writeApiCredential"
                  ? { secret: "QA_QUEUED" }
                  : {}),
              },
        );
        if (operation === "apiCredentialStatus") {
          assert.deepEqual(await request, {
            profileId: x.p.id,
            state: "unavailable",
            configured: false,
          });
        } else {
          await assert.rejects(
            request,
            /SIMULATION_CREDENTIALS_DISABLED|WORKSPACE_CHANGED/,
          );
        }
        await transition;
        assert.equal(vaultCalls, 0, operation + " touched production vault");
      } finally {
        x.s.close();
      }
    },
  );
}

test("queued production requests are stale after a workspace generation change", async () => {
  const x = await setup();
  try {
    const transition = x.service.runExclusive(async () => {
      x.setMode("simulation");
      x.setMode("production");
    });
    await assert.rejects(
      x.service.writeApiCredential({
        profileId: x.p.id,
        expectedRevision: 1,
        secret: "QA_STALE",
      }),
      /WORKSPACE_CHANGED/,
    );
    await transition;
    assert(!fs.existsSync(x.vaultRoot));
  } finally {
    x.s.close();
  }
});
// Import is deferred so RED reports the absent API, rather than a missing-module crash.
function api() {
  assert(
    fs.existsSync(path.resolve("build/api-credentials.cjs")),
    "Main credential broker not implemented",
  );
  return require("../../build/api-credentials.cjs");
}
function encryptor() {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(text) {
      const iv = randomBytes(12),
        c = createCipheriv("aes-256-gcm", key, iv);
      const b = Buffer.concat([c.update(text, "utf8"), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), b]);
    },
    decryptString(data) {
      const d = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
      d.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([d.update(data.subarray(28)), d.final()]).toString(
        "utf8",
      );
    },
  };
}
async function setup() {
  const root = path.resolve("output/test-runs", randomUUID());
  const s = new Studio(root, "production");
  const p = await s.call("apiProfile.save", {
    profile: {
      id: randomUUID(),
      kind: "music",
      providerId: "yourmusic",
      label: "QA only",
      modelId: null,
      executionEnabled: false,
    },
    expectedRevision: null,
  });
  const storage = encryptor(),
    vaultRoot = path.join(root, "credentials");
  const vault = new CredentialVault(vaultRoot, storage);
  let mode = "production",
    scope = 1;
  const getProfile = async (id) =>
    (await s.call("apiProfile.list")).find((x) => x.id === id);
  const options = {
    vault,
    getProfile,
    context: () => ({ mode, generation: scope }),
  };
  const service = new (api().ApiCredentials)(options);
  return {
    root,
    s,
    p,
    storage,
    vault,
    vaultRoot,
    options,
    service,
    setMode: (value) => {
      mode = value;
      scope++;
    },
  };
}

test("Main credentials encrypt, survive restart, replace and clear without returning plaintext", async () => {
  const x = await setup();
  const identity = { profileId: x.p.id, expectedRevision: 1 };
  const first = "QA_FAKE_ONLY_" + randomUUID(),
    second = "QA_REPLACEMENT_" + randomUUID();
  try {
    assert.equal(
      (await x.service.apiCredentialStatus({ profileId: x.p.id })).state,
      "absent",
    );
    const result = await x.service.writeApiCredential({
      ...identity,
      secret: first,
    });
    assert.deepEqual(result, {
      profileId: x.p.id,
      state: "stored_unverified",
      configured: true,
    });
    assert(!JSON.stringify(result).includes(first));
    const restarted = new (api().ApiCredentials)(x.options);
    assert.equal(
      (await restarted.apiCredentialStatus({ profileId: x.p.id })).state,
      "stored_unverified",
    );
    await restarted.writeApiCredential({ ...identity, secret: second });
    const binding = {
      accountId: x.p.id,
      providerId: "yourmusic",
      remoteSubject: "local-profile:" + x.p.id,
    };
    assert.equal(x.vault.get(binding), second);
    const file = path.join(x.vaultRoot, x.p.id + ".bin");
    assert(!fs.readFileSync(file).includes(Buffer.from(second)));
    assert(!JSON.stringify(x.s.snapshot()).includes(second));
    const backup = path.join(x.root, "qa.zip");
    await x.s.backup(backup);
    const entries = await new Promise((resolve, reject) =>
      require("yauzl").open(backup, { lazyEntries: true }, (error, zip) => {
        if (error) return reject(error);
        const names = [];
        zip.on("error", reject);
        zip.on("entry", (entry) => {
          names.push(entry.fileName);
          zip.openReadStream(entry, (e, stream) => {
            if (e) return reject(e);
            const chunks = [];
            stream.on("data", (b) => chunks.push(b));
            stream.on("error", reject);
            stream.on("end", () => {
              const body = Buffer.concat(chunks);
              if (
                body.includes(Buffer.from(first)) ||
                body.includes(Buffer.from(second))
              )
                return reject(Error("plaintext in backup"));
              zip.readEntry();
            });
          });
        });
        zip.on("end", () => resolve(names));
        zip.readEntry();
      }),
    );
    assert.deepEqual(entries.sort(), ["database.sqlite", "manifest.json"]);
    await x.s.restore(backup);
    assert.equal(
      (await x.s.call("apiProfile.list"))[0].executionEnabled,
      false,
    );
    assert.equal(
      (await restarted.clearApiCredential(identity)).state,
      "absent",
    );
    assert(!fs.existsSync(file));
  } finally {
    x.s.close();
  }
});

test("Main rejects wrong profile, stale revision, unknown hosts, unconfigured providers and simulation before vault access", async () => {
  const x = await setup();
  const input = { profileId: x.p.id, expectedRevision: 1, secret: "QA_FAKE" };
  try {
    await assert.rejects(
      x.service.writeApiCredential({ ...input, expectedRevision: 2 }),
      /REVISION_CONFLICT/,
    );
    await assert.rejects(
      x.service.writeApiCredential({ ...input, profileId: randomUUID() }),
      /PROFILE_NOT_FOUND/,
    );
    await assert.rejects(
      x.service.writeApiCredential({
        ...input,
        baseUrl: "https://evil.invalid",
      }),
    );
    const p = await x.s.call("apiProfile.save", {
      profile: {
        id: randomUUID(),
        kind: "music",
        providerId: "miaoxiang",
        label: "Pending",
        modelId: null,
        executionEnabled: false,
      },
      expectedRevision: null,
    });
    await assert.rejects(
      x.service.writeApiCredential({ ...input, profileId: p.id }),
      /PROVIDER_NOT_CONFIGURED/,
    );
    x.setMode("simulation");
    await assert.rejects(
      x.service.writeApiCredential(input),
      /SIMULATION_CREDENTIALS_DISABLED/,
    );
    assert.deepEqual(
      await x.service.apiCredentialStatus({ profileId: x.p.id }),
      { profileId: x.p.id, state: "unavailable", configured: false },
    );
    assert(!fs.existsSync(x.vaultRoot));
    await assert.rejects(
      x.s.call("writeApiCredential", input),
      /METHOD_NOT_ALLOWED/,
    );
    assert.equal(x.s.externalRequests, 0);
  } finally {
    x.s.close();
  }
});

test("failed encryption preserves previous ciphertext, unavailable storage is explicit, mismatched binding is rejected", async () => {
  const x = await setup(),
    input = { profileId: x.p.id, expectedRevision: 1, secret: "QA_FIRST" };
  try {
    await x.service.writeApiCredential(input);
    const file = path.join(x.vaultRoot, x.p.id + ".bin"),
      before = fs.readFileSync(file);
    x.storage.encryptString = () => {
      throw Error("QA_SECRET_IN_UNTRUSTED_ERROR");
    };
    await assert.rejects(
      x.service.writeApiCredential({ ...input, secret: "QA_SECOND" }),
    );
    assert.deepEqual(fs.readFileSync(file), before);
    x.storage.isEncryptionAvailable = () => false;
    assert.equal(
      (await x.service.apiCredentialStatus({ profileId: x.p.id })).state,
      "unavailable",
    );
    await assert.rejects(
      x.service.writeApiCredential(input),
      /SECURE_STORAGE_UNAVAILABLE/,
    );
    x.storage.isEncryptionAvailable = () => true;
    const bad = {
      accountId: x.p.id,
      providerId: "different",
      remoteSubject: "local-profile:" + x.p.id,
    };
    assert.throws(() => x.vault.get(bad), /CREDENTIAL_IDENTITY_MISMATCH/);
  } finally {
    x.s.close();
  }
});

test("credential IPC verifies source, sanitizes errors and serializes concurrent writes", async () => {
  const x = await setup();
  const handlers = new Map();
  try {
    api().registerApiCredentialHandlers(
      (name, fn) => handlers.set(name, fn),
      (e) => {
        if (e !== "trusted") throw Error("IPC_SOURCE_REJECTED");
      },
      x.service,
    );
    assert.equal(handlers.size, 3);
    assert(![...handlers.keys()].some((n) => /get|read/.test(n)));
    const write = handlers.get("rainfall:api-credential:write"),
      input = { profileId: x.p.id, expectedRevision: 1, secret: "QA_FAKE" };
    assert.equal((await write("subframe", input)).ok, false);
    assert(!fs.existsSync(x.vaultRoot));
    const writes = await Promise.all([
      write("trusted", input),
      write("trusted", { ...input, secret: "QA_FINAL" }),
    ]);
    assert(writes.every((r) => r.ok));
    assert.equal(
      x.vault.get({
        accountId: x.p.id,
        providerId: "yourmusic",
        remoteSubject: "local-profile:" + x.p.id,
      }),
      "QA_FINAL",
    );
    x.storage.encryptString = () => {
      throw Error("LEAK_THIS_QA_MARKER");
    };
    const failed = await write("trusted", input);
    assert.equal(failed.ok, false);
    assert(!JSON.stringify(failed).includes("LEAK_THIS_QA_MARKER"));
    assert(!JSON.stringify(x.s.all("audit")).includes("QA_FINAL"));
  } finally {
    x.s.close();
  }
});

test("scope change during profile lookup freezes credential operation without touching vault", async () => {
  const x = await setup();
  try {
    const service = new (api().ApiCredentials)({
      ...x.options,
      getProfile: async () => {
        x.setMode("simulation");
        return x.p;
      },
    });
    await assert.rejects(
      service.writeApiCredential({
        profileId: x.p.id,
        expectedRevision: 1,
        secret: "QA_FAKE",
      }),
      /WORKSPACE_CHANGED/,
    );
    assert(!fs.existsSync(x.vaultRoot));
  } finally {
    x.s.close();
  }
});
