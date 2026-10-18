/** Pure, fail-closed overlay policy. DOM recognition and physical execution live in the adapter. */
export type OverlayKind='notice'|'tour'|'login'|'terms'|'permission'|'captcha'|'unsaved'|'delete'|'unknown';
export type OverlayScope={origin:string;route:string;subject:string;binding:string;materials:string};
export type ObservedOverlay={
 instanceId:string;
 ruleId?:string;
 kind:OverlayKind;
 visible:boolean;
 blocking:boolean;
 verified:boolean;
 actionCount:number;
};
export type OverlaySnapshot={scope:OverlayScope;overlays:ObservedOverlay[];scanComplete:boolean};
export type OverlayCallContext={timeoutMs:number};
export type OverlayDismissContext=OverlayCallContext&{scope:Readonly<OverlayScope>};
export type OverlayGuardOptions={
 observe:(context:OverlayCallContext)=>Promise<OverlaySnapshot>;
 dismiss:(target:Readonly<ObservedOverlay>,context:OverlayDismissContext)=>Promise<void|boolean>;
 /** Synchronous cancellation/workspace check; throw to stop the entire operation. */
 guard:()=>void;
 now?:()=>number;
 timeoutMs?:number;
};
export type OverlayGuardResult={
 status:'clear';
 snapshot:OverlaySnapshot;
 dismissals:{instanceId:string;ruleId:string}[];
};
export type OverlayGuardCode=
 |'OVERLAY_INVALID_TIMEOUT'|'OVERLAY_CLOCK_INVALID'|'OVERLAY_TIMEOUT'
 |'OVERLAY_INVALID_OBSERVATION'|'OVERLAY_SCAN_INCOMPLETE'
 |'OVERLAY_SCOPE_REQUIRED'|'OVERLAY_SCOPE_CHANGED'
 |'OVERLAY_UNSAFE'|'OVERLAY_AMBIGUOUS'|'OVERLAY_TARGET_CHANGED'
 |'OVERLAY_DISMISS_FAILED'|'OVERLAY_DISMISS_UNCONFIRMED'
 |'OVERLAY_REPEATED'|'OVERLAY_LIMIT_REACHED';
export class OverlayGuardError extends Error{
 constructor(public readonly code:OverlayGuardCode){super(code);this.name='OverlayGuardError';}
}
const fail=(code:OverlayGuardCode):never=>{throw new OverlayGuardError(code);};
const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const nonempty=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;
const scopeKeys=['origin','route','subject','binding','materials'] as const;
const kinds:ReadonlySet<string>=new Set(['notice','tour','login','terms','permission','captcha','unsaved','delete','unknown']);
const sensitive:ReadonlySet<OverlayKind>=new Set(['login','terms','permission','captcha','unsaved','delete']);

function parseSnapshot(value:unknown):OverlaySnapshot{
 if(!record(value)||!Array.isArray(value.overlays)||typeof value.scanComplete!=='boolean')return fail('OVERLAY_INVALID_OBSERVATION');
 if(!value.scanComplete)return fail('OVERLAY_SCAN_INCOMPLETE');
 const sourceScope=value.scope;
 if(!record(sourceScope)||scopeKeys.some(key=>!nonempty(sourceScope[key])))return fail('OVERLAY_SCOPE_REQUIRED');
 // Copy every primitive: reusing/mutating an adapter object must not rewrite earlier evidence.
 const scope:OverlayScope={origin:sourceScope.origin as string,route:sourceScope.route as string,subject:sourceScope.subject as string,binding:sourceScope.binding as string,materials:sourceScope.materials as string};
 const overlays=value.overlays.map((item:unknown):ObservedOverlay=>{
  if(!record(item)||!nonempty(item.instanceId)||typeof item.kind!=='string'||!kinds.has(item.kind)
   ||typeof item.visible!=='boolean'||typeof item.blocking!=='boolean'||typeof item.verified!=='boolean'
   ||typeof item.actionCount!=='number'||!Number.isInteger(item.actionCount)||item.actionCount<0
   ||(item.ruleId!==undefined&&typeof item.ruleId!=='string'))return fail('OVERLAY_INVALID_OBSERVATION');
  return{instanceId:item.instanceId,ruleId:item.ruleId as string|undefined,kind:item.kind as OverlayKind,visible:item.visible,blocking:item.blocking,verified:item.verified,actionCount:item.actionCount};
 });
 return{scope,overlays,scanComplete:true};
}
function assertScope(snapshot:OverlaySnapshot,baseline:OverlayScope):void{
 if(scopeKeys.some(key=>snapshot.scope[key]!==baseline[key]))fail('OVERLAY_SCOPE_CHANGED');
}
function candidates(snapshot:OverlaySnapshot,seen:ReadonlySet<string>):ObservedOverlay[]{
 const visible=snapshot.overlays.filter(item=>item.visible);
 // A known sensitive dialog is never approved by the ordinary-notice policy.
 if(visible.some(item=>sensitive.has(item.kind)))fail('OVERLAY_UNSAFE');
 const blocking=visible.filter(item=>item.blocking);
 if(blocking.some(item=>(item.kind!=='notice'&&item.kind!=='tour')||!item.verified||!nonempty(item.ruleId)||item.actionCount!==1))fail('OVERLAY_UNSAFE');
 if(visible.some(item=>item.ruleId!==undefined&&seen.has(item.ruleId)))fail('OVERLAY_REPEATED');
 const instanceIds=new Set<string>(),ruleIds=new Set<string>();
 for(const item of blocking){
  // Multiple different overlays are valid. Duplicate target/rule identity is not.
  if(instanceIds.has(item.instanceId)||ruleIds.has(item.ruleId!))fail('OVERLAY_AMBIGUOUS');
  instanceIds.add(item.instanceId);ruleIds.add(item.ruleId!);
 }
 return blocking;
}
function sameCandidates(left:ObservedOverlay[],right:ObservedOverlay[]):boolean{
 return left.length===right.length&&left.every((item,index)=>{
  const other=right[index];
  return item.instanceId===other.instanceId&&item.ruleId===other.ruleId&&item.kind===other.kind;
 });
}

/**
 * Dismiss at most four verified blocking notice/tour overlays within a 10s budget.
 * A clear result is fresh scope/material evidence, not permission to upload or submit.
 * All pauses throw; executor/guard errors propagate unchanged, and no call is retried.
 *
 * There is deliberately no Promise.race or detached continuation. If an executor call
 * stalls, this promise remains pending so its caller must retain its in-flight lock.
 * Each executor must enforce the supplied remaining timeout itself and finish/cancel
 * the actual operation before settling. A late result is rejected before another call.
 * The caller must retain its workspace lock until this promise settles and must not
 * automatically restart this guard after a pause (which would reset its rule history).
 */
export async function runOverlayGuard(options:OverlayGuardOptions):Promise<OverlayGuardResult>{
 const timeoutMs=options.timeoutMs??10000;
 if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>10000)fail('OVERLAY_INVALID_TIMEOUT');
 const now=options.now??(()=>performance.now());
 let lastTime=now();
 if(!Number.isFinite(lastTime))fail('OVERLAY_CLOCK_INVALID');
 const deadline=lastTime+timeoutMs;
 if(!Number.isFinite(deadline))fail('OVERLAY_CLOCK_INVALID');
 const checkpoint=()=>{
  const time=now();
  if(!Number.isFinite(time)||time<lastTime)fail('OVERLAY_CLOCK_INVALID');
  lastTime=time;
  const remaining=deadline-time;
  if(remaining<=0)fail('OVERLAY_TIMEOUT');
  return remaining;
 };
 const call=async<T>(action:(timeoutMs:number)=>Promise<T>):Promise<T>=>{
  checkpoint();options.guard();
  const result=await action(checkpoint());
  checkpoint();options.guard();checkpoint();
  return result;
 };
 const observe=async()=>parseSnapshot(await call(budget=>options.observe({timeoutMs:budget})));
 let current=await observe();
 const baseline=Object.freeze({...current.scope}),seen=new Set<string>();
 const dismissals:OverlayGuardResult['dismissals']=[];
 for(;;){
  assertScope(current,baseline);
  const available=candidates(current,seen);
  if(available.length===0)return{status:'clear',snapshot:current,dismissals};
  if(dismissals.length>=4)fail('OVERLAY_LIMIT_REACHED');
  const refreshed=await observe();
  assertScope(refreshed,baseline);
  const refreshedCandidates=candidates(refreshed,seen);
  // A new/reordered blocker can cover the old target. Never carry an old target
  // through changed evidence, even if the replacement happens to share a rule.
  if(!sameCandidates(available,refreshedCandidates))fail('OVERLAY_TARGET_CHANGED');
  const target=Object.freeze({...refreshedCandidates[0]});
  seen.add(target.ruleId!);
  const dismissed=await call(budget=>options.dismiss(target,{scope:baseline,timeoutMs:budget}));
  if(dismissed===false)fail('OVERLAY_DISMISS_FAILED');
  dismissals.push({instanceId:target.instanceId,ruleId:target.ruleId!});
  current=await observe();
  assertScope(current,baseline);
  if(current.overlays.some(item=>item.visible&&item.instanceId===target.instanceId))fail('OVERLAY_DISMISS_UNCONFIRMED');
  // The next iteration validates every blocker and rule before any further close.
 }
}
