import path from "node:path";
import { execFileSync } from "node:child_process";
import { windowsPowerShellExecutable } from "../../shared/host-executable-paths";
export const physicalInboxHelperPath = (
  name: "dot-rename-exclusive.ps1" | "dot-volume-facts.ps1",
  base: string = __dirname,
) =>
  path.join(
    base.replace(/([\\/])app\.asar([\\/])/, "$1app.asar.unpacked$2"),
    name,
  );
export const exclusiveHelperPath = (base: string = __dirname) =>
  physicalInboxHelperPath("dot-rename-exclusive.ps1", base);
/** Windows File.Move is atomic and never replaces an existing destination, including on DriveFS. */
export function renameExclusive(source: string, destination: string) {
  if (process.platform !== "win32")
    throw Error("DELIVERY_EXCLUSIVE_WINDOWS_REQUIRED");
  try {
    execFileSync(
      windowsPowerShellExecutable(),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-File",
        exclusiveHelperPath(),
        "-Source",
        source,
        "-Destination",
        destination,
      ],
      { windowsHide: true, timeout: 15000, stdio: "pipe" },
    );
  } catch (e: any) {
    if (e?.status === 73)
      throw Object.assign(Error("EEXIST"), { code: "EEXIST" });
    throw e;
  }
}
