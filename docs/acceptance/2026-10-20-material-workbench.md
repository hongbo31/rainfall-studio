# 90VC material workbench acceptance — 2026-10-20

Development checkout: `rainfall-material-workbench`, branch `feature/material-workbench-90vc`, based on local `a50dc316bf13cbc2ffb8df31e82fc4eff7aaf8e0` plus separately recorded Fanqie/credential preparation dependency `b6296ff`. This is an isolated preview.5 candidate, not an installed upgrade.

## Delivered behavior

- Explicit directory selection and explicit read-only scan of the existing `song-map-001-100.json` collection adapter. No watcher, automatic import, generic folder convention, or root relocation/rebind is implemented.
- Initial 20 styles use the exact indexed numbered/title section; later 80 use indexed files and checked metadata. Stable UUID/revision, file hashes, ambiguity/missing/change checks, decoded cover thumbnails and full details. A unique same-collection hash match can retain identity on rename; ambiguous matches block.
- Pending/all/generated views, stable selection, generated-row deselection, preserved history and separately confirmed regeneration. Failed/unknown states do not count as generated.
- Persistent serial submit/query/download/verify lifecycle, pause/restart recovery, original provider-ID reconciliation, request deduplication and retained unknown cost reservations. Production material generation is hard blocked: no supplier-enforced price ceiling has been established. A local budget is not a guarantee of provider charges.
- Frozen managed cover captured before fixture submission; verified A/B audio must both exist before generated state. Source changes create a new material revision and do not replace older work covers/audio.
- Existing publication center gains ready-audio list, actual audio players, explicit persisted A/B choice, source/history links, target/status filters and unavailable target explanations. Local queue/preparation is distinct from official review/publication. Fanqie official submit remains unavailable; 1024px material covers remain below the observed 1440px requirement. AI/rights/terms require explicit applicable confirmation.

## Verification actually run

| Check | Result |
| --- | --- |
| `npm test` | 3/3 passed |
| `npm run test:integration` | 230/230 passed after fixing new read-only snapshot regression |
| `node scripts/test-material-workbench.mjs` | 16/16 passed |
| `node scripts/test-material-broker.mjs` | 3/3 passed |
| Material routing tests included in integration | 3/3 passed: actual isolated SQLite/WAV imports, immutable cover, failed selection consistency, all100 offline drafts |
| New headless materials/publication UI tests | 10/10 passed |
| `npm run test:fanqie` | 40/40 passed |
| `npm run typecheck`, `npm run desktop:build`, `git diff --check` | Passed; build retains existing >500kB chunk warning |

The real100 collection scan fully decoded all100 covers and compared every indexed source file hash before/after. The initial20 shared Style association and later80 metadata association were exercised. No source writes occurred. New queue tests reproduced the ordering, preparation-repeat and read-only constructor defects before the fixes. Review found no remaining concrete blocker in the inspected broker boundary, frozen-cover/audio, cost, restart and unknown-result scope.

## Publication feedback regression — resolved

`node scripts/compare-publication-feedback.mjs` compares only the renderer source while holding current Core, fixtures, installed Chromium (143.0.7499.193), test assertions and timeouts constant. `b6296ff`: 1/10; first candidate `c6f84c9`: 1/10; repaired renderer: 10/10. Core/source/test/fixture hashes, exact failure names and boundary counters are in `output/publish-material-feedback/comparison.json`; runner logs accompany it. All runs had zero external requests and zero external operations.

This was a user-visible defect within the modified publication center, not grounds for waiving acceptance: after enqueue, persisted queue jobs hid local material-check details, direct repair actions and stale-history information. Removing two rendering guards keeps those details alongside the queue. Every original assertion and timeout remains; an additional assertion requires queue/details coexistence. Core material-feedback tests also pass32/32.

The nine failures classify as: three result/concurrency/reuse visibility cases; three stale-snapshot/background-invalidation cases; one missing-material repair case; two error/retry cases (asynchronous response and selection-save failure). All reached persisted local request/queue data; the hidden result branch prevented their expected controls from appearing. The tenth mode-change case already passed because it expected no late result. This classification and identical failure names are recorded for both historical renderers.

## Real Electron offline acceptance

`node scripts/test-material-electron.mjs --packaged` launched the actual portable executable using a fresh `Temp/rainfall-offline-acceptance-*` root, separate `runtime` userData and `production/library.sqlite`. The opt-in acceptance gate rejects non-temporary/unmarked roots, blocks provider transport before DNS/HTTPS, blocks Electron HTTP(S)/WebSocket requests and disables automatic broker pumps. No production credentials or data were copied. Guard tests pass3/3. Every dedicated IPC channel is denied before its handler; an exact allowlist permits only local materials/preflight methods. The actual window verified rejection of native-browser, official-link, generation and enqueue calls, plus an observed network-cancellation counter.

The real window passed11 checks: the existing100 materials were scanned read-only;100 thumbnail images decoded at1024px through the actual custom protocol. Full-size detail/dimensions/path/lyrics/Style, pending99/all100/generated1 filtering, both actual WAV A/B source associations and playback, persisted B selection and existing publication UI preflight were exercised. Visual inspection caught a hard-coded audio-A label despite selected-B snapshot; it now reflects the recording slot and the real Electron assertion checks the B label. The one generated material and A/B WAVs are synthetic offline fixtures, explicitly marked in a visible acceptance ribbon. Preflight showed real local configuration/material blockers and the durable queue together; no official review/published state was produced. All361 indexed source hashes remained identical. Screenshots and results are under `output/material-electron-acceptance` and copied into the verified candidate's docs.

Restricted-tool launches initially failed GPU child initialization with0xC0000135; the same isolated launch under the approved normal execution context succeeded. No dependency installation or sandbox/security-setting change was used.

## Manual acceptance entry

From the candidate directory run `pwsh -NoProfile -File ./Start-Offline-Material-Acceptance.ps1 -SourceRoot "C:\Users\31559\Documents\Codex\2026-10-20\task\Rainfall-Materials-Pending\2026-10-20_100-songs"`. The launcher creates another temporary fixture DB, imports test WAV A/B for the first material, and starts the real candidate with external networking and automatic execution disabled. It never selects the formal desktop entry.

In 素材列表: scan, switch 待生成/全部素材/已生成, open a thumbnail and inspect source details. In existing 发布中心: play the fixture A/B, choose B, select QQ音乐 and run local checks; configuration/material blockers must remain visible beside the queue. Do not interpret generated fixture data or local checks as a supplier connection or official receipt. Closing the candidate leaves the temporary evidence/data for inspection; the original Demo remains untouched.

## Not performed / remaining blockers

No real provider request, production DB/credential read, generation charge, account mutation, user-browser operation, upload, new agreement acceptance, official submission or online publication was performed. Demo and earlier candidate remain intact. Only isolated native acceptance windows were launched and closed; no installer, desktop pointer switch, safety-setting change, dependency download or software installation occurred.

Real provider fee enforcement remains unverified. Fanqie has no production write adapter; this work does not establish live platform or end-to-end publication success. Candidate is reviewable offline and must not be promoted automatically. Generic directory imports, per-song folder conventions/manifests other than the current100-song adapter, and root relocation/rebinding remain unsupported.
