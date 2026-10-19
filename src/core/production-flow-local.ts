import { randomUUID } from "node:crypto";
import { parseDraft, type CreativeDraft } from "../shared/creation";
import { PairSchema } from "./quality/contracts";
import { pairHash } from "./quality/scoring";
import type { Row } from "./database";

export function localFlowDraft(
  plan: Row,
  artist: Row,
  previous?: CreativeDraft,
): CreativeDraft {
  if (previous) {
    const d = parseDraft(previous);
    if (d.instrumental)
      return parseDraft({
        ...d,
        continuityNotes:
          d.continuityNotes +
          " Local instrumental revision; no lyric sections added.",
      });
    const extra = {
      id: "local-revision-" + randomUUID(),
      kind: "Verse",
      lines: [
        `把${plan.theme}轻轻写在纸上`,
        "让未说出口的话慢慢有了回响",
        "门边的灯仍照着归来的方向",
        "这一刻的平常也值得被收藏",
      ],
    };
    return parseDraft({
      ...d,
      sections: [...d.sections, extra],
      vocalPlan: d.instrumental
        ? []
        : [...d.vocalPlan, { sectionId: extra.id, voice: "male" }],
    });
  }
  if (plan.template) return parseDraft(plan.template);
  const prompt = {
    positiveStyle:
      String(artist.defaults?.genre ?? "acoustic pop") +
      ", original melody, warm vocal, unhurried arrangement",
    negativeStyle: "",
    durationTarget: 180,
    voiceArrangement: "male",
  };
  return parseDraft({
    title: plan.title,
    topic: plan.theme,
    storyBeat: plan.theme,
    language: String(artist.defaults?.language ?? "Chinese"),
    style: String(artist.defaults?.genre ?? "acoustic pop"),
    instrumental: false,
    sections: [
      {
        id: "verse",
        kind: "Verse",
        lines: [
          `把${plan.theme}轻轻写在纸上`,
          "窗边的风吹过安静的走廊",
          "脚步慢下来才听见自己的愿望",
          "一盏灯陪着夜色慢慢变亮",
        ],
      },
      {
        id: "chorus",
        kind: "Chorus",
        lines: [
          "把今天的平常认真收藏",
          "让心里的话有一个方向",
          "走过的路会留下温柔回响",
          "明天醒来仍愿意抬头看光",
        ],
      },
    ],
    hook: { sectionId: "chorus", startLine: 0, endLine: 4 },
    vocalPlan: [
      { sectionId: "verse", voice: "male" },
      { sectionId: "chorus", voice: "male" },
    ],
    musicPrompts: { suno: prompt, yourmusic: prompt },
    continuityNotes: "本地固定模板与规则组合；未调用模型，不代表AI生成。",
  });
}
export function flowCandidate(
  run: Row,
  draftInput: unknown,
  source: "local_template" | "deepseek-api" | "local-inbox",
  provenance: Row = {},
) {
  const draft = parseDraft(draftInput),
    id = randomUUID(),
    lyrics = draft.sections
      .map((s) => `[${s.kind}]\n${s.lines.join("\n")}`)
      .join("\n\n");
  const pair = PairSchema.parse({
    attemptId: run.id,
    revisionId: id,
    parentRevisionId: run.candidate?.id ?? null,
    lyrics,
    musicPrompt: draft.musicPrompts.yourmusic.positiveStyle,
    intent: run.plan.theme,
    language: draft.language,
    style: draft.style,
    generator: {
      modelId:
        source === "local_template"
          ? "local_template"
          : provenance.providerModel,
      modelVersion:
        source === "local_template"
          ? "local-template-v1"
          : provenance.providerModel,
      promptVersion:
        source === "local_template"
          ? "local-template-v1"
          : source === "local-inbox"
            ? provenance.promptVersion
            : "deepseek-creative-json-v1",
    },
    lockedSpans: [],
    capability: {
      version: "music-target-unverified-v1",
      verified: false,
      lengthUnit: null,
      limits: {},
      requiredFields: draft.instrumental
        ? ["musicPrompt"]
        : ["lyrics", "musicPrompt"],
    },
  });
  return {
    id,
    source,
    method:
      source === "local_template"
        ? "rule_based"
        : source === "local-inbox"
          ? "imported"
          : "model",
    revision: run.revisionCount,
    parentCandidateId: run.candidate?.id ?? null,
    draft,
    pair,
    pairHash: pairHash(pair),
    provenance,
  };
}
export function localFlowScore(candidate: Row, threshold: number) {
  const d = parseDraft(candidate.draft),
    lines = d.sections.flatMap((s) => s.lines).filter((s) => s.trim());
  const placeholder = /\{\{(?:WRITE_LYRICS_HERE|WRITE_PROMPT_HERE)\}\}/.test(
    candidate.pair.lyrics + "\n" + candidate.pair.musicPrompt,
  );
  const overall = placeholder
    ? 0
    : (d.instrumental || lines.length >= 8 ? 40 : lines.length >= 4 ? 25 : 10) +
      (candidate.pair.musicPrompt.trim() ? 20 : 0) +
      (d.instrumental || d.hook ? 20 : 0) +
      20;
  return {
    revisionId: candidate.id,
    method: "rule_based",
    source: "rule_based",
    overall,
    threshold,
    passed: overall >= threshold && !placeholder,
    findings: [
      placeholder
        ? "本地检查发现占位符。"
        : `本地结构规则：${lines.length}行、风格提示与段落引用检查；不代表模型或人工质量评分。`,
    ],
  };
}
