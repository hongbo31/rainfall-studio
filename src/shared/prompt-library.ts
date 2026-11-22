import { z } from "zod";

export const promptContentLimit = 50_000;
export const promptContentLength = (content: string) => Array.from(content).length;

const identity = z.strictObject({ id: z.uuid() });
const revision = z.number().int().positive();
const savePrompt = identity.extend({
  name: z.string().trim().min(1, "请输入提示词名称"),
  content: z.string()
    .refine(content => content.trim().length > 0, "请输入提示词内容")
    .refine(content => promptContentLength(content) <= promptContentLimit, "提示词内容最多 50,000 字"),
  expectedRevision: revision.nullable(),
});
const deletePrompt = identity.extend({ expectedRevision: revision });

export const promptLibrarySchemas = {
  "promptLibrary.list": z.strictObject({ query: z.string().trim().optional() }),
  "promptLibrary.get": identity,
  "promptLibrary.save": savePrompt,
  "promptLibrary.delete": deletePrompt,
};

export type SavePrompt = z.infer<typeof savePrompt>;
export type DeletePrompt = z.infer<typeof deletePrompt>;
export type PromptSummary = { id: string; name: string; revision: number; updatedAt: string };
export type SavedPrompt = PromptSummary & { content: string };
