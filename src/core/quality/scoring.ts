import { createHash } from "node:crypto";
import { z } from "zod";
import {
  dimensionIds,
  LevelSchema,
  PairSchema,
  ScoresSchema,
  ThresholdsSchema,
  defaultThresholds,
  rubric,
  type DimensionId,
  type Level,
  type Pair,
  type Policy,
  type Scores,
} from "./contracts";

export function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  )
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ":" +
            canonical((value as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  throw Error("NON_JSON_VALUE");
}
export const hashValue = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export const pairHash = (pair: Pair) => hashValue(PairSchema.parse(pair));
const levelsSchema = z.record(z.enum(dimensionIds), LevelSchema);
export function score(input: Record<DimensionId, Level>): Scores {
  const levels = levelsSchema.parse(input);
  const subtotal = (prefix: string) => {
    const dims = rubric.filter((d) => d.id.startsWith(prefix));
    return dims.some((d) => levels[d.id] === null)
      ? null
      : dims.reduce((s, d) => s + d.weight * levels[d.id]!, 0);
  };
  const L4 = subtotal("L"),
    M4 = subtotal("M"),
    C4 = subtotal("C");
  const S400 =
    L4 === null || M4 === null || C4 === null
      ? null
      : 50 * L4 + 35 * M4 + 15 * C4;
  return {
    L4,
    M4,
    C4,
    S400,
    L: L4 === null ? null : L4 / 4,
    M: M4 === null ? null : M4 / 4,
    C: C4 === null ? null : C4 / 4,
    S: S400 === null ? null : S400 / 400,
  };
}
export function meetsThresholds(
  input: Scores,
  thresholds: Policy["thresholds"] = defaultThresholds,
): boolean | null {
  const s = ScoresSchema.parse(input),
    t = ThresholdsSchema.parse(thresholds);
  return s.L4 === null || s.M4 === null || s.C4 === null || s.S400 === null
    ? null
    : s.L4 >= t.L * 4 &&
        s.M4 >= t.M * 4 &&
        s.C4 >= t.C * 4 &&
        s.S400 >= t.S * 400;
}
