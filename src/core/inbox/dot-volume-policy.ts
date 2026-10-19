import path from "node:path";
import { execFileSync } from "node:child_process";
import { physicalInboxHelperPath } from "./dot-rename-exclusive";
const known = new Map<string, number>();
/** Some virtual volumes report nlink=0. Accept only if native volume flags prove hardlinks unsupported. */
export function acceptableLinkCount(
  stat: { nlink: number; dev: number },
  file: string,
) {
  if (stat.nlink === 1) return true;
  if (stat.nlink !== 0 || process.platform !== "win32") return false;
  const root = path.parse(path.resolve(file)).root,
    key = root.toLowerCase() + "|" + stat.dev;
  if ((known.get(key) ?? 0) > Date.now()) return true;
  let facts;
  try {
    facts = JSON.parse(
      execFileSync(
        "pwsh.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-File",
          physicalInboxHelperPath("dot-volume-facts.ps1"),
          "-Root",
          root,
        ],
        {
          encoding: "utf8",
          windowsHide: true,
          timeout: 15000,
          maxBuffer: 4096,
        },
      ).trim(),
    );
  } catch {
    throw Error("DELIVERY_VOLUME_FACTS_UNAVAILABLE");
  }
  const valid =
    Number.isInteger(facts.serial) &&
    facts.serial === stat.dev &&
    Number.isInteger(facts.flags) &&
    facts.flags >= 0 &&
    facts.flags <= 0xffffffff &&
    (facts.flags & 0x00400000) === 0;
  if (valid) known.set(key, Date.now() + 30000);
  return valid;
}
