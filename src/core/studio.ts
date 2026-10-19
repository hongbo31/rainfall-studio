import {AccountIdentityService} from './account-identity';
import {readGenerationConfig,saveGenerationConfig} from './generation-config';
import {prepareManualCreation,listManualCreations} from './manual-creation';
import {unifiedPublicationService,savePublicationMetadata} from "./unified-publication-integration";
import fs from "node:fs";
import {DirectoryTaskController} from './directory-tasks';
import {ProviderTextService} from './provider-text';
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import {PlanCenterService,isLegacyOwned} from './plan-center';
import {assertLegacyScheduleEditable} from './plan-center-ownership';
import {createPlanCenterService,executePlanCenter,tickPlanCenter} from './plan-center-integration';
import { Repository, hash, type Row, type Table } from "./database";
import type {PlanAlbumService} from './plan-albums';
import {createPlanAlbumService,executePlanAlbums} from './plan-albums-integration';
import { validate, defaultsSchema } from "../shared/schemas";
import type { Mode } from "../shared/contracts";
import * as resources from "./resources";
import * as assets from "./assets";
import * as archives from "./backup";
import * as publishing from "./publishing";
import { parse } from "csv-parse/sync";
import { listApiProfiles, saveApiProfile } from "./api-profiles";
import { CreationService } from "./workflow/creation";
import { TextProviderRegistry } from "./workflow/text";
import {
  simulationPolicy,
  simulationText,
  simulationMusic,
} from "./workflow/simulation";
import { MusicService } from "./workflow/music";
import { YourMusicAdapter } from "./workflow/yourmusic";
import { DailyScheduler } from "./workflow/daily";
import { selectCandidate } from "./workflow/selection";
import { hashValue } from "./quality/scoring";
import { InboxController } from "./inbox/controller";
import { selectInboxMusicInput, selectedInboxMusicInput } from "./inbox/music-input";
import { parseTextProviderProfile } from "../shared/text-providers";
import { TmeDraftService } from './tme-drafts';
import { CoverHandoff } from './cover-handoff';
import {assertPlanCoverWork} from './plan-cover-work';
import {LyricService,candidateLyricOrigin,type LyricOrigin} from './lyrics';
import {publicationPayload} from './publication-payload';
import {listTmeObservations, recordTmeObservation} from './tme-observations';
import type {MusicAdapter} from './workflow/yourmusic';
import {liveMusicGrantKey} from '../shared/live-music';
import {LiveTextService} from './live-text';
import {createProductionFlowService} from './production-integration';
import type {ProductionFlowService} from './production-flow';
import {createTmeAiPrepareService} from './tme-ai-prepare-integration';
import type {TmeAiPrepareService} from './tme-ai-prepare';
import {initializePlatformConfigurations,listPlatformConfigurations,savePlatformConfiguration} from './platform-config';
import {publishSelection,savePublishSelection,publishSimple,listSimplePublicationRequests,listPublicationPendingTerms} from './simple-publication';
export const baseDefaults = {
  genre: "流行 / 民谣",
  voice: "female",
  lyricTone: "克制、细腻的叙事",
  bpmMin: 72,
  bpmMax: 96,
  coverStyle: "雨夜、暖紫色、电影感留白",
  language: "中文",
  mood: "温柔",
  duration: 180,
};
export class Studio {
  coverHandoff() { return new CoverHandoff(this); }
  lyricService() { return new LyricService(this); }
  repo: Repository;
  externalRequests = 0;
  now: () => Date;
  lastTick: Date;
  closing = false;
  private identity?:AccountIdentityService;
  private identityRepo?:Repository;
  accountIdentityService(){if(!this.identity||this.identityRepo!==this.repo){this.identity=new AccountIdentityService(this.repo,{now:this.now});this.identityRepo=this.repo;}return this.identity;}
  private creative?: CreationService;
  private music?: MusicService;
  private daily?: DailyScheduler;
  private inbox?: InboxController;
  private directory?: DirectoryTaskController;
  private providerText?: ProviderTextService;
  providerTextService(){
    if(!this.providerText||this.providerText.repo!==this.repo)this.providerText=new ProviderTextService(this.repo,{now:this.now});
    return this.providerText;
  }
  directoryTasks(){
    if(!this.directory||this.directory.repo!==this.repo)this.directory=new DirectoryTaskController(this.repo,{dataRoot:this.root,now:this.now,center:()=>this.planCenterService()});
    return this.directory;
  }
  private tme?: TmeDraftService;
  private liveText?: LiveTextService;
  private productionFlow?: ProductionFlowService;
  private planCenter?: PlanCenterService;
  private planAlbum?:PlanAlbumService;
  planAlbumService(){
    if(!this.planAlbum||this.planAlbum.repo!==this.repo)this.planAlbum=this.options.albumServiceFactory?.(this)??createPlanAlbumService(this);
    return this.planAlbum;
  }
  planCenterService(){
    if(!this.planCenter||this.planCenter.repo!==this.repo)this.planCenter=createPlanCenterService(this);
    return this.planCenter;
  }
  private tmeAiPrepare?: TmeAiPrepareService;
  tmeAiPrepareService(){
    if(!this.tmeAiPrepare||this.tmeAiPrepare.repo!==this.repo)this.tmeAiPrepare=createTmeAiPrepareService(this);
    return this.tmeAiPrepare;
  }
  productionFlowService(){
    if(!this.productionFlow||this.productionFlow.repo!==this.repo)this.productionFlow=createProductionFlowService(this);
    return this.productionFlow;
  }
  liveTextService() {
    if(!this.liveText || this.liveText.repo!==this.repo) this.liveText=new LiveTextService(this.repo,{now:this.now});
    return this.liveText;
  }
  tmeDraftService() {
    if (!this.tme) this.tme = new TmeDraftService(this);
    return this.tme;
  }
  private inboxTickAt = 0;
  inboxController() {
    if (!this.inbox || this.inbox.repo !== this.repo)
      this.inbox = new InboxController(
        this.repo,
        path.join(this.root, this.mode, "inbox-v1"),
      );
    return this.inbox;
  }
  async scanInbox() {
    if (!this.closing) await this.inboxController().scanOnce();
  }
  dailyScheduler() {
    if (!this.daily || this.daily.repo !== this.repo)
      this.daily = new DailyScheduler(this.repo, this.mode, {
        now: this.now,
        allowFixtureExecution: false,
        dispatch: (p, o) => this.dispatchDailyOccurrence(p, o),
      });
    return this.daily;
  }
  async dispatchDailyOccurrence(plan: Row, occurrence: Row) {
    if (this.mode !== "simulation" || occurrence.source !== "fixture")
      throw Error("DAILY_EXECUTION_DISABLED");
    const creation = this.creationService(),
      turn = creation.begin({
        requestId: occurrence.id,
        sessionId: occurrence.id,
        artistId: plan.artistId,
        expectedRevision: 0,
        instruction: "每日离线候选 · " + occurrence.intendedLocalDate,
        parentDraftId: null,
        lockedQuotes: [],
        profileId: plan.textProfileId,
        seriesId: plan.seriesId,
        budgetLimit: plan.textBudget,
        excludeWorkIds: [],
      });
    this.save("creativeTurns", {
      ...turn,
      dailyPlanId: plan.id,
      occurrenceId: occurrence.id,
    });
    await creation.execute(turn.id);
    const result = this.get("creativeTurns", turn.id);
    if (result.state !== "ready_for_review") throw Error("DAILY_TEXT_BLOCKED");
    const draft = this.get("drafts", result.draftId),
      music = this.musicService();
    for (let i = 0; i < Math.floor(plan.candidateLimit / 2); i++) {
      const h = hashValue(occurrence.id + ":music:" + i),
        requestId =
          h.slice(0, 8) +
          "-" +
          h.slice(8, 12) +
          "-4" +
          h.slice(13, 16) +
          "-8" +
          h.slice(17, 20) +
          "-" +
          h.slice(20, 32);
      const op = music.prepare({
        requestId,
        draftId: draft.id,
        expectedPairHash: draft.pairHash,
        accountRef: "fixture-account",
        modelId: "chirp-v6",
        candidateLimit: plan.candidateLimit,
        budgetLimit: plan.musicBudget,
      });
      if (op.state === "blocked") break;
      await music.submit(op.id);
      await music.reconcile(op.id);
    }
    return { runId: turn.id };
  }
  musicService() {
    if (!this.music || this.music.repo !== this.repo)
      this.music = new MusicService(this.repo, this.mode, {
        now: this.now,
        productionAuthorization: input=>{const g=this.repo.maybe('settings',liveMusicGrantKey);return g&&g.requestId===input.requestId&&g.draftId===input.draftId&&g.pairHash===input.expectedPairHash&&g.profileId===input.accountRef&&input.modelId==='chirp-v6'&&g.creditCap===385&&g.consent===true?{maxCredits:385}:null},
        adapter:
          this.mode === "simulation"
            ? simulationMusic()
            : this.options.musicAdapter ?? new YourMusicAdapter({
                source: "external",
                credential: async () => {
                  throw Error("LIVE_EXECUTION_DISABLED");
                },
                request: async () => {
                  throw Error("LIVE_EXECUTION_DISABLED");
                },
              }),
        ingest: async (bytes, mime) => {
          const ext: Record<string, string> = {
            "audio/wav": "wav",
            "audio/x-wav": "wav",
            "audio/mpeg": "mp3",
            "audio/mp3": "mp3",
            "audio/flac": "flac",
            "audio/ogg": "ogg",
            "audio/mp4": "m4a",
          };
          if (!ext[mime]) throw Error("AUDIO_MIME_REJECTED");
          const folder = path.join(this.root, "staging");
          fs.mkdirSync(folder, { recursive: true });
          const file = path.join(folder, randomUUID() + "." + ext[mime]);
          fs.writeFileSync(file, bytes, { flag: "wx" });
          try {
            const asset = await this.importFile(file, "audio_A");
            return { id: String(asset.id) };
          } finally {
            fs.unlinkSync(file);
          }
        },
      });
    return this.music;
  }
  creationService() {
    if (!this.creative || this.creative.repo !== this.repo) {
      const registry = new TextProviderRegistry();
      if (this.mode === "simulation") registry.register(simulationText);
      this.creative = new CreationService(this.repo, this.mode, {
        registry,
        adapterId: this.mode === "simulation" ? "offline-fixture" : undefined,
        policy: this.mode === "simulation" ? simulationPolicy() : undefined,
        now: this.now,
      });
    }
    return this.creative;
  }
  constructor(
    public root: string,
    public mode: Mode,
    private options: { now?: () => Date;musicAdapter?:MusicAdapter;albumServiceFactory?:(studio:Studio)=>PlanAlbumService } = {},
  ) {
    this.now = options.now || (() => new Date());
    this.lastTick = this.now();
    fs.mkdirSync(root, { recursive: true });
    this.repo = new Repository(path.join(root, mode, "library.sqlite"));
    this.recover();
    if (!this.all("artists").length) {
      const a = this.save("artists", {
        id: randomUUID(),
        name: mode === "simulation" ? "林间 · 演练艺人" : "我的艺人",
        revision: 1,
        defaults: baseDefaults,
      });
      if (mode === "simulation") this.seed(a.id);
    }
    if (!this.repo.maybe("settings", "budget"))
      this.save("settings", {
        id: "budget",
        costLimit: 30000,
        candidateLimit: 10,
      });
    initializePlatformConfigurations(this.repo);
    this.providerTextService();
  }
  get db() {
    return this.repo.db;
  }
  all(t: Table) {
    return this.repo.all(t);
  }
  get(t: Table, id: string) {
    return this.repo.get(t, id);
  }
  save(t: Table, row: Row) {
    return this.repo.save(t, row);
  }
  close() {
    if (this.closing) return;
    this.directory?.close();
    this.inbox?.stop();
    this.creative?.stop();
    this.music?.stop();
    this.closing = true;
    for (const u of this.all("units"))
      if (u.state === "COMMITTING") {
        u.state = "SUBMISSION_UNKNOWN";
        this.markUnknown(u.id);
        this.save("units", u);
      } else if (
        ["READY", "PREPARING", "UPLOADING", "UPLOADED", "RETRY_WAIT"].includes(
          u.state,
        )
      ) {
        u.previousState = u.state;
        u.state = "PAUSED";
        this.save("units", u);
      }
    this.repo.close();
  }
  recover() {
    for(const op of this.all('operations').filter(o=>o.kind==='music'&&o.state==='dispatching'))this.save('operations',{...op,state:'unknown',costState:'unknown',reasons:['INTERRUPTED_SUBMISSION']});
    for (const u of this.all("units")) {
      if (u.state === "COMMITTING") {
        u.state = "SUBMISSION_UNKNOWN";
        this.markUnknown(u.id);
        this.save("units", u);
        this.exception("unit", u.id, "SUBMISSION_UNKNOWN", "unknown");
      } else if (
        ["READY", "UPLOADING", "UPLOADED", "RETRY_WAIT", "PREPARING"].includes(
          u.state,
        )
      ) {
        u.previousState = u.state;
        u.state = "PAUSED";
        this.save("units", u);
      }
    }
  }
  seed(artistId: string) {
    const series = this.save("series", {
      id: randomUUID(),
      title: "刚好是你",
      story: "相识 → 熟悉 → 告白；本地原创故事样本",
      workIds: [],
    });
    for (const [i, title] of ["那天刚好下雨", "顺路", "从今天起"].entries()) {
      const w = this.saveWork({
        title,
        artistId,
        story: [
          "雨天借伞，在街角第一次相识。",
          "下班后的顺路，变成默契的等待。",
          "把平常的陪伴，说成认真告白。",
        ][i],
        lyrics: [
          "雨落在屋檐\n你把伞倾向这边\n那一刻人潮忽然走远",
          "说是顺路的一段\n绕过了两个转弯\n没说出口的喜欢\n藏在晚安之前",
          "从今天起\n每个明天都留给你\n让普通的日子\n长成我们的四季",
        ][i],
        prompt: "本地原创歌词样本，未生成音频",
        parameters: {},
        seriesId: series.id,
        rights: "本地原创文字示例；音频、封面权益待导入",
        ai: "assisted",
      });
      series.workIds.push(w.id);
    }
    this.save("series", series);
  }
  async call(method: string, input: any = {}) {
    if(method.startsWith('planAlbums.'))return executePlanAlbums(this,method.slice('planAlbums.'.length),input);
    if(method.startsWith('planCenter.'))return executePlanCenter(this,method,input);
    const v: any = validate(method, input);
    if(method.startsWith('accountIdentity.'))return this.accountIdentityService().execute(method.slice('accountIdentity.'.length),v);
    if(method.startsWith('directoryTasks.')){
      const controller=this.directoryTasks(),action=method.slice('directoryTasks.'.length);
      if(action==='status')return controller.status();
      if(action==='save')return controller.save(v);
      if(action==='pause')return controller.pause(v);
      if(action==='resume')return controller.resume(v);
      if(action==='scanNow')return controller.scanNow(v);
      if(action==='stop')return controller.stop(v);
      throw Error('METHOD_NOT_ALLOWED');
    }
    if(method.startsWith('publish.')&&v.id&&['batches','units'].some(table=>this.repo.maybe(table as 'batches'|'units',v.id)?.kind==='tme_uia'))throw Error('TME_SPECIALIZED_CHANNEL_REQUIRED');
    switch (method) {
      case 'generationConfig.read': return readGenerationConfig(this.repo);
      case 'generationConfig.save': return saveGenerationConfig(this.repo,v);
      case 'manualCreation.prepare': return prepareManualCreation(this,v);
      case 'manualCreation.list': return listManualCreations(this);
      case 'platformConfig.list': return listPlatformConfigurations(this.repo);
      case 'platformConfig.save': return savePlatformConfiguration(this.repo,v.config,v.expectedRevision);
      case 'publish.selection.save': return savePublishSelection(this,v);
      case 'publish.metadata.save': return savePublicationMetadata(this,v);
      case 'publish.simple': return publishSimple(this,v);
      case 'tme.observations.record': return recordTmeObservation(this,v);
      case 'tme.observations.list': return listTmeObservations(this,v);
      case 'lyrics.preview': return this.lyricService().preview(v.workId);
      case 'lyrics.confirm': return this.lyricService().confirm(v);
      case 'publication.payload': return publicationPayload(this,this.get('works',v.workId));
      case 'cover.request': return this.coverHandoff().request(v);
      case 'cover.list': return this.coverHandoff().list(v.workId);
      case 'tme.preview': return this.tmeDraftService().preview(v);
      case 'tme.prepare': return this.tmeDraftService().prepare(v);
      case 'tme.list': return this.tmeDraftService().list();
      case 'tme.batchPlan': return this.tmeDraftService().planBatch(v);
      case 'tme.batches': return {batches:this.tmeDraftService().batches(),units:this.tmeDraftService().batchUnits()};
      case 'tme.batchCancel': return this.tmeDraftService().updateBatch(v.id,{state:'TME_CANCELLED',cancelled:true});
      case "inbox.status":
        return this.inboxController().status();
        case "inbox.bridge.pause": return this.inboxController().setBridgeEnabled(false,v.expectedRevision);
        case "inbox.bridge.resume": return this.inboxController().setBridgeEnabled(true,v.expectedRevision);
      case "inbox.configure":
        return this.inboxController().configure(v);
      case "inbox.pause":
        return this.inboxController().disable();
      case "inbox.listCandidates":
        return {
          candidates: this.all("textCandidates"),
          drafts: this.all("drafts").filter((d) => d.source === "local-inbox"),
          musicInput: selectedInboxMusicInput(this.repo),
        };
      case "inbox.selectMusicInput":
        return selectInboxMusicInput(this.repo, v.candidateId);
      case "inbox.getReceipt": {
        const channel = this.inboxController().status().channel;
        return (
          this.all("inboxReceipts").find(
            (r) =>
              r.channelId === channel?.id && r.receipt.batchId === v.batchId,
          )?.receipt ?? null
        );
      }
      case "dailyPlan.list": {
        const scheduler = this.dailyScheduler();
        return {
          plans: this.all("dailyPlans").map((p) => ({
            ...p,
            preview: scheduler.preview(p),
          })),
          occurrences: this.all("occurrences"),
          checkpoints: this.all("seriesCheckpoints"),
        };
      }
      case "dailyPlan.save":
        return this.dailyScheduler().save(v.plan, v.expectedRevision);
      case "dailyPlan.enable":
        return this.dailyScheduler().enable(v.id, v.expectedRevision);
      case "candidate.select":
        return selectCandidate(this.repo, v, (draft, candidate) => {
          const lyric=candidateLyricOrigin(candidate,draft);
          const w = this.saveWork({
            artistId: draft.artistId,
            title: draft.draft.title,
            story: draft.draft.storyBeat,
            lyrics: lyric.text,
            prompt: draft.pair.musicPrompt,
            parameters: {},
            seriesId: draft.seriesId ?? undefined,
            rights:
              candidate.source === "fixture"
                ? "本地原创诊断音与离线示例，非 AI 歌曲"
                : "授权依据待人工确认",
            ai: "unknown",
          },lyric.origin);
          this.save("works", {
            ...w,
            assets: { audio_A: candidate.assetId },
            assetHistory: [candidate.assetId],
            source: candidate.source,
          });
          return { id: w.id };
        });
      case "music.list":
        return {
          operations: this.all("operations").filter((o) => o.kind === "music"),
          candidates: this.all("candidates"),
        };
      case "music.prepare": {
        const service = this.musicService(),
          op = service.prepare(v);
        if (op.state === "prepared")
          void service
            .submit(op.id)
            .then(() => service.reconcile(op.id))
            .catch(() => undefined);
        return op;
      }
      case "music.reconcile": {
        const service = this.musicService();
        void service.reconcile(v.id).catch(() => undefined);
        return { requested: true };
      }
      case "music.retryDownloads": {
        const service = this.musicService();
        service.retryDownloads(v.id);
        void service.reconcile(v.id).catch(() => undefined);
        return { requested: true };
      }
      case "conversation.list":
        return {
          sessions: this.all("creativeSessions"),
          turns: this.all("creativeTurns"),
          drafts: this.all("drafts"),
          evaluations: this.all("evaluations"),
          balance: this.creationService().balance(),
        };
      case "conversation.generate": {
        const service = this.creationService(),
          turn = service.begin(v);
        if (turn.state === "queued")
          void service.execute(turn.id).catch(() => undefined);
        return turn;
      }
      case "textConfig.list":
        return this.all("settings")
          .filter((r) => r.id.startsWith("text-config:"))
          .map((r) => r.config);
      case "textConfig.save": {
        const profile = listApiProfiles(this.repo).find(
          (p) => p.id === v.config.profileId,
        );
        if (!profile || profile.kind !== "text")
          throw Error("TEXT_PROFILE_REQUIRED");
        if (
          ["deepseek", "codex_cli", "claude_code"].includes(profile.providerId)
        ) {
          if (v.config.adapterId !== profile.providerId)
            throw Error("TEXT_ADAPTER_MISMATCH");
          parseTextProviderProfile({
            providerId: profile.providerId,
            endpoint: v.config.endpoint,
            modelId: v.config.modelId,
            executionEnabled: v.config.executionEnabled,
          });
        }
        return this.repo.transaction(() => {
          const id = "text-config:" + profile.id,
            old = this.repo.maybe("settings", id);
          if (
            (old?.config.revision ?? 0) !== v.expectedRevision ||
            v.config.revision !== v.expectedRevision + 1
          )
            throw Error("REVISION_CONFLICT");
          this.save("settings", { id, config: v.config });
          return v.config;
        });
      }
      case "apiProfile.list":
        return listApiProfiles(this.repo);
      case "apiProfile.save":
        return saveApiProfile(this.repo, v);
      case "snapshot":
        return this.snapshot();
      case "metrics.read":
        return this.all("metrics");
      case "artist.save": {
        const old = v.id ? this.get("artists", v.id) : null;
        if (old && v.expected !== old.revision)
          throw Error("REVISION_CONFLICT");
        const a = this.save("artists", {
          ...v,
          id: v.id || randomUUID(),
          revision: (old?.revision || 0) + 1,
        });
        this.repo.audit("artist.save", a.id);
        return a;
      }
      case "account.save": {
        const old = v.id ? this.get("accounts", v.id) : null;
        if (old && old.provider !== v.provider)
          throw Error("IDENTITY_IMMUTABLE");
        return this.save("accounts", {
          ...v,
          id: v.id || randomUUID(),
          authStatus:
            this.mode === "simulation" ? "simulation" : "not_connected",
          remoteSubject: null,
          scopes: [],
          providerBalance: null,
        });
      }
      case "binding.save": {
        this.get("artists", v.artistId);
        const account = this.get("accounts", v.accountId);
        const allowed: Record<string, string[]> = { tme: ["qqmusic", "kugou"] };
        if (
          v.targets.some(
            (x: string) =>
              !(allowed[account.provider] || [account.provider]).includes(x),
          )
        )
          throw Error("TARGET_ACCOUNT_MISMATCH");
        return this.save("bindings", {
          ...v,
          id: randomUUID(),
          revision: 1,
          status: this.mode === "simulation" ? "simulation" : "local_only",
          operations: ["prepare"],
        });
      }
      case "binding.revoke": {
        const b = this.get("bindings", v.id);
        b.status = "revoked";
        b.revision++;
        this.save("bindings", b);
        for (const u of this.all("units").filter(
          (u) =>
            u.bindingId === b.id &&
            !["SUBMITTED", "SUBMISSION_UNKNOWN", "CANCELLED"].includes(u.state),
        )) {
          u.state = "BLOCKED";
          u.reason = "BINDING_REVOKED";
          this.save("units", u);
        }
        return b;
      }
      case "work.save":
        return this.saveWork(v);
      case "work.version": {
        const w = this.get("works", v.id);
        const r = this.save("revisions", {
          ...w,
          id: randomUUID(),
          workId: w.id,
          revisionId: w.id,
          createdAt: this.now().toISOString(),
        });
        this.repo.audit("work.version", w.id, { revisionId: r.id });
        return r;
      }
      case "work.selectAsset": {
        return this.repo.transaction(()=>{
        const coverBinding=v.role==='cover'?assertPlanCoverWork(this,v.workId):null;
        if(coverBinding)this.coverHandoff().verifiedSelectedReceipt(v.workId,v.assetId);
        const w = this.get("works", v.workId);
        const a = this.get("assets", v.assetId);
        this.locate(a.id);
        if (!(w.assetHistory || []).includes(a.id))
          throw Error("ASSET_OWNERSHIP");
        if (
          (v.role.startsWith("audio") && a.kind !== "audio") ||
          (v.role === "cover" && a.kind !== "image") ||
          (v.role === "video" && a.kind !== "video")
        )
          throw Error("ASSET_ROLE");
        w.assets[v.role] = v.assetId;
        if (v.role === 'audio_A') w.lyricsConfirmation = null;
        this.save("works", w);
        return w;
        });
      }
      case "series.save": {
        for (const id of v.workIds) this.get("works", id);
        const row = { ...v, id: v.id || randomUUID() };
        this.save("series", row);
        for (const id of v.workIds) {
          const w = this.get("works", id);
          w.seriesId = row.id;
          this.save("works", w);
        }
        return row;
      }
      case "creation.start":
        return this.startCreation(v);
      case "run.confirm":
        return this.confirmRun(v.id, v.step);
      case "plan.save":
        return this.savePlan(v);
      case "plan.toggle": {
        if(isLegacyOwned(this.repo,'plans',v.id))throw Error('PLAN_CENTER_OWNS_SCHEDULE');
        const p = this.get("plans", v.id);
        p.enabled = v.enabled;
        this.save("plans", p);
        return p;
      }
      case "plan.preview":
        return this.preview(this.get("plans", v.id));
      case "plan.run": {
        if(isLegacyOwned(this.repo,'plans',v.id))throw Error('PLAN_CENTER_OWNS_SCHEDULE');
        const p = this.get("plans", v.id);
        return this.startCreation({
          artistId: p.artistId,
          title: p.title,
          story: p.story,
          overrides: p.overrides,
          planId: p.id,
          manual: true,
        });
      }
      case "budget.save":
        return this.save("settings", { id: "budget", ...v });
      case "publish.quick":
        return publishing.quick(this, v);
      case "publish.plan":
        return publishing.plan(this, v);
      case "publish.approve":
        return publishing.approve(this, v);
      case "publish.start":
        return publishing.start(this, v.id);
      case "publish.retry":
        return publishing.retry(this, v.id);
      case "publish.pause":
        return publishing.pause(this, v.id);
      case "publish.cancel":
        return publishing.cancel(this, v.id);
      case "publish.reconcile":
        return publishing.reconcile(this, v.id);
      case "publish.revalidate":
        return publishing.revalidate(this, v.id);
      case "publish.recordManual":
        return publishing.recordManual(this, v);
      case "publish.simulateFault":
        return publishing.setFault(this, v.id, v.kind);
      case "exception.retry": {
        const e = this.get("exceptions", v.id);
        if (e.kind === "unit") return publishing.retryUnit(this, e.entityId);
        if (e.kind === "run") {
          const r = this.get("runs", e.entityId);
          if (r.state === "unknown") throw Error("RECONCILE_FIRST");
          this.refreshRunForWork(r.workId);
          return this.get("runs", r.id);
        }
        throw Error("RETRY_UNSAFE");
      }
      case "cover.task": {
        const w = this.get("works", v.workId),
          a = this.get("artists", w.artistId);
        return {
          text: `Codex 封面协作任务\n歌名：${w.title}\n艺名：${a.name}\n故事：${w.story}\n歌词：${w.lyrics}\n曲风：${w.config.genre}\n封面风格：${w.config.coverStyle}\n补充：${v.brief}\n请生成无文字方形母版，保留歌名/艺名排版留白。避免他人商标/受保护角色。输出PNG并记录生成来源。\n生成后由用户导入本应用；本应用没有内置免费Codex图像API。`,
        };
      }
      case "video.prepare":
        return assets.prepareVideo(this, v.workId, v.recordingSlot);
      case "goal.complete": {
        const run = this.all("runs").find((r) => r.workId === v.workId);
        if (run) {
          if (v.planId && v.planId !== run.planId) throw Error("PLAN_SCOPE");
          return this.confirmRun(run.id, "finished");
        }
        return this.complete(v.workId, v.planId);
      }
      default:
        throw Error("METHOD_NOT_ALLOWED");
    }
  }
  snapshot() {
    const today = this.now().toISOString().slice(0, 10);
    const budget = this.get("settings", "budget");
    const cost = this.ensureBucket(
        "cost",
        "workspace",
        today,
        budget.costLimit,
      ),
      candidate = this.ensureBucket(
        "candidate",
        "workspace",
        today,
        budget.candidateLimit,
      );
    return {
      mode: this.mode,
      platformConfigurations: listPlatformConfigurations(this.repo),
      publicationRequests: listSimplePublicationRequests(this),
      publicationPipelineJobs: this.mode === "production" ? unifiedPublicationService(this).list() : [],
      publicationPendingTerms: listPublicationPendingTerms(this),
      publishSelection: publishSelection(this),
      artists: this.all("artists"),
      accounts: this.all("accounts"),
      bindings: this.all("bindings"),
      works: this.all("works"),
      tmeObservations: listTmeObservations(this),
      revisions: this.all("revisions"),
      assets: this.all("assets").map((a) => ({
        ...a,
        metadata:
          a.kind === "image"
            ? { width: a.metadata.width, height: a.metadata.height }
            : { duration: a.metadata?.format?.duration },
      })),
      series: this.all("series"),
      plans: this.all("plans").map((p) => ({ ...p, next: this.preview(p) })),
      runs: this.all("runs"),
      steps: this.all("steps"),
      batches: this.all("batches"),
      units: this.all("units"),
      targets: this.all("targets"),
      exceptions: this.all("exceptions").filter((e) => e.state !== "resolved"),
      resources: {
        cost: this.balance(cost.id),
        candidate: this.balance(candidate.id),
        submissions: this.all("buckets")
          .filter((b) => b.kind.startsWith("submission"))
          .map((b) => this.balance(b.id)),
        finished: this.all("completions").filter((c) => c.active).length,
      },
      budget,
      metrics: this.all("metrics"),
      audit: this.all("audit").slice(-60),
      capabilities: {
        generation: "manual_import",
        cover: "codex_handoff",
        publishing: "manual_materials",
        analytics: "csv_import",
      },
      tools: {
        ffmpeg: fs.existsSync(assets.ffmpeg),
        ffprobe: fs.existsSync(assets.ffprobe),
      },
      externalRequests: this.externalRequests,
    };
  }
  saveWork(v: any, lyricOrigin?:LyricOrigin) {
    const old = v.id ? this.get("works", v.id) : null;
    if (old && v.expected !== old.revision) throw Error("REVISION_CONFLICT");
    const artist = this.get("artists", v.artistId);
    const config = defaultsSchema.parse({
      ...artist.defaults,
      ...v.parameters,
    });
    const w = {
      ...old,
      ...v,
      id: v.id || randomUUID(),
      revision: (old?.revision || 0) + 1,
      assets: old?.assets || {},
      assetHistory: old?.assetHistory || [],
      config,
      configHash: hash(config),
      defaultsRevision: artist.revision,
      createdAt: old?.createdAt || this.now().toISOString(),
      updatedAt: this.now().toISOString(),
    };
    delete w.expected;
    this.repo.transaction(() => {
      if(!old||old.lyrics!==w.lyrics||!w.lyricsVersionId)this.lyricService().record(w,lyricOrigin??{kind:'manual'});
      if (old)
        this.save("revisions", { ...old, id: randomUUID(), workId: old.id });
      this.save("works", w);
      this.repo.audit("work.save", w.id, { revision: w.revision });
    });
    return w;
  }
  checkBinding(
    id: string,
    artistId: string,
    accountId: string,
    target: string,
  ) {
    const b = this.get("bindings", id);
    if (
      b.artistId !== artistId ||
      b.accountId !== accountId ||
      b.status === "revoked" ||
      !b.targets.includes(target)
    )
      throw Error("BINDING_SCOPE");
    this.get("accounts", accountId);
    return true;
  }
  startCreation(v: any) {
    const artist = this.get("artists", v.artistId),
      p = v.planId ? this.get("plans", v.planId) : null;
    if (p && p.artistId !== artist.id) throw Error("ARTIST_PLAN_MISMATCH");
    const config = defaultsSchema.parse({
      ...artist.defaults,
      ...p?.overrides,
      ...v.overrides,
    });
    const lyrics = `[主歌]\n${v.story.slice(0, 100) || "把今天的心事，轻轻写进晚风"}\n走过熟悉街角，记得你微笑\n\n[副歌]\n如果这一刻能慢一点\n让我把喜欢写成明天\n`;
    const prompt = `本地模板 · ${config.genre}；${config.language}；${config.voice}；${config.mood}；BPM参考${config.bpmMin}–${config.bpmMax}；时长参考${config.duration}秒。故事：${v.story}`;
    const w = this.saveWork({
      title: v.title,
      artistId: artist.id,
      story: v.story,
      lyrics,
      prompt,
      parameters: v.overrides || {},
      rights: "待确认原创/生成来源与商用依据",
      ai: "unknown",
    });
    const run = this.save("runs", {
      id: randomUUID(),
      planId: p?.id || null,
      date: v.date || null,
      slot: v.date ? "daily" : null,
      planRevision: p?.revision,
      workId: w.id,
      artistId: artist.id,
      config,
      configHash: hash(config),
      defaultsRevision: artist.revision,
      checkpoints: p?.checkpoints || {
        lyrics: "automatic",
        candidate: "manual",
        cover: "manual",
        finished: "manual",
        publish: "manual",
      },
      state:
        p?.checkpoints.lyrics === "manual"
          ? "waiting_confirmation"
          : "waiting_external",
      step: p?.checkpoints.lyrics === "manual" ? "lyrics" : "generation",
      createdAt: this.now().toISOString(),
    });
    for (const name of [
      "lyrics",
      "generation",
      "candidate",
      "cover",
      "finished",
      "publish",
    ])
      this.save("steps", {
        id: randomUUID(),
        runId: run.id,
        name,
        state:
          name === "lyrics"
            ? run.step === "lyrics"
              ? "waiting_confirmation"
              : "succeeded"
            : name === "generation"
              ? run.step === "generation"
                ? "waiting_external"
                : "pending"
              : "pending",
        inputHash: hash({ config, story: v.story }),
        outputRefs: name === "lyrics" ? [w.id] : [],
        cost: 0,
        source: "local",
        operationKey: `${run.id}:${name}`,
      });
    this.exception("run", run.id, "GENERATION_MANUAL_IMPORT", "not_applicable");
    this.repo.audit("creation.start", run.id, {
      source: v.date ? "scheduled" : "manual",
    });
    return run;
  }

  refreshRunForWork(workId: string) {
    const w = this.get("works", workId);
    for (const r of this.all("runs").filter(
      (r) => r.workId === workId && r.state !== "succeeded",
    )) {
      const steps = this.all("steps").filter((x) => x.runId === r.id);
      const step = (name: string) => steps.find((x) => x.name === name)!;
      const finish = (name: string, outputs: string[] = []) => {
        const row = step(name);
        if (
          row.state !== "succeeded" ||
          JSON.stringify(row.outputRefs) !== JSON.stringify(outputs)
        ) {
          row.state = "succeeded";
          row.outputRefs = outputs;
          this.save("steps", row);
        }
      };
      const wait = (name: string, state: string) => {
        r.step = name;
        r.state = state;
        const row = step(name);
        row.state = state;
        this.save("steps", row);
        this.save("runs", r);
      };
      if (step("lyrics").state !== "succeeded") {
        wait("lyrics", "waiting_confirmation");
        continue;
      }
      if (!w.assets.audio_A) {
        wait("generation", "waiting_external");
        continue;
      }
      finish("generation", [w.assets.audio_A]);
      for (const e of this.all("exceptions").filter(
        (e) => e.entityId === r.id && e.code === "GENERATION_MANUAL_IMPORT",
      ))
        this.save("exceptions", { ...e, state: "resolved" });
      if (
        r.checkpoints.candidate === "manual" &&
        step("candidate").state !== "succeeded"
      ) {
        wait("candidate", "waiting_confirmation");
        continue;
      }
      finish("candidate", [w.assets.audio_A]);
      if (!w.assets.cover) {
        wait("cover", "waiting_external");
        continue;
      }
      if (
        r.checkpoints.cover === "manual" &&
        step("cover").state !== "succeeded"
      ) {
        wait("cover", "waiting_confirmation");
        continue;
      }
      finish("cover", [w.assets.cover]);
      if (
        r.checkpoints.finished === "manual" &&
        step("finished").state !== "succeeded"
      ) {
        wait("finished", "waiting_confirmation");
        continue;
      }
      try {
        this.complete(w.id, r.planId);
        finish("finished", [w.id]);
        r.state = "succeeded";
        r.step = "publish";
        this.save("runs", r);
      } catch {
        wait("finished", "waiting_confirmation");
      }
    }
  }
  confirmRun(id: string, name: string) {
    const r = this.get("runs", id);
    if (r.step !== name || r.state !== "waiting_confirmation")
      throw Error("CHECKPOINT_MISMATCH");
    if (name === "finished") this.complete(r.workId, r.planId);
    const step = this.all("steps").find(
      (x) => x.runId === id && x.name === name,
    );
    if (!step) throw Error("STEP_MISSING");
    const work = this.get("works", r.workId);
    const outputs =
      name === "candidate"
        ? [work.assets.audio_A]
        : name === "cover"
          ? [work.assets.cover]
          : [work.id];
    this.save("steps", { ...step, state: "succeeded", outputRefs: outputs });
    this.refreshRunForWork(r.workId);
    return this.get("runs", id);
  }

  complete(workId: string, planId?: string) {
    const w = this.get("works", workId),
      run = this.all("runs").find((r) => r.workId === workId),
      effectivePlan = planId || run?.planId;
    let goalDate = this.now().toISOString().slice(0, 10);
    if (effectivePlan) {
      const p = this.get("plans", effectivePlan);
      if (p.artistId !== w.artistId || !run || run.planId !== p.id)
        throw Error("PLAN_SCOPE");
      goalDate =
        run.date ||
        DateTime.fromJSDate(this.now(), { zone: p.timezone }).toISODate()!;
    }
    if (run) {
      if (run.artistId !== w.artistId) throw Error("ARTIST_RUN_MISMATCH");
      const steps = this.all("steps").filter((x) => x.runId === run.id);
      for (const name of ["lyrics", "generation", "candidate", "cover"])
        if (steps.find((x) => x.name === name)?.state !== "succeeded")
          throw Error("CHECKPOINT_REQUIRED");
      for (const [name, id] of [
        ["candidate", w.assets.audio_A],
        ["cover", w.assets.cover],
      ])
        if (!steps.find((x) => x.name === name)?.outputRefs?.includes(id))
          throw Error("CHECKPOINT_STALE");
    }
    if (
      !w.assets.audio_A ||
      !w.assets.cover ||
      !w.rights ||
      w.rights.startsWith("待") ||
      w.ai === "unknown" ||
      (!w.lyrics && w.config.voice !== "instrumental")
    )
      throw Error("FINISHED_REQUIREMENTS");
    this.locate(w.assets.audio_A);
    this.locate(w.assets.cover);
    const key = effectivePlan || "manual",
      old = this.all("completions").find(
        (x) => x.workId === workId && x.planKey === key,
      );
    if (old) return old;
    return this.save("completions", {
      id: randomUUID(),
      workId,
      planKey: key,
      date: goalDate,
      revision: w.revision,
      active: true,
      at: this.now().toISOString(),
    });
  }
  savePlan(v: any) {
    assertLegacyScheduleEditable(this.repo,'plans',v.id);
    if (!DateTime.now().setZone(v.timezone).isValid)
      throw Error("TIMEZONE_INVALID");
    const [h, m] = v.time.split(":").map(Number);
    if (h > 23 || m > 59) throw Error("TIME_INVALID");
    const a = this.get("artists", v.artistId);
    defaultsSchema.parse({ ...a.defaults, ...v.overrides });
    const old = v.id ? this.get("plans", v.id) : null;
    const p = this.save("plans", {
      ...v,
      id: v.id || randomUUID(),
      revision: (old?.revision || 0) + 1,
      createdAt: old?.createdAt || this.now().toISOString(),
    });
    this.repo.audit("plan.save", p.id);
    return p;
  }
  resolveSchedule(date: string, time: string, zone: string) {
    const start = DateTime.fromISO(date, { zone }).startOf("day").toUTC();
    const target = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    for (let i = 0; i < 26 * 60; i++) {
      const utc = start.plus({ minutes: i }),
        local = utc.setZone(zone);
      if (local.toISODate() !== date) continue;
      if (local.hour * 60 + local.minute >= target) return utc.toISO()!;
    }
    throw Error("SCHEDULE_INVALID");
  }
  preview(p: any) {
    const now = DateTime.fromJSDate(this.now(), { zone: p.timezone });
    const list: string[] = [];
    for (let n = 0; n < 5 && list.length < 3; n++) {
      const date = now.plus({ days: n }).toISODate()!;
      const at = this.resolveSchedule(date, p.time, p.timezone);
      if (new Date(at) > this.now()) list.push(at);
    }
    return list;
  }
  async tick() {
    await this.directoryTasks().tick();
    tickPlanCenter(this);
    if(this.mode==='production')this.productionFlowService().tick();
    if (Date.now() - this.inboxTickAt >= 5000) {
      this.inboxTickAt = Date.now();
      await this.scanInbox();
    }
    await this.dailyScheduler().tick();
    if (this.music)
      for (const op of this.all("operations").filter(
        (o) => o.kind === "music" && ["accepted", "polling"].includes(o.state),
      ))
        void this.music.reconcile(op.id).catch(() => undefined);
    const now = this.now(),
      from = this.lastTick;
    this.lastTick = now;
    if (now.getTime() - from.getTime() <= 90000 && now >= from) {
      for (const p of this.all("plans").filter((p) => p.enabled&&!isLegacyOwned(this.repo,'plans',p.id))) {
        const date = DateTime.fromJSDate(now, {
          zone: p.timezone,
        }).toISODate()!;
        const due = new Date(this.resolveSchedule(date, p.time, p.timezone));
        if (
          due > from &&
          due <= now &&
          !this.all("runs").some((r) => r.planId === p.id && r.date === date) &&
          !this.all("runs").some(
            (r) =>
              r.planId === p.id &&
              !["succeeded", "cancelled"].includes(r.state),
          )
        )
          this.repo.transaction(() =>
            this.startCreation({
              artistId: p.artistId,
              title: p.title,
              story: p.story,
              overrides: p.overrides,
              planId: p.id,
              date,
            }),
          );
      }
    }
    await publishing.tick(this);
  }
  exception(
    kind: string,
    entityId: string,
    code: string,
    remoteOutcome: string,
  ) {
    const exists = this.all("exceptions").find(
      (e) =>
        e.kind === kind &&
        e.entityId === entityId &&
        e.code === code &&
        e.state !== "resolved",
    );
    if (exists) return exists;
    return this.save("exceptions", {
      id: randomUUID(),
      kind,
      entityId,
      code,
      remoteOutcome,
      state: "open",
      at: this.now().toISOString(),
      source: this.mode === "simulation" ? "simulation" : "local",
    });
  }
  ensureBucket(
    kind: string,
    scope: string,
    date: string,
    limit: number,
    zone?: string,
  ) {
    return resources.ensureBucket(this, kind, scope, date, limit, zone);
  }
  balance(id: string) {
    return resources.balance(this, id);
  }
  reserve(op: string, r: { id: string; amount: number }[]) {
    return resources.reserve(this, op, r);
  }
  settle(op: string, event: string) {
    return resources.settle(this, op, event);
  }
  release(op: string, evidence: string) {
    return resources.release(this, op, evidence);
  }
  markUnknown(op: string) {
    return resources.markUnknown(this, op);
  }
  rollover(op: string) {
    return resources.rollover(this, op);
  }
  async importFile(source: string, role: string, workId?: string, beforePersist?:()=>void) {
    if(workId&&role==='cover'&&assertPlanCoverWork(this,workId))throw Error('COVER_HANDOFF_REQUIRED');
    return assets.importFile(this, source, role, workId,beforePersist);
  }
  locate(id: string) {
    return assets.locate(this, id);
  }
  backup(destination: string) {
    return archives.backup(this, destination);
  }
  async restore(source: string) {
    archives.assertRestoreSafe(this);
    this.directory?.close();
    this.inbox?.stop();
    this.creative?.stop();
    this.music?.stop();
    try {
      return await archives.restore(this, source);
    } finally {
      this.creative = undefined;
      this.music = undefined;
      this.daily = undefined;
      this.inbox = undefined;
      this.directory = undefined;
      this.providerText = undefined;
    }
  }
  async importReport(source: string) {
    if (fs.statSync(source).size > 10 * 1024 * 1024)
      throw Error("REPORT_LIMIT");
    const data = fs.readFileSync(source, "utf8");
    const records = parse(data, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      relax_column_count: false,
    });
    if (records.length > 50000) throw Error("ROW_LIMIT");
    return this.repo.transaction(() => {
      for (const row of records as Row[]) {
        if (
          !["netease", "qishui", "qqmusic", "kugou", "douyin"].includes(
            row.platform,
          ) ||
          !DateTime.fromISO(row.date).isValid
        )
          throw Error("REPORT_FIELDS");
        const metricKey = hash([row.platform, row.account, row.work, row.date]);
        const old = this.all("metrics").find((m) => m.metricKey === metricKey);
        const result: Row = {
          id: old?.id || randomUUID(),
          metricKey,
          platform: row.platform,
          account: row.account,
          work: row.work,
          date: row.date,
          source: "import",
          importedAt: this.now().toISOString(),
          fileHash: hash(data),
          timezone: "user_report_unspecified",
        };
        for (const field of ["plays", "favorites", "comments"]) {
          result[field] =
            row[field] === undefined || row[field] === ""
              ? null
              : Number(row[field]);
          if (
            result[field] !== null &&
            (!Number.isSafeInteger(result[field]) || result[field] < 0)
          )
            throw Error("METRIC_INVALID");
        }
        this.save("metrics", result);
      }
      return { rows: records.length, source: "import" };
    });
  }
}
