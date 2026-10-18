// Isolated original demo data only. Run with installed Electron as Node; never starts a window.
const fs = require("node:fs"),
  path = require("node:path");
const { Studio } = require("../build/core.cjs");
const root = path.resolve("output/ui-consistency/headless-fixture-data");
fs.mkdirSync(root, { recursive: true });
const studio = new Studio(root, "simulation");
try {
  const snapshot = studio.snapshot();
  snapshot.mode = "production"; // Exercise production UI with fixture state, never a real bridge.
  fs.writeFileSync(
    "output/ui-consistency/visual-fixture.json",
    JSON.stringify(snapshot),
  );
} finally {
  studio.close();
}
