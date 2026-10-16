import { z } from "zod";
export const TextProviderProfileSchema = z
  .strictObject({
    providerId: z
      .enum(["deepseek", "codex_cli", "claude_code"])
      .default("deepseek"),
    endpoint: z.string().nullable().optional(),
    modelId: z.string().trim().min(1).max(200).nullable().default(null),
    executionEnabled: z.literal(false).default(false),
    automaticEvaluation: z.literal(false).default(false),
  })
  .transform((p, ctx) => {
    const endpoint =
      p.providerId === "deepseek" ? "https://api.deepseek.com" : null;
    if (p.endpoint !== undefined && p.endpoint !== endpoint) {
      ctx.addIssue({ code: "custom", message: "TEXT_ENDPOINT_REJECTED" });
      return z.NEVER;
    }
    return { ...p, endpoint };
  });
export type TextProviderProfile = z.output<typeof TextProviderProfileSchema>;
export const parseTextProviderProfile = (input: unknown) =>
  TextProviderProfileSchema.parse(input);
export function textProviderReadiness(profile: TextProviderProfile) {
  const p = parseTextProviderProfile(profile);
  return [
    ...(!p.modelId ? ["TEXT_MODEL_MISSING"] : []),
    ...(p.providerId !== "deepseek" ? ["LOCAL_ADAPTER_UNCONFIGURED"] : []),
    "LIVE_EXECUTION_DISABLED",
  ];
}
