import { randomUUID } from "node:crypto";
import { type Policy, RULE_VERSION, dimensionIds } from "../quality/contracts";
import type { TextProvider } from "./text";
import { YourMusicAdapter, type MusicAdapter } from "./yourmusic";
import { fixtureTone } from "./fixture-audio";
// Original demonstration text. Not a model, approval, calibration sample or real provider.
export function simulationPolicy(): Policy {
  const p: Policy = {
    version: "SIMULATION_ONLY",
    thresholds: { L: 75, M: 75, C: 80, S: 80 },
    maxRevisions: 2,
    criticalDimensions: ["L1", "M2", "C2"],
    borderlineBand: 2,
    minimumConfidence: 0.8,
    majorLevelGap: 2,
    majorScoreGap: 10,
    evaluationRetryLimit: 0,
    merge: "per_dimension_min",
    calibrationMinimum: {
      calibration: 40,
      positive: 20,
      negative: 20,
      validation: 20,
    },
    calibrationAcceptance: {
      hardFalseAcceptMax: 0,
      falseAcceptMax: 0.05,
      falseRejectMax: 0.15,
    },
    evaluatorProfile: {
      primary: {
        modelId: "simulation-primary",
        modelVersion: "1",
        promptVersion: "1",
      },
      review: {
        modelId: "simulation-review",
        modelVersion: "1",
        promptVersion: "1",
      },
    },
    approvalRefs: {},
    calibrationApprovalRef: "FIXTURE_NOT_REAL_CALIBRATION",
  };
  for (const k of Object.keys(p))
    if (!["version", "approvalRefs", "calibrationApprovalRef"].includes(k))
      p.approvalRefs[k] = "FIXTURE_NOT_USER_APPROVAL";
  return p;
}
export const simulationText: TextProvider = {
  id: "offline-fixture",
  source: "fixture",
  async invoke(r) {
    if (r.kind === "evaluate" || r.kind === "review") {
      const c = r.context as any;
      return {
        status: "ok",
        actualCost: 1,
        evidenceId: r.operationId,
        value: {
          id: randomUUID(),
          sessionId: r.sessionId,
          contextHash: c.contextHash,
          pairHash: c.pairHash,
          ruleVersion: RULE_VERSION,
          policyVersion: c.policyVersion,
          modelId: c.modelId,
          modelVersion: c.modelVersion,
          promptVersion: c.promptVersion,
          group: c.group,
          levels: Object.fromEntries(
            dimensionIds
              .filter((x) => x.startsWith(c.group))
              .map((x) => [x, 4]),
          ),
          findings: [],
          confidence: 1,
          status: "complete",
        },
      };
    }
    const c = r.context as any;
    const prompt = {
      positiveStyle: "温暖民谣，木吉他，轻柔女声，从克制走向明亮",
      negativeStyle: "",
      durationTarget: 180,
      voiceArrangement: "female",
    };
    return {
      status: "ok",
      actualCost: 1,
      evidenceId: r.operationId,
      value: {
        title: "那天刚好下雨 · 离线样本",
        topic: "雨中相识",
        storyBeat: c.brief.instruction,
        language: "中文",
        style: "温暖民谣",
        instrumental: false,
        sections: [
          {
            id: "verse",
            kind: "主歌",
            lines: ["雨滴落在屋檐", "你把伞移向我这边"],
          },
          {
            id: "chorus",
            kind: "副歌",
            lines: ["那天刚好下雨", "刚好遇见了你"],
          },
        ],
        hook: { sectionId: "chorus", startLine: 0, endLine: 2 },
        vocalPlan: [
          { sectionId: "verse", voice: "female" },
          { sectionId: "chorus", voice: "female" },
        ],
        musicPrompts: { suno: prompt, yourmusic: prompt },
        continuityNotes: "原创固定 fixture；不是模型生成，不推断正史",
      },
    };
  },
};
export function simulationMusic(): MusicAdapter {
  const adapter = new YourMusicAdapter({
    source: "fixture",
    credential: async () => "LOCAL_FIXTURE_NOT_A_KEY",
    request: async (r) => {
      if (r.binary)
        return {
          status: 200,
          headers: { "content-type": "audio/wav" },
          body: fixtureTone(),
        };
      if (r.method === "POST")
        return {
          status: 202,
          body: {
            task_id: randomUUID(),
            status: "pending",
            songs: [
              { id: randomUUID(), status: "pending" },
              { id: randomUUID(), status: "pending" },
            ],
          },
        };
      const ids = new URL(r.url).searchParams.get("songid")!.split(",");
      return {
        status: 200,
        body: ids.map((id) => ({
          id,
          status: "succeeded",
          audio_url: "https://oss.yourmusic.fun/fixture/" + id + ".wav",
        })),
      };
    },
  });
  return {
    source: "fixture",
    capabilities: adapter.capabilities,
    submit: async (i) => {
      const r = await adapter.submit(i);
      return r.state === "accepted"
        ? {
            ...r,
            actualCost: 2,
            evidenceId: "FIXTURE_INVOICE:" + i.operationId,
          }
        : r;
    },
    query: (ids) => adapter.query(ids),
    download: (url) => adapter.download(url),
  };
}
