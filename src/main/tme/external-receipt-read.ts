import type {Page} from 'playwright-core';
import {createHash} from 'node:crypto';
import {tmeAiSubjectHash} from '../../shared/tme-ai-prepare';
import {readFreshOfficialAccount,readOfficialPendingSongs,readOfficialReleasedSong} from './official-browser-read';

type Options={page:Page;account?:typeof readFreshOfficialAccount;songs?:typeof readOfficialPendingSongs;releasedSong?:typeof readOfficialReleasedSong};
/** Read-only recovery: an old receipt must already be bound to the independently verified account. */
export function createExternalTmeReceiptReader(o:Options){
 return async(context:any)=>{
  if(context?.source!=='official'||!context.workId||!/^[a-f0-9]{64}$/.test(context.subjectHash??'')||!context.title||!context.albumTitle||!context.artistName||!/^[1-9]\d{4,19}$/.test(context.externalSongRecordId??'')||context.externalSongRecordId===context.albumId)throw Error('EXTERNAL_RECEIPT_ACCOUNT_BINDING_REQUIRED');
  const primaryUrl=o.page.url();
  const identity=await(o.account??readFreshOfficialAccount)(o.page,{expectedSubjectHash:context.subjectHash});
  if(tmeAiSubjectHash(identity)!==context.subjectHash||identity.artistName!==context.artistName)throw Error('ACCOUNT_CHANGED');
  const list=await(o.songs??readOfficialPendingSongs)(o.page);
  const matches=list.rows.filter(r=>r.id===context.externalSongRecordId&&r.name===context.title&&r.albumId===context.albumId&&r.albumName===context.albumTitle);
  let released:Awaited<ReturnType<typeof readOfficialReleasedSong>>|undefined;
  if(matches.length===0)released=await(o.releasedSong??readOfficialReleasedSong)(o.page,{id:context.externalSongRecordId,name:context.title,albumId:context.albumId,albumName:context.albumTitle,artistName:context.artistName});
  if(matches.length>1||matches.length===0&&!released)throw Error('OFFICIAL_RECEIPT_SCOPE');
  // Recheck the full identity after observing the list. Neither step changes the primary editor.
  const after=await(o.account??readFreshOfficialAccount)(o.page,{expectedSubjectHash:context.subjectHash});
  if(tmeAiSubjectHash(after)!==context.subjectHash||o.page.url()!==primaryUrl)throw Error('ACCOUNT_CHANGED');
  const row=released?.row??matches[0],officialStatusText=released?.row.officialStatusText??{reviewing:'审核中',rejected:'审核未通过',published:'已发布'}[row.status],url=released?.url??list.url;
  return{...context,state:row.status,officialStatusText,observedAt:row.observedAt,sourceUrl:url,...(released?{platformStatusText:released.row.platformStatusText,officialPublishedAtText:released.row.officialPublishedAtText}:{}),submittedAtSource:context.submittedAtSource??'local-observation',readOnlyEvidenceHash:createHash('sha256').update(JSON.stringify({subjectHash:context.subjectHash,row,url})).digest('hex')};
 };
}
