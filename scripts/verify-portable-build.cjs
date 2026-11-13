// Run the shipped Core with the shipped Electron runtime and an empty test library.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const [packageRoot, dataRoot] = process.argv.slice(2);
assert(path.isAbsolute(packageRoot) && path.isAbsolute(dataRoot));
assert(!fs.existsSync(dataRoot), "The verification library must be new");
const code = String.raw`
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const [root, data] = process.argv.slice(1);
const { Studio } = require(path.join(root, "resources/app/build/core.cjs"));
for (let attempt = 0; attempt < 2; attempt++) {
  const studio = new Studio(data, "production");
  try {
    assert.equal(studio.snapshot().works.length, 0);
    assert(fs.statSync(path.join(data, "production/library.sqlite")).size > 0);
  } finally {
    studio.close();
  }
}
`;
execFileSync(path.join(packageRoot, "RainfallStudio.exe"), ["-e", code, packageRoot, dataRoot], {
  cwd: packageRoot,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", RAINFALL_DATA_ROOT: dataRoot },
  windowsHide: true,
  timeout: 30000,
});
