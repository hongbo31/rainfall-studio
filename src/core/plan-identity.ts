import type { Repository } from "./database";
import type { Studio } from "./studio";
import type {
  PlanCenterPlan,
  PlanCenterRun,
  PlanCenterPublishTarget,
} from "../shared/plan-center";
import { AccountIdentityBindingSchema } from "../shared/account-identity";
/** Explicit binding id only; never resolve identities through display names. */
export function freezePlanIdentities(
  repo: Repository,
  plan: PlanCenterPlan,
): PlanCenterPlan {
  return {
    ...plan,
    publishTargets: plan.publishTargets.map((target) => {
      const { identitySnapshot, ...clean } = target;
      if (!plan.routing || !target.identityBindingId) return clean;
      const row = repo.maybe(
        "settings",
        "account-identity-v1:" + target.identityBindingId,
      );
      if (!row || row.kind !== "account-identity-v1")
        throw Error("PLATFORM_ARTIST_MAPPING_REQUIRED");
      const b = AccountIdentityBindingSchema.parse(row.value),
        account = repo.get("accounts", target.accountId);
      if (b.bindingState !== "bound") throw Error("BINDING_NOT_VERIFIED");
      if (
        b.artistId !== plan.artistId ||
        b.accountId !== target.accountId ||
        b.provider !== account.provider
      )
        throw Error("IDENTITY_PUBLISH_SCOPE");
      if (
        target.platform !== b.provider &&
        !(
          b.provider === "tme" && ["qqmusic", "kugou"].includes(target.platform)
        )
      )
        throw Error("IDENTITY_PLATFORM_SCOPE");
      return {
        ...clean,
        identitySnapshot: {
          bindingId: b.id,
          bindingRevision: b.revision,
          artistId: b.artistId,
          accountId: b.accountId,
          provider: b.provider,
          namespace: b.namespace,
          remoteAccountId: b.remoteAccountId,
          remoteArtistId: b.remoteArtistId,
        },
      };
    }),
  };
}
export function assertPlanIdentity(
  s: Studio,
  run: PlanCenterRun,
  target: PlanCenterPublishTarget,
) {
  if (!run.snapshot.routing) return;
  const f = target.identitySnapshot;
  if (
    !f ||
    f.artistId !== run.snapshot.artistId ||
    f.accountId !== target.accountId ||
    f.bindingId !== target.identityBindingId
  )
    throw Error("PLATFORM_ARTIST_MAPPING_REQUIRED");
  s.accountIdentityService().assertPublishScope({
    ...f,
    externalState: "not_started",
  });
}

/** Rechecked at every production write claim; original submission intents remain read-only. */
export function assertTaskIdentity(s: Studio, taskId: string) {
  const task = s.repo.maybe(
    "settings",
    "unified-publication:v1:" + taskId,
  )?.value;
  if (!task) throw Error("IDENTITY_PUBLICATION_TASK_REQUIRED");
  const links = s.repo
    .all("settings")
    .filter(
      (r) =>
        r.id.startsWith("plan-publication:v1:") &&
        r.value?.publicationTaskId === taskId,
    )
    .map((r) => r.value);
  const owners = links
    .map((link) => ({
      link,
      run: s.repo.maybe("settings", "plan-center:run:" + link.runId)?.value,
    }))
    .filter((v) => v.run?.snapshot?.routing);
  if (!owners.length) {
    if (
      s.repo.maybe("works", task.workId)?.routeSnapshot ||
      hasRoutedWorkOwner(s, task.workId)
    )
      throw Error("PLATFORM_ARTIST_MAPPING_REQUIRED");
    return;
  }
  const submit = s.repo
    .all("operations")
    .some(
      (op) =>
        op.kind === "tme_ai_submission" &&
        op.phase === "submit" &&
        (op.jobId === task.submissionJobId ||
          op.receiptScope?.workId === task.workId),
    );
  if (submit || task.state === "reconcile_required")
    throw Error("RECONCILIATION_REQUIRED");
  for (const { link, run } of owners) {
    if (
      link.workId !== task.workId ||
      link.accountId !== task.accountId ||
      !task.targets.includes(link.platform)
    )
      throw Error("IDENTITY_PUBLICATION_TASK_SCOPE");
    const target = run.snapshot.publishTargets.find(
      (t: PlanCenterPublishTarget) =>
        t.enabled &&
        t.accountId === task.accountId &&
        t.platform === link.platform,
    );
    if (!target) throw Error("IDENTITY_PUBLICATION_TASK_SCOPE");
    assertPlanIdentity(s, run, target);
  }
}

function hasRoutedWorkOwner(s: Studio, workId: string) {
  return s.repo
    .all("settings")
    .filter(
      (r) => r.id.startsWith("plan-center:item:") && r.value?.workId === workId,
    )
    .some(
      (row) =>
        !!s.repo.maybe("settings", "plan-center:run:" + row.value.runId)?.value
          ?.snapshot?.routing,
    );
}
export function assertWorkIdentityWrite(
  s: Studio,
  grant: { workId: string; publicationTaskId?: string },
) {
  if (grant.publicationTaskId) {
    const task = s.repo.maybe(
      "settings",
      "unified-publication:v1:" + grant.publicationTaskId,
    )?.value;
    if (!task || task.workId !== grant.workId)
      throw Error("IDENTITY_PUBLICATION_TASK_SCOPE");
    assertTaskIdentity(s, grant.publicationTaskId);
    return;
  }
  const work = s.repo.maybe("works", grant.workId);
  if (work?.routeSnapshot || hasRoutedWorkOwner(s, grant.workId))
    throw Error("IDENTITY_PUBLICATION_TASK_REQUIRED");
}
