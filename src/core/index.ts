import {executeUnifiedPublication} from "./unified-publication-integration";
import { materialEntries } from "./materials";
export { materialEntries };
export { probe, ffmpeg, ffprobe } from "./assets";
import { Studio } from "./studio";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { zip } from "./backup";
import { exportCover } from "./assets";
import { hash } from "./database";
import {stageLiveMusic,liveMusicContext,materializeLiveMusic} from './live-music';
import type {MusicAdapter} from './workflow/yourmusic';
import {ProductionFlowSchemas} from '../shared/production-flow';
import {importProductionAudio} from './production-integration';
import {executeTmeAiPrepare} from './tme-ai-prepare-integration';
import {executeTmeAiSubmission} from './tme-ai-submission-integration';
export { Studio };
export { resolveQuickPublish } from '../shared/quick-publish';
export {stageLiveMusic,liveMusicContext,materializeLiveMusic};
export { TmeDraftService, cleanTmeLyrics } from './tme-drafts';
export { listApiProfiles, saveApiProfile } from "./api-profiles";

export function previewLegacy(file: string) {
  if (fs.statSync(file).size > 50 * 1024 * 1024) throw Error("LEGACY_LIMIT");
  const body = fs.readFileSync(file, "utf8"),
    data = JSON.parse(body),
    rows = data.works || data.state?.works;
  if (!Array.isArray(rows) || rows.length > 10000) throw Error("LEGACY_SCHEMA");
  for (const w of rows) {
    if (
      !w ||
      typeof w.title !== "string" ||
      !w.title.trim() ||
      w.title.length > 200
    )
      throw Error("LEGACY_SCHEMA");
    for (const [field, max] of Object.entries({
      story: 20000,
      lyrics: 100000,
      prompt: 100000,
      rights: 4000,
    }))
      if (
        w[field] !== undefined &&
        (typeof w[field] !== "string" || w[field].length > max)
      )
        throw Error("LEGACY_SCHEMA");
    if (
      typeof w.cover === "string" &&
      w.cover.startsWith("data:image/") &&
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(w.cover)
    )
      throw Error("LEGACY_COVER_FORMAT");
  }
  return {
    rows,
    sourceHash: hash(body),
    works: rows.length,
    missingAudio: rows.length,
  };
}
export async function importLegacy(s: Studio, file: string) {
  if (s.mode !== "simulation") throw Error("LEGACY_USE_SIMULATION");
  const preview = previewLegacy(file);
  if (s.all("imports").some((x) => x.sourceHash === preview.sourceHash))
    return { alreadyImported: true };
  const artist = s.all("artists")[0];
  const prepared: { w: Record<string, any>; coverId?: string }[] = [];
  for (const w of preview.rows) {
    let coverId: string | undefined;
    if (
      typeof w.cover === "string" &&
      /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(w.cover)
    ) {
      const f = path.join(s.root, "staging", randomUUID() + ".img");
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, Buffer.from(w.cover.split(",")[1], "base64"));
      try {
        coverId = (await s.importFile(f, "cover")).id;
      } finally {
        fs.unlinkSync(f);
      }
    }
    prepared.push({ w, coverId });
  }
  s.repo.transaction(() => {
    for (const { w, coverId } of prepared) {
      const created = s.saveWork({
        title: w.title,
        artistId: artist.id,
        story: w.story || "",
        lyrics: w.lyrics || "",
        prompt: w.prompt || "",
        parameters: {},
        rights: w.rights || "原型导入，权益待确认",
        ai: "unknown",
      });
      if (coverId)
        s.save("works", {
          ...created,
          assets: { cover: coverId },
          assetHistory: [coverId],
        });
    }
    s.save("imports", {
      id: randomUUID(),
      sourceHash: preview.sourceHash,
      works: preview.works,
      missingAudio: preview.missingAudio,
    });
  });
  const receipts = path.join(s.root, "migration-receipts");
  fs.mkdirSync(receipts, { recursive: true });
  fs.copyFileSync(file, path.join(receipts, preview.sourceHash + ".json"));
  return {
    works: preview.works,
    missingAudio: preview.missingAudio,
    notice: "旧音频blob无法迁移，请重新导入；旧发布状态未导为真实任务。",
  };
}
const port = (process as any).parentPort;
if (port) {
  const networkPending=new Map<string,{resolve:(value:any)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}>();
  const network=(action:string,operationId:string,url?:string)=>new Promise<any>((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{networkPending.delete(id);reject(Error('PROVIDER_RESPONSE_TIMEOUT'))},120000);networkPending.set(id,{resolve,reject,timer});port.postMessage({kind:'music-provider',id,action,operationId,url})});
  const audioOwners=new Map<string,string>();
  const liveAdapter:MusicAdapter={source:'external',capabilities:{provider:'yourmusic',version:'openapi-1.0.0',maximumOutputs:2,lookupByClientKey:false,automaticPaid:false},submit:input=>network('submit',input.operationId),query:async ids=>{const op=studio.all('operations').find(o=>o.kind==='music'&&JSON.stringify(o.songIds)===JSON.stringify(ids));if(!op)throw Error('LIVE_OPERATION_REQUIRED');const result=await network('query',op.id);for(const song of result.songs??[])if(song.audio_url)audioOwners.set(song.audio_url,op.id);return result},download:async url=>{const id=audioOwners.get(url);if(!id)throw Error('UNVERIFIED_AUDIO_URL');const result=await network('download',id,url);return{bytes:Buffer.from(result.bytes),mime:result.mime}}};
  const studio = new Studio(
    process.argv[2],
    process.argv[3] === "simulation" ? "simulation" : "production",
    {musicAdapter:liveAdapter},
  );
  let chain = Promise.resolve().then(() => studio.scanInbox());
  const execute = async (method: string, input: any) => {
    if(method==='internal.inboxBridge.configure')return studio.inboxController().configureBridge(input);
    if(method.startsWith('internal.unifiedPublish.'))return executeUnifiedPublication(studio,method.slice('internal.unifiedPublish.'.length),input);
    if(method.startsWith('internal.tmeAiSubmission.'))return executeTmeAiSubmission(studio,method.slice('internal.tmeAiSubmission.'.length),input);
    if(method.startsWith('internal.tmeAiPrepare.'))return executeTmeAiPrepare(studio,method.slice('internal.tmeAiPrepare.'.length),input);
    if(method.startsWith('internal.productionFlow.')){
      if(studio.mode!=='production')throw Error('PRODUCTION_REQUIRED');
      const action=method.slice('internal.productionFlow.'.length);
      if(action==='importAudio')return importProductionAudio(studio,input);
      const schema=(ProductionFlowSchemas as Record<string,any>)['productionFlow.'+action];
      if(!schema)throw Error('METHOD_NOT_ALLOWED');
      const value=schema.parse(input),flow=studio.productionFlowService();
      if(action==='context')return flow.context(value.id);
      if(action==='list')return flow.list();
      return (flow as any)[action](value);
    }
    if(method.startsWith('internal.liveText.')){
      if(studio.mode!=='production')throw Error('PRODUCTION_REQUIRED');
      const text=studio.liveTextService();
      if(method==='internal.liveText.prepare')return text.prepare(input);
      if(method==='internal.liveText.claim')return text.claim(input);
      if(method==='internal.liveText.record')return text.record(input);
      if(method==='internal.liveText.context'){const context=text.context(input.id);return {...context,draft:context.job.draftId?studio.get('drafts',context.job.draftId):null};}
      if(method==='internal.liveText.list')return text.list();
      throw Error('METHOD_NOT_ALLOWED');
    }
    if(method==='internal.liveMusic.stage')return stageLiveMusic(studio,input);
    if(method==='internal.liveMusic.context')return liveMusicContext(studio,input.id);
    if(method==='internal.liveMusic.status'){const c=liveMusicContext(studio);if(c&&['accepted','polling','download_failed'].includes(c.operation.state))studio.musicService();return c;}
    if(method==='internal.liveMusic.start'){const c=liveMusicContext(studio);if(!c||c.grant.requestId!==input.requestId)throw Error('LIVE_SCOPE_MISMATCH');void studio.musicService().submit(c.operation.id).then(()=>studio.musicService().reconcile(c.operation.id)).catch(()=>undefined);return c.operation;}
    if(method==='internal.liveMusic.materialize')return materializeLiveMusic(studio);
    if(method==='internal.liveMusic.retryDownloads'){const c=liveMusicContext(studio);if(!c)throw Error('LIVE_ATTEMPT_REQUIRED');return studio.musicService().retryDownloads(c.operation.id)}
    if(method==='internal.liveMusic.recover'){const c=liveMusicContext(studio,input.id);if(!c)throw Error('LIVE_ATTEMPT_REQUIRED');return studio.musicService().recoverAccepted(c.operation.id,input.result)}
    if (method === "internal.pauseAutomation") {
      const center=studio.planCenterService();
      for(const p of center.list().plans.filter(p=>p.enabled))center.toggle({id:p.id,expectedRevision:p.revision,enabled:false});
      for(const r of center.list().runs.filter(r=>!['completed','stopped'].includes(r.state)))center.stop({runId:r.id});
      for(const p of studio.all('plans').filter(p=>p.enabled))studio.save('plans',{...p,enabled:false});
      if(studio.mode==='production')studio.productionFlowService().pauseAll();
      for (const p of studio.all("dailyPlans"))
        studio.save("dailyPlans", { ...p, state: "paused", enabled: false });
      return { paused: true };
    }
    if (method === "internal.previewLegacy") {
      if (studio.mode !== "simulation") throw Error("LEGACY_USE_SIMULATION");
      const p = previewLegacy(input.source);
      return {
        works: p.works,
        missingAudio: p.missingAudio,
        sourceHash: p.sourceHash,
      };
    }
    if (method === "internal.close") {
      studio.close();
      return true;
    }
    if (method === "internal.locate") return studio.locate(input.id);
    if (method === 'internal.tme.get') return studio.tmeDraftService().get(input.id);
    if (method === 'internal.tme.list') return studio.tmeDraftService().list();
    if (method === 'internal.tme.current') { studio.tmeDraftService().assertCurrent(studio.tmeDraftService().get(input.id)); return true; }
    if (method === 'internal.tme.update') return studio.tmeDraftService().update(input.id,input.revision,input.patch);
    if (method === 'internal.tme.bind') return studio.tmeDraftService().bind(input.id,input.revision,input.identity);
    if (method === 'internal.tme.live') {
      const svc=studio.tmeDraftService();
      if(input.action==='units')return svc.batchUnits(input.id);
      if(input.action==='batches')return svc.batches();
      if(input.action==='updateUnit')return svc.updateUnit(input.id,input.patch);
      if(input.action==='updateBatch')return svc.updateBatch(input.id,input.patch);
      if(input.action==='claim')return svc.claimUnit(input.id,input.identity);
      if(input.action==='start')return svc.startUnit(input.id);
      throw Error('METHOD_NOT_ALLOWED');
    }
    if (method === "internal.import") {
      if(input.role==='lyrics')return studio.lyricService().importText(input.source,input.workId);
      if(input.role==='coverResultImage'||input.role==='coverResultManifest')return studio.coverHandoff().receiveFile(input.source,input.workId,input.requestId,input.role==='coverResultManifest'?'manifest':'image');
      if (input.role === "backup") return studio.restore(input.source);
      if (input.role === "report") return studio.importReport(input.source);
      if (input.role === "legacy") return importLegacy(studio, input.source);
      return studio.importFile(input.source, input.role, input.workId);
    }
    if (method === "internal.export") {
      if(input.kind==='coverRequest'){const request=studio.coverHandoff().exportRequest(input.input.requestId);fs.writeFileSync(input.destination,JSON.stringify(request,null,2),'utf8');return{path:input.destination,notice:'已导出文件交接请求，尚未执行图像生成'};}
      if (input.kind === "backup") return studio.backup(input.destination);
      if (input.kind === "cover")
        return exportCover(
          studio,
          input.input.workId,
          input.destination,
          input.input,
        );
      if (input.kind === "coverTask") {
        const task = await studio.call("cover.task", {
          workId: input.input.workId,
          brief: input.input.brief || "",
        });
        const edited = input.input.editedText;
        if (
          edited !== undefined &&
          (typeof edited !== "string" || edited.length > 200000)
        )
          throw Error("COVER_TASK_INVALID");
        const text = edited || task.text;
        fs.writeFileSync(input.destination, text, "utf8");
        const work = studio.get("works", input.input.workId);
        studio.save("works", {
          ...work,
          coverTaskText: text,
          coverBrief: input.input.brief || "",
        });
        return { path: input.destination };
      }
      if (input.kind === "materials") {
        const files = materialEntries(studio, input.input.batchId);
        await zip(input.destination, files);
        return { path: input.destination, uploaded: false };
      }
      if (input.kind === "diagnostics") {
        fs.writeFileSync(
          input.destination,
          JSON.stringify(
            {
              mode: studio.mode,
              versions: process.versions,
              capabilities: studio.snapshot().capabilities,
              externalRequests: studio.externalRequests,
              audit: studio
                .all("audit")
                .map(({ type, entityId, at }) => ({ type, entityId, at })),
            },
            null,
            2,
          ),
        );
        return { path: input.destination };
      }
    }
    return studio.call(method, input);
  };
  port.on("message", ({ data }: any) => {
    if(data.kind==='music-provider-result'){const p=networkPending.get(data.id);if(p){clearTimeout(p.timer);networkPending.delete(data.id);if(data.ok)p.resolve(data.value);else p.reject(Error('PROVIDER_OPERATION_FAILED'))}return;}
    if(['inbox.pause','inbox.bridge.pause','internal.inboxBridge.configure'].includes(data.method)){
      try{studio.inboxController().interruptRequest(data.method,data.input)}catch{/* Serialized execution returns the validation error. */}
    }
    chain = chain.then(async () => {
      try {
        const value = await execute(data.method, data.input);
        port.postMessage({ id: data.id, result: { ok: true, value } });
      } catch (e: any) {
        const code =
          typeof e.code === "string"
            ? e.code
            : typeof e.message === "string" && /^[A-Z0-9_]+$/.test(e.message)
              ? e.message
              : "OPERATION_FAILED";
        port.postMessage({
          id: data.id,
          result: {
            ok: false,
            error: {
              code,
              message:
                "操作未完成：" +
                code +
                "。请检查输入、文件、授权范围或所需步骤。",
            },
          },
        });
      }
    });
  });
  setInterval(() => {
    chain = chain
      .then(() => (studio.closing ? undefined : studio.tick()))
      .catch(() => undefined);
  }, 1000).unref();
  port.postMessage({ ready: true });
}
export {};
