import {z} from 'zod';
import type {Repository,Row} from './database';
const sha=z.string().regex(/^[a-f0-9]{64}$/);
export const ExternalTmeReceiptSchema=z.object({source:z.literal('official'),state:z.enum(['reviewing','rejected','published']),workId:z.uuid(),title:z.string().min(1),artistName:z.string().min(1),audioSha256:sha,externalSongRecordId:z.string().regex(/^[1-9]\d{4,19}$/),albumId:z.string().regex(/^[1-9]\d{0,19}$/),albumTitle:z.string().min(1),acceptedAt:z.iso.datetime({offset:true}),termsSha256:sha,explicitUserConsentAt:z.iso.datetime({offset:true}),submittedAt:z.iso.datetime({offset:true}),observedAt:z.iso.datetime({offset:true}),officialStatusText:z.string().min(1),sourceUrl:z.string().url().refine(v=>new URL(v).origin==='https://y.tencentmusic.com'),subjectHash:sha.optional(),submittedAtSource:z.enum(['official','local-observation']).optional(),readOnlyEvidenceHash:sha.optional(),platformStatusText:z.string().max(1000).optional(),officialPublishedAtText:z.string().max(100).optional()});
export function* externalTmeReceipts(repo:Repository){
 for(const r of repo.all('settings').filter(r=>r.id.startsWith('external-publication:tme:'))){
  const parsed=ExternalTmeReceiptSchema.safeParse(r.value);if(!parsed.success)continue;const value=parsed.data;
  if(r.id!=='external-publication:tme:'+value.workId)continue;
  yield value;
 }
}
export function externalTmeReceipt(repo:Repository,workId:string,audioSha?:string|null){
 for(const receipt of externalTmeReceipts(repo)){
  if(receipt.workId===workId||audioSha&&receipt.audioSha256===audioSha)return receipt;
 }
 return null;
}
export function externalTmePublicJob(receipt:NonNullable<ReturnType<typeof externalTmeReceipt>>){
 return{id:receipt.workId,workId:receipt.workId,state:receipt.state,revision:1,remoteId:receipt.externalSongRecordId,title:receipt.title,artistName:receipt.artistName,termsAccepted:true,termsHash:receipt.termsSha256,externalReceipt:true,submissionByClient:false,receipt:{source:'official-tencent-review-record',entityType:'song',remoteId:receipt.externalSongRecordId,title:receipt.title,artistName:receipt.artistName,status:receipt.state,submittedAt:receipt.submittedAt,observedAt:receipt.observedAt,submittedAtSource:receipt.submittedAtSource??'local-observation',url:receipt.sourceUrl,...(receipt.platformStatusText?{platformStatusText:receipt.platformStatusText,officialPublishedAtText:receipt.officialPublishedAtText}:{})},reason:'OFFICIAL_RECORD_ALREADY_EXISTS'};
}
/** Main-only observations can update the same record; an album ID is never accepted as a song ID. */
export function recordExternalTmeObservation(repo:Repository,raw:unknown){
 const receipt=ExternalTmeReceiptSchema.parse(raw),old=externalTmeReceipt(repo,receipt.workId);
 if(!old||!old.subjectHash||old.subjectHash!==receipt.subjectHash)throw Error('EXTERNAL_RECEIPT_SCOPE');
 for(const key of ['externalSongRecordId','albumId','albumTitle','artistName','audioSha256','title','acceptedAt','termsSha256','explicitUserConsentAt','submittedAt'] as const)if(old[key]!==receipt[key])throw Error('EXTERNAL_RECEIPT_SCOPE');
 if(receipt.externalSongRecordId===receipt.albumId)throw Error('SONG_RECORD_ID_REQUIRED');
 if(Date.parse(receipt.observedAt)<Date.parse(old.observedAt))throw Error('STALE_OFFICIAL_RECEIPT');
 repo.save('settings',{id:'external-publication:tme:'+receipt.workId,value:{...old,...receipt}});return externalTmePublicJob(receipt);
}
