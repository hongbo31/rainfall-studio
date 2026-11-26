import { z } from "zod";
import type { PlanCenterPublishAttempt, PlanCenterRun, PlanCenterStageAttempt, PlanWorkflowPublicationTarget } from "./plan-center";

const id = z.uuid();
const revision = z.number().int().positive();
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const PublicationScheduleSchema = z.discriminatedUnion("unit", [
  z.strictObject({ kind: z.literal("scheduled"), unit: z.literal("hour"), minute: z.number().int().min(0).max(59) }),
  z.strictObject({ kind: z.literal("scheduled"), unit: z.literal("day"), localTime }),
  z.strictObject({ kind: z.literal("scheduled"), unit: z.literal("week"), localTime, weekday: z.number().int().min(1).max(7) }),
  z.strictObject({ kind: z.literal("scheduled"), unit: z.literal("month"), localTime, day: z.number().int().min(1).max(31) }),
]);
const execution = z.union([z.strictObject({ kind: z.literal("manual") }), PublicationScheduleSchema]);
const distinct = (items: string[]) => new Set(items).size === items.length;
export const publicationTaskPlanLimit = 20;
const planStep = z.strictObject({ kind: z.literal("plans"), planIds: z.array(id).min(1).max(publicationTaskPlanLimit).refine(distinct) });
const task = z.strictObject({
  id, title: z.string().trim().min(1).max(120),
  execution, steps: z.tuple([planStep]), consent: z.literal(true), prepareContract: z.boolean().optional(),
});
export const PublicationTaskSaveSchema = z.strictObject({ task, expectedRevision: revision.nullable() });
export const PublicationTaskStartSchema = z.strictObject({ id, requestId: id, expectedRevision: revision });
export const PublicationTaskToggleSchema = z.strictObject({ id, expectedRevision: revision, enabled: z.boolean() });
export const PublicationTaskDeleteSchema = z.strictObject({ id, expectedRevision: revision });
export const PublicationTaskIdSchema = z.strictObject({ id });
export const PublicationTaskListSchema = z.strictObject({ expandedTaskId: id.optional() });
export const publicationTaskSchemas: Record<string, z.ZodType> = {
  "publicationTasks.list": PublicationTaskListSchema, "publicationTasks.save": PublicationTaskSaveSchema,
  "publicationTasks.start": PublicationTaskStartSchema, "publicationTasks.toggle": PublicationTaskToggleSchema,
  "publicationTasks.delete": PublicationTaskDeleteSchema, "publicationTasks.stop": PublicationTaskIdSchema,
  "publicationTasks.history": PublicationTaskIdSchema,
};
export type PublicationTaskInput = z.input<typeof task>;
export type PublicationExecution = z.output<typeof execution>;
export type PublicationPlan = { id: string; revision: number; title: string; artistName?: string; updatedAt?: string; publishes?: boolean };
type LegacyPublishStep = { kind: "publish"; targets: PlanWorkflowPublicationTarget[] };
export type PublicationTask = Omit<z.output<typeof task>, "steps"> & {
  steps: [z.output<typeof planStep>, LegacyPublishStep?];
  revision: number; enabled: boolean; deleted?: boolean; cursor: string;
};

export function publicationTaskNeedsPlanConfirmation(task: PublicationTask, plans: PublicationPlan[]) {
  return !!task.steps[1] && plans.some(plan => plan.publishes && task.steps[0].planIds.includes(plan.id));
}
export type PublicationDispatch = { tmeIds: string[]; fanqieIds: string[] };
export type PublicationRunState = "running" | "waiting" | "action_required" | "completed" | "partial" | "failed" | "stopped";
export type PublicationTaskRun = {
  id: string; taskId: string; requestId: string; source: "manual" | "scheduled";
  snapshot: PublicationTask; plans: PublicationPlan[]; linked: { id: string; planId: string; owned: boolean }[];
  planFailures?: { planId: string; reason: string }[];
  skippedPlanIds?: string[];
  dispatch?: PublicationDispatch; state: PublicationRunState; detail: string; startedAt: string; updatedAt: string;
  logs: { at: string; state: PublicationRunState; detail: string }[];
};
export type PublicationPlanStage = (
  Pick<PlanCenterStageAttempt, "id" | "stage" | "state" | "reason"> |
  (Pick<PlanCenterPublishAttempt, "id" | "platform" | "state" | "reason"> & { stage: "publication" })
) & {
  updatedAt?: string;
  /** Already masked by Core for use in the task summary. */
  externalIdHint?: string;
};
export type PublicationPlanProgress = {
  planId: string; title: string; runId?: string; source?: PlanCenterRun["source"]; owned?: boolean; updatedAt?: string; reason?: string;
  state: PlanCenterRun["state"] | "pending" | "queued" | "skipped";
  items: { id: string; ordinal: number; title?: string; state: string; reason?: string; stages: PublicationPlanStage[] }[];
};
export type PublicationTaskList = {
  tasks: { task: PublicationTask; run?: Omit<PublicationTaskRun, "snapshot" | "logs">; planProgress?: PublicationPlanProgress[] }[];
  plans: PublicationPlan[];
};
export const publicationRunKey = "publication-task:run:";
export const publicationTaskKey = "publication-task:definition:";
export function publicationRunActive(state?: PublicationRunState) {
  return state === "running" || state === "waiting" || state === "action_required";
}
