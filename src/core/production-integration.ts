import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Studio } from "./studio";
import { ProductionFlowService } from "./production-flow";
import type { FlowAsset } from "../shared/production-flow";
import { publicationPayload } from "./publication-payload";

export function createProductionFlowService(s: Studio) {
  return new ProductionFlowService(s.repo, {
    now: s.now,
    // No verified current per-request upper price exists. User text cannot replace a quote.
    verifyMusicPricing: () => false,
    // No provider/account-bound quote source is installed. The separate explicit
    // existing-credit policy is validated by Core; arbitrary quote IDs stay blocked.
    verifyManagedMusicQuote: () => false,
    // Native TME writes require a verified unique identity, AI page contract and scoped terms.
    publicationAuthority: () => ({
      allowed: false,
      reason: "ACCOUNT_UNIQUE_ID_REQUIRED",
    }),
    publicationMaterials: ({ work }) => {
      const payload = publicationPayload(s, work),
        reasons = [...payload.warnings];
      const confirmed = s
        .tmeDraftService()
        .list()
        .some((d) => {
          if (
            d.source !== "local" ||
            d.workId !== work.id ||
            d.workRevision !== work.revision ||
            d.assets.audio?.sha256 !== payload.audio?.sha256
          )
            return false;
          try {
            s.tmeDraftService().assertCurrent(d);
          } catch {
            return false;
          }
          return d.issues.length === 0;
        });
      if (!confirmed) reasons.push("RIGHTS_CONFIRMATION");
      return { ready: reasons.length === 0, reasons };
    },
    createWork: (run, candidate) => {
      const prior = s
        .all("works")
        .find((w) => w.productionFlowRunId === run.id);
      if (prior) return { workId: prior.id };
      const d = candidate.draft;
      const parent=run.managedProviderText?.parentRunId?s.repo.maybe('settings','plan-center:run:'+run.managedProviderText.parentRunId)?.value?.snapshot:undefined;
      const work = s.saveWork(
        {
          artistId: run.artistId,
          title: d.title,
          story: d.storyBeat,
          lyrics: candidate.pair.lyrics,
          prompt: candidate.pair.musicPrompt,
          parameters: {
            ...(parent?.artistSnapshot?.defaults??{}),
            genre: d.style,
            language: d.language,
            duration: d.musicPrompts.yourmusic.durationTarget,
            voice: d.musicPrompts.yourmusic.voiceArrangement,
          },
          rights: "歌词与音乐提示来自本轮候选；音频、封面及商用授权需分别确认",
          ai: d.instrumental ? "unknown" : "assisted",
          source: candidate.source,
          productionFlowRunId: run.id,
          productionCandidateId: candidate.id,
          productionCandidateHash: candidate.pairHash,
        },
        { kind: "generation_input", provider: candidate.source },
      );
      if(parent?.artistSnapshot)s.save('works',{...work,artistSnapshot:parent.artistSnapshot,storyContext:parent.storyContext,routeSnapshot:parent.routeSnapshot});
      s.repo.audit("productionFlow.work", work.id, {
        runId: run.id,
        candidateId: candidate.id,
      });
      return { workId: work.id };
    },
    materializeAssets: (run, list) => {
      const work = s.get("works", run.workId),
        assets = [...list].sort((a, b) => a.ordinal - b.ordinal);
      for (const a of assets) {
        const actual = s.get("assets", a.assetId);
        if (actual.sha256 !== a.sha256 || actual.kind !== "audio")
          throw Error("ASSET_HASH_MISMATCH");
        s.locate(a.assetId);
      }
      const versions = assets.map((a) => {
        const record = s.repo.maybe(
          "settings",
          downloadKey(run.id, a.providerSongId),
        );
        if (
          run.managedMusic &&
          (!record ||
            record.runId !== run.id ||
            record.operationId !== run.operationId ||
            record.providerSongId !== run.songIds[a.ordinal] ||
            record.assetId !== a.assetId ||
            record.sha256 !== a.sha256 ||
            record.ordinal !== a.ordinal)
        )
          throw Error("ORIGINAL_ASSET_SCOPE");
        return {
          ...a,
          provider: "yourmusic",
          operationId: run.musicSubmissionOperationId ?? null,
          providerMetadata: record?.providerMetadata ?? null,
          submittedLyrics: { text: run.candidate.pair.lyrics },
          actualLyrics: record?.providerMetadata?.lyric
            ? { text: record.providerMetadata.lyric, version: null }
            : null,
        };
      });
      s.save("works", {
        ...work,
        assets: {
          ...work.assets,
          audio_A: assets[0].assetId,
          audio_B: assets[1].assetId,
        },
        assetHistory: [
          ...new Set([
            ...(work.assetHistory ?? []),
            ...assets.map((a) => a.assetId),
          ]),
        ],
        audioVersions: versions,
        provider: "yourmusic",
        providerTaskId: run.trackingId,
        providerSongIds: run.songIds,
        generationRunId: run.id,
        lyricsConfirmation: null,
      });
      s.repo.audit("productionFlow.assets", work.id, {
        runId: run.id,
        assetIds: assets.map((a) => a.assetId),
      });
      return { workId: work.id };
    },
  });
}
const downloadKey = (runId: string, songId: string) =>
  "production-flow:download:" + runId + ":" + songId;
const DownloadSchema = z.strictObject({
  id: z.uuid(),
  operationId: z.uuid(),
  providerSongId: z.string().min(1).max(500),
  ordinal: z.number().int().min(0).max(1),
  bytes: z
    .instanceof(Uint8Array)
    .refine((b) => b.byteLength > 0 && b.byteLength <= 50 * 1024 * 1024),
  mime: z.string().max(100),
  providerMetadata: z.strictObject({
    id: z.string().max(500),
    title: z.string().max(1000).nullable(),
    duration: z.number().nonnegative().nullable(),
    lyric: z.string().max(100000).nullable(),
  }),
});
export async function importProductionAudio(
  s: Studio,
  raw: unknown,
): Promise<FlowAsset> {
  if (s.mode !== "production") throw Error("PRODUCTION_REQUIRED");
  const input = DownloadSchema.parse(raw),
    { run, operation } = s.productionFlowService().context(input.id);
  if (
    run.operationId !== input.operationId ||
    operation?.id !== input.operationId ||
    operation?.state !== "dispatching" ||
    operation.taskType !== "music_assets" ||
    operation.runId !== run.id ||
    run.songIds[input.ordinal] !== input.providerSongId ||
    input.providerMetadata.id !== input.providerSongId
  )
    throw Error("ORIGINAL_ASSET_SCOPE");
  const file = path.join(s.root, "staging", randomUUID() + ".provider-audio");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, input.bytes);
  try {
    const asset = await s.importFile(file, "audio_A");
    s.locate(asset.id);
    const mapping = {
      id: downloadKey(run.id, input.providerSongId),
      runId: run.id,
      operationId: operation.id,
      providerSongId: input.providerSongId,
      assetId: asset.id,
      sha256: asset.sha256,
      ordinal: input.ordinal,
      providerMetadata: input.providerMetadata,
      source: "provider_download",
      at: s.now().toISOString(),
    };
    s.save("settings", mapping);
    s.repo.audit("productionFlow.audio.import", asset.id, {
      runId: run.id,
      providerSongId: input.providerSongId,
    });
    return {
      providerSongId: input.providerSongId,
      assetId: asset.id,
      sha256: asset.sha256,
      ordinal: input.ordinal,
    };
  } finally {
    fs.unlinkSync(file);
  }
}
