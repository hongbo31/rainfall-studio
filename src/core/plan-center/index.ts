import {freezePlanIdentities} from '../plan-identity';
import {freezePlanRoutes,planRouteIssue,freezeArtist,frozenRouteIssue} from '../generation-config';
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { parseDraft } from '../../shared/creation';
import { TextEvaluationScoreSchema } from '../../shared/text-evaluation';
import { PairSchema } from '../quality/contracts';
import { pairHash } from '../quality/scoring';
import type { Repository } from '../database';
import { PlanCenterPlanSchema, PlanCenterSaveSchema, PlanCenterDeleteSchema, PlanCenterToggleSchema, PlanCenterScheduleCreationSchema, PlanCenterIdSchema, PlanCenterRunSchema, PlanCenterStopSchema, PlanCenterClaimSchema, PlanCenterRecordSchema, PlanCenterReconcileSchema, PlanCenterRetrySchema, PlanCenterMaterialsSchema, PlanCenterCapabilitySchema, PlanCenterCapabilityNames, isPublicationPlan } from '../../shared/plan-center';
import type { CreationTaskSummary, PlanCenterPlan, PlanCenterPlanInput, PlanCenterCapabilities, PlanCenterCapabilityName, PlanCenterRun, PlanCenterItem, PlanCenterStage, PlanCenterStageAttempt, PlanCenterPublishAttempt, PlanCenterAlbumBinding, PlanCenterPublishTarget, PlanCenterList, PlanCenterMigration } from '../../shared/plan-center';
import { planRunActive, planRunBlocksDeletion, planStageCancelsOnStop } from '../../shared/plan-center';
import { CenterStore, digest, isLegacyOwned } from './storage';
import { dueTimes } from './schedule';
import {providerPlanProof} from '../provider-plan-text';
import {ProviderTextJobSchema} from '../../shared/provider-text';
import {authorizeGraphPlanExecution,freezePlanWorkflow,planWorkflowIssue,planWorkflowMusicIssue,verifiedPlanLyrics} from '../plan-workflow';
import {isLocalPublicationWorkflow,workflowPublicationPlatforms} from '../../shared/plan-workflow-graph';
import {workflowBrowserMusic} from '../../shared/plan-workflow-fields';
import {readWorkflowPublication} from '../plan-workflow-publication';
export { isLegacyOwned } from './storage';

export type PlanCenterOptions = {
  now?:()=>Date|string;
  capabilities?:Partial<PlanCenterCapabilities>|(()=>Partial<PlanCenterCapabilities>);
  ports?:{albumCatalog?:(input:{platform:string;accountId:string})=>{evidenceId:string;albums:Array<{id:string}>}};
  // Recovery is a process-start action. Long-lived integrations must reuse the service instance.
  recoverDispatching?:boolean;
  prepareDownloads?: (plan: PlanCenterPlan) => NonNullable<PlanCenterRun['downloadFolders']>;
};
const terminalRuns=new Set(['completed','stopped','failed']);
const names:Record<PlanCenterStage,PlanCenterCapabilityName|undefined>={dot:'dot',text_generate:'text',text_score:'text',lyric_write:'text',cover:'cover',music_submit:'music',music_assets:'music',materials:undefined};
const safeId=z.string().min(1).max(500);
const targetInput=z.strictObject({runId:safeId,platform:safeId,accountId:safeId});
const publishInput=targetInput.extend({itemId:safeId});
const missingTheme=(plan:PlanCenterPlanInput)=>['provider','pule_prompt'].includes(plan.material.source??'dot')&&!plan.theme?.trim()&&!plan.storyContext?.storyBeat.trim();
const deletedPlanKey=(id:string)=>'plan-center:deleted-plan:'+id;

function creationTaskState(run?: PlanCenterRun, item?: PlanCenterItem): CreationTaskSummary['state'] {
  if (!run) return 'pending';
  if (run.state === 'completed' || run.state === 'stopped') return run.state;
  if (item?.state === 'unknown') return 'unknown';
  if (run.state === 'stopping') return 'stopping';
  if (run.state === 'failed' || item?.state === 'failed' || item?.state === 'not_found') return 'failed';
  if (run.state === 'blocked') return 'blocked';
  if (item?.reason === 'COVER_REQUIRED') return 'awaiting_cover';
  return 'running';
}
export class PlanCenterService {
  private store:CenterStore;
  constructor(readonly repo:Repository,readonly options:PlanCenterOptions={}) {
    this.store=new CenterStore(repo);
    if(options.recoverDispatching!==false)this.recover();
  }
  private now() {const n=this.options.now?.()??new Date();return new Date(n).toISOString();}
  private checkCreationSchedule(plan:PlanCenterPlan) {
    if((plan.material.source!=='creation'&&!plan.workflow)||!plan.enabled||plan.schedule.kind!=='once')return;
    const at=DateTime.fromISO(`${plan.schedule.date}T${plan.schedule.localTime}`,{zone:plan.timezone});
    if(at.toMillis()<=Date.parse(this.now()))throw Error('CREATION_SCHEDULE_IN_PAST');
  }
  capabilities():PlanCenterCapabilities {
    const supplied=typeof this.options.capabilities==='function'?this.options.capabilities():this.options.capabilities??{};
    const result={} as PlanCenterCapabilities;
    for(const key of PlanCenterCapabilityNames)result[key]=PlanCenterCapabilitySchema.parse(supplied[key]??{available:false,reason:key==='dot'?'DOT_CREATION_PORT_UNAVAILABLE':`${key.toUpperCase()}_PORT_UNAVAILABLE`});
    return result;
  }
  list():PlanCenterList {
    return {plans:this.store.all('plan'),runs:this.store.all('run'),items:this.store.all('item'),stageAttempts:this.store.all('stage'),publishAttempts:this.store.all('publish'),occurrences:this.store.all('occurrence'),albumBindings:this.store.all('album'),migration:this.store.all('migration').at(-1)??null};
  }
  listCreationTasks(): CreationTaskSummary[] {
    const plans = this.store.all('plan').filter(plan => plan.creationDraft);
    if (!plans.length) return [];
    const latestRuns = new Map<string, PlanCenterRun>();
    for (const run of this.store.all('run')) {
      if (run.snapshot.material.source !== 'creation') continue;
      const previous = latestRuns.get(run.planId);
      if (!previous || run.createdAt >= previous.createdAt) latestRuns.set(run.planId, run);
    }
    const items = new Map(this.store.all('item').map(item => [item.runId, item]));
    const coverErrors = new Map<string, string>();
    for (const { id, value } of this.repo.all('settings')) {
      if (!id.startsWith('cover-inbox:') || value?.state !== 'waiting' || typeof value.planItemId !== 'string') continue;
      const reason = value.reason ?? value.generation?.reason;
      if (typeof reason === 'string') coverErrors.set(value.planItemId, reason);
    }
    return plans.reverse().sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).map(plan => {
      const run = latestRuns.get(plan.id);
      const item = run && items.get(run.id);
      const state = creationTaskState(run, item);
      return {
        planId: plan.id, runId: run?.id, workId: item?.workId,
        title: plan.title, style: plan.creationDraft!.style,
        state, reason: state==='stopped' ? run?.reason :
          (state==='awaiting_cover' && item ? coverErrors.get(item.id) : undefined) ?? item?.reason ?? run?.reason,
      };
    });
  }
  save(input:{plan:PlanCenterPlanInput;expectedRevision:number|null}) {
    const parsed=PlanCenterSaveSchema.parse(input);
    this.checkCreationSchedule(parsed.plan);
    if(parsed.plan.enabled&&missingTheme(parsed.plan))throw Error('THEME_REQUIRED');
    return this.repo.transaction(()=>{
      const old=this.store.get('plan',parsed.plan.id);
      if(!old&&this.repo.maybe('settings',deletedPlanKey(parsed.plan.id)))throw Error('PLAN_DELETED');
      if((old?.revision??null)!==parsed.expectedRevision)throw Error('REVISION_CONFLICT');
      if(parsed.plan.fanqie?.accountId&&this.repo.maybe('accounts',parsed.plan.fanqie.accountId)?.provider!=='fanqie')
        throw Error('ACCOUNT_PROVIDER_MISMATCH');
      const promptPlan=parsed.plan.material.source==='pule_prompt';
      const instrumental=parsed.plan.songType==='instrumental';
      if(instrumental&&(!parsed.plan.outputs.music||!['provider','pule_prompt','creation','workflow'].includes(parsed.plan.material.source)))throw Error('INSTRUMENTAL_MUSIC_REQUIRED');
      const typedPlan=instrumental&&!parsed.plan.workflow?{...parsed.plan,outputs:{...parsed.plan.outputs,lyrics:false},text:{...parsed.plan.text,consent:false},authorization:{...parsed.plan.authorization,text:false}}:parsed.plan;
      const planInput=promptPlan?{
        ...typedPlan,outputs:{...typedPlan.outputs,cover:true},
        ...(parsed.plan.routing||!parsed.plan.music.profileId?{}:{routing:{
          text:{source:'default' as const},image:{source:'default' as const},
          music:{source:'override' as const,profileId:parsed.plan.music.profileId},
        }}),
      }:typedPlan;
      const local=isLocalPublicationWorkflow(planInput.workflow?.graph);
      let inputPlan=freezePlanWorkflow(this.repo,local?planInput:freezePlanIdentities(this.repo,freezeArtist(this.repo,freezePlanRoutes(this.repo,planInput))));
      this.checkWorkflowSchedule(inputPlan);
      if(!inputPlan.workflow&&old?.routeSnapshot&&digest(old.routeSnapshot)!==digest(inputPlan.routeSnapshot)){inputPlan={...inputPlan,text:{...inputPlan.text,consent:false},music:{...inputPlan.music,consent:false},authorization:{...inputPlan.authorization,text:false,music:false}};}
      if(inputPlan.material.source==='provider'&&!instrumental&&inputPlan.text.profileId){
        const profile=this.repo.maybe('settings','api-profile:'+inputPlan.text.profileId);
        if(!profile||profile.kind!=='text'||!['deepseek','doubao'].includes(profile.providerId))throw Error('TEXT_PROFILE_REQUIRED');
        if(profile.revision!==inputPlan.text.profileRevision)throw Error('PROFILE_REVISION_CHANGED');
        inputPlan={...inputPlan,text:{...inputPlan.text,modelId:profile.modelId??undefined,maxOutputTokens:inputPlan.text.maxOutputTokens??2048}};
      }
      const now=this.now(),plan=this.store.put('plan',{...inputPlan,revision:(old?.revision??0)+1,createdAt:old?.createdAt??now,updatedAt:now});
      if(!old||digest(old.schedule)!==digest(plan.schedule)||old.enabled!==plan.enabled)
        this.store.put('cursor',{id:plan.id,lastAt:now});
      return plan;
    });
  }
  read(input:z.input<typeof PlanCenterIdSchema>) {
    const {id}=PlanCenterIdSchema.parse(input),plan=this.store.get('plan',id);
    if(!plan)throw Error('NOT_FOUND');
    return plan;
  }
  delete(input:z.input<typeof PlanCenterDeleteSchema>, onStopped?:(run:PlanCenterRun)=>void) {
    const {id,expectedRevision}=PlanCenterDeleteSchema.parse(input);
    return this.repo.transaction(()=>{
      const plan=this.read({id});
      if(plan.revision!==expectedRevision)throw Error('REVISION_CONFLICT');
      const rows=this.list(),unfinished=rows.runs.filter(run=>run.planId===id&&!terminalRuns.has(run.state));
      if(unfinished.some(run=>planRunBlocksDeletion(run,rows)))throw Error('ACTIVE_RUN');
      for(const run of unfinished){
        const stopped=this.stop({runId:run.id});
        onStopped?.(stopped);
      }
      this.repo.save('settings',{id:deletedPlanKey(id),value:{plan,deletedAt:this.now()}});
      this.store.remove('plan',id);
      this.store.remove('cursor',id);
      this.repo.audit('planCenter.plan.deleted',id,{revision:expectedRevision});
      return {id};
    });
  }
  toggle(input:z.input<typeof PlanCenterToggleSchema>) {
    const p=PlanCenterToggleSchema.parse(input);
    return this.repo.transaction(()=>{const old=this.store.get('plan',p.id);if(!old)throw Error('NOT_FOUND');if(old.revision!==p.expectedRevision)throw Error('REVISION_CONFLICT');if(p.enabled&&missingTheme(old))throw Error('THEME_REQUIRED');this.checkCreationSchedule({...old,enabled:p.enabled});this.checkWorkflowSchedule({...old,enabled:p.enabled});const now=this.now();const plan=this.store.put('plan',{...old,enabled:p.enabled,revision:old.revision+1,updatedAt:now});this.store.put('cursor',{id:plan.id,lastAt:now});return plan;});
  }
  private checkWorkflowSchedule(plan:PlanCenterPlan) {
    if(plan.enabled&&workflowPublicationPlatforms(plan.workflow?.graph).length){
      if(!plan.authorization.publish)throw Error('WORKFLOW_PUBLICATION_CONFIRMATION_REQUIRED');
      const issue=planWorkflowIssue(this.repo,plan);
      if(issue)throw Error(issue);
    }
  }
  scheduleCreation(input:unknown) {
    const p=PlanCenterScheduleCreationSchema.parse(input);
    return this.repo.transaction(()=>{
      const old=this.store.get('plan',p.id);
      if(old?.material.source!=='creation')throw Error('NOT_FOUND');
      if(old.revision!==p.expectedRevision)throw Error('REVISION_CONFLICT');
      if(this.hasActiveRun(old.id,'scheduled'))throw Error('ACTIVE_RUN');
      const now=this.now(),plan={...old,enabled:true,schedule:p.schedule,updatedAt:now,revision:old.revision+1};
      this.checkCreationSchedule(plan);
      const issue=planRouteIssue(this.repo,plan);
      if(issue)throw Error(issue);
      this.store.put('cursor',{id:plan.id,lastAt:now});
      return this.store.put('plan',plan);
    });
  }
  preview(input:z.input<typeof PlanCenterIdSchema>) {
    const {id}=PlanCenterIdSchema.parse(input),plan=this.store.get('plan',id);if(!plan)throw Error('NOT_FOUND');
    const summary={title:plan.title,artistId:plan.artistId,count:plan.count,outputs:plan.outputs,theme:plan.theme,styleTemplate:plan.styleTemplate,artistSnapshot:plan.artistSnapshot,storyContext:plan.storyContext,material:plan.material,text:plan.text,music:plan.music,routing:plan.routing,routeSnapshot:plan.routeSnapshot,routeIssue:planWorkflowIssue(this.repo,plan)??planRouteIssue(this.repo,plan),publishTargets:plan.publishTargets.filter(t=>t.enabled),fanqie:plan.fanqie,authorization:plan.authorization,...(plan.songType?{songType:plan.songType}:{})};
    return {planRevision:plan.revision,summaryHash:digest({plan,summary}),summary};
  }
  run(input:z.input<typeof PlanCenterRunSchema>) {
    const p=PlanCenterRunSchema.parse(input);
    return this.runTrusted(p);
  }
  /** Internal-only directory dispatch. Public run validation never accepts this source. */
  runDirectory(input:Omit<z.input<typeof PlanCenterRunSchema>,'source'|'confirmGeneration'|'confirmPublication'>){
    const parsed=PlanCenterRunSchema.omit({source:true,confirmGeneration:true,confirmPublication:true}).parse(input);
    return this.runTrusted({...parsed,source:'directory'});
  }
  runForPublication(input:Omit<z.input<typeof PlanCenterRunSchema>,'source'|'confirmGeneration'|'confirmPublication'>,includePlanPublication:boolean,prepareContract?:boolean){
    const parsed=PlanCenterRunSchema.omit({source:true,confirmGeneration:true,confirmPublication:true}).parse(input);
    return this.runTrusted({...parsed,source:'publication_task'},includePlanPublication,prepareContract);
  }
  private runTrusted(p:Omit<z.output<typeof PlanCenterRunSchema>,'source'>&{source:'manual'|'debug'|'directory'|'publication_task'},includePlanPublication=false,prepareContract?:boolean){
    return this.repo.transaction(()=>{
      const existing=this.store.all('run').find(r=>r.requestId===p.requestId);
      if(existing) {if(existing.planId!==p.id||existing.source!==p.source||existing.summaryHash!==p.summaryHash||existing.planRevision!==p.expectedRevision||
        (existing.prepareContract??true)!==(prepareContract??true))throw Error('REQUEST_ID_CONFLICT');return existing;}
      const plan=this.store.get('plan',p.id);if(!plan)throw Error('NOT_FOUND');
      if(plan.revision!==p.expectedRevision)throw Error('REVISION_CONFLICT');
      if(this.preview({id:p.id}).summaryHash!==p.summaryHash)throw Error('SUMMARY_CONFLICT');
      const publishes=workflowPublicationPlatforms(plan.workflow?.graph).length>0;
      const local=isLocalPublicationWorkflow(plan.workflow?.graph);
      if(plan.workflow?.graph&&(p.source==='manual'||p.source==='debug')){
        if(!local&&!p.confirmGeneration)throw Error('WORKFLOW_CONFIRMATION_REQUIRED');
        if(local&&p.confirmGeneration)throw Error('WORKFLOW_CONFIRMATION_SCOPE');
        if(publishes&&!p.confirmPublication)throw Error('WORKFLOW_PUBLICATION_CONFIRMATION_REQUIRED');
        if(!publishes&&p.confirmPublication)throw Error('WORKFLOW_CONFIRMATION_SCOPE');
        const issue=planWorkflowIssue(this.repo,plan)??planRouteIssue(this.repo,plan);
        if(issue)throw Error(issue);
        return this.createRun(authorizeGraphPlanExecution(plan,publishes),p.source,p.requestId,p.summaryHash);
      }
      if(p.confirmGeneration||p.confirmPublication)throw Error('WORKFLOW_CONFIRMATION_SCOPE');
      if(p.source==='publication_task'){
        if(!isPublicationPlan(plan)||local&&!includePlanPublication)throw Error('PUBLICATION_PLAN_UNAVAILABLE');
        const authorized=plan.workflow?.graph?authorizeGraphPlanExecution(plan,includePlanPublication&&publishes):plan;
        const snapshot=includePlanPublication?authorized:
          {...authorized,fanqie:undefined,publishTargets:[],authorization:{...authorized.authorization,publish:false}};
        return this.createRun(snapshot,p.source,p.requestId,p.summaryHash,undefined,prepareContract);
      }
      if(local&&p.source==='directory'&&!plan.authorization.publish)throw Error('WORKFLOW_PUBLICATION_CONFIRMATION_REQUIRED');
      if(!local&&plan.workflow?.graph&&p.source==='directory'&&
        (!plan.authorization.text||!plan.text.consent||!plan.authorization.music||!plan.music.consent||publishes&&!plan.authorization.publish))
        throw Error('WORKFLOW_CONFIRMATION_REQUIRED');
      return this.createRun(plan,p.source,p.requestId,p.summaryHash);
    });
  }
  private hasActiveRun(planId: string, source: PlanCenterRun['source']) {
    const taskOwned = source === 'publication_task';
    return this.store.all('run', { field: 'planId', values: [planId] })
      .some(run => (run.source === 'publication_task') === taskOwned && planRunActive(run));
  }
  private createRun(plan:PlanCenterPlan,source:PlanCenterRun['source'],requestId:string,summaryHash:string,occurrenceKey?:string,prepareContract?:boolean) {
    if(missingTheme(plan))throw Error('THEME_REQUIRED');
    if(this.hasActiveRun(plan.id,source))throw Error('ACTIVE_RUN');
    const workflowIssue=planWorkflowIssue(this.repo,plan)??(source!=='publication_task'&&
      workflowPublicationPlatforms(plan.workflow?.graph).length&&!plan.authorization.publish?'WORKFLOW_PUBLICATION_CONFIRMATION_REQUIRED':undefined);
    const local=isLocalPublicationWorkflow(plan.workflow?.graph);
    const routeIssue=workflowIssue??planRouteIssue(this.repo,plan);if(routeIssue)plan={...plan,needsConfiguration:[routeIssue,...plan.needsConfiguration]};
    let downloadFolders: PlanCenterRun['downloadFolders'];
    try {
      if(!local&&!workflowIssue){
        downloadFolders = this.options.prepareDownloads?.(plan);
        if(plan.workflow?.graph&&!downloadFolders?.length)throw Error('DOWNLOAD_ROOT_REQUIRED');
      }
    }
    catch (error) {
      if (source !== 'scheduled') throw error;
      const reason = error instanceof Error && /^DOWNLOAD_[A-Z_]+$/u.test(error.message) ? error.message : 'DOWNLOAD_FOLDER_UNAVAILABLE';
      plan = { ...plan, needsConfiguration: [reason, ...plan.needsConfiguration] };
    }
    const now=this.now(),run=this.store.put('run',{id:randomUUID(),planId:plan.id,planRevision:plan.revision,snapshot:plan,summaryHash,requestId,source,occurrenceKey,
      ...(prepareContract===undefined?{}:{prepareContract}),state:local&&routeIssue?'failed':'running',stopRequested:false,createdAt:now,updatedAt:now,
      ...(local&&routeIssue?{reason:routeIssue}:{}),...(downloadFolders?.length?{downloadFolders}:{})});
    if(local)return run;
    const draft=plan.creationDraft;
    for(let ordinal=1;ordinal<=plan.count;ordinal++)this.store.put('item',{id:`${run.id}:item:${ordinal}`,runId:run.id,planId:plan.id,ordinal,expectedExternalItemId:plan.material.expectedExternalItemIds?.[ordinal-1]??`pc-${digest([run.id,ordinal])}`,state:plan.material.source==='dot'?'waiting_external_dot':'waiting_materials',versions:[],createdAt:now,updatedAt:now,...(draft?{material:{source:'creation',title:draft.title,lyrics:draft.lyrics,musicPrompt:draft.style}}:{})});
    this.refresh(run.id);return this.store.get('run',run.id)!;
  }
  tick() {
    return this.repo.transaction(()=>{
      const now=this.now();
      for(const plan of this.store.all('plan').filter(p=>p.enabled)) {
        if(missingTheme(plan))continue;
        if(this.hasActiveRun(plan.id,'scheduled'))continue;
        const cursor=this.store.get('cursor',plan.id)??{id:plan.id,lastAt:plan.createdAt??now};
        const times=dueTimes(plan,cursor.lastAt,now);if(!times.length)continue;
        const selected=plan.catchUp.mode==='bounded'?times.slice(-plan.catchUp.limit)[0]:times.at(-1)!;
        const key=`${plan.id}:${selected}`;
        if(!this.store.get('occurrence',key)) {
          const base={id:key,planId:plan.id,occurrenceKey:key,intendedAt:selected,localDate:DateTime.fromISO(selected).setZone('Asia/Shanghai').toISODate()!,createdAt:now};
          if(plan.catchUp.mode==='skip'&&Date.parse(now)-Date.parse(selected)>60_000)this.store.put('occurrence',{...base,status:'skipped',reason:'CATCH_UP_SKIP'});
          else {const run=this.createRun(plan,'scheduled',key,this.preview({id:plan.id}).summaryHash,key);this.store.put('occurrence',{...base,status:'claimed',runId:run.id});}
        }
        if(plan.material.source==='creation'||plan.workflow&&plan.schedule.kind==='once')this.store.put('plan',{...plan,enabled:false,revision:plan.revision+1,updatedAt:now});
        this.store.put('cursor',{id:plan.id,lastAt:plan.catchUp.mode==='bounded'?selected:now});
      }
      return this.list();
    });
  }
  stop(input:z.input<typeof PlanCenterStopSchema>) {
    const {runId}=PlanCenterStopSchema.parse(input);
    return this.repo.transaction(()=>{
      const run=this.store.get('run',runId);if(!run)throw Error('NOT_FOUND');
      if(terminalRuns.has(run.state))return run;
      this.store.put('run',{...run,stopRequested:true,state:'stopped',updatedAt:this.now()});
      this.refresh(runId);return this.store.get('run',runId)!;
    });
  }
  /** A local prepared job with zero operations proves no provider call was dispatched. */
  resumeUnsentProviderGeneration(attemptId:string){
    return this.repo.transaction(()=>{
      const attempt=this.store.get('stage',safeId.parse(attemptId));
      if(!attempt||attempt.stage!=='text_generate'||attempt.state!=='unknown')throw Error('PROVIDER_RESUME_SCOPE');
      const run=this.store.get('run',attempt.runId),binding=this.repo.maybe('settings','provider-plan:binding:'+attempt.itemId)?.value;
      if(!run||run.stopRequested||terminalRuns.has(run.state)||run.snapshot.material.source!=='provider')throw Error('PROVIDER_RESUME_SCOPE');
      if(!binding){
        if(this.repo.all('settings').some(r=>(r.id.startsWith('provider-text:job:')||r.id.startsWith('provider-text:operation:'))&&r.value?.ownerKey===attempt.id))throw Error('PROVIDER_DISPATCH_RECONCILE_REQUIRED');
        const resumed=this.store.put('stage',{...attempt,state:'dispatching',reason:undefined,updatedAt:this.now()});this.refresh(run.id);return resumed;
      }
      if(binding.ownerKey!==attempt.id||binding.runId!==run.id||binding.itemId!==attempt.itemId)throw Error('PROVIDER_RESUME_SCOPE');
      const job=ProviderTextJobSchema.parse(this.repo.maybe('settings','provider-text:job:'+binding.jobId)?.value);
      if(job.ownerKey!==attempt.id||job.runId!==run.id||job.itemId!==attempt.itemId||job.artistId!==run.snapshot.artistId||job.profileId!==run.snapshot.text.profileId||job.profileRevision!==run.snapshot.text.profileRevision||job.state!=='ready'||job.phase!=='generate'||job.operations.length||job.operationId||job.draftId||job.stopRequested||job.spentMicros||job.reservedMicros)throw Error('PROVIDER_DISPATCH_RECONCILE_REQUIRED');
      if(this.repo.all('settings').some(r=>r.id.startsWith('provider-text:operation:')&&r.value?.jobId===job.id))throw Error('PROVIDER_DISPATCH_RECONCILE_REQUIRED');
      const resumed=this.store.put('stage',{...attempt,state:'dispatching',reason:undefined,updatedAt:this.now()});
      this.refresh(run.id);return resumed;
    });
  }
  private stages(plan:PlanCenterPlan):PlanCenterStage[] {
    if(plan.workflow)return ['lyric_write','music_submit','music_assets',...(plan.outputs.cover?['cover' as const]:[]),'materials'];
    if(plan.material.source==='creation')return [...(plan.outputs.music?['music_submit' as const,'music_assets' as const]:[]),...(plan.outputs.cover?['cover' as const]:[]),'materials'];
    if(plan.material.source==='pule_prompt')return ['music_submit','music_assets','cover','materials'];
    if(plan.songType==='instrumental')return ['music_submit','music_assets',...(plan.outputs.cover?['cover' as const]:[]),'materials'];
    return [...(plan.material.source==='provider'?['text_generate' as const]:['dot' as const]),'text_score',...(plan.outputs.music?['music_submit' as const,'music_assets' as const]:[]),...(plan.outputs.cover?['cover' as const]:[]),'materials'];
  }
  private stageGate(run:PlanCenterRun,item:PlanCenterItem,stage:PlanCenterStage):{state:string;reason?:string} {
    const profileIssue=frozenRouteIssue(this.repo,run.snapshot);if(profileIssue)return{state:'blocked',reason:profileIssue};
    const configurationIssue=run.snapshot.needsConfiguration[0];
    if(configurationIssue)return {state:'blocked',reason:run.snapshot.routing||configurationIssue.startsWith('DOWNLOAD_')?configurationIssue:'LEGACY_CONFIGURATION_REQUIRED'};
    if(stage==='dot'&&run.snapshot.material.source==='manual')return {state:'waiting_materials',reason:'MANUAL_MATERIAL_REQUIRED'};
    const cap=names[stage];
    if(cap&&!this.capabilities()[cap].available)return {state:stage==='dot'?'waiting_external_dot':'blocked',reason:this.capabilities()[cap].reason};
    if(stage==='dot'&&(!run.snapshot.material.channel||!run.snapshot.material.identity))return {state:'waiting_external_dot',reason:'DOT_IDENTITY_REQUIRED'};
    if(['text_generate','text_score'].includes(stage)&&(!run.snapshot.authorization.text||!run.snapshot.text.consent||!run.snapshot.text.profileId||!run.snapshot.text.profileRevision||!run.snapshot.text.modelId||!run.snapshot.text.budgetMicros))return {state:'blocked',reason:'TEXT_GRANT_REQUIRED'};
    if(stage==='lyric_write'){
      const plan=run.snapshot, issue=planWorkflowIssue(this.repo,plan);
      if(issue)return {state:'blocked',reason:issue};
      if(plan.workflow?.graph&&item.ordinal>1&&this.store.all('item').some(previous=>previous.runId===run.id&&
        previous.ordinal<item.ordinal&&!['completed','waiting_publication'].includes(previous.state)))
        return {state:'waiting_workflow',reason:'PREVIOUS_WORKFLOW_PENDING'};
      if(!plan.authorization.text||!plan.text.consent)return {state:'blocked',reason:'TEXT_AUTHORIZATION_REQUIRED'};
      if(!(plan.routeSnapshot?.music.channel==='pule'||plan.routeSnapshot?.music.capability==='music_browser')||!plan.authorization.music||!plan.music.consent||plan.music.creditPolicy?.mode!=='uncapped_existing_credits')
        return {state:'blocked',reason:'MUSIC_GRANT_REQUIRED'};
    }
    if(stage==='music_submit'&&(run.snapshot.songType==='instrumental'||run.snapshot.material.source==='creation'||run.snapshot.workflow)&&run.snapshot.music.creditPolicy?.mode!=='uncapped_existing_credits')return {state:'blocked',reason:'MUSIC_GRANT_REQUIRED'};
    if((stage==='music_submit'||stage==='music_assets')&&workflowBrowserMusic(run.snapshot.workflow)){
      const issue=planWorkflowMusicIssue(this.repo,run.snapshot);
      return issue||!run.snapshot.authorization.music||!run.snapshot.music.consent
        ?{state:'blocked',reason:issue??'MUSIC_GRANT_REQUIRED'}:{state:'ready'};
    }
    if(stage==='music_submit'&&run.snapshot.songType!=='instrumental'&&run.snapshot.music.route==='manual')return item.workId?{state:'ready'}:{state:'waiting_materials',reason:'EXISTING_AUDIO_BINDING_REQUIRED'};
    if(stage==='music_submit'&&(!run.snapshot.authorization.music||!run.snapshot.music.consent||!run.snapshot.music.profileId||!run.snapshot.music.profileRevision||!run.snapshot.music.modelId||!run.snapshot.music.budgetCredits||!run.snapshot.music.maxCostPerRequestCredits||(!run.snapshot.music.pricingEvidence&&!run.snapshot.music.creditPolicy)))return {state:'blocked',reason:'MUSIC_GRANT_REQUIRED'};
    if(stage==='music_submit'&&!['yourmusic','pule'].includes(run.snapshot.music.route))return {state:'blocked',reason:'MUSIC_ROUTE_UNAVAILABLE'};
    if(stage==='materials'&&!item.materials&&run.snapshot.authorization.publish&&run.snapshot.publishTargets.some(t=>t.enabled))return {state:'waiting_materials',reason:'MATERIALS_INCOMPLETE'};
    return {state:'ready'};
  }
  next(input:{runId?:string;itemId?:string}={}) {
    const parsed=z.strictObject({runId:safeId.optional(),itemId:safeId.optional()}).parse(input);
    for(const run of this.store.all('run').filter(r=>!terminalRuns.has(r.state)&&!r.stopRequested&&(!parsed.runId||r.id===parsed.runId)))
      for(const item of this.store.all('item').filter(i=>i.runId===run.id&&(!parsed.itemId||i.id===parsed.itemId))) {
        const attempts=this.store.all('stage').filter(a=>a.itemId===item.id);
        for(const stage of this.stages(run.snapshot)) {
          if(attempts.some(a=>a.stage===stage&&a.state==='succeeded'))continue;
          const last=attempts.filter(a=>a.stage===stage).at(-1);
          if(last)return {runId:run.id,itemId:item.id,stage,state:last.state,reason:last.reason,attemptId:last.id};
          return {runId:run.id,itemId:item.id,stage,...this.stageGate(run,item,stage)};
        }
      }
    return null;
  }
  claim(input:z.input<typeof PlanCenterClaimSchema>):PlanCenterStageAttempt|{state:string;reason?:string} {
    const p=PlanCenterClaimSchema.parse(input);
    return this.repo.transaction(()=>{
      const run=this.store.get('run',p.runId),item=this.store.get('item',p.itemId);if(!run||!item||item.runId!==run.id)throw Error('NOT_FOUND');
      if(run.stopRequested)throw Error('STOP_REQUESTED');if(terminalRuns.has(run.state))throw Error('RUN_TERMINAL');
      const attempts=this.store.all('stage').filter(a=>a.itemId===p.itemId&&a.stage===p.stage),success=attempts.find(a=>a.state==='succeeded');
      if(p.requestHash&&attempts.length&&p.requestHash!==attempts.at(-1)!.requestHash)throw Error('REQUEST_HASH_CONFLICT');
      if(success)return success;
      if(attempts.length) {const last=attempts.at(-1)!;if(last.state==='unknown')throw Error('RECONCILE_REQUIRED');return last;}
      const required=this.stages(run.snapshot),stageIndex=required.indexOf(p.stage);if(stageIndex<0)throw Error('STAGE_NOT_CONFIGURED');
      for(const prev of required.slice(0,stageIndex))if(!this.store.all('stage').some(a=>a.itemId===item.id&&a.stage===prev&&a.state==='succeeded'))throw Error('STAGE_PREREQUISITE');
      const gate=this.stageGate(run,item,p.stage);if(gate.state!=='ready'){this.store.put('item',{...item,...gate,updatedAt:this.now()});this.refresh(run.id);return gate;}
      return this.newAttempt(run,item,p.stage,1,p.requestHash);
    });
  }
  private newAttempt(run:PlanCenterRun,item:PlanCenterItem,stage:PlanCenterStage,ordinal:number,requestHash?:string) {
    const now=this.now(),key=`${run.id}:${item.id}:${stage}:${ordinal}`;
    const attempt=this.store.put('stage',{id:key,runId:run.id,itemId:item.id,stage,ordinal,idempotencyKey:key,requestHash:requestHash??digest({snapshot:run.snapshot,itemId:item.id,stage,ordinal}),state:'dispatching',createdAt:now,updatedAt:now});
    this.store.put('item',{...item,state:'running',reason:undefined,updatedAt:now});this.refresh(run.id);return attempt;
  }
  record(input:z.input<typeof PlanCenterRecordSchema>) {
    const p=PlanCenterRecordSchema.parse(input);
    return this.repo.transaction(()=>this.recordInside(p));
  }
  private recordInside(p:z.output<typeof PlanCenterRecordSchema>) {
    const attempt=this.store.get('stage',p.attemptId);if(!attempt)throw Error('NOT_FOUND');
    if(['succeeded','failed','not_found'].includes(attempt.state)) {
      if(attempt.state===p.status&&digest(attempt.result??{})===digest(p.result??{})&&attempt.evidenceId===p.evidenceId)return attempt;
      throw Error('TERMINAL_ATTEMPT');
    }
    const item=this.store.get('item',attempt.itemId)!,run=this.store.get('run',attempt.runId)!;
    if(p.status==='succeeded') {
      if(!p.evidenceId)throw Error('EVIDENCE_REQUIRED');
      if(attempt.stage==='lyric_write'){
        if(run.stopRequested||attempt.externalTaskId!==p.evidenceId)throw Error('WORKFLOW_LYRICS_EVIDENCE_REQUIRED');
        const material=verifiedPlanLyrics(this.repo,attempt.id,p.evidenceId,run.snapshot);
        this.store.put('item',{...item,material,updatedAt:this.now()});
      }
      if(attempt.stage==='dot')this.validateDot(run,item,p.result);
      if(attempt.stage==='text_generate'){
        const proof=providerPlanProof(this.repo,run,item,safeId.parse(p.result?.providerJobId),false);
        if(p.evidenceId!==proof.generationOperation.id||p.result?.draftId!==proof.version.id||p.result?.pairHash!==proof.version.pairHash)throw Error('PROVIDER_GENERATION_EVIDENCE_MISMATCH');
        this.store.put('item',{...item,material:{...item.material,providerJobId:proof.job.id,source:'provider'},updatedAt:this.now()});
      }
      if(attempt.stage==='text_score') {
        const result=p.result??{};
        if(result.source!=='model'||typeof result.score!=='number'||!Number.isFinite(result.score)||result.score<run.snapshot.text.threshold||result.score>100)throw Error('MODEL_SCORE_REQUIRED');
        if(item.material?.candidateId&&result.candidateId!==item.material.candidateId)throw Error('SCORE_CANDIDATE_MISMATCH');
        if(run.snapshot.material.source==='provider')this.applyProviderEvaluatedMaterial(run,item,attempt,p);
        else if(result.evaluationRunId!==undefined||result.evaluatedDraftId!==undefined||result.evaluatedMaterial!==undefined)this.applyEvaluatedMaterial(run,item,attempt,p);
      }
      if(attempt.stage==='music_assets') {
        const versions=z.array(z.strictObject({version:z.enum(['A','B']),assetId:safeId,externalId:safeId.optional(),sha256:z.string().optional()})).min(1).max(2).parse(p.result?.versions);
        if(new Set(versions.map(v=>v.version)).size!==versions.length)throw Error('DUPLICATE_VERSION');
        this.store.put('item',{...item,versions,state:'ready',updatedAt:this.now()});
      }
      if(attempt.stage==='dot')this.store.put('item',{...item,material:p.result,state:'ready',updatedAt:this.now()});
    }
    const updated=this.store.put('stage',{...attempt,state:p.status==='waiting'?'waiting':p.status,...(p.externalTaskId?{externalTaskId:p.externalTaskId}:{}),...(p.evidenceId?{evidenceId:p.evidenceId}:{}),result:p.result??attempt.result,reason:p.reason,updatedAt:this.now()});
    this.refresh(attempt.runId);return updated;
  }
  private validateDot(run:PlanCenterRun,item:PlanCenterItem,result?:Record<string,unknown>) {
    if(!result||result.artistId!==run.snapshot.artistId||result.channel!==run.snapshot.material.channel||result.identity!==run.snapshot.material.identity||result.externalItemId!==item.expectedExternalItemId)throw Error('DOT_IDENTITY_MISMATCH');
    if(typeof result.title!=='string'||!result.title.trim()||typeof result.lyrics!=='string'||!result.lyrics.trim())throw Error('DOT_MATERIAL_INCOMPLETE');
  }
  private applyProviderEvaluatedMaterial(run:PlanCenterRun,item:PlanCenterItem,attempt:PlanCenterStageAttempt,input:z.output<typeof PlanCenterRecordSchema>){
    const result=input.result??{},jobId=safeId.parse(result.providerJobId),proof=providerPlanProof(this.repo,run,item,jobId),v=proof.version;
    if(item.material?.providerJobId!==jobId||attempt.stage!=='text_score'||result.evaluatedDraftId!==v.id||result.proofHash!==proof.proofHash||input.evidenceId!==proof.scoreOperation?.id||digest(result.assessment)!==digest(v.score)||result.score!==v.score?.overall||v.score?.threshold!==run.snapshot.text.threshold||!v.score.passed||result.rewriteCount!==proof.job.versions.length-1)throw Error('PROVIDER_SCORE_EVIDENCE_MISMATCH');
    const final={title:v.draft.title,lyrics:v.pair.lyrics,musicPrompt:v.pair.musicPrompt,draftId:v.id,pairHash:v.pairHash,providerJobId:jobId,proofHash:proof.proofHash,assessment:v.score,evidenceId:proof.scoreOperation!.id};
    this.store.put('item',{...item,material:{...item.material,source:'provider',title:final.title,lyrics:final.lyrics,musicPrompt:final.musicPrompt,finalDraftId:v.id,coverRefreshRequired:proof.job.versions.length>1,finalRevision:final},updatedAt:this.now()});
  }
  private applyEvaluatedMaterial(run:PlanCenterRun,item:PlanCenterItem,attempt:PlanCenterStageAttempt,input:z.output<typeof PlanCenterRecordSchema>) {
    const result=input.result!,evaluationRunId=safeId.parse(result.evaluationRunId),draftId=safeId.parse(result.evaluatedDraftId);
    const evaluation=this.repo.maybe('settings',`production-flow:run:${evaluationRunId}`)?.value,draftRow=this.repo.maybe('drafts',draftId);
    if(!evaluation||evaluation.state!=='completed'||evaluation.artistId!==run.snapshot.artistId||evaluation.inboxCandidateId!==item.material?.candidateId||!evaluation.plan?.managedByPlanCenter||evaluation.plan.managedOwnerKey!==attempt.id||evaluation.candidate?.id!==draftId||!draftRow||draftRow.artistId!==run.snapshot.artistId||draftRow.source!=='inbox-evaluation'||draftRow.evaluationRunId!==evaluationRunId)throw Error('SCORE_ARTIFACT_SCOPE_MISMATCH');
    if(digest(result.assessment)!==digest(evaluation.score)||evaluation.score?.revisionId!==draftId||evaluation.score?.overall!==result.score||evaluation.score?.threshold!==run.snapshot.text.threshold||!evaluation.score?.passed)throw Error('SCORE_PROOF_MISMATCH');
    const raw=evaluation.score;
    TextEvaluationScoreSchema.parse({revisionId:raw.revisionId,dimensions:raw.dimensions,overall:raw.overall,findings:raw.findings,threshold:raw.threshold,passed:raw.passed,source:raw.source,calibration:raw.calibration});
    if(raw.operationId&&input.evidenceId!==raw.operationId)throw Error('SCORE_EVIDENCE_MISMATCH');
    const draft=parseDraft(draftRow.draft),pair=PairSchema.parse(draftRow.pair),verifiedHash=pairHash(pair);
    if(pair.revisionId!==draftId||verifiedHash!==evaluation.candidate.pairHash||digest(pair)!==digest(evaluation.candidate.pair)||digest(draft)!==digest(evaluation.candidate.draft))throw Error('SCORE_PAIR_MISMATCH');
    if(!Number.isInteger(evaluation.revisionCount)||evaluation.revisionCount<0||evaluation.revisionCount>run.snapshot.text.maxRewrites||result.rewriteCount!==evaluation.revisionCount)throw Error('SCORE_REVISION_LIMIT');
    const final={title:draft.title,lyrics:pair.lyrics,musicPrompt:pair.musicPrompt,draftId,pairHash:verifiedHash};
    if(result.evaluatedMaterial!==undefined) {
      const supplied=z.strictObject({title:z.string(),lyrics:z.string(),musicPrompt:z.string(),draftId:safeId,pairHash:z.string()}).parse(result.evaluatedMaterial);
      if(digest(supplied)!==digest(final))throw Error('SCORE_ARTIFACT_MISMATCH');
    }
    const originalDot=item.material?.originalDot??{...item.material};
    this.store.put('item',{...item,material:{...item.material,originalDot,title:final.title,lyrics:final.lyrics,musicPrompt:final.musicPrompt,finalDraftId:draftId,coverRefreshRequired:evaluation.revisionCount>0,finalRevision:{...final,evaluationRunId,assessment:result.assessment,evidenceId:input.evidenceId}},updatedAt:this.now()});
  }
  // Incoming dot evidence can be accepted without pretending a creation port exists.
  acceptDotCandidate(input:{itemId:string;evidenceId:string;candidate:Record<string,unknown>}) {
    const p=z.strictObject({itemId:safeId,evidenceId:safeId,candidate:z.record(z.string(),z.unknown())}).parse(input);
    return this.repo.transaction(()=>{
      const item=this.store.get('item',p.itemId);if(!item)throw Error('NOT_FOUND');const run=this.store.get('run',item.runId)!;
      this.validateDot(run,item,p.candidate);
      const success=this.store.all('stage').find(a=>a.itemId===item.id&&a.stage==='dot'&&a.state==='succeeded');if(success)return success;
      const existing=this.store.all('stage').filter(a=>a.itemId===item.id&&a.stage==='dot').at(-1);
      if(!existing&&run.stopRequested)throw Error('STOP_REQUESTED');
      const attempt=existing??this.newAttempt(run,item,'dot',1);
      return this.recordInside({attemptId:attempt.id,status:'succeeded',evidenceId:p.evidenceId,result:p.candidate});
    });
  }
  attachDot(input:{itemId:string;candidateId:string}) {
    const p=z.strictObject({itemId:safeId,candidateId:safeId}).parse(input);
    return this.repo.transaction(()=>{
      const item=this.store.get('item',p.itemId),candidate=this.repo.maybe('textCandidates',p.candidateId);if(!item||!candidate)throw Error('NOT_FOUND');
      const run=this.store.get('run',item.runId)!;
      if(!candidate.isCurrent||candidate.source?.verification!=='local_channel'||candidate.lineageState==='lineage_pending')throw Error('DOT_CANDIDATE_UNTRUSTED');
      const channel=this.repo.maybe('settings','inbox-channel')?.channel;
      if(!channel||channel.id!==run.snapshot.material.channel||candidate.source.channelId!==channel.id||channel.artistRefs?.[run.snapshot.material.identity]!==run.snapshot.artistId||candidate.artistId!==run.snapshot.artistId||candidate.externalItemId!==item.expectedExternalItemId)throw Error('DOT_IDENTITY_MISMATCH');
      // Older imported rows did not persist artistRef. Only an unambiguous channel mapping can establish it.
      const aliases=Object.entries(channel.artistRefs??{}).filter(([,artist])=>artist===candidate.artistId).map(([ref])=>ref);
      const importedRef=candidate.artistRef??candidate.source.artistRef;
      if(importedRef?importedRef!==run.snapshot.material.identity:aliases.length!==1)throw Error('DOT_IDENTITY_AMBIGUOUS');
      const draft=this.repo.maybe('drafts',candidate.draftId);if(!draft||draft.artistId!==run.snapshot.artistId)throw Error('DOT_CANDIDATE_UNTRUSTED');
      const d=draft.draft;if(!d||typeof d.title!=='string'||!Array.isArray(d.sections))throw Error('DOT_MATERIAL_INCOMPLETE');
      const lyrics=d.sections.flatMap((s:{lines?:string[]})=>s.lines??[]).join('\n');
      return this.acceptDotCandidate({itemId:item.id,evidenceId:`text-candidate:${candidate.id}`,candidate:{candidateId:candidate.id,draftId:candidate.draftId,artistId:candidate.artistId,channel:candidate.source.channelId,identity:run.snapshot.material.identity,externalItemId:candidate.externalItemId,title:d.title,lyrics,itemHash:candidate.itemHash??null}});
    });
  }
  reconcile(input:z.input<typeof PlanCenterReconcileSchema>) {
    const p=PlanCenterReconcileSchema.parse(input);
    return this.repo.transaction(()=>{
      const attempt=this.store.get('stage',p.attemptId);if(!attempt)throw Error('NOT_FOUND');if(!['unknown','dispatching','waiting'].includes(attempt.state))throw Error('RECONCILE_NOT_REQUIRED');
      if(p.status==='pending')return this.store.put('stage',{...attempt,state:'waiting',evidenceId:p.evidenceId,externalTaskId:p.externalTaskId??attempt.externalTaskId,updatedAt:this.now()});
      if(p.status==='not_found') {const a=this.store.put('stage',{...attempt,state:'not_found',evidenceId:p.evidenceId,reason:'RECONCILED_NOT_FOUND',updatedAt:this.now()});this.refresh(a.runId);return a;}
      return this.recordInside({...p,status:p.status});
    });
  }
  retry(input:z.input<typeof PlanCenterRetrySchema>) {
    const p=PlanCenterRetrySchema.parse(input);
    return this.repo.transaction(()=>{
      const attempt=this.store.get('stage',p.attemptId);if(!attempt)throw Error('NOT_FOUND');
      if(attempt.state==='succeeded')return attempt;
      if(!['failed','not_found'].includes(attempt.state))throw Error('RECONCILE_REQUIRED');
      const run=this.store.get('run',attempt.runId)!,item=this.store.get('item',attempt.itemId)!;
      if(run.stopRequested)throw Error('STOP_REQUESTED');
      if(run.snapshot.material.source==='provider'&&['text_generate','text_score'].includes(attempt.stage))throw Error('PROVIDER_TEXT_RETRY_REQUIRES_NEW_RUN');
      const attempts=this.store.all('stage').filter(a=>a.itemId===item.id&&a.stage===attempt.stage),last=attempts.at(-1)!;
      if(last.id!==attempt.id) {
        if(['unknown','waiting'].includes(last.state))throw Error('RECONCILE_REQUIRED');
        if(last.state==='dispatching')throw Error('ATTEMPT_IN_PROGRESS');
        return last;
      }
      const gate=this.stageGate(run,item,attempt.stage);if(gate.state!=='ready')throw Error(gate.reason??'STAGE_BLOCKED');
      if(attempt.stage==='text_score'&&typeof attempt.result?.evaluationRunId==='string'){
        const child=this.repo.maybe('settings',`production-flow:run:${attempt.result.evaluationRunId}`)?.value;
        if(!child?.plan?.managedByPlanCenter||child.plan.managedOwnerKey!==attempt.id||child.state!=='ready'||child.paused)throw Error('MANAGED_SCORE_RESUME_REQUIRED');
        const resumed=this.store.put('stage',{...attempt,state:'dispatching',reason:undefined,updatedAt:this.now()});
        this.repo.audit('planCenter.managedScore.resumed',attempt.id,{runId:run.id,evaluationRunId:child.id});
        this.refresh(run.id);return resumed;
      }
      if(['music_submit','music_assets'].includes(attempt.stage)&&typeof attempt.result?.childRunId==='string'){
        const child=this.repo.maybe('settings',`production-flow:run:${attempt.result.childRunId}`)?.value;
        const binding=this.repo.maybe('settings','plan-center-music:'+item.id);
        if(!child?.managedMusic||binding?.childRunId!==child.id||child.managedStopped||child.state==='unknown'||child.paused)throw Error('MANAGED_MUSIC_RESUME_REQUIRED');
        const resumed=this.store.put('stage',{...attempt,state:'dispatching',reason:undefined,updatedAt:this.now()});this.refresh(run.id);return resumed;
      }
      const limit=attempt.stage==='text_score'?run.snapshot.text.maxScoreRetries+1:3;if(attempt.ordinal>=limit)throw Error('RETRY_LIMIT');
      return this.newAttempt(run,item,attempt.stage,attempt.ordinal+1);
    });
  }
  bindWork(input:{itemId:string;workId:string;versions:PlanCenterItem['versions'];selectedVersion?:'A'|'B';collectOnly?:boolean}) {
    return this.repo.transaction(()=>{
      const item=this.store.get('item',input.itemId);if(!item)throw Error('NOT_FOUND');
      const run=this.store.get('run',item.runId)!;if(run.stopRequested&&!input.collectOnly)throw Error('STOP_REQUESTED');
      if(item.workId&&item.workId!==input.workId)throw Error('WORK_ALREADY_BOUND');
      const versions=z.array(z.strictObject({version:z.enum(['A','B']),assetId:safeId,externalId:safeId.optional(),sha256:z.string().regex(/^[a-f0-9]{64}$/).optional()})).max(2).parse(input.versions);
      if(new Set(versions.map(v=>v.version)).size!==versions.length)throw Error('DUPLICATE_VERSION');
      if(input.selectedVersion&&versions.length&&!versions.some(v=>v.version===input.selectedVersion))throw Error('AUDIO_VERSION_MISMATCH');
      if(run.snapshot.music.versionPolicy==='first'&&input.selectedVersion&&input.selectedVersion!=='A')throw Error('VERSION_POLICY_FIRST');
      return this.store.put('item',{...item,workId:input.workId,versions,selectedVersion:input.selectedVersion??item.selectedVersion,updatedAt:this.now()});
    });
  }
  setMaterials(input:z.input<typeof PlanCenterMaterialsSchema>) {
    const p=PlanCenterMaterialsSchema.parse(input);
    return this.repo.transaction(()=>{
      const item=this.store.get('item',p.itemId);if(!item)throw Error('NOT_FOUND');const run=this.store.get('run',item.runId)!;
      if(Boolean(p.lyrics)===(run.snapshot.songType==='instrumental'))throw Error('LYRICS_MISMATCH');
      if(item.versions.length) {
        const first=item.versions.find(v=>v.version==='A')??item.versions[0];
        const expected=run.snapshot.material.source==='pule_prompt'||run.snapshot.songType==='instrumental'?item.selectedVersion:first.version;
        if(run.snapshot.music.versionPolicy==='first'&&p.selectedVersion!==expected)throw Error('VERSION_POLICY_FIRST');
        const version=item.versions.find(v=>v.version===p.selectedVersion);if(!version||version.assetId!==p.audioAssetId)throw Error('AUDIO_VERSION_MISMATCH');
      }
      const {itemId,...materials}=p;const saved=this.store.put('item',{...item,materials,updatedAt:this.now()});this.refresh(item.runId);return saved;
    });
  }
  private target(runId:string,platform:string,accountId:string):{run:PlanCenterRun;target:PlanCenterPublishTarget} {
    const run=this.store.get('run',runId);if(!run)throw Error('NOT_FOUND');
    const target=run.snapshot.publishTargets.find(t=>t.enabled&&t.platform===platform&&t.accountId===accountId);if(!target)throw Error('TARGET_NOT_CONFIGURED');return {run,target};
  }
  claimAlbum(input:z.input<typeof targetInput>):PlanCenterAlbumBinding {
    const p=targetInput.parse(input);
    return this.repo.transaction(()=>{
      const {run,target}=this.target(p.runId,p.platform,p.accountId);if(run.stopRequested)throw Error('STOP_REQUESTED');
      const selectionHash=digest(target.album),id=digest({planId:run.planId,platform:p.platform,accountId:p.accountId,selectionHash}),old=this.store.get('album',id),caps=this.capabilities();
      if(old?.state==='unknown'||old?.state==='dispatching')throw Error('ALBUM_RECONCILE_REQUIRED');
      if(old?.state==='bound') {if(!caps.albumAppend.available)throw Error('ALBUM_APPEND_UNSUPPORTED');return old;}
      if(old?.state==='failed')throw Error('ALBUM_FAILED_REQUIRES_REVIEW');
      const now=this.now(),base={id,planId:run.planId,createdByRunId:run.id,platform:p.platform,accountId:p.accountId,selectionHash,selection:target.album,createdAt:now,updatedAt:now};
      if(target.album.mode==='existing') {
        if(!caps.albumCatalog.available||!this.options.ports?.albumCatalog)throw Error('ALBUM_CATALOG_UNAVAILABLE');
        const catalog=z.strictObject({evidenceId:safeId,albums:z.array(z.strictObject({id:safeId}))}).parse(this.options.ports.albumCatalog({platform:p.platform,accountId:p.accountId}));
        const albumId=target.album.albumId;
        if(!catalog.albums.some(a=>a.id===albumId))throw Error('ALBUM_NOT_IN_CATALOG');
        if(!caps.albumAppend.available)throw Error('ALBUM_APPEND_UNSUPPORTED');
        return this.store.put('album',{...base,state:'bound',albumId:target.album.albumId,evidenceId:catalog.evidenceId});
      }
      if(!caps.albumCreate.available)throw Error('ALBUM_CREATE_UNAVAILABLE');
      return this.store.put('album',{...base,state:'dispatching'});
    });
  }
  recordAlbum(input:{bindingId:string;status:'bound'|'unknown'|'failed';albumId?:string;evidenceId?:string;reason?:string}) {
    const p=z.strictObject({bindingId:safeId,status:z.enum(['bound','unknown','failed']),albumId:safeId.optional(),evidenceId:safeId.optional(),reason:z.string().optional()}).parse(input);
    return this.repo.transaction(()=>{
      const old=this.store.get('album',p.bindingId);if(!old)throw Error('NOT_FOUND');
      if(p.status==='bound'&&(!p.albumId||!p.evidenceId))throw Error('ALBUM_EVIDENCE_REQUIRED');
      if(old.state==='bound') {if(p.status==='bound'&&old.albumId===p.albumId&&old.evidenceId===p.evidenceId)return old;throw Error('TERMINAL_ALBUM_BINDING');}
      const saved=this.store.put('album',{...old,state:p.status,albumId:p.albumId??old.albumId,evidenceId:p.evidenceId??old.evidenceId,reason:p.reason,updatedAt:this.now()});
      if(old.createdByRunId)this.refresh(old.createdByRunId);return saved;
    });
  }
  claimPublish(input:z.input<typeof publishInput>):PlanCenterPublishAttempt {
    const p=publishInput.parse(input);
    return this.repo.transaction(()=>{
      const {run}=this.target(p.runId,p.platform,p.accountId),item=this.store.get('item',p.itemId);if(!item||item.runId!==run.id)throw Error('NOT_FOUND');if(run.stopRequested)throw Error('STOP_REQUESTED');
      if(!item.materials)throw Error('MATERIALS_INCOMPLETE');
      const previous=this.store.all('publish').filter(a=>a.itemId===item.id&&a.platform===p.platform&&a.accountId===p.accountId).at(-1);
      if(previous) {if(previous.state==='unknown')throw Error('PUBLISH_RECONCILE_REQUIRED');return previous;}
      if(!this.capabilities().publication.available)throw Error('PUBLICATION_PORT_UNAVAILABLE');
      if(!run.snapshot.authorization.publish)throw Error('PUBLICATION_GRANT_REQUIRED');
      const binding=this.claimAlbum({runId:p.runId,platform:p.platform,accountId:p.accountId});if(binding.state!=='bound'||!binding.albumId||!binding.evidenceId)throw Error('ALBUM_NOT_BOUND');
      const key=`${item.id}:${p.platform}:${p.accountId}:1`,now=this.now();
      return this.store.put('publish',{id:key,runId:run.id,itemId:item.id,platform:p.platform,accountId:p.accountId,bindingId:binding.id,ordinal:1,idempotencyKey:key,requestHash:digest({materials:item.materials,albumId:binding.albumId,target:p}),state:'dispatching',createdAt:now,updatedAt:now});
    });
  }
  recordPublish(input:{attemptId:string;status:PlanCenterPublishAttempt['state'];externalId?:string;evidenceId?:string;reason?:string}) {
    const p=z.strictObject({attemptId:safeId,status:z.enum(['submitted','reviewing','published','rejected','unknown','failed']),externalId:safeId.optional(),evidenceId:safeId.optional(),reason:z.string().optional()}).parse(input);
    return this.repo.transaction(()=>{
      const old=this.store.get('publish',p.attemptId);if(!old)throw Error('NOT_FOUND');
      if(['published','rejected','failed'].includes(old.state)) {if(p.status===old.state&&p.evidenceId===old.evidenceId)return old;throw Error('TERMINAL_PUBLISH_ATTEMPT');}
      if(p.status!=='unknown'&&!p.evidenceId)throw Error('PUBLISH_EVIDENCE_REQUIRED');
      if(['submitted','reviewing','published'].includes(p.status)&&!p.externalId&&!old.externalId)throw Error('PUBLISH_EXTERNAL_ID_REQUIRED');
      const saved=this.store.put('publish',{...old,state:p.status,externalId:p.externalId??old.externalId,evidenceId:p.evidenceId??old.evidenceId,reason:p.reason,updatedAt:this.now()});this.refresh(old.runId);return saved;
    });
  }
  refreshPublication(runId:string){this.refresh(runId);}
  private refresh(runId:string) {
    const run=this.store.get('run',runId)!;if(terminalRuns.has(run.state)&&!(run.state==='stopped'&&run.stopRequested))return;
    const stages=this.store.all('stage').filter(a=>a.runId===run.id),publish=this.store.all('publish').filter(a=>a.runId===run.id),items=this.store.all('item').filter(i=>i.runId===run.id),now=this.now();
    if(run.stopRequested) {
      for(const attempt of stages.filter(a=>planStageCancelsOnStop(run,a))){
        const reason=attempt.stage==='music_assets'?'WORKFLOW_DOWNLOAD_STOPPED':'WORKFLOW_STAGE_STOPPED';
        this.store.put('stage',{...attempt,state:'failed',reason,updatedAt:now});
      }
      if(run.snapshot.workflow?.graph){
        for(const item of items.filter(item=>item.state!=='completed'&&item.state!=='stopped'))
          this.store.put('item',{...item,state:'stopped',reason:undefined,updatedAt:now});
      }
      // A stopped run can still receive evidence for a request it already sent.
      if(run.state!=='stopped')this.store.put('run',{...run,state:'stopped',updatedAt:now});
      return;
    }
    if(isLocalPublicationWorkflow(run.snapshot.workflow?.graph))return;
    const workflowPublishes=run.snapshot.authorization.publish&&workflowPublicationPlatforms(run.snapshot.workflow?.graph).length>0;
    const workflowPublication=workflowPublishes?readWorkflowPublication(this.repo,run.id):undefined;
    let complete=0,blocked=false,waiting=false;
    for(const item of items) {
      const required=this.stages(run.snapshot),next=required.find(s=>!stages.some(a=>a.itemId===item.id&&a.stage===s&&a.state==='succeeded'));
      if(!next) {
        if(workflowPublishes&&workflowPublication?.state!=='completed'){
          waiting=true;
          blocked ||= workflowPublication?.state==='action_required'||workflowPublication?.state==='failed';
          this.store.put('item',{...item,state:'waiting_publication',reason:workflowPublication?.detail??'WORKFLOW_PUBLICATION_PENDING',updatedAt:now});
          continue;
        }
        if(run.snapshot.fanqie&&run.snapshot.authorization.publish){
          const job=this.repo.maybe('settings','plan-fanqie:'+item.id)?.value;
          if(!job||!['uploaded','existing'].includes(job.state)){
            waiting=true;blocked ||= ['unknown','blocked'].includes(job?.state);
            this.store.put('item',{...item,state:'waiting_publication',reason:job?.reason??'FANQIE_UPLOAD_PENDING',updatedAt:now});continue;
          }
        }
        const targets=run.snapshot.authorization.publish?run.snapshot.publishTargets.filter(t=>t.enabled):[],done=targets.every(t=>publish.some(a=>a.itemId===item.id&&a.platform===t.platform&&a.accountId===t.accountId&&['published','rejected','failed'].includes(a.state)));
        if(done){complete++;this.store.put('item',{...item,state:'completed',reason:undefined,updatedAt:now});}
        else {waiting=true;this.store.put('item',{...item,state:'waiting_publication',reason:this.capabilities().publication.available?'PUBLICATION_PENDING':'PUBLICATION_PORT_UNAVAILABLE',updatedAt:now});}
        continue;
      }
      const attempt=stages.filter(a=>a.itemId===item.id&&a.stage===next).at(-1),gate=attempt?{state:attempt.state==='dispatching'?'running':attempt.state,reason:attempt.reason}:this.stageGate(run,item,next);
      blocked ||= ['blocked','failed','not_found','unknown'].includes(gate.state);waiting ||= gate.state.startsWith('waiting');
      this.store.put('item',{...item,...gate,updatedAt:now});
    }
    this.store.put('run',{...run,state:complete===items.length?'completed':workflowPublication?.state==='failed'?'failed':blocked?'blocked':waiting?'waiting':'running',updatedAt:now});
  }
  private recover() {
    this.repo.transaction(()=>{
      const runs=this.store.all('run');
      const graphs=new Map(runs.filter(run=>run.snapshot.workflow?.graph).map(run=>[run.id,run]));
      const ids=new Set(runs.filter(run=>run.state==='stopping'&&run.stopRequested).map(run=>run.id));
      for(const a of this.store.all('stage')){
        if(a.state!=='dispatching'||a.stage==='lyric_write')continue;
        const graph=graphs.get(a.runId);
        if(graph&&(a.stage==='materials'||a.stage==='cover'))continue;
        const localDownload=graph&&a.stage==='music_assets';
        this.store.put('stage',localDownload
          ?{...a,state:'waiting',reason:'ORIGINAL_ASSETS_PENDING',updatedAt:this.now()}
          :{...a,state:'unknown',reason:'RESTART_RECONCILE_REQUIRED',updatedAt:this.now()});
        ids.add(a.runId);
      }
      for(const a of this.store.all('publish'))if(a.state==='dispatching'){this.store.put('publish',{...a,state:'unknown',reason:'RESTART_RECONCILE_REQUIRED',updatedAt:this.now()});ids.add(a.runId);}
      for(const a of this.store.all('album'))if(a.state==='dispatching'){this.store.put('album',{...a,state:'unknown',reason:'RESTART_RECONCILE_REQUIRED',updatedAt:this.now()});if(a.createdByRunId)ids.add(a.createdByRunId);}
      for(const id of ids)this.refresh(id);
    });
  }
  migrateLegacy():PlanCenterMigration {
    return this.repo.transaction(()=>{
      const old=this.store.all('migration').at(-1);if(old?.state==='applied')return old;
      const migration:PlanCenterMigration={id:randomUUID(),state:'applied',createdAt:this.now(),entries:[]};
      const sources:Array<{kind:'plans'|'dailyPlans'|'production-flow';row:Record<string,any>}>=[...this.repo.all('plans').map(row=>({kind:'plans' as const,row})),...this.repo.all('dailyPlans').map(row=>({kind:'dailyPlans' as const,row})),...this.repo.all('settings').filter(row=>row.id.startsWith('production-flow:plan:')&&!row.value?.managedByPlanCenter).map(row=>({kind:'production-flow' as const,row}))];
      for(const {kind,row} of sources) {
        const value=kind==='production-flow'?row.value:row,legacyId=String(value.id??row.id),planId=`legacy:${kind}:${legacyId}`;
        if(isLegacyOwned(this.repo,kind,legacyId))continue;
        let localTime=/^([01]\d|2[0-3]):[0-5]\d$/.test(value.localTime??value.time??'')?(value.localTime??value.time):'09:00';
        const needsConfiguration=['LEGACY_CONFIGURATION_REVIEW_REQUIRED'];
        const zone=value.timezone;
        if(zone) {
          const reference=DateTime.fromISO(this.now()).setZone(zone),[hour,minute]=localTime.split(':').map(Number);
          if(reference.isValid) {
            const originalTime=reference.startOf('day').set({hour,minute}),beijing=originalTime.setZone('Asia/Shanghai');
            localTime=beijing.toFormat('HH:mm');
            const january=originalTime.set({month:1,day:1}),july=originalTime.set({month:7,day:1});
            if(january.offset!==july.offset||originalTime.toISODate()!==beijing.toISODate())needsConfiguration.push('LEGACY_TIMEZONE_REVIEW_REQUIRED');
          } else needsConfiguration.push('LEGACY_TIMEZONE_REVIEW_REQUIRED');
        } else needsConfiguration.push('LEGACY_TIMEZONE_REVIEW_REQUIRED');
        const plan=PlanCenterPlanSchema.parse({id:planId,title:value.title??value.name??'迁移计划',artistId:value.artistId??'unconfigured',enabled:!!value.enabled,schedule:{kind:'daily',localTime},count:Number.isInteger(value.count)&&value.count>0&&value.count<=20?value.count:1,theme:value.theme??'',material:{source:'dot',channel:'',identity:''},text:{threshold:value.threshold??75,maxRewrites:Math.min(2,value.maxRevisions??2),maxScoreRetries:Math.min(2,value.maxScoreRetries??2)},music:{route:'manual',versionPolicy:'first'},publishTargets:[],legacy:{kind,id:legacyId,originalEnabled:!!value.enabled},needsConfiguration,createdAt:this.now(),updatedAt:this.now()});
        if(this.store.get('plan',planId))throw Error('MIGRATION_CONFLICT');
        const owned=kind==='production-flow'?{...row,value:{...value,enabled:false,scheduleOwner:'plan-center'}}:{...row,enabled:false,scheduleOwner:'plan-center'};
        const owner={id:`${kind}:${legacyId}`,kind,legacyId,planId,migrationId:migration.id};
        const legacyRuns=this.repo.all('runs').filter(r=>r.planId===legacyId),runIds=new Set(legacyRuns.map(r=>r.id));
        const history=kind==='plans'?{runs:legacyRuns,steps:this.repo.all('steps').filter(r=>r.planId===legacyId||runIds.has(r.runId))}:kind==='dailyPlans'?{occurrences:this.repo.all('occurrences').filter(r=>r.planId===legacyId)}:{records:this.repo.all('settings').filter(r=>(r.id.startsWith('production-flow:run:')||r.id.startsWith('production-flow:occurrence:'))&&r.value?.planId===legacyId)};
        this.repo.save(kind==='production-flow'?'settings':kind,owned);this.store.put('plan',plan);this.store.put('cursor',{id:plan.id,lastAt:this.now()});this.store.put('owner',owner);
        migration.entries.push({kind,sourceId:row.id,planId,original:row,ownedHash:digest(owned),planHash:digest(plan),ownerHash:digest(owner),history});
      }
      return this.store.put('migration',migration);
    });
  }
  rollbackMigration() {
    return this.repo.transaction(()=>{
      const migration=this.store.all('migration').at(-1);if(!migration||migration.state!=='applied')throw Error('MIGRATION_NOT_APPLIED');
      for(const e of migration.entries) {
        if(this.store.all('run').some(r=>r.planId===e.planId))throw Error('MIGRATION_EXECUTED');
        const table=e.kind==='production-flow'?'settings':e.kind,value=e.kind==='production-flow'?e.original.value:e.original,legacyId=String(value.id??e.sourceId);
        if(digest(this.repo.maybe(table,e.sourceId))!==e.ownedHash||digest(this.store.get('plan',e.planId))!==e.planHash||digest(this.store.get('owner',`${e.kind}:${legacyId}`))!==e.ownerHash)throw Error('MIGRATION_CONFLICT');
      }
      for(const e of migration.entries) {
        const value=e.kind==='production-flow'?e.original.value:e.original,legacyId=String(value.id??e.sourceId);
        this.repo.save(e.kind==='production-flow'?'settings':e.kind,e.original);this.store.remove('plan',e.planId);this.store.remove('cursor',e.planId);this.store.remove('owner',`${e.kind}:${legacyId}`);
      }
      return this.store.put('migration',{...migration,state:'rolled_back'});
    });
  }
}
