const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../../build/core.cjs");
test("Core exposes persistent Studio service", () =>
  assert.equal(
    typeof core.Studio,
    "function",
    "persistent Studio service missing",
  ));
