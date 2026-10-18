// Runs in the accepted package's Electron Node mode, never as its GUI Main.
const path=require('node:path');
const [packageRoot,dataRoot]=process.argv.slice(2);
if(!process.versions.electron||!path.isAbsolute(packageRoot)||!path.isAbsolute(dataRoot))throw Error('MIGRATION_RUNTIME');
globalThis.fetch=()=>{throw Error('MIGRATION_NETWORK_DISABLED');};
for(const name of ['node:http','node:https']){const m=require(name);m.request=m.get=()=>{throw Error('MIGRATION_NETWORK_DISABLED');};}
const {Studio}=require(path.join(packageRoot,'resources/app.asar/build/core.cjs'));
const studio=new Studio(dataRoot,'production');
try{if(studio.db.pragma('user_version',{simple:true})!==3)throw Error('MIGRATION_SCHEMA');console.log(JSON.stringify({schema:3,mode:'production',works:studio.all('works').length,accounts:studio.all('accounts').length}));}finally{studio.close();}
