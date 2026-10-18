import { z } from "zod";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const TmeObservationStatusSchema = z.enum([
  "draft",
  "prepared",
  "submitted",
  "reviewing",
  "released",
  "rejected",
  "unknown",
]);
export const tmeObservationStatusNames: Record<
  z.infer<typeof TmeObservationStatusSchema>,
  string
> = {
  draft: "草稿",
  prepared: "资料已准备",
  submitted: "页面显示已提交",
  reviewing: "审核中",
  released: "页面显示已发行",
  rejected: "已驳回",
  unknown: "状态未知",
};
export const TmeObservationInputSchema = z.strictObject({
  workId: z.uuid(),
  accountId: z.uuid(),
  visibleAccount: z.string().trim().min(1).max(200),
  remoteId: z.string().trim().min(1).max(300).nullable(),
  status: TmeObservationStatusSchema,
  officialUrl: z
    .string()
    .url()
    .max(2000)
    .refine((value) => {
      const url = new URL(value);
      return (
        url.origin === "https://y.tencentmusic.com" &&
        !url.username &&
        !url.password
      );
    }, "TME_OFFICIAL_URL_REQUIRED"),
  observedAt: z.iso.datetime(),
  evidence: z.strictObject({
    summary: z.string().trim().min(10).max(4000),
    reference: z.string().trim().min(1).max(2000),
    sha256,
  }),
  audioEvidence: z
    .strictObject({
      sourceASha256: sha256,
      pcmSha256: sha256,
      derivation: z.literal("pcm_format_compatibility"),
      note: z.string().trim().min(5).max(2000),
    })
    .refine(
      (value) => value.sourceASha256 !== value.pcmSha256,
      "DERIVED_AUDIO_HASH_REQUIRED",
    )
    .optional(),
});
export const TmeObservationListSchema = z.strictObject({
  workId: z.uuid().optional(),
});
export const TmeObservationSchemas = {
  "tme.observations.record": TmeObservationInputSchema,
  "tme.observations.list": TmeObservationListSchema,
};
export type TmeObservationInput = z.infer<typeof TmeObservationInputSchema>;
export type TmeObservation = TmeObservationInput & {
  id: string;
  workRevision: number;
  title: string;
  sourceRecordingSha256: string | null;
  source: "official_page_observation";
  verification: "user_report";
  identityBasis: "visible_account_user_report";
  recordingMatch: "not_verified";
  submissionByClient: false;
  recordedAt: string;
};
