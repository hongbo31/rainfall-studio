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

## Known failing baseline UI regression

`tests/publish-material-feedback-ui.test.mjs`: 1/10 passed, 9 timed out waiting for `.publication-current-result`. Rebuilding the unchanged `b6296ff` PublishCenter with the same Core reproduced exactly 1/10 and the same nine timeouts. The fixture expects inline current results, while persisted pipeline jobs suppress that inline branch. This existing suite was not weakened or represented as passing. It remains unresolved and limits acceptance.

## Not performed / remaining blockers

No real provider request, production DB/credential read, generation charge, account mutation, browser operation, upload, new agreement acceptance, official submission or online publication was performed. Demo and earlier candidate remain intact. No native client window, installer, desktop pointer switch, safety-setting change, dependency download or software installation occurred.

Real provider fee enforcement and native candidate visual acceptance remain unverified. Fanqie has no production write adapter; this work does not establish live platform or end-to-end publication success. Candidate is reviewable offline and must not be promoted automatically. Existing old UI fixture regression above remains open.
