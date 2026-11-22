import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { build } from "esbuild";
import { headlessChromiumOptions } from "../scripts/lib/headless-chromium.mjs";
import { powerShell7Path, windowsDesktopDirectory } from "../scripts/lib/powershell-7.mjs";
import { readVerifiedDesktop } from "../scripts/lib/verified-desktop.mjs";

const { outputFiles } = await build({
  entryPoints: [path.resolve(import.meta.dirname, "../src/main/fanqie/chrome-executable.ts")],
  bundle: true, platform: "node", format: "esm", write: false,
});
const { fanqieChromeLaunchOptions } = await import("data:text/javascript;base64," +
  Buffer.from(outputFiles[0].contents).toString("base64"));

test("Windows Chrome lookup never invents a system drive", () => {
  const probed = [];
  assert.throws(() => fanqieChromeLaunchOptions("win32", {}, candidate => {
    probed.push(candidate);
    return true;
  }), /FANQIE_CHROME_NOT_FOUND/);
  assert.deepEqual(probed, []);
});

test("Windows Chrome lookup uses the OS program directory on another drive", () => {
  const installed = "Q:\\Applications\\Google\\Chrome\\Application\\chrome.exe";
  assert.deepEqual(fanqieChromeLaunchOptions("win32", {
    ProgramW6432: "Q:\\Applications", SystemDrive: "R:",
  }, path => path === installed), { executablePath: installed });
});

test("headless browser selection honors an explicit browser and uses Edge when Chrome is absent", () => {
  const chrome = { executablePath: () => "Q:\\Playwright\\chromium.exe" };
  const edge = "R:\\Apps\\Microsoft\\Edge\\Application\\msedge.exe";
  const custom = "S:\\Browser\\custom.exe";
  const base = { platform: "win32", isFile: file => file === edge || file === custom };
  assert.deepEqual(headlessChromiumOptions(chrome, { ...base,
    env: { ProgramFiles: "R:\\Apps", RAINFALL_TEST_CHROME: custom },
  }), { executablePath: custom, headless: true });
  assert.deepEqual(headlessChromiumOptions(chrome, { ...base, env: { ProgramFiles: "R:\\Apps" } }),
    { executablePath: edge, headless: true });
  assert.throws(() => headlessChromiumOptions(chrome, { ...base, env: { CHROME_PATH: "Q:\\missing.exe" } }),
    /CHROMIUM_EXECUTABLE_UNAVAILABLE/);
  assert.throws(() => headlessChromiumOptions(chrome, { ...base, env: { CHROME_PATH: "Q:relative.exe" } }),
    /CHROMIUM_PATH_NOT_FULLY_QUALIFIED/);
});

test("an explicit relative browser override resolves from the project, independent of the caller directory", () => {
  const relativePath = path.join("portable browser", "chrome");
  const expected = path.resolve(import.meta.dirname, "..", relativePath);
  assert.deepEqual(headlessChromiumOptions({ executablePath: () => "" }, {
    env: { RAINFALL_TEST_CHROME: relativePath }, isFile: candidate => candidate === expected,
  }), { executablePath: expected, headless: true });
});

test("Linux headless tests find Chromium from absolute PATH entries", () => {
  const chrome = { executablePath: () => "/managed/chromium" };
  const options = headlessChromiumOptions(chrome, {
    platform: "linux", env: { PATH: "relative:/installed/browser" },
    isFile: candidate => candidate === "/installed/browser/chromium" || candidate === "/managed/chromium",
  });
  assert.deepEqual(options, { executablePath: "/installed/browser/chromium", headless: true });
});

test("desktop diagnostics use the current user's accepted pointer and fail for a relative data root", () => {
  const local = path.join(path.parse(process.execPath).root, "fixture user", "Local");
  const dataRoot = path.join(local, "accepted data");
  const read = (file, encoding) => {
    assert.equal(file, path.join(local, "RainfallStudioLauncher", "verified-desktop.json"));
    assert.equal(encoding, "utf8");
    return "\uFEFF" + JSON.stringify({ format: 1, validation: "accepted", dataRoot });
  };
  assert.equal(readVerifiedDesktop(local, read).dataRoot, dataRoot);
  assert.throws(() => readVerifiedDesktop(local, () => JSON.stringify({
    format: 1, validation: "accepted", dataRoot: "candidate-data",
  })), /VERIFIED_DESKTOP_POINTER_INVALID/);
});

test("PowerShell 7 discovery resolves the shell outside the system drive", () => {
  const pwsh = "Q:\\portable tools\\pwsh.exe";
  assert.equal(powerShell7Path({ Path: '"Q:\\portable tools"' }, "win32", path => path === pwsh), pwsh);
  assert.throws(() => powerShell7Path({ RAINFALL_PWSH: "unqualified\\pwsh.exe" }, "win32", () => true),
    /RAINFALL_PWSH_UNAVAILABLE/);
});

test("desktop folder lookup accepts a redirected known folder", () => {
  const folder = "Q:\\Redirected profile\\Desktop";
  assert.equal(windowsDesktopDirectory("pwsh.exe", (_executable, args, options) => {
    assert.match(args.at(-1), /GetFolderPath\('DesktopDirectory'\)/);
    assert.equal(options.windowsHide, true);
    return folder + "\r\n";
  }), folder);
  assert.throws(() => windowsDesktopDirectory("pwsh.exe", () => ""), /DESKTOP_DIRECTORY_UNAVAILABLE/);
});
