import { z } from "zod";

export const RULE_VERSION = "quality-v1";
export const dimensionIds = [
  "L1",
  "L2",
  "L3",
  "L4",
  "M1",
  "M2",
  "M3",
  "M4",
  "C1",
  "C2",
  "C3",
] as const;
export const groups = ["L", "M", "C"] as const;
export const DimensionIdSchema = z.enum(dimensionIds);
export const GroupSchema = z.enum(groups);
export const LevelSchema = z.number().int().min(0).max(4).nullable();
export type DimensionId = z.infer<typeof DimensionIdSchema>;
export type Group = z.infer<typeof GroupSchema>;
export type Level = z.infer<typeof LevelSchema>;
const text = z.string().min(1);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const cost = z.number().int().nonnegative().max(1_000_000_000);
export const SpanSchema = z.strictObject({
  field: z.enum(["lyrics", "musicPrompt", "intent"]),
  start: count,
  end: count,
  quote: z.string(),
});
export type Span = z.infer<typeof SpanSchema>;
export const ModelProfileSchema = z.strictObject({
  modelId: text,
  modelVersion: text,
  promptVersion: text,
});
export const CapabilitySchema = z.strictObject({
  version: text,
  verified: z.boolean(),
  lengthUnit: z.enum(["utf16", "codepoint"]).nullable(),
  limits: z.strictObject({
    lyrics: count.optional(),
    musicPrompt: count.optional(),
  }),
  requiredFields: z.array(
    z.enum(["lyrics", "musicPrompt", "intent", "language", "style"]),
  ),
});
export const PairSchema = z.strictObject({
  attemptId: text,
  revisionId: text,
  parentRevisionId: text.nullable(),
  lyrics: z.string(),
  musicPrompt: z.string(),
  intent: z.string(),
  language: text,
  style: text,
  generator: ModelProfileSchema,
  lockedSpans: z.array(SpanSchema),
  capability: CapabilitySchema,
});
export type Pair = z.infer<typeof PairSchema>;
export const FindingSchema = z.strictObject({
  id: text,
  defectKey: text,
  impact: text,
  suggestion: text,
  owner: DimensionIdSchema,
  evidence: z.array(SpanSchema),
  missingPath: text.optional(),
});
export const AssessmentSchema = z.strictObject({
  id: text,
  sessionId: text,
  contextHash: text,
  pairHash: text,
  ruleVersion: text,
  policyVersion: text,
  modelId: text,
  modelVersion: text,
  promptVersion: text,
  group: GroupSchema,
  levels: z.partialRecord(DimensionIdSchema, LevelSchema),
  findings: z.array(FindingSchema),
  confidence: z.number().min(0).max(1).nullable(),
  status: z.enum(["complete", "insufficient", "failed"]),
});
export type Assessment = z.infer<typeof AssessmentSchema>;
export const HardCheckSchema = z.strictObject({
  status: z.enum(["clear", "failed", "pending"]),
  issues: z.array(
    z.strictObject({
      code: text,
      evidence: z.array(SpanSchema),
      path: text.optional(),
    }),
  ),
});
export type HardCheck = z.infer<typeof HardCheckSchema>;
export const RuleEvidenceSchema = z.array(
  z.strictObject({
    code: z.enum([
      "empty",
      "truncated",
      "placeholder",
      "mandatory_violation",
      "contradiction",
    ]),
    certainty: z.enum(["confirmed", "suspected"]),
    evidence: z.array(SpanSchema),
    path: text.optional(),
  }),
);
export type RuleEvidence = z.infer<typeof RuleEvidenceSchema>;
export const ThresholdsSchema = z.strictObject({
  L: z.number().min(0).max(100),
  M: z.number().min(0).max(100),
  C: z.number().min(0).max(100),
  S: z.number().min(0).max(100),
});
export const defaultThresholds = { L: 75, M: 75, C: 80, S: 80 } as const;
export const CalibrationMinimumSchema = z.strictObject({
  calibration: count,
  positive: count,
  negative: count,
  validation: count,
});
export const CalibrationAcceptanceSchema = z.strictObject({
  hardFalseAcceptMax: z.number().min(0).max(1),
  falseAcceptMax: z.number().min(0).max(1),
  falseRejectMax: z.number().min(0).max(1),
});
export const PolicySchema = z.strictObject({
  version: text,
  thresholds: ThresholdsSchema,
  maxRevisions: z.literal(2),
  criticalDimensions: z.array(DimensionIdSchema).min(1).nullable(),
  borderlineBand: z.number().min(0).max(100).nullable(),
  minimumConfidence: z.number().min(0).max(1).nullable(),
  majorLevelGap: z.number().int().min(1).max(4).nullable(),
  majorScoreGap: z.number().min(0).max(100).nullable(),
  evaluationRetryLimit: z.union([z.literal(0), z.literal(1)]).nullable(),
  merge: z.literal("per_dimension_min").nullable(),
  calibrationMinimum: CalibrationMinimumSchema.nullable(),
  calibrationAcceptance: CalibrationAcceptanceSchema.nullable(),
  evaluatorProfile: z
    .strictObject({ primary: ModelProfileSchema, review: ModelProfileSchema })
    .nullable(),
  approvalRefs: z.record(z.string(), text),
  calibrationApprovalRef: text.nullable(),
});
export type Policy = z.infer<typeof PolicySchema>;
export const ScoresSchema = z.strictObject({
  L4: z.number().nullable(),
  M4: z.number().nullable(),
  C4: z.number().nullable(),
  S400: z.number().nullable(),
  L: z.number().nullable(),
  M: z.number().nullable(),
  C: z.number().nullable(),
  S: z.number().nullable(),
});
export type Scores = z.infer<typeof ScoresSchema>;
export const DecisionSchema = z.strictObject({
  state: z.enum(["shadow", "pending", "review", "revise", "manual", "pass"]),
  wouldPass: z.boolean().nullable(),
  canProceedToMusic: z.literal(false),
  reasons: z.array(text),
  scores: ScoresSchema,
});
export type Decision = z.infer<typeof DecisionSchema>;
export const DecisionInputSchema = z.strictObject({
  pair: PairSchema,
  policy: PolicySchema,
  hard: HardCheckSchema,
  primary: z.array(AssessmentSchema),
  review: z.array(AssessmentSchema).nullable(),
  reviewHard: HardCheckSchema.nullable(),
  revisionCount: z.number().int().min(0).max(2),
  costState: z.enum(["settled", "reserved", "unknown"]),
  expectedPairHash: text,
});
export type DecisionInput = z.infer<typeof DecisionInputSchema>;
export const effectKinds = [
  "evaluate_L",
  "evaluate_M",
  "evaluate_C",
  "review_L",
  "review_M",
  "review_C",
  "revise",
] as const;
export const EffectSchema = z.strictObject({
  key: text,
  kind: z.enum(effectKinds),
  pairHash: text,
  maxCost: cost,
});
export type Effect = z.infer<typeof EffectSchema>;
export const EffectResultSchema = z.strictObject({
  status: z.enum(["ok", "confirmed_unsent", "unknown", "failed"]),
  actualCost: cost.nullable(),
  assessment: AssessmentSchema.optional(),
  pair: PairSchema.optional(),
  hard: HardCheckSchema.optional(),
});
export type EffectResult = z.infer<typeof EffectResultSchema>;
export const FixtureScriptSchema = z.strictObject({
  kind: z.literal("fixture"),
  responses: z.record(z.string(), z.array(EffectResultSchema)),
  budgetLimit: cost,
  authorizedSendLimit: count,
  maxCosts: z.record(z.enum(effectKinds), cost),
});
export type FixtureScript = z.infer<typeof FixtureScriptSchema>;
export const JournalEventSchema = z.strictObject({
  eventKey: text,
  type: z.enum([
    "reserve",
    "dispatch",
    "settle",
    "freeze",
    "result",
    "revision",
    "decision",
  ]),
  operationKey: text,
  payload: z.unknown(),
});
export type JournalEvent = z.infer<typeof JournalEventSchema>;
export interface Journal {
  append(event: JournalEvent): void;
  read(): JournalEvent[];
  close(): void;
}
export type RunReport = {
  decision: Decision;
  pairs: Pair[];
  events: JournalEvent[];
  spent: number;
  reserved: number;
  frozen: boolean;
};
export const CalibrationRowSchema = z
  .strictObject({
    id: text,
    split: z.enum(["calibration", "validation"]),
    language: text,
    style: text,
    human: z.enum(["pass", "fail", "disputed"]),
    humanHardFailure: z.boolean(),
    predicted: z.enum(["pass", "fail", "pending", "shadow"]),
    labelSource: z.enum(["synthetic", "human"]),
    ruleVersion: text,
    policyVersion: text,
  })
  .refine(
    (r) => !(r.humanHardFailure && r.human === "pass"),
    "HUMAN_LABEL_CONFLICT",
  );
export type CalibrationRow = z.infer<typeof CalibrationRowSchema>;
export const CalibrationConfigSchema = z.strictObject({
  ruleVersion: text,
  policyVersion: text,
  minimum: CalibrationMinimumSchema,
  targets: z.array(z.strictObject({ language: text, style: text })),
  acceptance: CalibrationAcceptanceSchema,
});
export type CalibrationConfig = z.infer<typeof CalibrationConfigSchema>;

export const rubric = [
  {
    id: "L1",
    weight: 30,
    name: "主题情绪",
    anchors: [
      "核心叙述/态度与明确主题相反且无意图依据",
      "多处偏题或情绪转向无缘由",
      "主题可辨但关键转折动机薄弱",
      "主题明确，情绪转变有文字铺垫",
      "关键意象、细节与转折共同支撑意图，无无故偏离",
    ],
  },
  {
    id: "L2",
    weight: 25,
    name: "语言表达",
    anchors: [
      "核心句无法理解或语义自毁",
      "多处指代/措辞使主要意思难懂",
      "大意可懂，局部套话或歧义削弱表达",
      "表达自然准确，意象与视角基本一致",
      "用语精确且有具体辨识度，留白/反讽也有可解释线索",
    ],
  },
  {
    id: "L3",
    weight: 25,
    name: "文本可唱性",
    anchors: [
      "关键句的文字组织明显无法承载指定唱法",
      "多处重音、语序或呼吸分组障碍",
      "部分句群需调整才支持指定唱法",
      "主要句群可合理分句，密度/重音支持意图",
      "语音节奏与措辞配合稳定，密集/稀疏处理有目的且可说明",
    ],
  },
  {
    id: "L4",
    weight: 20,
    name: "结构记忆点",
    anchors: [
      "展开关系无法辨认且没有可指认的核心动机",
      "段落/意象堆叠，重复无推进",
      "有主线或动机但回收、变化较弱",
      "展开清楚，有符合风格的核心句/动机",
      "变化与回收强化核心，精简或非重复形式也有明确记忆设计",
    ],
  },
  {
    id: "M1",
    weight: 30,
    name: "音乐方向",
    anchors: [
      "核心音乐方向无法辨认或互相抵消",
      "泛泛堆词，无法判断主要声音",
      "大体方向清楚，重要层次含糊",
      "主要风格/音色/空间等足够定位目标",
      "少量准确指令形成稳定方向，关键优先级清楚",
    ],
  },
  {
    id: "M2",
    weight: 30,
    name: "必要演唱编配可执行性",
    anchors: [
      "已知能力无法实现核心要求或核心指令互斥",
      "必要角色/编配关系多处不可执行",
      "关键角色大致明确，仍有执行歧义",
      "必要演唱/编配安排明确且符合已验证能力",
      "角色进入、重点与约束表达精确，未强加无关参数",
    ],
  },
  {
    id: "M3",
    weight: 20,
    name: "情绪能量",
    anchors: [
      "指示的情绪能量违背明确目标且无解释",
      "大段情绪/动态指令冲突或失焦",
      "主要情绪可辨，变化/强弱缺依据",
      "情绪与能量轨迹支撑目标",
      "动态转折、克制或对比有明确作用与可执行提示",
    ],
  },
  {
    id: "M4",
    weight: 20,
    name: "信息效率兼容性",
    anchors: [
      "核心信息无法解析或超已验证硬限制",
      "冗余/歧义掩盖主要指令",
      "有重复或次要不兼容表达，主旨尚清楚",
      "信息清楚精炼，格式在目标能力内",
      "必要信息完整且层次清楚，无无效堆叠；更短本身不加分",
    ],
  },
  {
    id: "C1",
    weight: 40,
    name: "情绪配合",
    anchors: [
      "歌词与音乐情绪互相抵消且无意图依据",
      "主要段落错配，削弱明确意图",
      "部分配合，局部转折未呼应",
      "情绪呼应或有意反差可解释",
      "呼应/反差贯穿关键段落并增强明确叙事目的",
    ],
  },
  {
    id: "C2",
    weight: 35,
    name: "文字密度与唱法",
    anchors: [
      "核心文字密度与必要唱法不可调和",
      "多段密度/吐字要求明显冲突",
      "局部密度或停顿安排尚不稳",
      "密度、分句与唱法大体相容",
      "稀密变化、停顿和唱法共同服务表达，依据为文本而非虚构音频",
    ],
  },
  {
    id: "C3",
    weight: 25,
    name: "段落配合",
    anchors: [
      "关键段落关系与编配进入顺序互相冲突",
      "多处进入/高潮/收束与文字功能脱节",
      "大体配合，少数段落功能未落实",
      "关键段落、高潮或收束与编配意图相配",
      "配合精确且有变化，非传统结构同样能说明每个转换目的",
    ],
  },
] as const;
