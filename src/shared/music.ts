import { z } from "zod";
export const MusicRequestSchema = z.strictObject({
  requestId: z.uuid(),
  draftId: z.uuid(),
  expectedPairHash: z.string().regex(/^[a-f0-9]{64}$/),
  accountRef: z.string().min(1).max(100),
  modelId: z.string().min(1).max(200),
  candidateLimit: z.number().int().min(0).max(100),
  budgetLimit: z.number().int().min(0).max(1000000),
});
