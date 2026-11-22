import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import type { Studio } from "./studio";
import { digest } from "./plan-center/storage";
import { CreationTaskSchema } from "../shared/generation-config";
import type { PlanCenterItem, PlanCenterRun } from "../shared/plan-center";
import { planRouteIssue } from "./generation-config";

function saveCreationTask(s: Studio, raw: unknown, startImmediately: boolean) {
  if (s.mode !== "production") throw Error("PRODUCTION_REQUIRED");
  const input = CreationTaskSchema.parse(raw);
  const instrumental = input.songType === "instrumental";
  const draft = { ...input.draft, lyrics: instrumental ? "" : input.draft.lyrics,
    vocalGender: instrumental ? undefined : input.draft.vocalGender };
  if (!instrumental && !draft.lyrics.trim()) throw Error("LYRICS_REQUIRED");
  if (instrumental && !input.outputs.music) throw Error("INSTRUMENTAL_MUSIC_REQUIRED");
  if (draft.separateVersionCovers && (!input.outputs.cover || !input.outputs.music)) throw Error("CREATION_VERSION_COVER_SCOPE");
  if (input.outputs.music !== input.music.consent) throw Error("MUSIC_GRANT_REQUIRED");
  if (input.outputs.music && [draft.title, draft.lyrics, draft.style].some((text, i) => Array.from(text).length > [80, 5000, 1000][i]))
    throw Error("CREATION_MUSIC_LIMIT");
  return s.repo.transaction(() => {
    const center = s.planCenterService();
    const requestHash = digest(input), key = "creation-task:" + input.requestId;
    const previous = s.repo.maybe("settings", key);
    if (previous) {
      if (previous.requestHash !== requestHash) throw Error("IDEMPOTENCY_CONFLICT");
      const rows = center.list();
      const plan = rows.plans.find(row => row.id === previous.planId);
      if (!plan) throw Error("NOT_FOUND");
      const run = rows.runs.find(row => row.id === previous.runId && row.planId === plan.id);
      if (startImmediately && !run) throw Error("CREATION_TASK_ALREADY_STAGED");
      return { plan, run };
    }
    s.repo.get("accountLocalArtists", input.artistId);
    const tomorrow = DateTime.fromJSDate(s.now()).setZone("Asia/Shanghai").plus({ days: 1 }).toISODate()!;
    const plan = center.save({
      expectedRevision: null,
      plan: {
        id: randomUUID(), title: draft.title, artistId: input.artistId, origin: "manual", songType: input.songType,
        schedule: { kind: "once", date: tomorrow, localTime: "09:00" },
        creationDraft: draft, material: { source: "creation" }, outputs: { ...input.outputs, lyrics: !instrumental },
        routing: input.routing ?? { text: { source: "default" }, image: { source: "default" }, music: { source: "default" } },
        text: {}, music: input.music.consent ? {
          ...input.music, route: "pule", budgetCredits: 1, maxCostPerRequestCredits: 1,
          creditPolicy: { mode: "uncapped_existing_credits", noRecharge: true, actualCostUnknown: true, consent: true },
        } : { route: "manual" },
        authorization: { text: false, music: input.music.consent, publish: false },
      },
    });
    const routeIssue = planRouteIssue(s.repo, plan);
    if (routeIssue) throw Error(routeIssue);
    let run: PlanCenterRun | undefined;
    if (startImmediately) {
      const preview = center.preview({ id: plan.id });
      run = center.run({ id: plan.id, expectedRevision: preview.planRevision, summaryHash: preview.summaryHash,
        requestId: input.requestId, source: "manual" });
    }
    s.repo.save("settings", { id: key, requestHash, planId: plan.id, runId: run?.id });
    return { plan, run };
  });
}

export function prepareCreationTask(s: Studio, raw: unknown) {
  return saveCreationTask(s, raw, false).plan;
}

export function startCreationTask(s: Studio, raw: unknown) {
  return saveCreationTask(s, raw, true);
}

export function creationWorkFields(run: PlanCenterRun, draft = run.snapshot.creationDraft!) {
  const defaults = run.snapshot.artistSnapshot?.defaults;
  const voice = run.snapshot.songType === "instrumental" ? "instrumental" :
    draft.vocalGender ?? (defaults?.voice === "instrumental" ? "female" : defaults?.voice);
  return { artistId: run.snapshot.artistId, title: draft.title,
    ...(draft.alternateTitle ? { alternateTitle: draft.alternateTitle } : {}), lyrics: draft.lyrics, prompt: draft.style,
    story: "", parameters: { ...defaults, ...(voice ? { voice } : {}) }, rights: "待人工确认授权", ai: "unknown" };
}

export function materializeCreationTaskWork(s: Studio, run: PlanCenterRun, item: PlanCenterItem) {
  if (!run.snapshot.creationDraft || run.snapshot.outputs.music) return;
  return s.repo.transaction(() => {
    const center = s.planCenterService();
    const rows = center.list(), current = rows.items.find(row => row.id === item.id);
    const next = center.next({ runId: run.id, itemId: item.id });
    if (!current || current.runId !== run.id || !next || !["cover", "materials"].includes(next.stage) ||
      !["ready", "dispatching", "waiting"].includes(next.state)) return;
    if (current.workId) return current;
    const work = s.saveWork(creationWorkFields(run), { kind: "generation_input" });
    return center.bindWork({ itemId: current.id, workId: work.id, versions: [] });
  });
}
