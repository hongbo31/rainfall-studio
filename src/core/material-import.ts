import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import type {
  MaterialEntry,
  MaterialFileCheck,
  MaterialSource,
  MaterialWorkbenchSnapshot,
} from "../shared/material-workbench";
import type {
  MaterialImportPreview,
  MaterialImportRow,
  MaterialImportPreviewInput,
  MaterialImportUpdateInput,
  MaterialImportConfirmInput,
  MaterialImportRole,
} from "../shared/material-import";
import type { MaterialWorkbenchRepository } from "./material-workbench";

type InventoryFile = { relative: string; sha256: string; bytes: number };
type Inventory = {
  files: InventoryFile[];
  errors: string[];
  fingerprint: string;
};
type Descriptor = {
  styleSection?: string;
  metadataPath?: string;
  originalTitle?: string;
  legacyId?: string;
  identityExplicit: boolean;
  titleEdited?: boolean;
  editedRoles?: MaterialImportRole[];
};
type StoredPreview = {
  preview: MaterialImportPreview;
  inventory: Inventory;
  descriptors: Record<string, Descriptor>;
  sourceFingerprint: string;
};
export type MaterialImportCommitRow = {
  material: MaterialEntry;
  manifests: MaterialFileCheck[];
};
type Hooks = {
  snapshot: () => MaterialWorkbenchSnapshot;
  commit: (
    preview: MaterialImportPreview,
    rows: MaterialImportCommitRow[],
  ) => MaterialWorkbenchSnapshot;
  now: () => string;
};
const PREFIX = "material-import.preview:";
const LIMITS = {
  files: 5000,
  rows: 1000,
  depth: 16,
  totalBytes: 512 * 1024 * 1024,
  fileBytes: 32 * 1024 * 1024,
  textBytes: 2 * 1024 * 1024,
};
const roles: MaterialImportRole[] = ["lyrics", "style", "cover"];
const digest = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
const clone = <T>(v: T): T => structuredClone(v);
const slash = (v: string) => v.split(path.sep).join("/");
const sourceFingerprint = (source: MaterialSource) =>
  digest(JSON.stringify(source));
export function materialImportRoot(value: string) {
  const resolved = path.resolve(value);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw Error("IMPORT_ROOT_LINK_OR_NOT_DIRECTORY");
  const real = fs.realpathSync(resolved);
  if (real.toLowerCase() !== resolved.toLowerCase())
    throw Error("IMPORT_ROOT_LINK_REJECTED");
  return real;
}
const rootPath=materialImportRoot;
function safePath(root: string, relative: string) {
  if (
    !relative ||
    relative.includes("\0") ||
    relative.includes("\\") ||
    path.posix.isAbsolute(relative) ||
    path.win32.isAbsolute(relative) ||
    relative.split("/").some((p) => p === ".." || p === "." || !p) ||
    relative.includes(":")
  )
    throw Error("IMPORT_PATH_OUTSIDE_ROOT");
  const target = path.resolve(root, relative),
    rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel))
    throw Error("IMPORT_PATH_OUTSIDE_ROOT");
  let cursor = root;
  for (const part of relative.split("/")) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor)) {
      const info = fs.lstatSync(cursor);
      if (info.isSymbolicLink() || (info.isFile() && info.nlink > 1))
        throw Error("IMPORT_LINK_REJECTED");
      const real = fs.realpathSync(cursor);
      if (real.toLowerCase() !== cursor.toLowerCase())
        throw Error("IMPORT_LINK_REJECTED");
    }
  }
  return target;
}
function inventory(root: string, legacy: boolean): Inventory {
  const files: InventoryFile[] = [],
    errors: string[] = [];
  let total = 0,
    stopped = false;
  const rootDev = fs.statSync(root).dev;
  function visit(directory: string, depth: number) {
    if (stopped) return;
    if (depth > LIMITS.depth) {
      errors.push(
        "IMPORT_DEPTH_LIMIT: " + slash(path.relative(root, directory)),
      );
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (e) {
      errors.push(
        "IMPORT_DIRECTORY_UNREADABLE: " + slash(path.relative(root, directory)),
      );
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (stopped) break;
      const relative = slash(
        path.relative(root, path.join(directory, entry.name)),
      );
      if (legacy && depth === 0 && entry.name === "original-archives") continue;
      let target: string, stat: fs.Stats;
      try {
        target = safePath(root, relative);
        stat = fs.lstatSync(target);
        if (stat.dev !== rootDev) throw Error("IMPORT_MOUNT_REJECTED");
      } catch (e) {
        errors.push(String(e) + ": " + relative);
        continue;
      }
      if (stat.isDirectory()) {
        visit(target, depth + 1);
        continue;
      }
      if (!stat.isFile()) {
        errors.push("IMPORT_SPECIAL_FILE_REJECTED: " + relative);
        continue;
      }
      if (files.length >= LIMITS.files) {
        errors.push("IMPORT_FILE_COUNT_LIMIT");
        stopped = true;
        break;
      }
      if (stat.size > LIMITS.fileBytes) {
        errors.push("IMPORT_FILE_SIZE_LIMIT: " + relative);
        continue;
      }
      total += stat.size;
      if (total > LIMITS.totalBytes) {
        errors.push("IMPORT_TOTAL_BYTES_LIMIT");
        stopped = true;
        break;
      }
      try {
        fs.accessSync(target, fs.constants.R_OK);
        const bytes = fs.readFileSync(target);
        files.push({ relative, sha256: digest(bytes), bytes: bytes.length });
      } catch {
        errors.push("IMPORT_FILE_UNREADABLE: " + relative);
      }
    }
  }
  visit(root, 0);
  return {
    files,
    errors,
    fingerprint: digest(JSON.stringify({ files, errors })),
  };
}
export class MaterialImportService {
  constructor(
    private repo: MaterialWorkbenchRepository,
    private hooks: Hooks,
  ) {}
  private load(id: string): StoredPreview {
    const value = this.repo.getSetting(PREFIX + id) as
      StoredPreview | undefined;
    if (!value) throw Error("IMPORT_PREVIEW_NOT_FOUND");
    return clone(value);
  }
  private persist(stored: StoredPreview) {
    this.repo.setSetting(PREFIX + stored.preview.id, clone(stored));
    return clone(stored.preview);
  }
  private source(id: string) {
    const source = this.hooks.snapshot().sources.find((s) => s.id === id);
    if (!source) throw Error("IMPORT_SOURCE_NOT_FOUND");
    return source;
  }
  private assertCurrent(stored: StoredPreview) {
    const source = this.source(stored.preview.sourceId);
    if (
      source.revision !== stored.preview.baseSourceRevision ||
      sourceFingerprint(source) !== stored.sourceFingerprint
    )
      throw Error("IMPORT_PREVIEW_STALE_SOURCE");
    if (rootPath(stored.preview.root) !== stored.preview.root)
      throw Error("IMPORT_ROOT_CHANGED");
    const current = inventory(
      stored.preview.root,
      stored.preview.format === "legacy",
    );
    if (current.fingerprint !== stored.inventory.fingerprint)
      throw Error("IMPORT_SOURCE_BYTES_CHANGED");
  }
  async previewScan(
    input: MaterialImportPreviewInput,
  ): Promise<MaterialImportPreview> {
    const source = this.source(input.sourceId),
      root = rootPath(input.root ?? source.root);
    const legacy = fs.existsSync(path.join(root, "song-map-001-100.json"));
    const inv = inventory(root, legacy);
    const preview: MaterialImportPreview = {
      id: randomUUID(),
      sourceId: source.id,
      root,
      baseSourceRevision: source.revision,
      rebind: root.toLowerCase() !== source.root.toLowerCase(),
      format: "folders",
      rows: [],
      errors: [...inv.errors],
      warnings: [],
      createdAt: this.hooks.now(),
    };
    const stored: StoredPreview = {
      preview,
      inventory: inv,
      descriptors: {},
      sourceFingerprint: sourceFingerprint(source),
    };
    let inputs: Array<{
      sourceKey: string;
      number: string;
      title: string;
      lyricsPath: string;
      stylePath: string;
      coverPath: string;
      descriptor: Descriptor;
    }> = [];
    const manifest = inv.files.find(
        (f) => f.relative === "rainfall-materials.json",
      ),
      oldIndex = inv.files.find((f) => f.relative === "song-map-001-100.json");
    try {
      if (manifest) {
        preview.format = "manifest";
        if (manifest.bytes > LIMITS.textBytes)
          throw Error("IMPORT_MANIFEST_SIZE_LIMIT");
        const data = JSON.parse(
          fs.readFileSync(safePath(root, manifest.relative), "utf8"),
        );
        if (data.version !== 1 || !Array.isArray(data.materials))
          throw Error("IMPORT_MANIFEST_SCHEMA");
        if (data.materials.length > LIMITS.rows)
          throw Error("IMPORT_ROW_COUNT_LIMIT");
        if (oldIndex)
          preview.warnings.push("IMPORT_MANIFEST_OVERRIDES_LEGACY_INDEX");
        inputs = data.materials.map((row: any, i: number) => {
          if (
            !row ||
            typeof row.sourceKey !== "string" ||
            !row.sourceKey.trim() ||
            row.sourceKey.length > 500 ||
            typeof row.title !== "string" ||
            !["lyricsPath", "stylePath", "coverPath"].every(
              (k) => typeof row[k] === "string",
            )
          )
            throw Error("IMPORT_MANIFEST_SCHEMA");
          return {
            sourceKey: "manifest:" + row.sourceKey,
            number: String(i + 1).padStart(3, "0"),
            title: row.title,
            lyricsPath: row.lyricsPath,
            stylePath: row.stylePath,
            coverPath: row.coverPath,
            descriptor: { identityExplicit: true },
          };
        });
      } else if (oldIndex) {
        preview.format = "legacy";
        if (oldIndex.bytes > LIMITS.textBytes)
          throw Error("IMPORT_MANIFEST_SIZE_LIMIT");
        const rows = JSON.parse(
          fs.readFileSync(safePath(root, oldIndex.relative), "utf8"),
        );
        if (!Array.isArray(rows)) throw Error("IMPORT_LEGACY_INDEX_SCHEMA");
        inputs = rows.map((row: any) => {
          if (
            !row ||
            !["id", "title", "lyrics_file", "style_file", "cover_file"].every(
              (k) => typeof row[k] === "string",
            )
          )
            throw Error("IMPORT_LEGACY_INDEX_SCHEMA");
          return {
            sourceKey: row.id,
            number: row.id,
            title: row.title,
            lyricsPath: row.lyrics_file,
            stylePath: row.style_file,
            coverPath: row.cover_file,
            descriptor: {
              identityExplicit: true,
              styleSection: row.style_section,
              metadataPath: row.metadata_file,
              originalTitle: row.title,
              legacyId: row.id,
            },
          };
        });
      } else {
        const folders = new Map<string, InventoryFile[]>();
        for (const file of inv.files) {
          const ext = path.posix.extname(file.relative).toLowerCase();
          if (![".txt", ".png", ".jpg", ".jpeg"].includes(ext)) continue;
          const folder = path.posix.dirname(file.relative);
          const group = folders.get(folder) ?? [];
          group.push(file);
          folders.set(folder, group);
        }
        inputs = [...folders.entries()]
          .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
          .map(([folder, files], i) => {
            const candidate = (name: string) =>
              files.filter(
                (f) => path.posix.basename(f.relative).toLowerCase() === name,
              );
            const covers = files.filter((f) =>
              [".png", ".jpg", ".jpeg"].includes(
                path.posix.extname(f.relative).toLowerCase(),
              ),
            );
            return {
              sourceKey: "folder:" + folder,
              number: String(i + 1).padStart(3, "0"),
              title:
                folder === "."
                  ? path.basename(root)
                  : path.posix.basename(folder),
              lyricsPath:
                candidate("lyrics.txt").length === 1
                  ? candidate("lyrics.txt")[0].relative
                  : "",
              stylePath:
                candidate("style.txt").length === 1
                  ? candidate("style.txt")[0].relative
                  : "",
              coverPath: covers.length === 1 ? covers[0].relative : "",
              descriptor: { identityExplicit: false },
            };
          });
      }
      if (inputs.length > LIMITS.rows) throw Error("IMPORT_ROW_COUNT_LIMIT");
    } catch (e) {
      preview.errors.push(String(e));
      inputs = [];
    }
    const allText = inv.files
        .filter((f) => path.posix.extname(f.relative).toLowerCase() === ".txt")
        .map((f) => f.relative),
      allCovers = inv.files
        .filter((f) =>
          [".png", ".jpg", ".jpeg"].includes(
            path.posix.extname(f.relative).toLowerCase(),
          ),
        )
        .map((f) => f.relative);
    const committed = this.hooks
      .snapshot()
      .materials.filter((m) => m.sourceId === source.id);
    for (const inputRow of inputs) {
      const previous = committed.find(
        (m) =>
          m.sourceKey === inputRow.sourceKey ||
          (preview.format === "folders" &&
            "folder:" +
              path.posix.dirname(
                slash(path.relative(source.root, m.checks.lyrics.path)),
              ) ===
              inputRow.sourceKey),
      );
      const row: MaterialImportRow = {
        id: randomUUID(),
        sourceKey: inputRow.sourceKey,
        number: inputRow.number,
        title: previous?.title ?? inputRow.title,
        existingMaterialId: previous?.id,
        suggestedTitle: inputRow.title,
        lyricsPath: inputRow.lyricsPath,
        stylePath: inputRow.stylePath,
        coverPath: inputRow.coverPath,
        lyrics: "",
        style: "",
        checks: {} as any,
        cover: { width: 0, height: 0, previewUrl: "" },
        candidates: { lyrics: allText, style: allText, cover: allCovers },
        errors: [],
        warnings: [],
        duplicateMaterialIds: [],
        ready: false,
      };
      if (previous && preview.format === "folders") {
        for (const role of roles) {
          const relative = slash(
            path.relative(source.root, previous.checks[role].path),
          );
          if (inv.files.some((f) => f.relative === relative)) {
            if (relative !== row[`${role}Path`])
              (inputRow.descriptor.editedRoles ??= []).push(role);
            row[`${role}Path`] = relative;
          }
        }
      }
      stored.descriptors[row.id] = inputRow.descriptor;
      preview.rows.push(row);
    }
    if (!preview.rows.length && !preview.errors.length)
      preview.errors.push("IMPORT_NO_MATERIAL_FOLDERS");
    await this.validate(stored);
    let addedMissing = false;
    for (const previous of committed.filter(
      (m) => !preview.rows.some((r) => r.existingMaterialId === m.id),
    )) {
      if (preview.rows.length >= LIMITS.rows) {
        preview.errors.push("IMPORT_ROW_COUNT_LIMIT");
        break;
      }
      const row: MaterialImportRow = {
        id: randomUUID(),
        sourceKey: previous.sourceKey,
        number: previous.number,
        title: previous.title,
        suggestedTitle: previous.title,
        existingMaterialId: previous.id,
        lyricsPath: slash(
          path.relative(source.root, previous.checks.lyrics.path),
        ),
        stylePath: slash(
          path.relative(source.root, previous.checks.style.path),
        ),
        coverPath: slash(
          path.relative(source.root, previous.checks.cover.path),
        ),
        lyrics: "",
        style: "",
        checks: {} as any,
        cover: { width: 0, height: 0, previewUrl: "" },
        candidates: { lyrics: allText, style: allText, cover: allCovers },
        errors: [],
        warnings: [],
        duplicateMaterialIds: [],
        ready: false,
      };
      stored.descriptors[row.id] = { identityExplicit: true };
      preview.rows.push(row);
      addedMissing = true;
    }
    if (addedMissing) {
      preview.errors = preview.errors.filter(
        (e) => e !== "IMPORT_NO_MATERIAL_FOLDERS",
      );
      await this.validate(stored);
    }
    return this.persist(stored);
  }
  private async validate(stored: StoredPreview) {
    const p = stored.preview,
      snapshot = this.hooks.snapshot();
    for (const row of p.rows) {
      row.errors = [];
      row.warnings = [];
      row.duplicateMaterialIds = [];
      row.lyrics = "";
      row.style = "";
      row.styleNotes = "";
      row.cover = {
        width: 0,
        height: 0,
        previewUrl: "",
      };
      const descriptor = stored.descriptors[row.id];
      if (!row.title.trim() || row.title.length > 300)
        row.errors.push("IMPORT_TITLE_REQUIRED_OR_TOO_LONG");
      if (
        p.rows.some(
          (other) => other.id !== row.id && other.sourceKey === row.sourceKey,
        )
      )
        row.errors.push("IMPORT_SOURCE_KEY_AMBIGUOUS");
      for (const role of roles) {
        const relative = row[`${role}Path`];
        let target = "";
        try {
          if (!relative) throw Error("IMPORT_ROLE_MISSING_OR_AMBIGUOUS");
          target = safePath(p.root, relative);
          const known = stored.inventory.files.find(
            (f) => f.relative === relative,
          );
          if (!known || !fs.existsSync(target))
            throw Error("IMPORT_ROLE_FILE_MISSING");
          const ext = path.extname(relative).toLowerCase();
          if (
            role === "cover"
              ? ![".png", ".jpg", ".jpeg"].includes(ext)
              : ext !== ".txt"
          )
            throw Error("IMPORT_ROLE_FORMAT");
          if (role !== "cover" && known.bytes > LIMITS.textBytes)
            throw Error("IMPORT_TEXT_SIZE_LIMIT");
          const bytes = fs.readFileSync(target);
          if (digest(bytes) !== known.sha256)
            throw Error("IMPORT_SOURCE_BYTES_CHANGED");
          row.checks[role] = {
            path: target,
            exists: true,
            valid: true,
            sha256: known.sha256,
          };
          if (role === "cover") {
            const decoded = await sharp(bytes, {
              failOn: "warning",
              limitInputPixels: 40_000_000,
            })
              .raw()
              .toBuffer({ resolveWithObject: true });
            row.cover.width = decoded.info.width;
            row.cover.height = decoded.info.height;
            row.cover.previewUrl = `material-cover://preview/${p.id}/${row.id}?sha256=${known.sha256}`;
          } else {
            let text = bytes
              .toString("utf8")
              .replace(/^\uFEFF/, "")
              .replace(/\r\n/g, "\n")
              .trim();
            if (text.includes("\0") || text.includes("\uFFFD"))
              throw Error("IMPORT_TEXT_ENCODING");
            if (!text) throw Error("IMPORT_TEXT_EMPTY");
            if (role === "lyrics") {
              const title = descriptor.originalTitle ?? row.suggestedTitle;
              const header =
                "歌曲编号：" +
                descriptor.legacyId +
                "\n歌曲名称：" +
                title +
                "\n";
              if (descriptor.legacyId && text.startsWith(header))
                text = text.slice(header.length).trim();
              if (text.startsWith(title + "\n"))
                text = text.slice(title.length).trim();
              row.lyrics = text;
            } else {
              row.styleNotes = text;
              if (
                descriptor.styleSection &&
                !descriptor.editedRoles?.includes("style")
              ) {
                const lines = text.split("\n"),
                  matches = lines
                    .map((l, i) =>
                      l.trim() === descriptor.styleSection?.trim() ? i : -1,
                    )
                    .filter((i) => i >= 0);
                if (matches.length !== 1)
                  throw Error("IMPORT_STYLE_SECTION_AMBIGUOUS");
                const start = matches[0];
                let end = lines.findIndex(
                  (l, i) => i > start && /^\d{2}[｜|]/u.test(l),
                );
                if (end < 0) end = lines.length;
                row.styleNotes = lines.slice(start, end).join("\n");
                const styles = row.styleNotes
                  .split("\n")
                  .filter((l) => /^Style[：:]/.test(l));
                if (styles.length !== 1)
                  throw Error("IMPORT_STYLE_SECTION_AMBIGUOUS");
                text = styles[0].replace(/^Style[：:]\s*/, "").trim();
              } else if (
                descriptor.metadataPath &&
                !descriptor.editedRoles?.includes("style")
              ) {
                const metadata = JSON.parse(
                  fs.readFileSync(
                    safePath(p.root, descriptor.metadataPath),
                    "utf8",
                  ),
                );
                if (
                  metadata.id !== descriptor.legacyId ||
                  metadata.title !== descriptor.originalTitle ||
                  typeof metadata.style_en !== "string" ||
                  !text.includes(metadata.style_en.trim())
                )
                  throw Error("IMPORT_METADATA_MISMATCH");
                text = metadata.style_en.trim();
              }
              row.style = text;
            }
          }
        } catch (e) {
          row.checks[role] = {
            path: target,
            exists: !!target && fs.existsSync(target),
            valid: false,
            reason: String(e),
          };
          row.errors.push(role + ": " + String(e));
        }
      }
      if (descriptor.metadataPath) {
        try {
          const relative = descriptor.metadataPath,
            known = stored.inventory.files.find((f) => f.relative === relative);
          if (!known || known.bytes > LIMITS.textBytes)
            throw Error("IMPORT_METADATA_MISSING_OR_TOO_LARGE");
          const metadata = JSON.parse(
            fs.readFileSync(safePath(p.root, relative), "utf8"),
          );
          if (
            metadata.id !== descriptor.legacyId ||
            metadata.title !== descriptor.originalTitle
          )
            throw Error("IMPORT_METADATA_IDENTITY_MISMATCH");
          for (const role of roles) {
            if (descriptor.editedRoles?.includes(role)) continue;
            const expected = metadata[`${role}_file`],
              actual = row[`${role}Path`];
            if (
              typeof expected !== "string" ||
              !(actual === expected || actual.endsWith("/" + expected))
            )
              throw Error("IMPORT_METADATA_ROLE_PATH_MISMATCH");
          }
          if (
            !descriptor.editedRoles?.includes("cover") &&
            metadata.cover_sha256 &&
            metadata.cover_sha256 !== row.checks.cover.sha256
          )
            throw Error("IMPORT_METADATA_COVER_HASH_MISMATCH");
          if (
            !descriptor.editedRoles?.includes("lyrics") &&
            (typeof metadata.lyrics !== "string" ||
              metadata.lyrics.replace(/\r\n/g, "\n").trim() !== row.lyrics)
          )
            throw Error("IMPORT_METADATA_LYRICS_MISMATCH");
        } catch (e) {
          row.errors.push(String(e));
        }
      }
      if (
        p.rows.some(
          (other) =>
            other.id !== row.id &&
            other.coverPath &&
            other.coverPath === row.coverPath,
        )
      )
        row.errors.push("IMPORT_COVER_ASSIGNED_MULTIPLE_ROWS");
      row.ready = row.errors.length === 0;
    }
    const identical = (row: MaterialImportRow, m: MaterialEntry) =>
      roles.every(
        (role) =>
          row.checks[role]?.sha256 &&
          row.checks[role].sha256 === m.checks[role].sha256,
      );
    for (const row of p.rows) {
      if (
        !row.existingMaterialId &&
        !stored.descriptors[row.id].identityExplicit
      ) {
        const matches = snapshot.materials.filter(
          (m) =>
            m.sourceId === p.sourceId &&
            identical(row, m) &&
            !p.rows.some((other) => other.existingMaterialId === m.id),
        );
        const candidates = matches.filter((m) => {
          const oldSource = snapshot.sources.find((s) => s.id === m.sourceId)!;
          const oldRelative = slash(
            path.relative(oldSource.root, m.checks.lyrics.path),
          );
          return (
            !stored.inventory.files.some((f) => f.relative === oldRelative) &&
            p.rows.filter((other) => identical(other, m)).length === 1
          );
        });
        if (candidates.length === 1) {
          row.existingMaterialId = candidates[0].id;
          if (!stored.descriptors[row.id].titleEdited)
            row.title = candidates[0].title;
          row.warnings.push("IMPORT_IDENTITY_MATCHED_BY_EXACT_SOURCE_HASHES");
        }
      }
      if (row.existingMaterialId) {
        const target = snapshot.materials.find(
          (m) => m.id === row.existingMaterialId,
        );
        if (!target || target.sourceId !== p.sourceId)
          row.errors.push("IMPORT_EXISTING_IDENTITY_OUTSIDE_SOURCE");
      }
      row.duplicateMaterialIds = snapshot.materials
        .filter(
          (m) =>
            m.id !== row.existingMaterialId &&
            (m.title.trim() === row.title.trim() || identical(row, m)),
        )
        .map((m) => m.id);
      row.duplicateRowIds = p.rows
        .filter(
          (other) =>
            other.id !== row.id &&
            !(
              row.existingMaterialId &&
              row.existingMaterialId === other.existingMaterialId
            ) &&
            (other.title.trim() === row.title.trim() ||
              roles.every(
                (role) =>
                  !!row.checks[role]?.sha256 &&
                  row.checks[role].sha256 === other.checks[role]?.sha256,
              )),
        )
        .map((other) => other.id);
      if (row.duplicateMaterialIds.length || row.duplicateRowIds.length)
        row.warnings.push("IMPORT_DUPLICATE_REQUIRES_ACKNOWLEDGMENT");
      row.ready = row.errors.length === 0;
    }
    // Validation is intentionally two-pass: identities inferred late cannot silently bind twice.
    for (const row of p.rows) {
      if (
        row.existingMaterialId &&
        p.rows.some(
          (other) =>
            other.id !== row.id &&
            other.existingMaterialId === row.existingMaterialId,
        )
      ) {
        row.warnings.push("IMPORT_EXISTING_IDENTITY_SHARED_CHOICE");
      }
    }
  }
  async updatePreview(
    input: MaterialImportUpdateInput,
  ): Promise<MaterialImportPreview> {
    const stored = this.load(input.previewId);
    this.assertCurrent(stored);
    const row = stored.preview.rows.find((r) => r.id === input.rowId);
    if (!row) throw Error("IMPORT_ROW_NOT_FOUND");
    stored.descriptors[row.id].titleEdited = true;
    for (const role of roles)
      if (input[`${role}Path`] !== row[`${role}Path`]) {
        const edited = (stored.descriptors[row.id].editedRoles ??= []);
        if (!edited.includes(role)) edited.push(role);
      }
    row.title = input.title;
    row.lyricsPath = input.lyricsPath;
    row.stylePath = input.stylePath;
    row.coverPath = input.coverPath;
    row.existingMaterialId = input.existingMaterialId;
    await this.validate(stored);
    return this.persist(stored);
  }
  async confirmImport(
    input: MaterialImportConfirmInput,
  ): Promise<MaterialWorkbenchSnapshot> {
    if (
      input.confirmTitles !== true ||
      !input.rowIds.length ||
      input.rowIds.length > LIMITS.rows ||
      new Set(input.rowIds).size !== input.rowIds.length
    )
      throw Error("IMPORT_EXPLICIT_TITLES_CONFIRMATION_REQUIRED");
    const stored = this.load(input.previewId);
    this.assertCurrent(stored);
    await this.validate(stored);
    this.assertCurrent(stored);
    if (stored.preview.errors.length) throw Error("IMPORT_PREVIEW_HAS_ERRORS");
    const selected = input.rowIds.map((id) => {
      const row = stored.preview.rows.find((r) => r.id === id);
      if (!row) throw Error("IMPORT_ROW_NOT_FOUND");
      if (!row.ready) throw Error("IMPORT_ROW_HAS_ERRORS");
      if (
        (row.duplicateMaterialIds.length || row.duplicateRowIds?.length) &&
        !input.acceptDuplicates
      )
        throw Error("IMPORT_DUPLICATE_ACKNOWLEDGMENT_REQUIRED");
      return row;
    });
    const selectedIdentities = selected
      .map((r) => r.existingMaterialId)
      .filter(Boolean);
    if (new Set(selectedIdentities).size !== selectedIdentities.length)
      throw Error("IMPORT_EXISTING_IDENTITY_ASSIGNED_MULTIPLE_ROWS");
    const snapshot = this.hooks.snapshot();
    const rows: MaterialImportCommitRow[] = selected.map((row) => {
      const old = row.existingMaterialId
        ? snapshot.materials.find((m) => m.id === row.existingMaterialId)
        : undefined;
      const contentHash = digest(
        JSON.stringify({
          title: row.title.trim(),
          lyricsText: row.lyrics,
          styleText: row.style,
          styleNotes: row.styleNotes,
          metadataHash: stored.inventory.files.find(
            (f) => f.relative === stored.descriptors[row.id].metadataPath,
          )?.sha256,
          lyrics: row.checks.lyrics.sha256,
          style: row.checks.style.sha256,
          cover: row.checks.cover.sha256,
          styleSection: stored.descriptors[row.id].styleSection,
        }),
      );
      const normalized = (value: string | undefined) =>
        (value ?? "").replace(/\r\n/g, "\n").trim();
      const unchanged =
        old &&
        old.title === row.title.trim() &&
        normalized(old.lyrics) === normalized(row.lyrics) &&
        normalized(old.style) === normalized(row.style) &&
        normalized(old.styleNotes) === normalized(row.styleNotes) &&
        roles.every(
          (role) => old.checks[role].sha256 === row.checks[role].sha256,
        );
      if (
        old &&
        !stored.preview.rebind &&
        snapshot.jobs.some(
          (j) =>
            j.materialId === old.id &&
            !["completed", "blocked"].includes(j.state),
        ) &&
        (!unchanged ||
          roles.some((role) => old.checks[role].path !== row.checks[role].path))
      )
        throw Error("IMPORT_ACTIVE_JOB_SOURCE_CHANGE");
      const material: MaterialEntry = {
        id: old?.id ?? randomUUID(),
        sourceId: stored.preview.sourceId,
        sourceKey: old?.sourceKey ?? row.sourceKey,
        number: old?.number ?? row.number,
        title: row.title.trim(),
        revision: old ? old.revision + (unchanged ? 0 : 1) : 1,
        contentHash: unchanged ? old!.contentHash : contentHash,
        lyrics: row.lyrics,
        style: row.style,
        styleNotes: row.styleNotes,
        checks: clone(row.checks),
        cover: {
          width: row.cover.width,
          height: row.cover.height,
          previewUrl: "",
        },
        validationReasons: [],
        state: old?.jobIds.some((id) =>
          snapshot.jobs.some(
            (j) =>
              j.id === id &&
              [
                "queued",
                "dispatching",
                "accepted",
                "polling",
                "downloading",
                "unknown",
              ].includes(j.state),
          ),
        )
          ? old.state === "invalid"
            ? "pending"
            : old.state
          : unchanged && old?.versions.length
            ? "generated"
            : "pending",
        versions: clone(old?.versions ?? []),
        jobIds: clone(old?.jobIds ?? []),
        selectedVersionId: old?.selectedVersionId,
        workId: old?.workId,
        updatedAt: this.hooks.now(),
      };
      material.cover.previewUrl = `material-cover://cover/${material.id}?revision=${material.revision}`;
      const manifests = stored.inventory.files
        .filter((f) =>
          [
            "rainfall-materials.json",
            "song-map-001-100.json",
            stored.descriptors[row.id].metadataPath,
          ].includes(f.relative),
        )
        .map((f) => ({
          path: safePath(stored.preview.root, f.relative),
          exists: true,
          valid: true,
          sha256: f.sha256,
        }));
      return { material, manifests };
    });
    return this.hooks.commit(stored.preview, rows);
  }
  previewCoverPath({ previewId, rowId,sha256 }: { previewId: string; rowId: string;sha256?:string }) {
    const stored = this.load(previewId),
      row = stored.preview.rows.find((r) => r.id === rowId);
    if (!row || !row.checks.cover?.valid)
      throw Error("IMPORT_PREVIEW_COVER_UNAVAILABLE");
    if(sha256!==undefined&&sha256!==row.checks.cover.sha256)
      throw Error('IMPORT_PREVIEW_COVER_STALE');
    const file = safePath(stored.preview.root, row.coverPath);
    if (digest(fs.readFileSync(file)) !== row.checks.cover.sha256)
      throw Error("IMPORT_SOURCE_BYTES_CHANGED");
    return file;
  }
}
