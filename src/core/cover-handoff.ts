import {readGenerationConfig,freezeRoute} from './generation-config';
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { Studio } from "./studio";
import { hash } from "./database";
import { assertVersionCover, digest } from "./assets";
import { inboxHash } from "./inbox/service";
import {assertPlanCoverWork} from './plan-cover-work';
import {paidCoverModelId,supportsImageApiModel,supportsManualCover,type PaidCoverModelId} from '../shared/api-profiles';
import {frozenRouteModelMatches} from '../shared/generation-config';
import {
  CoverRequestSchema,
  CoverReceiptSchema,
  COVER_IMAGE_POLICY,
  coverResolutionSchema,
  coverAssetRole,
  songCoverPrompt, recordingCoverPrompt,
  type CoverVariant,
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
  private context(workId: string, variant?: CoverVariant) {
    const w = this.s.get("works", workId),
      a = this.s.get("artists", w.artistId);
    if (variant === "B" && !w.assets?.audio_B) throw Error("COVER_VERSION_AUDIO_REQUIRED");
    const resolution = coverResolutionSchema.safeParse((w.artistSnapshot?.defaults ?? w.config)?.coverResolution);
    return {
      workId,
      title: variant === "B" ? w.alternateTitle?.trim() || w.title : w.title,
      ...(variant ? { variant } : {}),
      artist: w.artistSnapshot?.name??a.name,
      lyrics: w.lyrics,
      story: w.story,
      genre: w.config.genre,
      mood: w.config.mood,
      coverStyle: w.config.coverStyle,
      ...(resolution.success ? { coverResolution: resolution.data } : {}),
    };
  }
  private assertContext(r: any) {
    if (inboxHash(this.context(r.workId, r.variant)) !== r.contextHash)
      throw Error("COVER_CONTEXT_CHANGED");
  }
  verifiedSelectedReceipt(workId:string,assetId?:string,variant?:CoverVariant){
    const binding=assertPlanCoverWork(this.s,workId),work=this.s.get('works',workId),selected=assetId??work.assets?.[coverAssetRole(variant)];
    if(!selected)throw Error('COVER_REQUIRED');
    const asset=this.s.get('assets',selected);
    if(asset.kind!=='image')throw Error('ASSET_ROLE');
    if(binding?.sourceCoverSha256===asset.sha256)throw Error('COVER_REFRESH_REQUIRED');
    const candidates=this.rows('cover-receipt').map(r=>r.receipt).filter(r=>r.workId===workId&&r.variant===variant&&r.assetId===selected&&r.image?.sha256===asset.sha256);
    if(!candidates.length)throw Error('COVER_RECEIPT_REQUIRED');
    const contextHash=inboxHash(this.context(workId,variant));
    // Keep proof stable for repeated same-context imports; stale contexts cannot mask a valid receipt.
    const receipt=candidates.find(r=>{const request=this.s.repo.maybe('settings','cover-request:'+r.requestId)?.request;return request?.workId===workId&&request.variant===variant&&request.contextHash===contextHash;});
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
    const defaultImage = workId && this.s.mode === 'production' && !planRecovery &&
      !this.s.planCenterService().list().items.some(item=>item.workId===workId)
      ? freezeRoute(this.s.repo,'image',{source:'default'}) : undefined;
    const manualCover = defaultImage?.capability==='image_api'&&supportsManualCover(defaultImage.providerId)&&defaultImage.modelId
      ? {providerId:defaultImage.providerId,modelId:defaultImage.modelId} : null;
    const zhipuProfileId = manualCover?.providerId==='zhipu_image' ? defaultImage?.profileId ?? null : null;
    return {
      ...(planRecovery?{planRecovery}:{}),
      zhipuProfileId,
      zhipuModelId: zhipuProfileId ? defaultImage?.modelId : null,
      manualCover,
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
  request(raw: unknown, manualGeneration = false, confirmedModelId?: PaidCoverModelId) {
    const i = CoverRequestSchema.parse(raw),
      context = this.context(i.workId, i.variant),
      requestHash = inboxHash(manualGeneration ? {...i, manualGeneration, ...(confirmedModelId ? {confirmedModelId} : {})} : i);
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
      if(i.variant&&planBinding)throw Error('COVER_SCOPE_MISMATCH');
      const planRows=this.s.planCenterService().list(),owner=planRows.items.find(item=>item.workId===i.workId);
      const planRun=planRows.runs.find(r=>r.id===(planBinding?.runId??owner?.runId));
      if(manualGeneration&&(planBinding||owner))throw Error('PLAN_COVER_GENERATION_REQUIRED');
      if(planRun&&planRun.snapshot.artistId!==this.s.get('works',i.workId).artistId)throw Error('ARTIST_MISMATCH');
      const frozenImage=planRun?.snapshot.routeSnapshot?.image;
      let generationRoute=frozenImage??(readGenerationConfig(this.s.repo).roles.image?freezeRoute(this.s.repo,'image',{source:'default'}):undefined);
      if(generationRoute){
        const p=this.s.repo.maybe('settings','api-profile:'+generationRoute.profileId);
        const reason=generationRoute.capability==='unavailable'?generationRoute.reason??'IMAGE_ADAPTER_UNAVAILABLE':
          !p||p.kind!=='image'||p.revision!==generationRoute.profileRevision||p.providerId!==generationRoute.providerId||
            !frozenRouteModelMatches(generationRoute,p.providerId,p.modelId)?'ROUTE_PROFILE_CHANGED':null;
        if(reason){
          if(planRun?.snapshot.material.source!=='pule_prompt')throw Error(reason);
          generationRoute=undefined;
        }
      }
      if(manualGeneration){
        if(generationRoute?.capability!=='image_api'||!supportsManualCover(generationRoute.providerId))
          throw Error('ZHIPU_COVER_CONFIG_REQUIRED');
        if(paidCoverModelId(generationRoute.modelId)!==confirmedModelId)
          throw Error('IMAGE_MODEL_CONFIRMATION_REQUIRED');
      }
      const imageProvider=(frozenImage||manualGeneration)&&generationRoute?.capability==='image_api'&&
        supportsImageApiModel(generationRoute.providerId,generationRoute.modelId) ? generationRoute.providerId : null;
      let workspace = this.s.repo.maybe("settings", "cover-workspace");
      if (!workspace)
        workspace = this.s.save("settings", {
          id: "cover-workspace",
          workspaceRef: randomUUID(),
        });
      const browserMusic = planRun?.snapshot.workflow?.browserMusic;
      const artist = planRun?.snapshot.workflowSnapshot;
      const singer = (i.variant === "B" ? artist?.secondSinger?.name : undefined) ?? artist?.artist.singer;
      const prompt = i.prompt?.trim() ? i.prompt : browserMusic
        ? recordingCoverPrompt({ ...context, artist: singer ?? context.artist }, i.variant ?? "A")
        : songCoverPrompt(context, i.brief, i.variant);
      const request = {
        id: i.requestId,
        workId: i.workId,
        ...(i.variant ? { variant: i.variant } : {}),
        workspaceRef: workspace.workspaceRef,
        contextHash: inboxHash(context),
        requestHash,
        context,
        prompt,
        brief: i.brief,
        imagePolicy: context.coverResolution === undefined
          ? COVER_IMAGE_POLICY : { ...COVER_IMAGE_POLICY, targetEdge: context.coverResolution },
        ...(generationRoute?{generationRoute}:{}),
        provider: imageProvider ?? "dot_handoff",
        ...(manualGeneration?{manualGeneration}:{}),
        state: "awaiting_result",
        createdAt: this.s.now().toISOString(),
        notice: imageProvider ? "等待图像服务出图" : "等待外部出图或导入",
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
    const targetEdge = r.imagePolicy?.targetEdge ?? COVER_IMAGE_POLICY.targetEdge;
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
        ...(r.variant ? { variant: r.variant } : {}),
        requestId: r.id,
        contextHash: r.contextHash,
        resultId: "unique-result-id",
        image: {
          fileName: "cover.png",
          sha256: "REPLACE_WITH_REAL_FILE_SHA256",
          mime: "image/png",
          width: targetEdge,
          height: targetEdge,
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
    generated?: { model: string; sha256: string },
    beforeReceive?:()=>void,
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
        manifest.variant !== request.variant ||
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
    const imagePath = path.toNamespacedPath(file);
    const meta = await sharp(imagePath, {
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
    await sharp(imagePath, {
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
    if (generated && sha256 !== generated.sha256) throw Error("SOURCE_CHANGED");
    this.assertContext(request);
    beforeReceive?.();
    if (old) {
      this.s.locate(old.receipt.assetId);
      return old.receipt;
    }
    assertPlanCoverWork(this.s,workId);
    const role=coverAssetRole(request.variant);
    const assertCover=()=>assertVersionCover(this.s,this.s.get('works',workId),role,sha256);
    assertCover();
    const guarded=!!this.s.repo.all('settings').find(r=>r.id.startsWith('plan-cover-work:')&&r.value?.workId===workId);
    const assertCurrent=()=>{assertPlanCoverWork(this.s,workId);this.assertContext(request);beforeReceive?.();assertCover();};
    const asset = await this.s.importFile(file, role,undefined,guarded||request.variant||beforeReceive?assertCurrent:undefined);
    if (asset.sha256 !== sha256) throw Error("SOURCE_CHANGED");
    if (asset.kind !== 'image') throw Error('ASSET_ROLE');
    return this.s.repo.transaction(() => {
      assertCurrent();
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
        ...(request.variant ? { variant: request.variant } : {}),
        assetId: asset.id,
        receiptHash,
        resultId,
        state: "received",
        source: generated ? "image-api" : kind === "manifest" ? "external-manifest" : "user-import",
        provenance: generated ? { producer: request.provider, model: generated.model, generatedAt: null } : manifest?.provenance ?? {
          producer: "user-import",
          model: null,
          generatedAt: null,
        },
        generationVerified: !!generated,
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
