// Offline/cloud validation only. No production browser connection or Tencent writes.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
const dir='output/cloud-publish-validation';fs.mkdirSync(dir,{recursive:true});
const commands=[
 ['core-intents',['scripts/test-unified-publish.mjs']],
 ['scope-consent',['scripts/test-tme-ai-scope.mjs']],
 ['prepare-core',['scripts/test-tme-ai-prepare.mjs']],
 ['prepare-broker',['scripts/test-tme-ai-broker.mjs']],
 ['submission',['scripts/test-tme-ai-submission.mjs']],
 ['materials',['scripts/test-publish-material-feedback.mjs']],
 ['browser-ui-contracts',['--test','tests/unified-publish-main.test.mjs','tests/tme-ai-cloud-session.test.mjs','tests/tme-ai-prepare-browser.test.mjs','tests/tme-ai-submission-browser.test.mjs','tests/publication-pipeline-render.test.mjs','tests/publication-metadata-form.test.mjs','tests/media-tool-paths.test.mjs']],
 ['cover-regression',['scripts/test-tme-cover-cloud.mjs']],
];
const results=[];
for(const [name,args]of commands){const r=spawnSync(process.execPath,args,{encoding:'utf8'});const log=(r.stdout??'')+(r.stderr??'');fs.writeFileSync(`${dir}/${name}.log`,log);const counts=[...log.matchAll(/ℹ (tests|pass|fail|skipped) (\d+)/g)].reduce((totals,m)=>({...totals,[m[1]]:(totals[m[1]]??0)+Number(m[2])}),{});const result={name,exitCode:r.status??1,...counts};results.push(result);console.log(JSON.stringify(result));}
fs.writeFileSync(`${dir}/summary.json`,JSON.stringify({scope:'offline unit, SQLite integration and injected browser/SSR contracts; not live Tencent or native UI',results},null,2));
process.exit(results.some(r=>r.exitCode!==0)?1:0);
