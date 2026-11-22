import path from "node:path";
import { execFileSync } from "node:child_process";
import { executableOnPath, isExecutableFile, windowsProgramDirectories } from "../../src/shared/host-executable-paths.ts";

export function powerShell7Path(env = process.env, platform = process.platform, isFile = isExecutableFile) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const command = platform === "win32" ? "pwsh.exe" : "pwsh";
  if (env.RAINFALL_PWSH) {
    const configured = env.RAINFALL_PWSH;
    const executable = paths.isAbsolute(configured) && paths.parse(configured).root.length > (platform === "win32" ? 1 : 0)
      ? paths.normalize(configured) : configured === command ? executableOnPath([command], platform, env, isFile) : undefined;
    if (executable && isFile(executable)) return executable;
    throw Error("RAINFALL_PWSH_UNAVAILABLE");
  }
  const executable = executableOnPath([command], platform, env, isFile) ?? (platform === "win32"
    ? windowsProgramDirectories(env).map(dir => paths.join(dir, "PowerShell", "7", command)).find(isFile)
    : undefined);
  if (!executable) throw Error("POWERSHELL_7_REQUIRED: install pwsh or set RAINFALL_PWSH");
  return executable;
}

export function windowsDesktopDirectory(executable = powerShell7Path(), exec = execFileSync) {
  const folder = exec(executable, ["-NoProfile", "-NonInteractive", "-Command", "[Environment]::GetFolderPath('DesktopDirectory')"],
    { encoding: "utf8", windowsHide: true, timeout: 10000 }).trim();
  if (!path.win32.isAbsolute(folder) || path.win32.parse(folder).root.length <= 1) throw Error("DESKTOP_DIRECTORY_UNAVAILABLE");
  return folder;
}
