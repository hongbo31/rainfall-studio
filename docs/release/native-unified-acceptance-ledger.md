# SDD ledger — plan: docs/release/native-unified-acceptance-plan.md

Task 1 complete: isolated sanitized source imported as ff861d6. Original ec39d740 checkout unchanged. Cumulative patch SHA256 26b5d25572946ff1e351df4e645072c6020df3f636c708da70451dedc3763820 and diagnostics v1 e462d311847c0e43ad9eeb39bdfbb292d21c579c7374ac2e3b98c1c9035cac82 passed git apply checks sequentially; no overlapping ff253 source.

Task 2: initial Windows typecheck/build passed; integration 204/204 passed. Initial publish suite had two fixture setup errors creating Windows symlinks (EPERM). Ruling: use directory junctions on Windows to exercise the same real-path/ancestor rejection without requiring symbolic-link privileges; keep Linux symlink cases. Both passed afterwards.

Task 2 fixed: missing protected title 留一盏灯 in enqueue and local material resolution. Watched new tests fail (queued / missing exception), then pass after adding the title to the existing safety boundary. Later metadata-save protection was made consistent; failing then passing regression retained.

Task 3: real installed Chromium local pipeline UI passed. Diagnostics + SSR 13/13 passed. Existing Edge PID 31696 was inspected read-only: no debugging port/pipe or private profile. No debug session was enabled. Real account CDP connection cannot be established in this authorized scope.

Task 3: packaged native run report output/playwright/native-unified-1792327639902/report.json passed all eight checks with two visible WinSta0/Default launches and isolated original fixtures. No native input processes, renderer HTTP requests, native exceptions or lifecycle failures. Restart state injected only into the closed fixture DB. Never wrote production data.

Ruling: exact getByLabel on a nested textarea included its initial text; use textbox accessible role/name. No product form change required. Full-page Playwright capture intermittently timed out on the Windows Electron compositor; use the actual BrowserWindow webContents capturePage for final viewport screenshots. Failed attempts retained in output/playwright; not counted as passing.

Task 3: actual Chromium DOM popup fixtures passed: known exact homepage notice closes once; unknown/terms/login/captcha dialogs stay blocked with zero clicks. Pages were locally fulfilled and visibly labelled fixtures, not live Tencent calibration.

Final review: one fresh-context read-only reviewer of ff861d6..3e96fc2 and current harness. No Critical findings; one Important finding: merged QQ/Kugou scopes only rechecked the first target. Fixed with effective-material conflict detection, persisted per-target fingerprints and verification of every target before claim. Added actual Studio+SQLite regressions; three failures watched before fix, four tests passing after fix (including protected metadata save). No re-review requested; final suite and native retest pending.

Ruling: preserve version 0.8.3-preview.2 from the provided source; identify every candidate by its exact Git sourceCommit and executable hash. This is an isolated portable candidate, not an accepted replacement of the installed client. No entry promotion.
