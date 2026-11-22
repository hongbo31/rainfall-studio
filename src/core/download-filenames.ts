import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const pathKey = (name: string) => process.platform === "win32" ? name.toLowerCase() : name;
const existed = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code === "EEXIST";
export const downloadSupportFolders = { certificate: "原创证书", rights: "授权附件", video: "视频" } as const;

export function songDownloadCollisionStem(folder: string) {
  return /^(.+) \((?:[2-9]|[1-9]\d+)\)$/u.exec(folder)?.[1];
}

function isPhysicalDirectory(directory: string) {
  const info = fs.lstatSync(directory, { throwIfNoEntry: false });
  return info?.isDirectory() && !info.isSymbolicLink() && pathKey(fs.realpathSync.native(directory)) === pathKey(directory);
}

export function ensureDownloadSubfolder(parent: string, name: string) {
  if (!name || name === "." || name === ".." || /[<>:"/\\|?*\u0000-\u001f]/u.test(name))
    throw Error("DOWNLOAD_FOLDER_INVALID");
  const directory = path.join(parent, name);
  try { fs.mkdirSync(directory); }
  catch (error) { if (!existed(error)) throw error; }
  if (!isPhysicalDirectory(directory)) throw Error("DOWNLOAD_FOLDER_INVALID");
  return directory;
}

export function createDownloadCollisionFolder(parent: string, stem: string) {
  for (let number = 2; ; number++) {
    const directory = path.join(parent, `${stem} (${number})`);
    try {
      fs.mkdirSync(directory);
      return directory;
    } catch (error) {
      if (!existed(error)) throw error;
    }
  }
}

export function reserveSongDownloadFolder(parent: string, stem: string) {
  const name = pathKey(stem.normalize("NFC"));
  const claim = path.join(parent, ".rainfall-" + createHash("sha256").update(name).digest("hex") + ".lock");
  // Main and Core can both archive into the same directory.
  const separate = () => ({ directory: createDownloadCollisionFolder(parent, stem), release() {} });
  try { fs.mkdirSync(claim); }
  catch (error) {
    if (!existed(error)) throw error;
    return separate();
  }
  const release = () => {
    try { fs.rmdirSync(claim); } catch { /* A leftover claim is treated as a collision. */ }
  };
  try {
    const hasTitle = (directory: string) => fs.readdirSync(directory, { withFileTypes: true }).some(entry =>
      !entry.isDirectory() && pathKey(path.parse(entry.name).name.normalize("NFC")) === name);
    const occupied = hasTitle(parent) || Object.values(downloadSupportFolders).some(folder => {
      const support = path.join(parent, folder);
      return isPhysicalDirectory(support) && hasTitle(support);
    });
    if (!occupied)
      return { directory: parent, release };
  } catch (error) {
    release();
    throw error;
  }
  release();
  return separate();
}
