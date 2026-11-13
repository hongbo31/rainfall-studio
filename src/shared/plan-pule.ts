import {z} from 'zod';
import {cleanLyricText} from './tme-lyrics';

export const planPuleScope=z.strictObject({
  runId:z.uuid(),
  itemId:z.string().min(1).max(500),
  stage:z.enum(['music_submit','music_assets']),
});
export const planPuleAttempt=planPuleScope.extend({attemptId:z.string().min(1).max(500)});
export const planPuleReceipt=z.strictObject({
  trackingId:z.string().min(1).max(200).optional(),
  songIds:z.array(z.string().min(1).max(200)).length(2).refine(ids=>new Set(ids).size===2),
});
export type PlanPuleTask=z.infer<typeof planPuleScope>;
export type PlanPuleReceipt=z.infer<typeof planPuleReceipt>;

export function planPuleReleaseIndex(songs:ReadonlyArray<{title?:string;lyrics?:string}|null>,instrumental=false){
  return songs.findIndex(song=>{
    if(instrumental)return !!song&&!cleanLyricText(song.lyrics??'').cleaned.trim();
    const title=song?.title?.trim();
    return !!title&&Array.from(title).length<=40&&!!song?.lyrics&&!!cleanLyricText(song.lyrics).cleaned.trim();
  });
}
