import {z} from 'zod';
import {cleanLyricText} from './tme-lyrics';

export const planPuleScope=z.strictObject({
  runId:z.uuid(),
  itemId:z.string().min(1).max(500),
  stage:z.enum(['music_submit','music_assets']),
});
export const planPuleAttempt=planPuleScope.extend({attemptId:z.string().min(1).max(500)});
const wavHash = z.string().regex(/^[a-f0-9]{64}$/u).nullable();
export const planPuleReceipt=z.strictObject({
  trackingId:z.string().min(1).max(200).optional(),
  songIds:z.array(z.string().min(1).max(200)).length(2).refine(ids=>new Set(ids).size===2),
  sunoWavs:z.strictObject({ requestId: z.uuid(), sha256: z.tuple([wavHash, wavHash]) }).optional(),
}).refine(receipt => !receipt.sunoWavs || (
  receipt.trackingId === "suno-cn:" + receipt.sunoWavs.requestId &&
  receipt.songIds[0] === receipt.sunoWavs.requestId + ":A" && receipt.songIds[1] === receipt.sunoWavs.requestId + ":B" &&
  receipt.sunoWavs.sha256.some(Boolean)
));
export type PlanPuleTask=z.infer<typeof planPuleScope>;
export type PlanPuleReceipt=z.infer<typeof planPuleReceipt>;
export type PlanPuleCustomDraft={title:string;alternateTitle?:string;lyrics:string;style:string;instrumental:boolean;duration:number;vocalGender?:'male'|'female'};
export type PlanPuleRetention = { kind: 'single'; preferredIndex: 0 | 1 } | { kind: 'pair' };
export const puleCustomLyricsLimit = 5_000;
export {puleAudioMaxBytes as planPuleAudioLimit} from './pule-browser';

export const planPuleHistoryMatch=z.array(z.strictObject({
  id:z.string().min(1).max(200),createdAt:z.iso.datetime({offset:true}),
})).length(2).refine(songs=>songs[0].id!==songs[1].id&&Math.abs(Date.parse(songs[0].createdAt)-Date.parse(songs[1].createdAt))<=10000);
export type PlanPuleHistoryMatch=z.infer<typeof planPuleHistoryMatch>;
export const puleSubmissionText=(value:string)=>value.replace(/\r\n?/gu,'\n').trim();
export function withinPuleSubmissionWindow(submittedAt:string,createdAt:string) {
  const elapsed=Date.parse(createdAt)-Date.parse(submittedAt);
  // The provider clock can drift slightly. Allow up to five minutes for delayed creation.
  return elapsed>=-5000&&elapsed<=300000;
}

export function planPuleReleaseIndex(songs:ReadonlyArray<{title?:string|null;lyrics?:string}|null>,mode:boolean|'provided'=false){
  return songs.findIndex(song=>{
    if(mode==='provided')return !!song;
    if(mode)return !!song&&!cleanLyricText(song.lyrics??'').cleaned.trim();
    const title=song?.title?.trim();
    return !!title&&Array.from(title).length<=40&&!!song?.lyrics&&!!cleanLyricText(song.lyrics).cleaned.trim();
  });
}
