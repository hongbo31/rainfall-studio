import { z } from "zod";
import type { ApiCredentials } from "./api-credentials";
import {
  LiveTextPrepareSchema,
  LiveTextClaimSchema,
} from "../shared/live-text";
type Options = {
  credentials: Pick<
    ApiCredentials,
    "apiCredentialStatus" | "withDeepSeekAdapter"
  >;
  rpc: (method: string, input?: unknown) => Promise<any>;
  available: () => boolean;
  generation?: () => number;
};
export function createLiveTextBroker(o: Options) {
  const rpc = async (method: string, input: unknown = {}) => {
    const r = await o.rpc(method, input);
    if (!r.ok) throw Error(r.error.code);
    return r.value;
  };
  const assertAvailable = () => {
    if (!o.available()) throw Error("PRODUCTION_REQUIRED");
  };
  let busy = false;
  return {
    async ui(action: string, raw: unknown = {}) {
      assertAvailable();
      if (action === "list") {
        z.strictObject({}).parse(raw);
        return rpc("internal.liveText.list");
      }
      if (action === "context") {
        const v = z.strictObject({ id: z.uuid() }).parse(raw);
        return rpc("internal.liveText.context", v);
      }
      if (!["prepare", "run"].includes(action))
        throw Error("METHOD_NOT_ALLOWED");
      if (busy) throw Error("TEXT_TASK_BUSY");
      busy = true;
      const generation = o.generation?.();
      const guard = () => {
        assertAvailable();
        if (o.generation?.() !== generation) throw Error("WORKSPACE_CHANGED");
      };
      try {
        if (action === "prepare") {
          const v = LiveTextPrepareSchema.parse(raw);
          const status = await o.credentials.apiCredentialStatus({
            profileId: v.profileId,
          });
          guard();
          if (!status.configured) throw Error("CREDENTIAL_REQUIRED");
          return await rpc("internal.liveText.prepare", v);
        }
        const v = LiveTextClaimSchema.parse(raw),
          c = await rpc("internal.liveText.context", { id: v.id });
        guard();
        const status = await o.credentials.apiCredentialStatus({
          profileId: c.job.profileId,
        });
        guard();
        if (!status.configured) throw Error("CREDENTIAL_REQUIRED");
        return await o.credentials.withDeepSeekAdapter(
          {
            profileId: c.job.profileId,
            expectedRevision: c.job.expectedProfileRevision,
          },
          async (adapter) => {
            guard();
            const claim = await rpc("internal.liveText.claim", v);
            guard();
            const result = await adapter.invoke(claim.request);
            guard();
            return rpc("internal.liveText.record", {
              id: v.id,
              operationId: claim.operation.id,
              result,
            });
          },
          guard,
        );
      } finally {
        busy = false;
      }
    },
  };
}
