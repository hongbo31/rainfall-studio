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
  "checkApiConnection",
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

test('synthetic new Key saves, immediately authenticates and authenticates after a vault/service restart',async()=>{
 const x=await setup(),secret='SYNTHETIC_RESTART_ONLY_'+randomUUID(),identity={profileId:x.p.id,expectedRevision:1};let gets=0;
 try{
  const request=async input=>{gets++;assert.equal(input.method,'GET');assert.equal(input.headers.Authorization,'Bearer '+secret);return {status:200,body:{data:[],total:0,page:1,size:1,total_pages:0}}};
  const service=new (api().ApiCredentials)({...x.options,connectionRequest:request});
  const saved=await service.writeApiCredential({...identity,secret});assert.equal(saved.configured,true);
  assert.equal((await service.checkApiConnection(identity)).state,'connected');
  const restarted=new (api().ApiCredentials)({...x.options,vault:new CredentialVault(x.vaultRoot,x.storage),connectionRequest:request});
  const result=await restarted.checkApiConnection(identity);assert.equal(result.state,'connected');assert.equal(result.paidGenerationRequested,false);assert.equal(gets,2);
  assert.ok(!JSON.stringify([saved,result,x.s.snapshot()]).includes(secret));assert.ok(!fs.readFileSync(path.join(x.vaultRoot,x.p.id+'.bin')).includes(Buffer.from(secret)));
 }finally{x.s.close()}
});

test('new Key readback/decrypt failures have safe phase-specific codes and never send HTTP',async()=>{
 const x=await setup(),secret='SYNTHETIC_DO_NOT_LEAK_'+randomUUID(),identity={profileId:x.p.id,expectedRevision:1};let requests=0;
 try{
  const service=new (api().ApiCredentials)({...x.options,connectionRequest:async()=>{requests++;return{status:401,body:{}}}});
  await service.writeApiCredential({...identity,secret});x.storage.decryptString=()=>{throw Error(secret)};
  const status=await service.apiCredentialStatus({profileId:x.p.id});assert.equal(status.failureCode,'CREDENTIAL_DECRYPT_FAILED');assert.equal(status.configured,false);
  await assert.rejects(service.checkApiConnection(identity),/CREDENTIAL_DECRYPT_FAILED/);
  await assert.rejects(service.writeApiCredential({...identity,secret}),/CREDENTIAL_DECRYPT_FAILED/);
  const handlers=new Map();api().registerApiCredentialHandlers((n,f)=>handlers.set(n,f),()=>{},service);
  const result=await handlers.get('rainfall:api-credential:check')({},identity);assert.equal(result.error.code,'CREDENTIAL_DECRYPT_FAILED');assert.equal(requests,0);
  assert.ok(!JSON.stringify([status,result,x.s.snapshot()]).includes(secret));
 }finally{x.s.close()}
});

test('synthetic encryption, filesystem and malformed-data failures remain distinct without plaintext errors',async()=>{
 const x=await setup(),binding={accountId:x.p.id,providerId:'yourmusic',remoteSubject:'local-profile:'+x.p.id};
 try{
  const failing=new CredentialVault(x.vaultRoot,{...x.storage,encryptString:()=>{throw Error('SYNTHETIC_PRIVATE_ERROR')}});
  assert.throws(()=>failing.put(binding,'SYNTHETIC_INPUT'),/CREDENTIAL_ENCRYPT_FAILED/);
  const notDirectory=path.join(x.root,'not-directory');fs.writeFileSync(notDirectory,'fixture');
  assert.throws(()=>new CredentialVault(notDirectory,x.storage).put(binding,'SYNTHETIC_INPUT'),/CREDENTIAL_SAVE_FAILED/);
  x.vault.put(binding,'SYNTHETIC_INPUT');const invalid=new CredentialVault(x.vaultRoot,{...x.storage,decryptString:()=>'{broken'});
  assert.throws(()=>invalid.get(binding),/CREDENTIAL_DATA_INVALID/);
 }finally{x.s.close()}
});

test('a synthetic replacement failing encrypted readback preserves the previous ciphertext',async()=>{
 const x=await setup(),identity={profileId:x.p.id,expectedRevision:1};
 try{
  await x.service.writeApiCredential({...identity,secret:'SYNTHETIC_OLD'});const file=path.join(x.vaultRoot,x.p.id+'.bin'),before=fs.readFileSync(file);
  x.storage.decryptString=()=> 'SYNTHETIC_WRONG_READBACK';
  await assert.rejects(x.service.writeApiCredential({...identity,secret:'SYNTHETIC_NEW'}),/CREDENTIAL_READBACK_FAILED/);
  assert.deepEqual(fs.readFileSync(file),before);
 }finally{x.s.close()}
});

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
    assert.equal(handlers.size, 4);
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

test("YourMusic connection check sends only one authenticated history GET and returns no account content", async () => {
  const x = await setup();
  const secret = "QA_CONNECTION_ONLY_" + randomUUID();
  try {
    await x.service.writeApiCredential({profileId:x.p.id,expectedRevision:1,secret});
    const requests=[];
    const service=new (api().ApiCredentials)({...x.options,connectionRequest:async request=>{
      requests.push(request);
      return {status:200,body:{data:[{title:"PRIVATE_HISTORY",lyrics:secret}],total:1,page:1,size:1,total_pages:1}};
    }});
    assert.equal(typeof service.checkApiConnection,"function","read-only client connection check is missing");
    const result=await service.checkApiConnection({profileId:x.p.id,expectedRevision:1});
    assert.equal(result.state,"connected");
    assert.equal(result.httpStatus,200);
    assert.equal(result.paidGenerationRequested,false);
    assert.equal(result.scope,"authentication_only");
    assert.equal(requests.length,1);
    assert.equal(requests[0].method,"GET");
    assert.equal(requests[0].url,"https://api.yourmusic.fun/v1/music/generations/history?page=1&size=1");
    assert.equal(requests[0].headers.Authorization,"Bearer "+secret);
    assert.equal(requests[0].body,undefined);
    assert(!JSON.stringify(result).includes(secret));
    assert(!JSON.stringify(result).includes("PRIVATE_HISTORY"));
    assert(!JSON.stringify(x.s.all("audit")).includes(secret));
    assert.equal((await x.s.call("apiProfile.list"))[0].executionEnabled,false);
  } finally {x.s.close()}
});

test("connection checks distinguish auth, credit, rate and malformed responses without reflecting secrets", async () => {
  const x=await setup(), secret="QA_CHECK_ERROR_SECRET";
  try{
    await x.service.writeApiCredential({profileId:x.p.id,expectedRevision:1,secret});
    for(const [httpStatus,state] of [[401,"unauthorized"],[403,"forbidden"],[402,"credits_required"],[429,"rate_limited"],[500,"unavailable"],[302,"unavailable"],[200,"invalid_response"]]){
      const service=new (api().ApiCredentials)({...x.options,connectionRequest:async()=>({status:httpStatus,body:{message:secret}})});
      assert.equal(typeof service.checkApiConnection,"function","read-only client connection check is missing");
      const result=await service.checkApiConnection({profileId:x.p.id,expectedRevision:1});
      assert.equal(result.state,state);
      assert(!JSON.stringify(result).includes(secret));
    }
    const service=new (api().ApiCredentials)({...x.options,connectionRequest:async()=>{throw Error(secret)}});
    const result=await service.checkApiConnection({profileId:x.p.id,expectedRevision:1});
    assert.equal(result.state,"unavailable");assert.equal(result.httpStatus,null);
    assert(!JSON.stringify(result).includes(secret));
  }finally{x.s.close()}
});

test("connection failures expose only allowlisted diagnostic categories",async()=>{
 const x=await setup();try{
  await x.service.writeApiCredential({profileId:x.p.id,expectedRevision:1,secret:'QA_ONLY_DIAGNOSTIC'});
  for(const [code,expected] of [['ENOTFOUND','HTTP_DNS_FAILED'],['SELF_SIGNED_CERT_IN_CHAIN','HTTP_TLS_FAILED'],['ERR_INVALID_CHAR','CREDENTIAL_FORMAT_INVALID'],['ECONNRESET','HTTP_REQUEST_FAILED'],['PRIVATE_CODE_SHOULD_NOT_ESCAPE','HTTP_REQUEST_FAILED']]){
   const service=new (api().ApiCredentials)({...x.options,connectionRequest:async()=>{throw Object.assign(Error('PRIVATE_ERROR_SHOULD_NOT_ESCAPE'),{code})}});
   const result=await service.checkApiConnection({profileId:x.p.id,expectedRevision:1});
   assert.equal(result.failureCode,expected);assert.equal(result.httpStatus,null);
   assert(!JSON.stringify(result).includes('PRIVATE_'));
  }
 }finally{x.s.close()}
});

test("connection check rejects stale revision, simulation, unsupported provider and custom URL before network", async()=>{
  const x=await setup();let requests=0;
  const service=new (api().ApiCredentials)({...x.options,connectionRequest:async()=>{requests++;return {status:401,body:{}}}});
  try{
    assert.equal(typeof service.checkApiConnection,"function","read-only client connection check is missing");
    const identity={profileId:x.p.id,expectedRevision:1};
    await assert.rejects(service.checkApiConnection({...identity,expectedRevision:2}),/REVISION_CONFLICT/);
    await assert.rejects(service.checkApiConnection({...identity,url:"https://evil.invalid"}));
    const {revision,...profile}=x.p;
    const other=await x.s.call("apiProfile.save",{profile:{...profile,id:randomUUID(),kind:"text",providerId:"codex_cli"},expectedRevision:null});
    await assert.rejects(service.checkApiConnection({profileId:other.id,expectedRevision:1}),/CONNECTION_CHECK_UNSUPPORTED/);
    x.setMode("simulation");
    await assert.rejects(service.checkApiConnection(identity),/SIMULATION_CREDENTIALS_DISABLED/);
    assert.equal(requests,0);
  }finally{x.s.close()}
});

test("connection IPC checks frame trust and invalidates results after workspace change",async()=>{
  const x=await setup();let requests=0;
  try{
    await x.service.writeApiCredential({profileId:x.p.id,expectedRevision:1,secret:"QA_ONLY"});
    const service=new (api().ApiCredentials)({...x.options,connectionRequest:async()=>{requests++;x.setMode("simulation");return {status:200,body:{data:[],total:0,page:1,size:1,total_pages:0}}}});
    const handlers=new Map();
    api().registerApiCredentialHandlers((n,f)=>handlers.set(n,f),event=>{if(event!=="trusted")throw Error("IPC_SOURCE_REJECTED")},service);
    const handler=handlers.get("rainfall:api-credential:check");
    assert.equal(typeof handler,"function","read-only connection IPC is missing");
    const identity={profileId:x.p.id,expectedRevision:1};
    assert.equal((await handler("untrusted",identity)).error.code,"IPC_SOURCE_REJECTED");
    assert.equal(requests,0);
    assert.equal((await handler("trusted",identity)).error.code,"WORKSPACE_CHANGED");
    assert.equal(requests,1);
  }finally{x.s.close()}
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
