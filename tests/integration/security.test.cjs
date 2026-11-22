const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID, createHash } = require("node:crypto"),
  sharp = require("sharp");
const { Studio } = require("../../build/core.cjs");
function setup() {
  const root = path.resolve("output/test-runs", randomUUID());
  return { root, s: new Studio(root, "simulation") };
}
test("future schema refuses writes without changing the database", () => {
  const { s, root } = setup();
  s.db.pragma("user_version=999");
  s.close();
  const file = path.join(root, "simulation/library.sqlite"),
    before = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  assert.throws(() => new Studio(root, "simulation"), /FUTURE_SCHEMA/);
  assert.equal(
    createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
    before,
  );
});
test("malicious ZIP traversal is rejected before extraction and preserves current library", async () => {
  const { s, root } = setup();
  const source = path.join(root, "malicious.zip");
  const name = Buffer.from("../escaped.txt"),
    data = Buffer.from("unsafe"),
    local = Buffer.alloc(30),
    central = Buffer.alloc(46),
    end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + data.length, 16);
  fs.writeFileSync(
    source,
    Buffer.concat([local, name, data, central, name, end]),
  );
  const before = s.all("works").length;
  await assert.rejects(s.restore(source));
  assert.equal(s.all("works").length, before);
  assert.equal(fs.existsSync(path.join(root, "escaped.txt")), false);
  s.close();
});
test("managed-media junction cannot redirect reads outside the hash store", async () => {
  const { s, root } = setup();
  const source = path.join(root, "image.png");
  await sharp({
    create: { width: 10, height: 10, channels: 4, background: "#ff00ff" },
  })
    .png()
    .toFile(source);
  const asset = await s.importFile(source, "cover");
  const actual = s.locate(asset.id).file,
    parent = path.dirname(actual),
    outside = path.join(root, "redirected");
  fs.renameSync(parent, outside);
  fs.symlinkSync(outside, parent, "junction");
  try {
    assert.throws(() => s.locate(asset.id), /PATH|ASSET/);
  } finally {
    fs.unlinkSync(parent);
    fs.renameSync(outside, parent);
    s.close();
  }
});
test("oversized text and paid-autopublish requests are blocked at service schemas", async () => {
  const { s } = setup();
  const a = s.all("artists")[0];
  await assert.rejects(s.call("creation.start", {
    artistId: a.id, title: "QA", story: "QA", overrides: {},
  }), /METHOD_NOT_ALLOWED/);
  await assert.rejects(s.call("work.save", {
    artistId: a.id, title: "QA", story: "x".repeat(20001),
    parameters: {}, lyrics: "", prompt: "", rights: "", ai: "none",
  }));
  await assert.rejects(s.call("createPublishGrant", {}));
  await assert.rejects(s.call("credentials.get", { accountId: a.id }));
  assert.equal(s.externalRequests, 0);
  s.close();
});
