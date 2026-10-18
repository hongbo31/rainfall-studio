type CoverSnapshot={
 identity:Record<string,unknown>;
 binding:Record<string,unknown>;
 route?:string;
 mode?:string;
 form?:Record<string,unknown>|null;
 coverState?:{manualSelected?:unknown;generatorBanner?:unknown};
};
type ReadbackOptions<T extends CoverSnapshot>={
 read:()=>Promise<T>;
 guard:()=>void;
 sleep?:(ms:number)=>Promise<void>;
 now?:()=>number;
 timeoutMs?:number;
};
const isRecord=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function signature(value:unknown):string{
 if(value===null||typeof value==='string'||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(signature).join(',')+']';
 if(isRecord(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+signature(value[key])).join(',')+'}';
 throw Error('COVER_READBACK_INVALID_VALUE');
}

// This settles read-only UI evidence. It cannot prove a new file selection or remote persistence.
export async function waitForStableManualCover<T extends CoverSnapshot>(options:ReadbackOptions<T>):Promise<T>{
 const timeoutMs=options.timeoutMs??6000;
 if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>6000)throw Error('INVALID_COVER_READBACK_TIMEOUT');
 const now=options.now??(()=>performance.now()),sleep=options.sleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
 const deadline=now()+timeoutMs,timeout=()=>Error('MANUAL_COVER_ACCEPTANCE_REQUIRED');
 let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
 const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{stopped=true;reject(timeout());},timeoutMs);});
 const poll=async()=>{
  let scope:string|undefined,materials:string|undefined,consecutive=0,stableSince=0;
  for(;;){
   if(stopped||now()>=deadline)throw timeout();
   options.guard();
   const snapshot=await options.read();
   if(stopped||now()>=deadline)throw timeout();
   options.guard();
   if(!isRecord(snapshot)||!isRecord(snapshot.identity)||Object.keys(snapshot.identity).length===0||!isRecord(snapshot.binding)||Object.keys(snapshot.binding).length===0)throw Error('COVER_READBACK_SCOPE_REQUIRED');
   const currentScope=signature({identity:snapshot.identity,binding:snapshot.binding,route:snapshot.route??null});
   if(scope!==undefined&&scope!==currentScope)throw Error('COVER_READBACK_SCOPE_CHANGED');
   scope=currentScope;
   if(snapshot.mode==='editor'&&snapshot.coverState?.manualSelected===true&&snapshot.coverState.generatorBanner===false&&isRecord(snapshot.form)){
    const currentMaterials=signature(snapshot.form);
    if(materials!==currentMaterials){materials=currentMaterials;consecutive=1;stableSince=now();}else consecutive++;
    if(consecutive>=3&&now()-stableSince>=200)return snapshot;
   }else{materials=undefined;consecutive=0;}
   const remaining=deadline-now();if(remaining<=0)throw timeout();
   await sleep(Math.min(100,remaining));
  }
 };
 try{return await Promise.race([poll(),expired]);}finally{stopped=true;clearTimeout(timer);}
}
