import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const source = 'src/renderer/components/TmeObservationReport.tsx';
test('official observation form makes external evidence explicit and displays absent IDs without claiming API or client submission', async () => {
  assert(fs.existsSync(source), 'OFFICIAL_OBSERVATION_UI_MISSING');
  await build({ entryPoints: ['tests/fixtures/tme-observations-ui.tsx'], outfile: 'build/tme-observations-ui.cjs', bundle: true, platform: 'node', format: 'cjs', packages: 'external' });
  const { renderObservationReport } = createRequire(import.meta.url)('../build/tme-observations-ui.cjs');
  const html = renderObservationReport([{ id: 'observation-1', workId: 'work-1', accountId: 'account-1', title: 'Fixture A', status: 'reviewing', remoteId: null, observedAt: '2026-10-16T15:00:00.000Z', evidence: { reference: 'fixture.png', sha256: 'b'.repeat(64), summary: 'Official page shows review pending.' }, submissionByClient: false, verification: 'user_report' }]);
  for (const text of ['官方页面观察回执', '未经过 API 核实', '不代表客户端提交', '未显示远端 ID', '审核中', '证据 SHA-256', '原 A → PCM']) assert(html.includes(text), text);
  assert(!html.includes('提交审核</button>'));
  assert(!html.includes('已验证同一录音'));
});
