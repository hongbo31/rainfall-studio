const path = require("node:path");
const { linuxMediaToolPath } = require("../../src/shared/host-executable-paths.ts");

// These test runners bundle their local media consumers one level under output.
module.exports = function fixtureMediaTool(tool) {
  if (process.platform === "linux") return linuxMediaToolPath(tool);
  return path.resolve(__dirname, "../../output/tools/media", tool + ".exe");
};
