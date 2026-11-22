import { readFileSync } from "node:fs";
import path from "node:path";

export function verifiedDesktopPointerPath(localAppData = process.env.LOCALAPPDATA) {
  if (!localAppData || !path.isAbsolute(localAppData) ||
      (process.platform === "win32" && path.parse(localAppData).root.length <= 1)) throw Error("LOCALAPPDATA_REQUIRED");
  return path.join(localAppData, "RainfallStudioLauncher", "verified-desktop.json");
}

export function readVerifiedDesktop(localAppData = process.env.LOCALAPPDATA, read = readFileSync) {
  const file = verifiedDesktopPointerPath(localAppData);
  let pointer;
  try {
    pointer = JSON.parse(read(file, "utf8").replace(/^\uFEFF/u, ""));
  } catch {
    throw Error("VERIFIED_DESKTOP_POINTER_UNREADABLE");
  }
  if (pointer?.format !== 1 || pointer.validation !== "accepted" ||
      typeof pointer.dataRoot !== "string" || !path.isAbsolute(pointer.dataRoot) ||
      (process.platform === "win32" && path.parse(pointer.dataRoot).root.length <= 1)) {
    throw Error("VERIFIED_DESKTOP_POINTER_INVALID");
  }
  return pointer;
}
