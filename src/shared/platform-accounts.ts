import { z } from "zod";
import { platformTargets, type PlatformTarget } from "./platform-config";

export const accountProviders = [...platformTargets, "tme", "suno", "yourmusic"] as const;
export const AccountProviderSchema = z.enum(accountProviders);
export const PlatformAccountIdSchema = z.strictObject({ accountId: z.uuid() });
export const defaultFanqieAccountId = "ea76a486-a79d-4ee7-aa4d-c68e4577f975";

export type AccountProvider = z.infer<typeof AccountProviderSchema>;
export type PlatformAccount = {
  id: string;
  provider: AccountProvider;
  name: string;
  dailyLimit: number;
  authStatus?: string;
};

export function accountSupportsTarget(provider: string, target: PlatformTarget) {
  return provider === target || (provider === "tme" && (target === "qqmusic" || target === "kugou"));
}
