import fs from "node:fs";
import path from "node:path";

export function isExecutableFile(file: string): boolean {
  try {
    return fs.statSync(file, { throwIfNoEntry: false })?.isFile() ?? false;
  } catch {
    return false;
  }
}

function isWindowsAbsolute(value: string | undefined): value is string {
  return !!value && path.win32.isAbsolute(value) && path.win32.parse(value).root.length > 1;
}

export function windowsProgramDirectories(env: NodeJS.ProcessEnv = process.env): string[] {
  const drive = /^[a-z]:$/i.test(env.SystemDrive ?? "") ? env.SystemDrive + path.win32.sep
    : isWindowsAbsolute(env.SystemRoot) ? path.win32.parse(env.SystemRoot).root : undefined;
  const conventional = drive ? ["Program Files", "Program Files (x86)"].map(name => path.win32.join(drive, name)) : [];
  return [...new Set([env.ProgramW6432, env.ProgramFiles, env["ProgramFiles(x86)"], ...conventional].filter(isWindowsAbsolute))];
}

export function windowsChromiumExecutable(browser: "chrome" | "msedge", env: NodeJS.ProcessEnv = process.env,
  isFile = isExecutableFile): string | undefined {
  const [vendor, app] = browser === "chrome" ? ["Google", "Chrome"] : ["Microsoft", "Edge"];
  const roots = [...new Set([...windowsProgramDirectories(env), env.LOCALAPPDATA].filter(isWindowsAbsolute))];
  return roots.map(root => path.win32.join(root, vendor, app, "Application", browser + ".exe")).find(isFile);
}

export function bundledChromiumExecutable(isFile = isExecutableFile): string | undefined {
  const executable = path.resolve(__dirname, "..", "tools", "chromium", "chrome.exe");
  if (isFile(executable)) return executable;
}

export function windowsPowerShellExecutable(): string {
  const executable = path.resolve(__dirname, "..", "tools", "powershell", "pwsh.exe");
  return process.platform === "win32" && isExecutableFile(executable) ? executable : "pwsh.exe";
}

export function executableOnPath(names: readonly string[], platform = process.platform,
  env: NodeJS.ProcessEnv = process.env, isFile = isExecutableFile): string | undefined {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const directories = (env.PATH ?? env.Path ?? "").split(paths.delimiter).map(dir => dir.trim().replace(/^"(.*)"$/u, "$1"));
  for (const dir of directories) {
    if (platform === "win32" ? !isWindowsAbsolute(dir) : !paths.isAbsolute(dir)) continue;
    for (const name of names) {
      const candidate = paths.join(dir, name);
      if (isFile(candidate)) return candidate;
    }
  }
}

export function linuxMediaToolPath(tool: "ffmpeg" | "ffprobe", configuredRoot = process.env.RAINFALL_MEDIA_TOOLS): string {
  if (tool !== "ffmpeg" && tool !== "ffprobe") throw Error("MEDIA_TOOL_UNSUPPORTED");
  const root = configuredRoot || path.posix.join(path.posix.sep, "usr", "bin");
  if (!path.posix.isAbsolute(root)) throw Error("MEDIA_TOOL_ROOT_INVALID");
  return path.posix.join(root, tool);
}
