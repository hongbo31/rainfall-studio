import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const localMethods=new Set(['runtime','snapshot','apiProfile.list','platformConfig.list','materials.list','materials.chooseDirectory','materials.scan','materials.pause','materials.resume','materials.selectVersion','work.selectAudioVersion','publish.selection.save','publish.simple']);
for(const method of ['previewScan','chooseRebindDirectory','updatePreview','confirmImport'])localMethods.add('materials.'+method);
export function offlineAcceptanceInvocationAllowed(channel:string,args:unknown[]){
 return channel==='rainfall:call'&&typeof args[0]==='string'&&localMethods.has(args[0]);
}
// Opt-in acceptance runs must use a freshly provisioned temporary workspace.
export function offlineAcceptanceEnabled(){
 if(process.env.RAINFALL_OFFLINE_ACCEPTANCE!=='1')return false;
 const requested=process.env.RAINFALL_DATA_ROOT;if(!requested)throw Error('OFFLINE_ACCEPTANCE_ROOT_REQUIRED');
 const root=fs.realpathSync(requested),temp=fs.realpathSync(os.tmpdir()),relative=path.relative(temp,root);
 if(relative.startsWith('..')||path.isAbsolute(relative)||!path.basename(root).startsWith('rainfall-offline-acceptance-')||!fs.existsSync(path.join(root,'offline-acceptance.marker')))throw Error('OFFLINE_ACCEPTANCE_TEMP_ROOT_REQUIRED');
 return true;
}
