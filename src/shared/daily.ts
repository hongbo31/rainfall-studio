import { z } from "zod";
const amount = z.number().int().nonnegative().max(1000000).nullable();
export const DailyPlanInputSchema = z.strictObject({
  id: z.uuid(),
  artistId: z.uuid(),
  seriesId: z.uuid().nullable(),
  timezone: z
    .string()
    .max(100)
    .refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }),
  localTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  candidateLimit: z.number().int().min(0).max(100).nullable(),
  textBudget: amount,
  musicBudget: amount,
  textProfileId: z.uuid().nullable(),
  musicProfileId: z.uuid().nullable(),
  missedPolicy: z.enum(["skip", "bounded_catch_up"]),
  catchUpHours: z.number().int().min(1).max(168).nullable(),
  maxCatchUpPerDay: z.number().int().min(1).max(5).nullable(),
  enabled: z.literal(false),
  authorizationRevision: z.null(),
});
export const SelectionSchema = z.strictObject({
  requestId: z.uuid(),
  candidateId: z.uuid(),
  seriesId: z.uuid().nullable(),
  expectedSeriesRevision: z.number().int().nonnegative().nullable(),
});
