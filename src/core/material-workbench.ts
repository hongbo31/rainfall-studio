import {
  readFileSync,
  existsSync,
  realpathSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { MaterialImportService,materialImportRoot } from "./material-import";
import type {
  MaterialImportPreviewInput,
  MaterialImportUpdateInput,
  MaterialImportConfirmInput,
} from "../shared/material-import";
import type {
  MaterialEntry,
  MaterialSource,
  MaterialQueueJob,
  MaterialWorkbenchSnapshot,
  MaterialEnqueueInput,
  MaterialAudioVersion,
  MaterialFileCheck,
} from "../shared/material-workbench";
export interface MaterialWorkbenchRepository {
  getSetting(key: string): unknown;
  setSetting(key: string, value: unknown): unknown;
}
export interface MaterialWorkbenchOptions {
  fixture?: boolean;
  fixtureFeeBoundCredits?: number;
  verifyAsset?: (version: MaterialAudioVersion) => boolean;
  now?: () => string;
}
type State = {
  sources: MaterialSource[];
  materials: MaterialEntry[];
  jobs: MaterialQueueJob[];
  paused: boolean;
  limit: number;
  contexts: Record<string, MaterialEntry>;
  manifests?: Record<string, MaterialFileCheck[]>;
};
type Row = {
  id: string;
  title: string;
  lyrics_file: string;
  style_file: string;
  cover_file: string;
  style_section?: string;
  metadata_file?: string;
};
const KEY = "material-workbench.v1";
const hash = (v: Buffer | string) =>
  createHash("sha256").update(v).digest("hex");
const copy = <T>(v: T): T => structuredClone(v);
const active = new Set([
  "dispatching",
  "accepted",
  "polling",
  "downloading",
  "unknown",
]);
export class MaterialWorkbenchService {
  private state: State;
  private now: () => string;
  private importer?: MaterialImportService;
  constructor(
    private repo: MaterialWorkbenchRepository,
    private options: MaterialWorkbenchOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.state = copy(
      (repo.getSetting(KEY) as State) ?? {
        sources: [],
        materials: [],
        jobs: [],
        paused: true,
        limit: 0,
        contexts: {},
      },
    );
    let recovered = false;
    for (const j of this.state.jobs)
      if (j.state === "dispatching") {
        recovered = true;
        j.state = "unknown";
        j.reason =
          "Submission interrupted; reconcile original provider request before continuing";
        this.material(j.materialId).state = "unknown";
      }
    this.state.manifests ??= {};
    if (recovered) this.save();
  }
  private save() {
    this.repo.setSetting(KEY, copy(this.state));
  }
  private importService() {
    return (this.importer ??= new MaterialImportService(this.repo, {
      snapshot: () => this.list(),
      now: this.now,
      commit: (preview, rows) => {
        const next = copy(this.state),
          source = next.sources.find((s) => s.id === preview.sourceId)!;
        if (source.revision !== preview.baseSourceRevision)
          throw Error("IMPORT_PREVIEW_STALE_SOURCE");
        if (
          preview.rebind &&
          next.jobs.some(
            (j) =>
              j.state !== "completed" &&
              j.state !== "blocked" &&
              next.materials.some(
                (m) => m.id === j.materialId && m.sourceId === source.id,
              ),
          )
        )
          throw Error("IMPORT_REBIND_ACTIVE_JOBS");
        for (const { material, manifests } of rows) {
          const old = next.materials.find((m) => m.id === material.id);
          if (old) Object.assign(old, copy(material));
          else next.materials.push(copy(material));
          next.manifests![material.id] = copy(manifests);
        }
        if (preview.rebind) {
          for (const m of next.materials.filter(
            (m) =>
              m.sourceId === source.id &&
              !rows.some((r) => r.material.id === m.id),
          )) {
            m.state = "invalid";
            m.validationReasons = ["IMPORT_REBIND_ROW_CONFIRMATION_REQUIRED"];
          }
          source.root = preview.root;
        }
        source.revision++;
        source.lastScanAt = this.now();
        delete source.error;
        this.repo.setSetting(KEY, copy(next));
        this.state = next;
        return this.list();
      },
    }));
  }
  previewScan(input: MaterialImportPreviewInput) {
    return this.importService().previewScan(input);
  }
  updatePreview(input: MaterialImportUpdateInput) {
    return this.importService().updatePreview(input);
  }
  confirmImport(input: MaterialImportConfirmInput) {
    return this.importService().confirmImport(input);
  }
  previewCoverPath(input: { previewId: string; rowId: string;sha256?:string }) {
    return this.importService().previewCoverPath(input);
  }
  private material(id: string) {
    const m = this.state.materials.find((x) => x.id === id);
    if (!m) throw Error("Material not found");
    return m;
  }
  private job(id: string) {
    const j = this.state.jobs.find((x) => x.id === id);
    if (!j) throw Error("Queue job not found");
    return j;
  }
  private bound() {
    const b = this.options.fixtureFeeBoundCredits;
    return this.options.fixture === true &&
      typeof b === "number" &&
      Number.isFinite(b) &&
      b > 0
      ? b
      : undefined;
  }
  list(): MaterialWorkbenchSnapshot {
    const bound = this.bound();
    return copy({
      sources: this.state.sources,
      materials: this.state.materials,
      jobs: this.state.jobs,
      paused: this.state.paused,
      budget: {
        limit: this.state.limit,
        reserved: this.state.jobs.reduce((n, j) => n + j.reservedCredits, 0),
        spent: this.state.jobs.reduce((n, j) => n + (j.actualCredits ?? 0), 0),
        unknown: this.state.jobs.some(
          (j) =>
            j.state === "unknown" ||
            (j.state === "completed" &&
              j.actualCredits === null &&
              j.reservedCredits > 0),
        ),
      },
      generationCapability: {
        available: bound !== undefined,
        reason:
          bound === undefined
            ? "Production generation unavailable: supplier-enforced fee upper bound has not been established"
            : "Fixture-only bounded generation",
      },
    });
  }
  configure({ root }: { root: string }) {
    const real = materialImportRoot(root);
    if (!statSync(real).isDirectory())
      throw Error("Source must be a directory");
    let s = this.state.sources.find(
      (x) => x.root.toLowerCase() === real.toLowerCase(),
    );
    if (!s) {
      s = { id: randomUUID(), root: real, revision: 0 };
      this.state.sources.push(s);
    }
    this.save();
    return this.list();
  }
  private safe(root: string, relative: string) {
    if (!relative || path.isAbsolute(relative))
      throw Error("Source path must be relative");
    const p = path.resolve(root, relative);
    const rel = path.relative(root, p);
    if (rel.startsWith("..") || path.isAbsolute(rel))
      throw Error("Source path escapes collection");
    if (existsSync(p)) {
      const real = realpathSync(p);
      const rr = path.relative(root, real);
      if (rr.startsWith("..") || path.isAbsolute(rr))
        throw Error("Source symlink escapes collection");
      return real;
    }
    return p;
  }
  private files(root: string): string[] {
    const out: string[] = [];
    for (const d of readdirSync(root, { withFileTypes: true })) {
      if (d.isSymbolicLink()) continue;
      const p = path.join(root, d.name);
      if (d.isDirectory()) {
        if (d.name !== "original-archives") out.push(...this.files(p));
      } else out.push(p);
    }
    return out;
  }
  async scan({
    sourceId,
  }: {
    sourceId: string;
  }): Promise<MaterialWorkbenchSnapshot> {
    const source = this.state.sources.find((s) => s.id === sourceId);
    if (!source) throw Error("Source not found");
    let rows: Row[];
    try {
      rows = JSON.parse(
        readFileSync(this.safe(source.root, "song-map-001-100.json"), "utf8"),
      );
      if (!Array.isArray(rows)) throw Error("Material index must be an array");
    } catch (e) {
      source.error = String(e);
      for (const m of this.state.materials.filter(
        (m) => m.sourceId === source.id,
      )) {
        m.state = "invalid";
        m.validationReasons = ["Material index unavailable or invalid"];
      }
      this.save();
      return this.list();
    }
    const files = this.files(source.root);
    const seen = new Set<string>();
    const coverKeys = new Map<Row, string>();
    const coverKey = (row: Row) => {
      const cached = coverKeys.get(row);
      if (cached !== undefined) return cached;
      let key: string;
      try {
        key = this.safe(source.root, row.cover_file).toLowerCase();
      } catch {
        key = row.cover_file;
      }
      coverKeys.set(row, key);
      return key;
    };
    const sharedCovers = new Set(
      rows
        .filter((r, i) =>
          rows.some((other, k) => i !== k && coverKey(r) === coverKey(other)),
        )
        .map(coverKey),
    );
    for (const row of rows) {
      const sourceKey = String(row.id);
      seen.add(sourceKey);
      const previous = this.state.materials.find(
        (m) => m.sourceId === source.id && m.sourceKey === sourceKey,
      );
      const reasons: string[] = [];
      if (rows.filter((r) => String(r.id) === sourceKey).length !== 1)
        reasons.push("Ambiguous duplicate material index ID");
      if (sharedCovers.has(coverKey(row)))
        reasons.push("Cover is assigned to multiple materials");
      const checks = {} as MaterialEntry["checks"];
      let lyrics = "",
        style = "",
        styleNotes = "";
      let metadataHash: string | undefined;
      let width = 0,
        height = 0;
      for (const role of ["lyrics", "style", "cover"] as const) {
        const relative = row[`${role}_file`];
        let p = "";
        try {
          p = this.safe(source.root, relative);
          if (!existsSync(p) && previous) {
            const old = previous.checks[role].sha256;
            if (old) {
              const matches = files.filter((f) => {
                try {
                  return hash(readFileSync(f)) === old;
                } catch {
                  return false;
                }
              });
              if (matches.length === 1) p = matches[0];
              else if (matches.length > 1)
                reasons.push(`${role}: ambiguous renamed source`);
            }
          }
          if (!existsSync(p)) throw Error("Missing source file");
          const bytes = readFileSync(p);
          checks[role] = {
            path: p,
            exists: true,
            valid: true,
            sha256: hash(bytes),
          };
          if (role === "lyrics") {
            lyrics = bytes.toString("utf8").trim();
            if (lyrics.startsWith(row.title + "\n"))
              lyrics = lyrics.slice(row.title.length).trim();
            if (!lyrics) throw Error("Empty lyrics");
          }
          if (role === "style") {
            styleNotes = bytes.toString("utf8");
            if (row.style_section) {
              const lines = styleNotes.split(/\r?\n/);
              const starts = lines
                .map((line, i) =>
                  line.trim() === row.style_section?.trim() ? i : -1,
                )
                .filter((i) => i >= 0);
              if (starts.length !== 1)
                throw Error(
                  "Missing or ambiguous exact numbered title Style section",
                );
              const start = starts[0];
              let end = lines.findIndex(
                (line, i) => i > start && /^\d{2}[｜|]/u.test(line),
              );
              if (end < 0) end = lines.length;
              styleNotes = lines.slice(start, end).join("\n");
              const styles = styleNotes
                .split(/\r?\n/)
                .filter((l) => /^Style[：:]/.test(l));
              if (styles.length !== 1)
                throw Error("Missing or ambiguous Style text");
              style = styles[0].replace(/^Style[：:]\s*/, "").trim();
            } else style = styleNotes.trim();
            if (!style) throw Error("Empty Style");
          }
          if (role === "cover") {
            const decoded = await sharp(bytes, { failOn: "warning" })
              .raw()
              .toBuffer({ resolveWithObject: true });
            width = decoded.info.width;
            height = decoded.info.height;
            if (!width || !height) throw Error("Undecodable cover");
          }
        } catch (e) {
          checks[role] = {
            path: p,
            exists: !!p && existsSync(p),
            valid: false,
            reason: String(e),
          };
          reasons.push(`${role}: ${String(e)}`);
        }
      }
      if (row.metadata_file) {
        try {
          const metadataBytes = readFileSync(
            this.safe(source.root, row.metadata_file),
          );
          metadataHash = hash(metadataBytes);
          const metadata = JSON.parse(metadataBytes.toString("utf8"));
          if (String(metadata.id) !== sourceKey || metadata.title !== row.title)
            throw Error("Metadata identity differs from index");
          for (const role of ["lyrics", "style", "cover"] as const) {
            const relative = metadata[`${role}_file`];
            if (
              typeof relative !== "string" ||
              !(
                row[`${role}_file`] === relative ||
                row[`${role}_file`].endsWith("/" + relative)
              )
            )
              throw Error(`Metadata ${role} path differs from index`);
          }
          if (
            metadata.cover_sha256 &&
            metadata.cover_sha256 !== checks.cover.sha256
          )
            throw Error("Metadata cover hash differs from file");
          if (
            typeof metadata.style_en !== "string" ||
            !style.includes(metadata.style_en.trim())
          )
            throw Error("Metadata English Style differs from file");
          const header =
            "歌曲编号：" + sourceKey + "\n歌曲名称：" + row.title + "\n";
          if (lyrics.startsWith(header))
            lyrics = lyrics.slice(header.length).trim();
          if (
            typeof metadata.lyrics !== "string" ||
            metadata.lyrics.trim() !== lyrics
          )
            throw Error("Metadata lyrics differ from file");
          style = metadata.style_en.trim();
        } catch (e) {
          reasons.push("metadata: " + String(e));
        }
      }
      const contentHash = hash(
        JSON.stringify({
          metadataHash,
          title: row.title,
          lyrics: checks.lyrics.sha256,
          style: checks.style.sha256,
          section: row.style_section,
          cover: checks.cover.sha256,
        }),
      );
      const changed = !!previous && previous.contentHash !== contentHash;
      const revision = previous ? previous.revision + (changed ? 1 : 0) : 1;
      if (changed)
        reasons.push("Source bytes changed; review required before generation");
      if (
        previous?.validationReasons.includes(
          "Source bytes changed; review required before generation",
        )
      )
        reasons.push("Source bytes changed; review required before generation");
      const material: MaterialEntry = {
        id: previous?.id ?? randomUUID(),
        sourceId,
        sourceKey,
        number: sourceKey,
        title: row.title,
        revision,
        contentHash,
        lyrics,
        style,
        styleNotes,
        checks,
        cover: { width, height, previewUrl: "" },
        validationReasons: [...new Set(reasons)],
        state: reasons.length ? "invalid" : (previous?.state ?? "pending"),
        versions: previous?.versions ?? [],
        jobIds: previous?.jobIds ?? [],
        selectedVersionId: previous?.selectedVersionId,
        workId: previous?.workId,
        updatedAt: this.now(),
      };
      material.cover.previewUrl = `material-cover://cover/${material.id}?revision=${revision}`;
      if (previous) Object.assign(previous, material);
      else this.state.materials.push(material);
      this.state.manifests![material.id] = [
        "song-map-001-100.json",
        ...(row.metadata_file ? [row.metadata_file] : []),
      ].map((relative) => {
        let p: string;
        try {
          p = this.safe(source.root, relative);
        } catch {
          return { path: "", exists: false, valid: false };
        }
        return {
          path: p,
          exists: existsSync(p),
          valid: existsSync(p),
          sha256: existsSync(p) ? hash(readFileSync(p)) : undefined,
        };
      });
    }
    for (const m of this.state.materials.filter(
      (m) => m.sourceId === sourceId && !seen.has(m.sourceKey),
    )) {
      m.state = "missing";
      m.validationReasons = ["Material removed from index"];
    }
    source.revision++;
    source.lastScanAt = this.now();
    delete source.error;
    this.save();
    return this.list();
  }
  coverPath({
    materialId,
    revision,
  }: {
    materialId: string;
    revision: number;
  }) {
    const m = this.material(materialId);
    if (m.revision !== revision || !m.checks.cover.valid)
      throw Error("Cover revision unavailable");
    const p = m.checks.cover.path;
    const source = this.state.sources.find((s) => s.id === m.sourceId)!;
    this.safe(source.root, path.relative(source.root, p));
    if (hash(readFileSync(p)) !== m.checks.cover.sha256)
      throw Error("Cover bytes changed");
    return p;
  }
  private verifySources(m: MaterialEntry) {
    if (m.validationReasons.length) throw Error(m.validationReasons.join("; "));
    for (const c of [
      ...Object.values(m.checks),
      ...(this.state.manifests?.[m.id] ?? []),
    ]) {
      const source = this.state.sources.find((s) => s.id === m.sourceId)!;
      this.safe(source.root, path.relative(source.root, c.path));
      if (
        !c.valid ||
        !existsSync(c.path) ||
        hash(readFileSync(c.path)) !== c.sha256
      )
        throw Error("Material source changed or missing; scan required");
    }
  }
  enqueue(input: MaterialEnqueueInput) {
    if (
      input.consent !== true ||
      !input.requestId.trim() ||
      !Number.isFinite(input.budgetCredits) ||
      input.budgetCredits <= 0
    )
      throw Error("Explicit consent and valid budget required");
    const duplicates = this.state.jobs.filter(
      (j) => j.requestId === input.requestId,
    );
    if (duplicates.length) return this.list();
    const materials = [...new Set(input.materialIds)]
      .map((id) => this.material(id))
      .sort(
        (a, b) =>
          Number(a.number) - Number(b.number) ||
          a.number.localeCompare(b.number),
      );
    if (!materials.length) throw Error("Select materials");
    for (const m of materials) {
      if (m.revision !== input.expectedRevisions[m.id])
        throw Error("Material revision changed");
      this.verifySources(m);
      if (
        this.state.jobs.some(
          (j) =>
            j.materialId === m.id &&
            (active.has(j.state) || j.state === "queued"),
        )
      )
        throw Error("Material already queued");
      if (m.versions.length && !input.regenerate)
        throw Error("Explicit regeneration required");
    }
    this.state.limit = input.budgetCredits;
    for (const m of materials) {
      const t = this.now();
      const j: MaterialQueueJob = {
        id: randomUUID(),
        materialId: m.id,
        materialRevision: m.revision,
        requestId: input.requestId,
        state: "queued",
        phase: "submit",
        profileId: input.profileId,
        profileRevision: input.profileRevision,
        modelId: input.modelId,
        artistId: input.artistId,
        budgetCredits: input.budgetCredits,
        reservedCredits: 0,
        actualCredits: null,
        providerSongIds: [],
        createdAt: t,
        updatedAt: t,
      };
      this.state.jobs.push(j);
      this.state.contexts[j.id] = copy(m);
      m.jobIds.push(j.id);
      m.state = "queued";
    }
    this.state.paused = false;
    this.save();
    return this.list();
  }
  pause() {
    this.state.paused = true;
    this.save();
    return this.list();
  }
  resume() {
    this.state.paused = false;
    this.save();
    return this.list();
  }
  claimNext() {
    if (
      this.state.paused ||
      this.state.jobs.some(
        (j) =>
          active.has(j.state) ||
          (j.state === "failed" && j.providerSongIds.length > 0),
      )
    )
      return undefined;
    const bound = this.bound();
    if (bound === undefined) {
      for (const waiting of this.state.jobs.filter(
        (j) => j.state === "queued",
      )) {
        waiting.state = "blocked";
        waiting.reason =
          "Production generation unavailable: supplier-enforced fee upper bound has not been established";
        this.material(waiting.materialId).state = "blocked";
      }
      this.save();
      return undefined;
    }
    if (
      this.state.jobs.some(
        (j) =>
          j.state === "completed" &&
          j.actualCredits === null &&
          j.reservedCredits > 0,
      )
    )
      return undefined;
    const j = this.state.jobs
      .filter((j) => j.state === "queued")
      .sort(
        (a, b) =>
          Number(this.material(a.materialId).number) -
            Number(this.material(b.materialId).number) ||
          a.createdAt.localeCompare(b.createdAt),
      )[0];
    if (!j) return undefined;
    const m = this.material(j.materialId);
    try {
      if (m.revision !== j.materialRevision)
        throw Error("Material revision changed");
      this.verifySources(m);
    } catch (e) {
      j.state = "blocked";
      j.reason = String(e);
      m.state = "invalid";
      this.save();
      return undefined;
    }
    const used = this.state.jobs.reduce(
      (n, x) => n + x.reservedCredits + (x.actualCredits ?? 0),
      0,
    );
    if (used + bound > j.budgetCredits) {
      j.state = "blocked";
      j.reason = "Local fixture budget exhausted";
      m.state = "blocked";
      this.save();
      return undefined;
    }
    j.state = "dispatching";
    j.reservedCredits = bound;
    j.updatedAt = this.now();
    m.state = "generating";
    this.save();
    return copy(j);
  }
  getJobContext({ jobId }: { jobId: string }) {
    return copy({ job: this.job(jobId), material: this.state.contexts[jobId] });
  }
  recordSubmitted({
    jobId,
    providerSongIds,
    trackingId,
  }: {
    jobId: string;
    providerSongIds: string[];
    trackingId?: string;
  }) {
    const j = this.job(jobId);
    if (j.state !== "dispatching" && j.state !== "unknown")
      throw Error("Job is not awaiting submission result");
    if (
      !providerSongIds.length ||
      providerSongIds.some((id) => !id.trim()) ||
      new Set(providerSongIds).size !== providerSongIds.length
    )
      throw Error("Original provider IDs required");
    j.providerSongIds = [...providerSongIds];
    j.trackingId = trackingId;
    j.state = "accepted";
    j.phase = "assets";
    j.updatedAt = this.now();
    this.save();
    return copy(j);
  }
  recordProgress({
    jobId,
    state,
  }: {
    jobId: string;
    state: "polling" | "downloading";
  }) {
    const j = this.job(jobId);
    if (!j.providerSongIds.length || j.state === "completed")
      throw Error("Original provider task required");
    j.state = state;
    j.phase = "assets";
    j.updatedAt = this.now();
    this.save();
    return copy(j);
  }
  recordAssets({
    jobId,
    workId,
    versions,
    actualCredits,
  }: {
    jobId: string;
    workId: string;
    versions: MaterialAudioVersion[];
    actualCredits?: number;
  }) {
    const j = this.job(jobId);
    if (
      !["accepted", "polling", "downloading", "failed"].includes(j.state) ||
      !j.providerSongIds.length
    )
      throw Error("Original accepted task required");
    if (
      versions.length !== 2 ||
      !versions.some((v) => v.version === "A") ||
      !versions.some((v) => v.version === "B") ||
      versions.length !== j.providerSongIds.length ||
      versions.some(
        (v) =>
          v.jobId !== j.id ||
          v.workId !== workId ||
          !j.providerSongIds.includes(v.providerSongId) ||
          !this.options.verifyAsset?.(v),
      ) ||
      new Set(versions.map((v) => v.providerSongId)).size !== versions.length ||
      new Set(versions.map((v) => v.version)).size !== versions.length
    )
      throw Error(
        "All original task audio must be verified and bound to one work",
      );
    if (
      actualCredits !== undefined &&
      (!Number.isFinite(actualCredits) ||
        actualCredits < 0 ||
        actualCredits > j.reservedCredits)
    )
      throw Error("Invalid fixture charge");
    const m = this.material(j.materialId);
    m.versions.push(...copy(versions));
    m.workId = workId;
    m.selectedVersionId = versions[0].id;
    if (m.revision === j.materialRevision && !m.validationReasons.length)
      m.state = "generated";
    j.state = "completed";
    j.workId = workId;
    j.actualCredits = actualCredits ?? null;
    if (actualCredits !== undefined) j.reservedCredits = 0;
    j.updatedAt = this.now();
    this.save();
    return this.list();
  }
  recordFailure({
    jobId,
    reason,
    unknown = false,
  }: {
    jobId: string;
    reason: string;
    unknown?: boolean;
  }) {
    const j = this.job(jobId);
    if (j.state === "completed") throw Error("Completed job cannot fail");
    if (j.state === "dispatching" && !j.providerSongIds.length) unknown = true;
    j.state = unknown ? "unknown" : "failed";
    j.reason = reason;
    this.material(j.materialId).state = unknown ? "unknown" : "failed";
    this.save();
    return copy(j);
  }
  retry({ jobId }: { jobId: string }) {
    const j = this.job(jobId);
    if (j.state === "unknown" || j.state === "dispatching")
      throw Error("Unknown submission cannot be retried");
    if (!j.providerSongIds.length)
      throw Error("No original provider IDs; explicit new generation required");
    if (j.state === "completed") throw Error("Already completed");
    j.state = "polling";
    j.phase = "assets";
    this.material(j.materialId).state = "generating";
    this.save();
    return copy(j);
  }
  reconcile({ jobId }: { jobId: string }) {
    const j = this.job(jobId);
    if (!j.providerSongIds.length)
      throw Error(
        "Original provider IDs unavailable; manual reconciliation required",
      );
    return copy(j);
  }
  selectVersion({
    materialId,
    versionId,
  }: {
    materialId: string;
    versionId: string;
  }) {
    const m = this.material(materialId);
    const version = m.versions.find((v) => v.id === versionId);
    if (!version) throw Error("Version is not bound to material");
    m.selectedVersionId = versionId;
    m.workId = version.workId;
    this.save();
    return this.list();
  }
}
