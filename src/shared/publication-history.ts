import { z } from "zod";
import { PlatformTargetSchema, type PlatformTarget } from "./platform-config";

const searchText = z.string().trim().max(500).optional();
export const publicationHistoryStatuses = ["contract_pending", "submitted", "reviewing", "published", "rejected", "withdrawn"] as const;
export const PublicationHistoryQuerySchema = z.strictObject({
  day: z.iso.date().optional(),
  platform: PlatformTargetSchema.or(z.literal("tme")).optional(),
  status: z.enum(publicationHistoryStatuses).optional(),
  singer: searchText,
  promptEngine: searchText,
  title: searchText,
  page: z.number().int().positive().max(1_000_000).default(1),
});
export type PublicationHistoryQuery = z.input<typeof PublicationHistoryQuerySchema>;
export type PublicationHistoryPlatform = NonNullable<PublicationHistoryQuery["platform"]>;
export type PublicationHistoryStatus = (typeof publicationHistoryStatuses)[number];

export type PublicationHistoryRow = {
  id: string;
  title: string;
  platform: PublicationHistoryPlatform;
  destinations?: PlatformTarget[];
  singer?: string;
  promptEngine?: string;
  accountName?: string;
  status: PublicationHistoryStatus;
  source: "platform" | "user";
  day: string | null;
  time: string | null;
  timeSource: "official" | "recorded" | "unknown";
};

export type PublicationHistoryPage = {
  today: string;
  total: number;
  pageSize: number;
  rows: PublicationHistoryRow[];
};
