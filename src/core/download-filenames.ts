import fs from "node:fs";
import path from "node:path";

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
