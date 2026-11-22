import { z } from "zod";
import type { ApiCredentials } from "./api-credentials";
import {
  FlowSavePlanSchema,
  FlowEnableSchema,
  FlowTriggerSchema,
  FlowIdSchema,
  FlowApproveSchema,
  FlowUseManualAssetsSchema,
} from "../shared/production-flow";

export type PublicationCapability = {
  available: boolean;
  reasons: string[];
  transport: string;
  receiptSource: string;
};
export interface ProductionPublicationPort {
  capability(): PublicationCapability;
  submit?(request: any): Promise<any>;
  poll?(request: any): Promise<any>;
}
// This is the actual native transport's write gate. An observation is never an executor.
export function blockedTmePublicationPort(transport: {
  writeBlockReason(): string;
}): ProductionPublicationPort {
  return {
    capability: () => ({
      available: false,
      transport: "windows-uia",
      receiptSource: "official-executor-only",
      reasons: [
        transport.writeBlockReason(),
        "AI_ROUTE_NOT_VALIDATED",
        "TERMS_ACCEPTANCE_REQUIRED",
      ],
    }),
  };
}
type Options = {
  credentials: Pick<
    ApiCredentials,
    "apiCredentialStatus" | "withDeepSeekAdapter" | "withMusicAdapter"
  >;
  rpc: (method: string, input?: any) => Promise<any>;
  available: () => boolean;
  generation: () => number;
  publication: ProductionPublicationPort;
};
export function createProductionFlowBroker(o: Options) {
  let busy = false;
  const rpc = async (method: string, input: any = {}) => {
    const r = await o.rpc("internal.productionFlow." + method, input);
    if (!r.ok) throw Error(r.error.code);
    return r.value;
  };
  const available = () => {
    if (!o.available()) throw Error("PRODUCTION_REQUIRED");
  };
  const schemas: Record<string, z.ZodType> = {
    savePlan: FlowSavePlanSchema,
    enable: FlowEnableSchema,
    disable: FlowEnableSchema,
    trigger: FlowTriggerSchema,
    list: z.strictObject({}),
    context: FlowIdSchema,
    next: FlowIdSchema,
    approve: FlowApproveSchema,
    retry: FlowEnableSchema,
    useManualAssets: FlowUseManualAssetsSchema,
  };
  async function executeRun(id: string, guard: () => void) {
    guard();
    const next = await rpc("next", { id });
    guard();
    if (!next?.task) return;
    const { task, run } = next,
      type = task.type;
    const block = async (reason: string) => {
      guard();
      await rpc("block", { id, expectedRevision: run.revision, reason });
    };
    if (type.startsWith("publication_")) {
      const cap = o.publication.capability();
      if (!cap.available || !o.publication.submit || !o.publication.poll) {
        await block(cap.reasons[0] ?? "PUBLICATION_EXECUTOR_UNAVAILABLE");
        return;
      }
    } else {
      const profileId =
        task.profileId ??
        (type.startsWith("text_")
          ? run.plan?.text?.profileId
          : run.plan?.music?.profileId);
      const status = await o.credentials.apiCredentialStatus({ profileId });
      guard();
      if (!status.configured) {
        await block("CREDENTIAL_REQUIRED");
        return;
      }
    }
    let claim: any = null;
    const execute = async (adapter?: any) => {
      guard();
      claim = await rpc("claim", { id, expectedRevision: run.revision });
      guard();
      const request = claim.task.request,
        operationId = claim.operation.id;
      let result: any;
      if (type === "text_generate")
        result = { type, result: await adapter.invoke(request) };
      else if (type === "text_score")
        result = { type, result: await adapter.evaluate(request) };
      else if (type === "music_submit") {
        const r = await adapter.submit(request);
        result =
          r.state === "accepted"
            ? {
                type,
                status: "accepted",
                trackingId: r.trackingId ?? null,
                songIds: r.songIds,
                actualCostCredits: null,
                evidenceId: null,
              }
            : {
                type,
                status:
                  r.state === "confirmed_unsent"
                    ? "confirmed_unsent"
                    : "unknown",
                reason:
                  r.state === "confirmed_unsent"
                    ? "MUSIC_CONFIRMED_UNSENT"
                    : "MUSIC_OUTCOME_UNKNOWN",
                confirmedUnsent: r.state === "confirmed_unsent",
              };
      } else if (type === "music_assets") {
        const r = await adapter.query(request.songIds);
        guard();
        const songs = r.songs ?? [];
        if (
          songs.some((s: any) => s.status === "error" || s.status === "failed")
        )
          result = {
            type,
            status: "failed",
            assets: [],
            reason: "MUSIC_PROVIDER_FAILED",
          };
        else if (r.state === "error")
          result = {
            type,
            status: "failed",
            assets: [],
            reason: "MUSIC_QUERY_FAILED",
          };
        else if (
          request.songIds.some(
            (songId: string) =>
              !songs.some(
                (s: any) =>
                  s.id === songId && s.status === "succeeded" && s.audio_url,
              ),
          )
        )
          result = { type, status: "pending", assets: [] };
        else {
          const assets = [];
          for (const [ordinal, songId] of request.songIds.entries()) {
            const song = songs.find((s: any) => s.id === songId);
            const audio = await adapter.download(song.audio_url, { retry: true });
            guard();
            const asset = await rpc("importAudio", {
              id,
              operationId,
              providerSongId: songId,
              ordinal,
              bytes: new Uint8Array(audio.bytes),
              mime: audio.mime,
              providerMetadata: {
                id: song.id,
                title: song.title ?? null,
                duration: song.duration ?? null,
                lyric: song.lyric ?? null,
              },
            });
            guard();
            assets.push(asset);
          }
          result = { type, status: "complete", assets };
        }
      } else
        result = await (type === "publication_submit"
          ? o.publication.submit!(request)
          : o.publication.poll!(request));
      guard();
      return await rpc("record", { id, operationId, result });
    };
    try {
      const grant = type.startsWith("text_") ? run.plan?.text : run.plan?.music;
      const identity = {
        profileId: task.profileId ?? grant?.profileId,
        expectedRevision: task.profileRevision ?? grant?.profileRevision,
      };
      if (type.startsWith("text_"))
        await o.credentials.withDeepSeekAdapter(identity, execute, guard);
      else if (type.startsWith("music_"))
        await o.credentials.withMusicAdapter(identity, execute, guard);
      else await execute();
    } catch (e) {
      guard();
      if (!claim) {
        await block(
          e instanceof Error &&
            [
              "REVISION_CONFLICT",
              "PROFILE_NOT_FOUND",
              "CREDENTIAL_REQUIRED",
              "TEXT_BUDGET_INSUFFICIENT",
              "MUSIC_BUDGET_INSUFFICIENT",
              "PROVIDER_RISK_FROZEN",
              "FLOW_PROVIDER_BUSY",
              "PLAN_REVISION_CHANGED",
              "PROFILE_REVISION_CHANGED",
              "PROFILE_PROVIDER_MISMATCH",
              "PUBLICATION_APPROVAL_STALE",
              "MUSIC_PRICING_UNVERIFIED",
              "MANAGED_MUSIC_WORK_SCOPE",
            ].includes(e.message)
            ? e.message
            : "PROFILE_REVALIDATION_REQUIRED",
        );
        return;
      }
      // Once claimed, uncertainty in a charge/post must never become a new submission.
      await rpc("record", {
        id,
        operationId: claim.operation.id,
        result:
          type === "music_assets"
            ? {
                type,
                status: "failed",
                assets: [],
                reason: "ORIGINAL_DOWNLOAD_FAILED",
              }
            : type === "publication_poll"
              ? { type, status: "failed", reason: "PUBLICATION_QUERY_FAILED" }
              : {
                  type,
                  status: "unknown",
                  reason: "PROVIDER_OUTCOME_UNKNOWN",
                  confirmedUnsent: false,
                },
      });
    }
  }
  return {
    async ui(action: string, raw: unknown = {}) {
      available();
      if (action === "capability") {
        z.strictObject({}).parse(raw);
        return o.publication.capability();
      }
      const schema = schemas[action];
      if (!schema) throw Error("METHOD_NOT_ALLOWED");
      return rpc(action, schema.parse(raw));
    },
    async pump() {
      if (busy || !o.available()) return;
      busy = true;
      const generation = o.generation(),
        guard = () => {
          available();
          if (o.generation() !== generation) throw Error("WORKSPACE_CHANGED");
        };
      try {
        const rows = await rpc("list");
        guard();
        for (const run of rows.runs ?? []) {
          try {
            await executeRun(run.id, guard);
          } catch {
            guard(); /* one failed run must not starve other plans */
          }
        }
      } catch {
        /* a stopped/switched Core is reconciled from its durable claims on restart */
      } finally {
        busy = false;
      }
    },
  };
}
