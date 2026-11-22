import path from "node:path";
import { executableOnPath, isExecutableFile, windowsChromiumExecutable } from "../../src/shared/host-executable-paths.ts";

/** Use a configured binary, an installed browser, or Playwright's managed browser. Never install one here. */
export function headlessChromiumOptions(chromium, {
  executablePath, platform = process.platform, env = process.env, isFile = isExecutableFile,
} = {}) {
  const configured = executablePath || env.RAINFALL_TEST_CHROME || env.CHROME_PATH;
  if (configured) {
    const paths = platform === "win32" ? path.win32 : path.posix;
    const root = paths.parse(configured).root;
    if (platform === "win32" && root && root.length <= 2) throw Error("CHROMIUM_PATH_NOT_FULLY_QUALIFIED");
    const selected = paths.resolve(path.resolve(import.meta.dirname, "../.."), configured);
    if (!isFile(selected)) throw Error("CHROMIUM_EXECUTABLE_UNAVAILABLE: " + selected);
    return { executablePath: selected, headless: true };
  }
  const installed = platform === "win32"
    ? windowsChromiumExecutable("chrome", env, isFile) ?? windowsChromiumExecutable("msedge", env, isFile)
      ?? executableOnPath(["chrome.exe", "msedge.exe", "chromium.exe"], platform, env, isFile)
    : executableOnPath(["google-chrome", "chromium", "chromium-browser", "microsoft-edge"], platform, env, isFile);
  if (installed) return { executablePath: installed, headless: true };
  const managed = chromium.executablePath();
  if (isFile(managed)) return { executablePath: managed, headless: true };
  return platform === "darwin" ? { channel: "chrome", headless: true } : { headless: true };
}

export async function launchHeadlessChromium(chromium, { executablePath, ...options } = {}) {
  return chromium.launch({ ...options, ...headlessChromiumOptions(chromium, { executablePath }) });
}
