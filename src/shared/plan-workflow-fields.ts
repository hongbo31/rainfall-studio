import { z } from "zod";
import { imageChoiceSchema } from "./platform-image";

export const browserMusicProviders = {
  yourmusic: { label: "谱乐 AI", route: "pule_browser" },
  suno_cn: { label: "苏诺之音", route: "suno_cn_browser" },
} as const;
export type BrowserMusicProvider = keyof typeof browserMusicProviders;
export function browserMusicProvider(value: string | undefined): BrowserMusicProvider | undefined {
  return value && Object.hasOwn(browserMusicProviders, value) ? value as BrowserMusicProvider : undefined;
}

const lyricField = z.enum(["title", "alternateTitle", "style", "lyrics"]);
export const workflowLyricFields: Record<z.infer<typeof lyricField>, string> = {
  title: "歌名一",
  alternateTitle: "歌名二",
  style: "风格描述",
  lyrics: "歌词",
};

export const WorkflowPuleSchema = z.strictObject({
  accountId: z.uuid().optional(),
  inputs: z.strictObject({
    title: lyricField.optional(),
    alternateTitle: lyricField.optional(),
    style: lyricField.optional(),
    lyrics: lyricField.optional(),
  }),
});
export type WorkflowPule = z.infer<typeof WorkflowPuleSchema>;

export const WorkflowBrowserMusicSchema = WorkflowPuleSchema.extend({
  provider: z.enum(Object.keys(browserMusicProviders) as BrowserMusicProvider[]),
  coverImage: imageChoiceSchema.partial({ profileId: true, modelId: true }).optional(),
});
export type WorkflowBrowserMusic = z.infer<typeof WorkflowBrowserMusicSchema>;

export function workflowBrowserMusic(workflow?: { browserMusic?: WorkflowBrowserMusic; pule?: WorkflowPule }): WorkflowBrowserMusic | undefined {
  return workflow?.browserMusic ?? (workflow?.pule && { ...workflow.pule, provider: "yourmusic" });
}

export function workflowPuleInputsComplete(inputs: WorkflowPule["inputs"], instrumental: boolean) {
  if (!inputs.title || !inputs.style) return false;
  return instrumental ? !inputs.lyrics && !Object.values(inputs).includes("lyrics") : !!inputs.lyrics;
}

export function withoutWorkflowLyrics(inputs: WorkflowPule["inputs"]): WorkflowPule["inputs"] {
  const entries = Object.entries(inputs);
  const instrumental = entries.filter(([field, source]) => field !== "lyrics" && source !== "lyrics");
  return instrumental.length === entries.length ? inputs : Object.fromEntries(instrumental);
}
