import {readGenerationConfig,freezeRoute} from './generation-config';
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { Studio } from "./studio";
import { hash } from "./database";
import { digest } from "./assets";
import { inboxHash } from "./inbox/service";
import {assertPlanCoverWork} from './plan-cover-work';
import {
  CoverRequestSchema,
  CoverReceiptSchema,
  COVER_IMAGE_POLICY,
} from "../shared/cover-handoff";

function localFile(source: string) {
  if (!path.isAbsolute(source) || source.startsWith("\\\\"))
    throw Error("SOURCE_REJECTED");
  for (let cursor = path.resolve(source); ; cursor = path.dirname(cursor)) {
    if (fs.lstatSync(cursor).isSymbolicLink()) throw Error("SOURCE_REJECTED");
    if (path.dirname(cursor) === cursor) break;
  }
  if (!fs.statSync(source).isFile()) throw Error("FILE_REQUIRED");
  return fs.realpathSync(source);
}
export class CoverHandoff {
  constructor(private s: Studio) {}
  private rows(kind: string) {
    return this.s.all("settings").filter((r) => r.kind === kind);
  }
  private context(workId: string) {
    const w = this.s.get("works", workId),
      a = this.s.get("artists", w.artistId);
    return {
      workId,
      title: w.title,
      artist: w.artistSnapshot?.name??a.name,
      lyrics: w.lyrics,
      story: w.story,
      genre: w.config.genre,
      mood: w.config.mood,
      coverStyle: w.config.coverStyle,
    };
  }
  private assertContext(r: any) {
    if (inboxHash(this.context(r.workId)) !== r.contextHash)
      throw Error("COVER_CONTEXT_CHANGED");
  }
  verifiedSelectedReceipt(workId:string,assetId?:string){
    const binding=assertPlanCoverWork(this.s,workId),work=this.s.get('works',workId),selected=assetId??work.assets?.cover;
    if(!selected)throw Error('COVER_REQUIRED');
    const asset=this.s.get('assets',selected);
    if(asset.kind!=='image')throw Error('ASSET_ROLE');
    if(binding?.sourceCoverSha256===asset.sha256)throw Error('COVER_REFRESH_REQUIRED');
    const candidates=this.rows('cover-receipt').map(r=>r.receipt).filter(r=>r.workId===workId&&r.assetId===selected&&r.image?.sha256===asset.sha256);
    if(!candidates.length)throw Error('COVER_RECEIPT_REQUIRED');
    const contextHash=inboxHash(this.context(workId));
    // Keep proof stable for repeated same-context imports; stale contexts cannot mask a valid receipt.
    const receipt=candidates.find(r=>{const request=this.s.repo.maybe('settings','cover-request:'+r.requestId)?.request;return request?.workId===workId&&request.contextHash===contextHash;});
    if(!receipt)throw Error('COVER_CONTEXT_CHANGED');
    const request=this.get(receipt.requestId);
    if(request.workId!==workId)throw Error('COVER_SCOPE_MISMATCH');
    this.assertContext(request);this.s.locate(asset.id);
    return{receipt,request,asset};
  }
  get(id: string) {
    return this.s.get("settings", "cover-request:" + id).request;
  }
  list(workId?: string) {
    let planRecovery: {locked:boolean;reason?:string}|undefined;
    if(workId&&this.s.repo.all('settings').some(r=>r.id.startsWith('plan-cover-work:')&&r.value?.workId===workId)){
      try{assertPlanCoverWork(this.s,workId);planRecovery={locked:false};}catch(error){planRecovery={locked:true,reason:error instanceof Error?error.message:'FINAL_MATERIAL_CHANGED'};}
    }
    return {
      ...(planRecovery?{planRecovery}:{}),
      provider: {
        id: "image-api",
        state: "unconfigured",
        executionEnabled: false,
      },
      handoff: "manual-local-file",
      requests: this.rows("cover-request")
        .map((r) => r.request)
        .filter((r) => !workId || r.workId === workId),
      receipts: this.rows("cover-receipt")
        .map((r) => r.receipt)
        .filter((r) => !workId || r.workId === workId),
    };
  }
  request(raw: unknown) {
    const i = CoverRequestSchema.parse(raw),
      context = this.context(i.workId),
      requestHash = inboxHash(i);
    return this.s.repo.transaction(() => {
      assertPlanCoverWork(this.s,i.workId);
      const previous = this.s.repo.maybe(
        "settings",
        "cover-request:" + i.requestId,
      );
      if (previous) {
        if (previous.request.requestHash !== requestHash)
          throw Error("IDEMPOTENCY_CONFLICT");
        return previous.request;
      }
      const planBinding=assertPlanCoverWork(this.s,i.workId);
      const planRows=this.s.planCenterService().list(),owner=planRows.items.find(item=>item.workId===i.workId);
      const planRun=planRows.runs.find(r=>r.id===(planBinding?.runId??owner?.runId));
      if(planRun&&planRun.snapshot.artistId!==this.s.get('works',i.workId).artistId)throw Error('ARTIST_MISMATCH');
      const generationRoute=planRun?.snapshot.routeSnapshot?.image??(readGenerationConfig(this.s.repo).roles.image?freezeRoute(this.s.repo,'image',{source:'default'}):undefined);
      if(generationRoute?.capability==='unavailable')throw Error(generationRoute.reason??'IMAGE_ADAPTER_UNAVAILABLE');
      if(generationRoute){const p=this.s.repo.maybe('settings','api-profile:'+generationRoute.profileId);if(!p||p.kind!=='image'||p.revision!==generationRoute.profileRevision||p.providerId!==generationRoute.providerId)throw Error('ROUTE_PROFILE_CHANGED');}
      let workspace = this.s.repo.maybe("settings", "cover-workspace");
      if (!workspace)
        workspace = this.s.save("settings", {
          id: "cover-workspace",
          workspaceRef: randomUUID(),
        });
      const prompt = i.prompt?.trim()
        ? i.prompt
        : `为歌曲《${context.title}》生成无字方形封面母版。\n艺名：${context.artist}\n故事：${context.story}\n歌词原文：\n${context.lyrics}\n曲风：${context.genre}\n情绪：${context.mood}\n封面风格：${context.coverStyle}\n补充：${i.brief}\n目标3000×3000，保留排版留白。输出真实PNG/JPEG/WebP文件。`;
      const request = {
        id: i.requestId,
        workId: i.workId,
        workspaceRef: workspace.workspaceRef,
        contextHash: inboxHash(context),
        requestHash,
        context,
        prompt,
        brief: i.brief,
        imagePolicy: COVER_IMAGE_POLICY,
        ...(generationRoute?{generationRoute}:{}),
        provider: "dot_handoff",
        state: "awaiting_result",
        createdAt: this.s.now().toISOString(),
        notice: "文件交接请求；未调用当前 dot 聊天或图像接口，等待真实结果",
      };
      this.s.save("settings", {
        id: "cover-request:" + request.id,
        kind: "cover-request",
        request,
      });
      return request;
    });
  }
  exportRequest(id: string) {
    const r = this.get(id);
    this.assertContext(r);
    return {
      schemaVersion: 1,
      kind: "cover-request",
      ...r,
      instructions:
        "在支持出图的会话中生成后，将真实图片与 cover-result 清单放在同一目录再导入。也可在应用选中此请求后导入真实图片；来源将记为用户导入，生成时间未知。不要填写虚假校验和或生成证明。",
      resultTemplate: {
        schemaVersion: 1,
        kind: "cover-result",
        workspaceRef: r.workspaceRef,
        workId: r.workId,
        requestId: r.id,
        contextHash: r.contextHash,
        resultId: "unique-result-id",
        image: {
          fileName: "cover.png",
          sha256: "REPLACE_WITH_REAL_FILE_SHA256",
          mime: "image/png",
          width: 3000,
          height: 3000,
        },
        provenance: { producer: "dot", model: null, generatedAt: null },
      },
    };
  }
  async receiveFile(
    source: string,
    workId: string,
    requestId: string,
    kind: "manifest" | "image",
  ) {
    assertPlanCoverWork(this.s,workId);
    const request = this.get(requestId);
    if (request.workId !== workId) throw Error("COVER_SCOPE_MISMATCH");
    this.assertContext(request);
    const selected = localFile(source);
    let file = selected,
      manifest: any = null,
      receiptHash: string,
      resultId: string;
    if (kind === "manifest") {
      if (fs.statSync(selected).size > 65536)
        throw Error("MANIFEST_SIZE_LIMIT");
      const bytes = fs.readFileSync(selected);
      manifest = CoverReceiptSchema.parse(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      );
      if (
        manifest.workspaceRef !== request.workspaceRef ||
        manifest.workId !== workId ||
        manifest.requestId !== requestId ||
        manifest.contextHash !== request.contextHash
      )
        throw Error("COVER_SCOPE_MISMATCH");
      file = localFile(
        path.join(path.dirname(selected), manifest.image.fileName),
      );
      receiptHash = hash(bytes);
      resultId = manifest.resultId;
    } else {
      receiptHash = digest(file);
      resultId = "image-" + receiptHash;
    }
    const key = "cover-receipt:" + hash([requestId, resultId]),
      old = this.s.repo.maybe("settings", key);
    if (old) {
      if (old.receipt.receiptHash !== receiptHash)
        throw Error("IDEMPOTENCY_CONFLICT");
    }
    const size = fs.statSync(file).size;
    if (!size || size > COVER_IMAGE_POLICY.maxBytes)
      throw Error("FILE_SIZE_LIMIT");
    const meta = await sharp(file, {
      limitInputPixels: COVER_IMAGE_POLICY.maxPixels,
    }).metadata();
    if (!COVER_IMAGE_POLICY.formats.includes(meta.format!))
      throw Error("IMAGE_FORMAT");
    if (
      !meta.width ||
      !meta.height ||
      meta.width !== meta.height ||
      meta.width < 512 ||
      meta.width > 10000 ||
      (meta.pages ?? 1) > 1
    )
      throw Error("IMAGE_DIMENSIONS");
    await sharp(file, {
      limitInputPixels: COVER_IMAGE_POLICY.maxPixels,
    }).stats();
    const sha256 = digest(file),
      mime = "image/" + meta.format;
    if (
      manifest &&
      (sha256 !== manifest.image.sha256 ||
        meta.width !== manifest.image.width ||
        meta.height !== manifest.image.height ||
        mime !== manifest.image.mime)
    )
      throw Error("IMAGE_RECEIPT_MISMATCH");
    if (kind === "image" && sha256 !== receiptHash)
      throw Error("SOURCE_CHANGED");
    this.assertContext(request);
    if (old) {
      this.s.locate(old.receipt.assetId);
      return old.receipt;
    }
    assertPlanCoverWork(this.s,workId);
    const guarded=!!this.s.repo.all('settings').find(r=>r.id.startsWith('plan-cover-work:')&&r.value?.workId===workId);
    const asset = await this.s.importFile(file, "cover",undefined,guarded?()=>{assertPlanCoverWork(this.s,workId);this.assertContext(request);}:undefined);
    if (asset.sha256 !== sha256) throw Error("SOURCE_CHANGED");
    return this.s.repo.transaction(() => {
      assertPlanCoverWork(this.s,workId);
      this.assertContext(request);
      this.s.locate(asset.id);
      const concurrent = this.s.repo.maybe("settings", key);
      if (concurrent) {
        if (concurrent.receipt.receiptHash !== receiptHash)
          throw Error("IDEMPOTENCY_CONFLICT");
        return concurrent.receipt;
      }
      const receipt = {
        id: randomUUID(),
        requestId,
        workId,
        assetId: asset.id,
        receiptHash,
        resultId,
        state: "received",
        source: kind === "manifest" ? "external-manifest" : "user-import",
        provenance: manifest?.provenance ?? {
          producer: "user-import",
          model: null,
          generatedAt: null,
        },
        generationVerified: false,
        image: {
          sha256,
          mime,
          width: meta.width,
          height: meta.height,
          bytes: size,
        },
        receivedAt: this.s.now().toISOString(),
      };
      const w = this.s.get("works", workId);
      this.s.save("works", {
        ...w,
        assetHistory: [...new Set([...w.assetHistory, asset.id])],
      });
      this.s.save("settings", { id: key, kind: "cover-receipt", receipt });
      this.s.save("settings", {
        id: "cover-request:" + requestId,
        kind: "cover-request",
        request: { ...request, state: "received" },
      });
      this.s.repo.audit("cover.receive", workId, {
        requestId,
        receiptId: receipt.id,
        assetId: asset.id,
      });
      return receipt;
    });
  }
}
