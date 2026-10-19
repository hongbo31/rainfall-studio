import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
const file = path.resolve('output/plan-center-build/center.cjs');
const entries = ['export {Repository} from "./src/core/database"; export {InboxId} from "./src/shared/inbox"; export {flowCandidate} from "./src/core/production-flow-local";'];
for (const p of ['src/shared/plan-center.ts', 'src/core/plan-center/index.ts'])
  if (fs.existsSync(p)) entries.push(`export * from "./${p}";`);
await build({ stdin: { contents: entries.join('\n'), resolveDir: process.cwd() }, outfile: file,
  bundle: true, platform: 'node', format: 'cjs', packages: 'external' });
const tests = fs.readdirSync('tests').filter(p => /^plan-center.*\.test\.mjs$/.test(p)).map(p => `tests/${p}`);
const result = spawnSync(process.execPath, ['--require', path.resolve('tests/fixtures/offline-only.cjs'), '--test', ...tests],
  { stdio: 'inherit', env: { ...process.env, RAINFALL_PLAN_CENTER_BUNDLE: file } });
process.exit(result.status ?? 1);
