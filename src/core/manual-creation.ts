import { randomUUID } from "node:crypto";
import type { Studio } from "./studio";
import { digest } from "./plan-center/storage";
import { GenerationConfigSchemas } from "../shared/generation-config";
const prefix = "manual-creation:";
export function listManualCreations(s: Studio) {
  return s.repo
    .all("settings")
    .filter((r) => r.id.startsWith(prefix))
    .map((r) => {
      const run = s
        .planCenterService()
        .list()
        .runs.find((v) => v.id === r.value.runId);
      return { ...r.value, run };
    });
}
export function prepareManualCreation(s: Studio, raw: unknown) {
  const i: any = GenerationConfigSchemas["manualCreation.prepare"].parse(raw);
  return s.repo.transaction(() => {
    const requestHash = digest(i),
      old = s.repo.maybe("settings", prefix + i.requestId)?.value;
    if (old) {
      if (old.requestHash !== requestHash) throw Error("IDEMPOTENCY_CONFLICT");
      return {
        ...old,
        plan: s
          .planCenterService()
          .list()
          .plans.find((p) => p.id === old.planId),
        run: s
          .planCenterService()
          .list()
          .runs.find((r) => r.id === old.runId),
      };
    }
    const artist = s.get("artists", i.artistId),
      center = s.planCenterService();
    const routing = i.routing ?? {
      text: { source: "default" },
      image: { source: "default" },
      music: { source: "default" },
    };
    const plan = center.save({
      plan: {
        id: randomUUID(),
        title: artist.name + " · 单次创作",
        artistId: artist.id,
        origin: "manual",
        enabled: false,
        schedule: { kind: "daily", localTime: "09:00" },
        theme: i.storyBeat.slice(0, 2000),
        storyContext: { storyBeat: i.storyBeat, storyStage: i.storyStage },
        styleTemplate: i.styleTemplate ?? "",
        outputs: i.outputs,
        material: { source: "provider" },
        routing,
        text: { ...i.text, threshold: 75, maxRewrites: 0, maxScoreRetries: 1 },
        music: { route: "manual", ...i.music },
        authorization: {
          text: i.text.consent,
          music: i.music.consent,
          publish: false,
        },
      },
      expectedRevision: null,
    });
    const preview = center.preview({ id: plan.id }),
      run = center.run({
        id: plan.id,
        expectedRevision: plan.revision,
        summaryHash: preview.summaryHash,
        requestId: i.requestId,
        source: "manual",
      });
    const value = {
      id: i.requestId,
      requestHash,
      planId: plan.id,
      runId: run.id,
      createdAt: s.now().toISOString(),
    };
    s.repo.save("settings", { id: prefix + i.requestId, value });
    return { ...value, plan, run };
  });
}
