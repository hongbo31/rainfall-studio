import {DirectoryTaskChooseSchema} from '../shared/directory-tasks';
type Scope={mode:string;generation:number;epoch:number;available:boolean};
/** Main-only native chooser; a renderer can select a source identity, never submit a path. */
export async function chooseDirectoryTaskSource(raw:unknown,deps:{capture:()=>Scope;choose:()=>Promise<{canceled:boolean;filePaths:string[]}>;rpc:(method:string,input:any)=>Promise<any>}){
 const input=DirectoryTaskChooseSchema.parse(raw),scope=deps.capture();
 const active=()=>{const s=deps.capture();if(!s.available||s.mode!==scope.mode||s.generation!==scope.generation||s.epoch!==scope.epoch)throw Error('WORKSPACE_CHANGED');};
 if(!scope.available)throw Error('WORKSPACE_UNAVAILABLE');active();
 const selection=await deps.choose();active();if(selection.canceled)return{ok:true,value:null};if(selection.filePaths.length!==1)throw Error('DIRECTORY_SELECTION_REQUIRED');
 return deps.rpc('internal.directoryTasks.configureDirectory',{...input,expectedRevision:input.expectedRevision??null,root:selection.filePaths[0]});
}
