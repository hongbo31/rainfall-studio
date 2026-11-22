import { COVER_API_IMAGE_MAX_BYTES } from "../shared/cover-handoff";
import { platformImageSchemas, type PlatformImageResult, type PlatformImageScope } from "../shared/platform-image";
import { safeWorkFilenameStem } from "../shared/work-analysis";
import type { ApiCredentials } from "./api-credentials";
import { resizeCover } from "./plan-cover-image";

export function createPlatformImageGenerator(options: {
  credentials: Pick<ApiCredentials, "generatePlanCover">;
  captureWorkspace: () => () => void;
  rpc: (method: string, input: unknown) => Promise<any>;
}) {
  const generating = new Set<string>();
  return async (raw: unknown): Promise<PlatformImageResult> => {
    const input = platformImageSchemas["platformImage.generate"].parse(raw);
    const guard = options.captureWorkspace();
    guard();
    if (generating.has(input.providerId)) throw Error("IMAGE_GENERATION_BUSY");
    generating.add(input.providerId);
    try {
      const readScope = async (): Promise<PlatformImageScope> => {
        guard();
        const result = await options.rpc("internal.platformImage.scope", input);
        guard();
        if (!result.ok) throw Error(result.error?.code ?? "IMAGE_OPERATION_FAILED");
        return result.value;
      };
      const { artistName, resolution } = await readScope();
      const { profileId, expectedRevision, modelId } = input;
      const bytes = await options.credentials.generatePlanCover({ profileId, expectedRevision, modelId }, input.prompt,
        async () => { await readScope(); }, guard, resolution);
      guard();
      const image = await resizeCover(bytes, resolution, "jpeg");
      guard();
      if (image.length > COVER_API_IMAGE_MAX_BYTES) throw Error("IMAGE_RESPONSE_INVALID");
      return { base64: image.toString("base64"), filename: safeWorkFilenameStem(artistName) + "-封面.jpg", resolution };
    } finally { generating.delete(input.providerId); }
  };
}
