import fs from 'node:fs';
import path from 'node:path';
import {ExternalTmeReceiptSchema} from '../../core/external-tme-receipt';
const directory=(root:string)=>path.join(root,'production','tme-external-receipts');
/** Legacy evidence blocks a retry even before its account binding has been re-established. */
export function persistExternalReceiptStop(root:string,raw:unknown){
 const receipt=ExternalTmeReceiptSchema.parse(raw),dir=directory(root);fs.mkdirSync(dir,{recursive:true});
 if(fs.lstatSync(dir).isSymbolicLink())throw Error('RECEIPT_BARRIER_PATH');
 const file=path.join(dir,receipt.audioSha256+'.stop.json');
 if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify({workId:receipt.workId,audioSha256:receipt.audioSha256,songId:receipt.externalSongRecordId,stopOnly:true}),{flag:'wx'});
 return file;
}
/** Independent of SQLite so restoring an old database cannot replay this recording's upload. */
export function persistExternalReceiptBarrier(root:string,raw:unknown){
 const receipt=ExternalTmeReceiptSchema.parse(raw);if(!receipt.subjectHash)throw Error('EXTERNAL_RECEIPT_ACCOUNT_BINDING_REQUIRED');
 const dir=directory(root);fs.mkdirSync(dir,{recursive:true});if(fs.lstatSync(dir).isSymbolicLink())throw Error('RECEIPT_BARRIER_PATH');
 const file=path.join(dir,receipt.audioSha256+'.json');
 if(fs.existsSync(file)){
  if(fs.lstatSync(file).isSymbolicLink())throw Error('RECEIPT_BARRIER_PATH');
  const old=ExternalTmeReceiptSchema.parse(JSON.parse(fs.readFileSync(file,'utf8')));
  for(const key of ['workId','audioSha256','externalSongRecordId','albumId','title','artistName','subjectHash','termsSha256'] as const)if(old[key]!==receipt[key])throw Error('EXTERNAL_RECEIPT_SCOPE');
  return file;
 }
 fs.writeFileSync(file,JSON.stringify(receipt,null,2),{flag:'wx'});return file;
}
export function externalReceiptBarrier(root:string,task:{audioSha?:string|null}){
 if(!/^[a-f0-9]{64}$/.test(task.audioSha??''))return null;
 const dir=directory(root),file=path.join(dir,task.audioSha+'.json');
 const stop=path.join(dir,task.audioSha+'.stop.json');
 if(!fs.existsSync(file)){
  if(!fs.existsSync(stop))return null;
  try{if(fs.lstatSync(dir).isSymbolicLink()||fs.lstatSync(stop).isSymbolicLink())throw Error();const value=JSON.parse(fs.readFileSync(stop,'utf8'));if(value.stopOnly!==true||value.audioSha256!==task.audioSha||!/^[1-9]\d{4,19}$/.test(value.songId??''))throw Error();return{reason:'OFFICIAL_RECORD_ALREADY_EXISTS',songId:value.songId}}catch{return{reason:'SUBMISSION_DURABLE_BARRIER_UNREADABLE'}}
 }
 // Even corrupt evidence remains a stop signal. It must never authorize an automatic retry.
 try{if(fs.lstatSync(dir).isSymbolicLink()||fs.lstatSync(file).isSymbolicLink())throw Error();const receipt=ExternalTmeReceiptSchema.parse(JSON.parse(fs.readFileSync(file,'utf8')));if(receipt.audioSha256!==task.audioSha||!receipt.subjectHash)throw Error();return{reason:'OFFICIAL_RECORD_ALREADY_EXISTS',songId:receipt.externalSongRecordId}}
 catch{return{reason:'SUBMISSION_DURABLE_BARRIER_UNREADABLE'}}
}
