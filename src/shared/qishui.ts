import { z } from "zod";
import { maxPublicationWorks } from "./platform-config";

export const qishuiOrigin = "https://music.douyin.com";
export const qishuiPublishUrl = qishuiOrigin + "/console/publish?source=nav";
export const QishuiReleaseSchema = z.strictObject({
  accountId: z.uuid(),
  workIds: z.array(z.uuid()).min(1).max(maxPublicationWorks),
});
export type QishuiSessionState = "closed" | "login_required" | "release_page" | "release_form" | "unverified";

export const QishuiFillSchema = z.strictObject({
  accountId:z.uuid(), workId:z.uuid(), variant:z.enum(['A','B']),
  performer:z.string().trim().min(1).max(100),
  lyricist:z.string().trim().min(1).max(100),
  composer:z.string().trim().min(1).max(100),
  ai:z.boolean(), aiTool:z.enum(['Suno','Udio','天音','海绵音乐','腾讯启明星','天工AI','Mureka','其他']),
});
export type QishuiFillInput=z.infer<typeof QishuiFillSchema>;
export const QishuiJobSchema=z.strictObject({accountId:z.uuid(),workId:z.uuid()});
export const QishuiAuthorizationSchema=QishuiJobSchema.extend({mode:z.enum(['exclusive_agency','exclusive','nonexclusive'])});
export const QishuiAcceptSchema=QishuiJobSchema.extend({reviewToken:z.uuid(),contractHash:z.string().regex(/^[a-f0-9]{64}$/),confirmed:z.literal(true)});
export type QishuiJobStage='prepared'|'running'|'form_ready'|'authorization'|'contract_review'|'verification_required'|'unknown';
export type QishuiMaterial={file:string;sha256:string;bytes:number};
export type QishuiWorkSource={workId:string;artistId:string;title:string;lyrics:string;instrumental:boolean;audio:QishuiMaterial;cover:QishuiMaterial;fingerprint:string};
