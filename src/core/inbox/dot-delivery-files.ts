import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";
import { assertInboxPath } from "./receiver";
import { renameExclusive } from "./dot-rename-exclusive";
export const sha = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export function directory(folder: string) {
  assertInboxPath(folder);
  fs.mkdirSync(folder, { recursive: true });
  assertInboxPath(folder);
  if (!fs.lstatSync(folder).isDirectory())
    throw Error("DELIVERY_DIRECTORY_REQUIRED");
}
/** Pin and bound every read. Hashes, not the arrival of READY, establish that sync completed. */
export function read(file: string, max: number) {
  assertInboxPath(file);
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.nlink !== 1)
    throw Error("DELIVERY_FILE_REJECTED");
  if (before.size > max) throw Error("DELIVERY_FILE_LIMIT");
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const pinned = fs.fstatSync(fd);
    if (
      !pinned.isFile() ||
      pinned.nlink !== 1 ||
      pinned.ino !== before.ino ||
      pinned.dev !== before.dev ||
      pinned.size !== before.size
    )
      throw Error("DELIVERY_FILE_CHANGED");
    const bytes = Buffer.alloc(pinned.size + 1),
      length = fs.readSync(fd, bytes, 0, bytes.length, 0),
      after = fs.fstatSync(fd);
    if (
      length !== pinned.size ||
      after.size !== pinned.size ||
      after.mtimeMs !== pinned.mtimeMs ||
      after.ctimeMs !== pinned.ctimeMs
    )
      throw Error("DELIVERY_FILE_CHANGED");
    assertInboxPath(file);
    return bytes.subarray(0, length);
  } finally {
    fs.closeSync(fd);
  }
}
export function json(bytes: Buffer) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw Error("DELIVERY_JSON_INVALID");
  }
}
export function writeJson(
  root: string,
  name: string,
  value: unknown,
  exclusive = false,
) {
  directory(root);
  const dest = path.join(root, name);
  assertInboxPath(dest);
  if (fs.existsSync(dest)) {
    const stat = fs.lstatSync(dest);
    if (!stat.isFile() || stat.nlink !== 1)
      throw Error("DELIVERY_FILE_REJECTED");
  }
  const temporary = path.join(root, randomUUID() + ".partial"),
    fd = fs.openSync(temporary, "wx");
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    assertInboxPath(dest);
    if (exclusive) renameExclusive(temporary, dest);
    else fs.renameSync(temporary, dest);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
