import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
const bundle = path.resolve('output/text-evaluation-build/evaluation.cjs');
const entries = ['src/core/workflow/deepseek.ts'];
if (fs.existsSync('src/shared/text-evaluation.ts')) entries.push('src/shared/text-evaluation.ts');
await build({
  stdin: { contents: entries.map((file) => `export * from './${file}';`).join('\n'), resolveDir: process.cwd() },
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external',
});
const result = spawnSync(process.execPath, ['--require', path.resolve('tests/fixtures/offline-only.cjs'), '--test', 'tests/text-evaluation.test.mjs'], {
  stdio: 'inherit', env: { ...process.env, RAINFALL_TEXT_EVALUATION_BUNDLE: bundle },
});
process.exit(result.status ?? 1);
