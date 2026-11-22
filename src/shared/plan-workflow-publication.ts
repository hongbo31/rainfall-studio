import { z } from "zod";
import type { PublicationDispatch } from "./publication-tasks";

export const PlanWorkflowQishuiScopeSchema = z.strictObject({
  runId: z.uuid(), accountId: z.uuid(), workId: z.uuid(),
});
export const PlanWorkflowQishuiSubmittedSchema = PlanWorkflowQishuiScopeSchema.extend({ confirmed: z.literal(true) });
const scopeHash = z.string().regex(/^[a-f0-9]{64}$/u);
export const PlanWorkflowFanqieAccountSchema = z.strictObject({
  accountId: z.uuid(), accountKey: scopeHash, configurationHash: scopeHash,
});

export type PlanWorkflowQishuiJob = z.infer<typeof PlanWorkflowQishuiScopeSchema> & {
  variant: "A" | "B";
  credits: { performer: string; lyricist: string; composer: string };
  submitted: boolean;
};

export type PlanWorkflowPublicationStatus = {
  runId: string;
  state: "running" | "action_required" | "completed" | "failed";
  detail: string;
  dispatch?: PublicationDispatch;
  fanqieAccount?: z.infer<typeof PlanWorkflowFanqieAccountSchema>;
  qishui: PlanWorkflowQishuiJob[];
};
