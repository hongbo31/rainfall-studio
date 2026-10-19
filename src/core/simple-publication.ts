import { unifiedPublicationService } from "./unified-publication-integration";
import { randomUUID } from "node:crypto";
import { hash, type Row } from "./database";
import type { Studio } from "./studio";
import { publicationPayload } from "./publication-payload";
import {
  assertAccountReference,
  listPlatformConfigurations,
  simpleSettingsPrefix,
  accountSupportsTarget,
} from "./platform-config";
import {
  platformTargets,
  type PublishSelection,
  type PlatformConfiguration,
  type PlatformTarget,
  type SimplePublicationRequest,
  type SimpleMaterialSnapshot,
  type PublicationPendingTerms,
} from "../shared/platform-config";

const selectionKey = simpleSettingsPrefix + "selection:v1",
  requestPrefix = simpleSettingsPrefix + "request:v1:";
export function publishSelection(s: Studio): PublishSelection {
  return (
    s.repo.maybe("settings", selectionKey)?.value ?? {
      workIds: [],
      targets: [],
      accountOverrides: {},
    }
  );
}
function normalizeSelection(
  s: Studio,
  input: PublishSelection,
): PublishSelection {
  const workIds = [...new Set(input.workIds)].sort(),
    targets = [...new Set(input.targets)].sort() as PlatformTarget[];
  for (const id of workIds)
    if (!s.repo.maybe("works", id)) throw Error("WORK_NOT_FOUND");
  const accountOverrides: PublishSelection["accountOverrides"] = {};
  for (const target of platformTargets)
    if (input.accountOverrides[target]) {
      assertAccountReference(s.repo, input.accountOverrides[target]!, target);
      accountOverrides[target] = input.accountOverrides[target];
    }
  return { workIds, targets, accountOverrides };
}
export function savePublishSelection(s: Studio, input: PublishSelection) {
  const value = normalizeSelection(s, input);
  s.save("settings", { id: selectionKey, value });
  return value;
}
function material(
  s: Studio,
  w: Row,
  c: PlatformConfiguration,
  accountId: string | null = c.accountId,
): SimpleMaterialSnapshot {
  const payload = publicationPayload(s, { ...w, assets: w.assets ?? {} }),
    facts = w.publicationMetadata ?? w.metadata ?? {};
  const { version, revision, ...defaults } = c;
  let audio = payload.audio;
  const bound = audio ? s.get("assets", audio.assetId) : null;
  // Prefer a verified WAV only when its recorded ancestry proves it belongs to A.
  if (bound && bound.ext !== "wav") {
    const attached = new Set([
      ...(w.assetHistory ?? []),
      ...(w.audioVersions ?? []).map((v: Row) => v.assetId),
    ]);
    for (const a of s
      .all("assets")
      .filter(
        (a) =>
          attached.has(a.id) &&
          a.kind === "audio" &&
          a.ext === "wav" &&
          (a.parentId === bound.id ||
            a.sourceAudioAssetId === bound.id ||
            a.derivedFromSha256 === bound.sha256),
      )) {
      try {
        s.locate(a.id);
        audio = {
          assetId: a.id,
          sha256: a.sha256,
          mime: a.mime,
          bytes: a.bytes,
          width: undefined,
          height: undefined,
        };
        break;
      } catch {}
    }
  }
  const audioAsset = audio ? s.get("assets", audio.assetId) : null;
  const stream = audioAsset?.metadata?.streams?.find(
    (v: Row) => v.codec_type === "audio",
  );
  const number = (v: unknown) =>
    Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined;
  const artistId = w.artistId ?? c.artistId;
  const artist = artistId ? s.repo.maybe("artists", artistId) : null;
  const account = accountId ? s.repo.maybe("accounts", accountId) : null;
  const nonblank = (value: unknown, fallback: string) =>
    typeof value === "string" && value.trim() ? value : fallback;
  const text = (key: string, fallback: string) =>
    typeof facts[key] === "string" && facts[key].trim()
      ? facts[key]
      : typeof w[key] === "string" && w[key].trim()
        ? w[key]
        : fallback;
  let video: SimpleMaterialSnapshot["video"] = null;
  if (c.target === "douyin" && audio && payload.cover) {
    const derivedKey = `${audio.assetId}:${payload.cover.assetId}:vertical-v1`;
    const matches = s
      .all("assets")
      .filter((a) => a.kind === "video" && a.derivedKey === derivedKey);
    matches.sort(
      (a, b) =>
        Number(b.id === w.assets?.video) - Number(a.id === w.assets?.video),
    );
    for (const asset of matches) {
      try {
        s.locate(asset.id);
        video = {
          assetId: asset.id,
          sha256: asset.sha256,
          mime: asset.mime,
          bytes: asset.bytes,
        };
        break;
      } catch {}
    }
  }
  return {
    schemaVersion: 1,
    workId: w.id,
    workRevision: w.revision,
    title: w.title,
    recordingSlot: w.selectedAudioVariant==="B"?"audio_B":"audio_A",
    audio:
      audio && audioAsset
        ? {
            ...audio,
            boundAssetId: bound!.id,
            label: audioAsset.label ?? "",
            format: audioAsset.ext,
            durationSeconds: number(audioAsset.metadata?.format?.duration),
            codec: stream?.codec_name,
            sampleRate: number(stream?.sample_rate),
          }
        : null,
    cover: payload.cover,
    video,
    lyrics: {
      ...payload.lyrics,
      audioHash: audio?.sha256 ?? null,
      alignmentConfirmed:
        payload.lyrics.alignmentConfirmed &&
        audio?.sha256 === payload.lyrics.audioHash,
    },
    metadata: {
      artistId,
      artistName: artist?.name ?? "",
      lyricist: text("lyricist", c.lyricist),
      composer: text("composer", c.composer),
      album: text("album", c.album),
      language: text("language", nonblank(w.config?.language, c.language)),
      genre: text("genre", nonblank(w.config?.genre, c.genre)),
      aiDisclosure: w.ai ?? "unknown",
      isCover:
        typeof w.isCover === "boolean"
          ? w.isCover
          : typeof facts.isCover === "boolean"
            ? facts.isCover
            : c.isCover,
    },
    defaults,
    rights: w.rights ?? "",
    ai: w.ai ?? "unknown",
    isCover:
      typeof w.isCover === "boolean"
        ? w.isCover
        : typeof facts.isCover === "boolean"
          ? facts.isCover
          : null,
    coverAuthorization:
      w.coverAuthorization ?? facts.coverAuthorization ?? null,
    account: account
      ? {
          accountId: account.id,
          name: account.name ?? "",
          authStatus: account.authStatus ?? "not_connected",
          identityHash: account.remoteSubject
            ? hash({
                provider: account.provider,
                subject: account.remoteSubject,
              })
            : null,
        }
      : null,
    provenance: {
      audioSource: audioAsset?.source ?? "unknown",
      audioLabel: audioAsset?.label ?? "",
      provider: w.provider ?? null,
      model: w.model ?? w.config?.model ?? null,
      providerTaskId: w.providerTaskId ?? null,
      providerSongIds: Array.isArray(w.providerSongIds)
        ? w.providerSongIds
        : [],
      statement: w.rights ?? "",
    },
  };
}
const pendingPattern = /待确认|待核实|待授权|未确认|未授权/;
function materialIssues(
  s: Studio,
  w: Row,
  m: SimpleMaterialSnapshot,
  target: PlatformTarget,
) {
  const issues: string[] = [];
  if (!m.audio) issues.push("缺少音频");
  if (!m.cover) issues.push("缺少封面");
  const instrumental = w.config?.voice === "instrumental";
  if (!instrumental && !m.lyrics.plainText.trim()) issues.push("缺少歌词");
  if (
    !instrumental &&
    m.lyrics.plainText.trim() &&
    !m.lyrics.alignmentConfirmed
  )
    issues.push("歌词匹配待确认");
  if (
    publicationPayload(s, { ...w, assets: w.assets ?? {} }).warnings.includes(
      "LYRICS_BRACKETS_REQUIRE_REVIEW",
    )
  )
    issues.push("歌词标记待确认");
  if (
    !m.rights.trim() ||
    m.rights.startsWith("待") ||
    pendingPattern.test(m.rights)
  )
    issues.push("权益待确认");
  if (m.ai === "unknown") issues.push("AI来源待确认");
  if (
    m.metadata.isCover === true &&
    (!m.coverAuthorization || pendingPattern.test(m.coverAuthorization))
  )
    issues.push("翻唱授权待确认");
  if (target === "douyin" && !m.video) issues.push("缺少视频");
  return issues;
}
/** Native preparation evidence is read directly. Constructing the native service would recover/mutate its journal. */
function pendingTerms(
  s: Studio,
  w: Row,
  target: PlatformTarget,
  accountId: string | null,
  m: SimpleMaterialSnapshot,
) {
  if (!accountId || !m.audio || !["qqmusic", "kugou"].includes(target))
    return null;
  const account = s.repo.maybe("accounts", accountId);
  if (!account || !accountSupportsTarget(account, target)) return null;
  const settings = s.all("settings");
  for (const row of settings.filter((r) =>
    r.id.startsWith("tme-ai-prepare:job:"),
  )) {
    const job = row.value;
    if (
      job?.state !== "awaiting_terms_review" ||
      job.workId !== w.id ||
      job.submissionByClient === true
    )
      continue;
    const grant = s.repo.maybe(
        "settings",
        "tme-ai-prepare:grant:" + job.grantId,
      )?.value,
      g = grant?.input;
    if (
      !g ||
      grant.suspended ||
      g.workId !== w.id ||
      g.sourceAudio?.variant !== (w.selectedAudioVariant === "B" ? "B" : "A") ||
      g.sourceAudio.assetId !== m.audio.assetId ||
      g.sourceAudio.sha256 !== m.audio.sha256
    )
      continue;
    // Local names or user-reported page observations cannot establish official account identity.
    const identity =
      account.remoteSubject &&
      g.identity?.subjectHash === account.remoteSubject;
    if (!identity) continue;
    if (
      !job.terms?.termsText ||
      job.terms.termsHash !== hash(job.terms.termsText)
    )
      continue;
    return {
      jobId: job.id,
      termsText: job.terms.termsText,
      termsHash: job.terms.termsHash,
      accepted: false as const,
    };
  }
  return null;
}
export function checkSimplePublication(
  s: Studio,
  w: Row,
  target: PlatformTarget,
  c: PlatformConfiguration,
  accountId: string | null,
): SimplePublicationRequest {
  const m = material(s, w, c, accountId),
    issues: string[] = [],
    now = s.now().toISOString();
  if (!accountId) issues.push("缺少账号");
  else assertAccountReference(s.repo, accountId, target);
  if (!m.metadata.artistId || !s.repo.maybe("artists", m.metadata.artistId))
    issues.push("缺少艺人");
  const missingConfiguration = issues.length > 0,
    materials = materialIssues(s, w, m, target),
    terms = pendingTerms(s, w, target, accountId, m);
  issues.push(...materials);
  if (terms) {
    m.terms = terms;
    issues.push(termsSummary(terms.termsText), terms.termsText);
  }
  const state = terms
    ? "awaiting_terms_review"
    : missingConfiguration
      ? "needs_configuration"
      : materials.length
        ? "needs_materials"
        : s.mode === "simulation"
          ? "ready"
          : "unavailable";
  const summary = terms
    ? "待条款确认"
    : missingConfiguration
      ? "缺少配置"
      : (materials[0] ?? (s.mode === "simulation" ? "模拟检查就绪" : "未接通"));
  return {
    id: randomUUID(),
    workId: w.id,
    title: w.title,
    target,
    accountId,
    state,
    summary,
    issues: [...new Set(issues)],
    createdAt: now,
    updatedAt: now,
    source: s.mode === "simulation" ? "simulation" : "local",
    formalSubmission: false,
    configurationTarget: target,
    materialSnapshot: m,
    submission: {
      available: false,
      reason:
        s.mode === "simulation"
          ? "本地模拟 · 未上传"
          : `${target === "qqmusic" ? "QQ音乐" : target === "netease" ? "网易云音乐" : target === "qishui" ? "汽水音乐" : target === "kugou" ? "酷狗音乐" : "抖音视频"}上传未接通`,
    },
  };
}
function termsSummary(_text: string) {
  return "请查看条款";
}
function storedRequests(s: Studio): SimplePublicationRequest[] {
  return s
    .all("settings")
    .filter((r) => r.id.startsWith(requestPrefix))
    .map((r) => r.value);
}
/** Official page preparation may be proven even when no OAuth/local account mapping exists. */
export function listPublicationPendingTerms(
  s: Studio,
): PublicationPendingTerms[] {
  const result: PublicationPendingTerms[] = [];
  for (const row of s
    .all("settings")
    .filter((r) => r.id.startsWith("tme-ai-prepare:job:"))) {
    const job = row.value,
      w = job?.workId ? s.repo.maybe("works", job.workId) : null;
    if (
      !w ||
      job.state !== "awaiting_terms_review" ||
      job.submissionByClient === true ||
      !job.terms?.termsText ||
      job.terms.termsHash !== hash(job.terms.termsText)
    )
      continue;
    const variant = w.selectedAudioVariant === "B" ? "B" : "A",
      slot = variant === "B" ? "audio_B" : "audio_A";
    const grant = s.repo.maybe(
        "settings",
        "tme-ai-prepare:grant:" + job.grantId,
      )?.value,
      g = grant?.input;
    if (
      !g ||
      grant.suspended ||
      g.workId !== w.id ||
      g.sourceAudio?.variant !== variant ||
      g.sourceAudio.assetId !== w.assets?.[slot]
    )
      continue;
    const audio = s.repo.maybe("assets", w.assets[slot]);
    if (
      !audio ||
      audio.kind !== "audio" ||
      audio.sha256 !== g.sourceAudio.sha256
    )
      continue;
    try {
      s.locate(audio.id);
    } catch {
      continue;
    }
    result.push({
      id: job.id,
      workId: w.id,
      title: w.title,
      summary: "待条款确认",
      termsText: job.terms.termsText,
      termsHash: job.terms.termsHash,
      createdAt: job.createdAt ?? w.createdAt,
      platformLabel: "腾讯音乐",
    });
  }
  return result;
}
/** Project provable prior terms read-only so they remain visible before the first click. */
export function listSimplePublicationRequests(
  s: Studio,
): SimplePublicationRequest[] {
  // Cache only for this synchronous listing. Every later snapshot and explicit
  // preparation verifies bytes again, including same-size in-place corruption.
  const source = s;
  s = Object.create(source) as Studio;
  const verified = new Map<
    string,
    { value?: ReturnType<Studio["locate"]>; error?: unknown }
  >();
  s.locate = (id: string) => {
    if (!verified.has(id)) {
      try {
        verified.set(id, { value: source.locate(id) });
      } catch (error) {
        verified.set(id, { error });
      }
    }
    const result = verified.get(id)!;
    if ("error" in result) throw result.error;
    return result.value!;
  };
  const current = new Map<string, SimplePublicationRequest>();
  const currentCheck = (
    w: Row,
    c: PlatformConfiguration,
    accountId: string | null,
  ) => {
    const key = JSON.stringify([w.id, c.target, accountId]);
    if (!current.has(key))
      current.set(key, checkSimplePublication(s, w, c.target, c, accountId));
    return current.get(key)!;
  };
  const configs = listPlatformConfigurations(s.repo);
  const result: SimplePublicationRequest[] = storedRequests(s).map((r) => {
    const w = s.repo.maybe("works", r.workId),
      c = configs.find((c) => c.target === r.target);
    if (!w || !c) return { ...r, stale: true };
    try {
      const fresh = currentCheck(w, c, r.accountId);
      return {
        ...r,
        stale:
          contentHash(r.materialSnapshot) !==
            contentHash(fresh.materialSnapshot) ||
          r.state !== fresh.state ||
          hash(r.issues) !== hash(fresh.issues),
      };
    } catch {
      return { ...r, stale: true };
    }
  });
  const pendingWorkIds = new Set(
    s
      .all("settings")
      .filter(
        (r) =>
          r.id.startsWith("tme-ai-prepare:job:") &&
          r.value?.state === "awaiting_terms_review",
      )
      .map((r) => r.value.workId),
  );
  for (const w of s.all("works").filter((w) => pendingWorkIds.has(w.id)))
    for (const c of configs.filter((c) =>
      ["qqmusic", "kugou"].includes(c.target),
    )) {
      const m = material(s, w, c),
        terms = pendingTerms(s, w, c.target, c.accountId, m);
      if (!terms) continue;
      if (
        result.some(
          (r) =>
            r.target === c.target &&
            r.accountId === c.accountId &&
            r.materialSnapshot.terms?.jobId === terms.jobId,
        )
      )
        continue;
      const req = { ...currentCheck(w, c, c.accountId) };
      req.id = `tme:${terms.jobId}:${c.target}:${c.accountId}`;
      const job = s.repo.maybe(
        "settings",
        "tme-ai-prepare:job:" + terms.jobId,
      )?.value;
      req.createdAt = job?.createdAt ?? w.createdAt;
      req.updatedAt = job?.updatedAt ?? req.createdAt;
      result.push(req);
    }
  return result;
}
export function publishSimple(s: Studio, input: PublishSelection) {
  if (!input.workIds.length || !input.targets.length)
    throw Error("EMPTY_SELECTION");
  const selection = normalizeSelection(s, input),
    configs = listPlatformConfigurations(s.repo),
    prepared: { fingerprint: string; request: SimplePublicationRequest }[] = [];
  // Validate and freeze every work/target before any write; normalized scope makes order/dedup irrelevant.
  for (const workId of selection.workIds)
    for (const target of selection.targets) {
      const c = configs.find((c) => c.target === target)!,
        accountId = selection.accountOverrides[target] ?? c.accountId;
      // Return the same JSON shape that SQLite/IPC preserve across a restart.
      const request: SimplePublicationRequest = JSON.parse(
        JSON.stringify(checkSimplePublication(s, s.get("works", workId), target, c, accountId)),
      );
      const {
        version: configVersion,
        revision: configRevision,
        ...defaults
      } = c;
      const fingerprint = hash({
        version: 1,
        mode: s.mode,
        workId,
        target,
        accountId,
        materialSnapshot: (() => {
          const { workRevision, ...content } = request.materialSnapshot;
          return content;
        })(),
        configuration: defaults,
      });
      prepared.push({ fingerprint, request });
    }
  return s.repo.transaction(() => {
    let reused = true;
    const requests = prepared.map(({ fingerprint, request }) => {
      const id = requestPrefix + fingerprint,
        old = s.repo.maybe("settings", id);
      if (old) {
        const prior = old.value as SimplePublicationRequest;
        if (
          prior.state === request.state &&
          prior.summary === request.summary &&
          hash(prior.issues) === hash(request.issues) &&
          hash(prior.submission ?? null) === hash(request.submission ?? null)
        )
          return prior;
        const refreshed = {
          ...prior,
          state: request.state,
          summary: request.summary,
          issues: request.issues,
          submission: request.submission,
          updatedAt: request.updatedAt,
        };
        s.save("settings", { ...old, value: refreshed });
        return refreshed;
      }
      reused = false;
      s.save("settings", { id, version: 1, fingerprint, value: request });
      return request;
    });
    return {
      requests,
      pipeline: s.mode === "production" ? unifiedPublicationService(s).enqueue(requests) : [],
      reused,
      rechecked: true,
      checkedAt: s.now().toISOString(),
    };
  });
}
function contentHash(m: SimpleMaterialSnapshot) {
  const { workRevision, ...content } = m;
  return hash(content);
}
