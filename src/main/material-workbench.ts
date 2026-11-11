import { MaterialMethods } from "../shared/material-methods";
import type {
  MaterialQueueJob,
  MaterialWorkbenchSnapshot,
} from "../shared/material-workbench";
import type { MusicAdapter } from "../core/workflow/yourmusic";
import type { ApiCredentials } from "./api-credentials";
type Options = {
  rpc: (method: string, input?: any) => Promise<any>;
  credentials: Pick<ApiCredentials, "withMusicAdapter">;
  available: () => boolean;
  generation: () => number;
  chooseDirectory?: () => Promise<{ canceled: boolean; filePaths: string[] }>;
  fixtureAdapter?: MusicAdapter;
};
export function createMaterialWorkbenchBroker(o: Options) {
  if (o.fixtureAdapter && o.fixtureAdapter.source !== "fixture")
    throw Error("FIXTURE_ADAPTER_REQUIRED");
  let busy = false;
  const rpc = async (action: string, input: any = {}) => {
    const r = await o.rpc("internal.materials." + action, input);
    if (!r.ok) throw Error(r.error.code);
    return r.value;
  };
  const guard = (generation: number) => {
    if (!o.available() || o.generation() !== generation)
      throw Error("WORKSPACE_CHANGED");
  };
  const withAdapter = <T>(
    job: MaterialQueueJob,
    fn: (a: MusicAdapter) => Promise<T>,
    check: () => void,
  ) =>
    o.fixtureAdapter
      ? fn(o.fixtureAdapter)
      : o.credentials.withMusicAdapter(
          { profileId: job.profileId, expectedRevision: job.profileRevision },
          fn,
          check,
        );
  async function poll(job: MaterialQueueJob, check: () => void) {
    await rpc("recordProgress", { jobId: job.id, state: "polling" });
    check();
    await withAdapter(
      job,
      async (adapter) => {
        const result = await adapter.query(job.providerSongIds);
        check();
        const songs = result.songs ?? [];
        if (
          songs.some(
            (s: any) =>
              job.providerSongIds.includes(s.id) &&
              ["failed", "error"].includes(s.status),
          )
        )
          throw Error("ORIGINAL_PROVIDER_TASK_FAILED");
        const ready = job.providerSongIds.map((id) =>
          songs.find(
            (song: any) =>
              song.id === id && song.status === "succeeded" && song.audio_url,
          ),
        );
        if (ready.some((s) => !s)) return;
        await rpc("recordProgress", { jobId: job.id, state: "downloading" });
        check();
        for (const song of ready) {
          const audio = await adapter.download(song.audio_url);
          check();
          await rpc("importAudio", {
            jobId: job.id,
            providerSongId: song.id,
            providerMetadata: song,
            bytes: new Uint8Array(audio.bytes),
            mime: audio.mime,
          });
          check();
        }
        // The production adapter currently supplies no verified charge evidence.
        await rpc("completeJob", {
          jobId: job.id,
          ...(o.fixtureAdapter && Number.isFinite(result.actualCostCredits)
            ? { actualCredits: result.actualCostCredits }
            : {}),
        });
        check();
      },
      check,
    );
  }
  return {
    async ui(action: string, raw: any = {}) {
      const generation = o.generation();
      guard(generation);
      const schema =
        MaterialMethods[
          ("materials." + action) as keyof typeof MaterialMethods
        ];
      if (!schema) throw Error("METHOD_NOT_ALLOWED");
      const input = schema.parse(raw);
      if(action==='chooseRebindDirectory'){
        if(!o.chooseDirectory)throw Error('DIRECTORY_PICKER_UNAVAILABLE');
        const picked=await o.chooseDirectory();guard(generation);
        if(picked.canceled||picked.filePaths.length!==1)return null;
        return rpc('previewRebind',{sourceId:(input as {sourceId:string}).sourceId,root:picked.filePaths[0]});
      }
      if (action === "chooseDirectory") {
        if (!o.chooseDirectory) throw Error("DIRECTORY_PICKER_UNAVAILABLE");
        const picked = await o.chooseDirectory();
        guard(generation);
        if (picked.canceled || picked.filePaths.length !== 1)
          return rpc("list");
        return rpc("configure", { root: picked.filePaths[0] });
      }
      if (action === "reconcile") {
        if (busy) throw Error("MATERIAL_QUEUE_BUSY");
        const job = await rpc("reconcile", input);
        guard(generation);
        busy = true;
        try {
          await poll(job, () => guard(generation));
          return rpc("list");
        } finally {
          busy = false;
        }
      }
      const result = await rpc(action, input);
      guard(generation);
      return result;
    },
    async pump() {
      if (busy || !o.available()) return;
      busy = true;
      const generation = o.generation(),
        check = () => guard(generation);
      let current: MaterialQueueJob | undefined,
        candidate: MaterialQueueJob | undefined;
      try {
        const snapshot: MaterialWorkbenchSnapshot = await rpc("list");
        check();
        if (snapshot.paused) return;
        current = snapshot.jobs.find((j) =>
          ["accepted", "polling", "downloading"].includes(j.state),
        );
        if (current) {
          await poll(current, check);
          return;
        }
        const queued = snapshot.jobs
          .filter((j) => j.state === "queued")
          .sort(
            (a, b) =>
              Number(
                snapshot.materials.find((m) => m.id === a.materialId)?.number,
              ) -
                Number(
                  snapshot.materials.find((m) => m.id === b.materialId)?.number,
                ) || a.createdAt.localeCompare(b.createdAt),
          )[0];
        if (!queued) return;
        candidate = queued;
        // Default production queue has no enforceable fee bound: Core records a blocked job.
        if (!snapshot.generationCapability.available) {
          await rpc("claimNext");
          return;
        }
        // Only an explicitly injected fixture adapter can exercise submission in this candidate.
        if (!o.fixtureAdapter) return;
        const prepared = await rpc("prepareWork", { jobId: queued.id });
        check();
        current = await rpc("claimNext");
        check();
        if (!current) return;
        if (current.id !== queued.id) throw Error("MATERIAL_QUEUE_CHANGED");
        const result = await withAdapter(
          current,
          (a) =>
            a.submit({
              draft: prepared.draft,
              modelId: current!.modelId,
              operationId: current!.id,
            }),
          check,
        );
        check();
        if (result.state !== "accepted" || !Array.isArray(result.songIds))
          throw Error("SUBMISSION_RESULT_UNKNOWN");
        await rpc("recordSubmitted", {
          jobId: current.id,
          providerSongIds: result.songIds,
          trackingId: result.trackingId,
        });
        check();
      } catch (e) {
        const failed = current ?? candidate;
        if (failed && o.available() && o.generation() === generation)
          await rpc("recordFailure", {
            jobId: failed.id,
            reason:
              e instanceof Error && /^[A-Z0-9_]+$/.test(e.message)
                ? e.message
                : "ORIGINAL_PROVIDER_OPERATION_FAILED",
            unknown:
              failed.state === "dispatching" && !failed.providerSongIds.length,
          }).catch(() => undefined);
      } finally {
        busy = false;
      }
    },
  };
}
