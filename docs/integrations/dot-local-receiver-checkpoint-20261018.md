# dot text + cover receiver checkpoint

Implemented in the independent candidate repository on DESKTOP-90VCPDC:
`C:/Users/31559/Documents/Codex/2026-10-15/task/rainfall-studio-unified-acceptance-20261018`.

The existing inbox schemaVersion1 text contract is unchanged. A separate deliveryVersion1 directory envelope binds text.json and one immutable cover per item revision. Full image decoding and exact SHA256/size/MIME/dimensions precede a single SQLite metadata transaction for candidates, drafts, image assets, cover relations and delivery receipt. Incomplete sync waits with capped retry intervals; permanent protocol/security conflicts refuse the package. Missing receipt files recover from committed database receipts after restart. Pause stops an in-flight asynchronous decode before import. Status remains available while paused. No HTTP/model/CLI/music/publication adapter is part of this receiver.

Fixed current paths: `<dataRoot>/<mode>/inbox-v1/deliveries/<deliveryId>/` and `<dataRoot>/<mode>/inbox-v1/delivery-receipts/`. Media copies stay under `<dataRoot>/media/sha256/`. The source path comes from application configuration, never an incoming manifest. A trusted native chooser/bridge mapping to the signed-in Drive project folder is still pending; current application-private folders do not establish cloud delivery.

Complete byte-valid example: `docs/integrations/dot-delivery-example/` (text.json, one 237-byte purple 64x64 fixture PNG, manifest.json, READY.json). It is clearly labeled a format fixture, not daily AI output. Do not call it an actual dot-created cover.

Verification:

- 38 isolated contract/image/real-SQLite/store/receiver/controller tests passed. Includes truncated and stale READY recovery, partial sync/restart/backlog, exact-once import, revision conflicts, rollback, hard links, invalid images, pause during decode, media/receipt ENOSPC recovery and v1 compatibility. Offline network guard enabled. Log: `output/dot-delivery-tests/verified-tests.log`.
- `npm test`: 3/3 passed. `npm run typecheck` and `node scripts/build-desktop.mjs` passed; Vite reports the existing >500kB chunk advisory.
- Independent review found incomplete READY and resource IO retry defects; both were fixed and re-reviewed with no remaining blocker.
- Development Electron native acceptance passed via the normal WinSta0/Default desktop with an isolated simulation root. It configured the inbox through the UI, imported the fixture, displayed the cover binding and model_pending state, paused/resumed without duplicates, and observed no renderer HTTP/errors/horizontal overflow. This is a development Electron run, not validation of a new packaged executable.
- Native report and screenshots: `output/dot-delivery-native-1792348138300/report.json`, `01-text-cover-received.png`, `02-pause-resume-no-duplicates.png`. The initial test harness had one missing snapshot field assertion; it was corrected before the successful run.
- Root-level formal installed data, desktop shortcut, real accounts, music generation and publishing were not changed by this feature.

Google Drive Desktop:

- User-approved installation completed: version132.0.0.0, installed executable `C:/Program Files/Google/Drive File Stream/132.0.0.0/GoogleDriveFS.exe`.
- Installer and installed executable Authenticode signature Valid, signer Google LLC; installer exit0. Evidence: `output/google-drive-desktop-install-evidence.json`.
- Actual OS Windows10 Pro22H2 build19045.6466; WebView2 already present.
- App closed, no sign-in or PC backup configuration performed. Human must sign in, retain Stream files, skip broad PC backups and locate only the dedicated project folder. No new OAuth client or copied credentials.

Remaining gates: human Google login and real filesystem path; trusted source/receipt directory mapping; one real dot payload sent from cloud and matching receipt observed back; then packaging/formal upgrade and parent-controlled scheduling. Daily09:00 Asia/Shanghai remains provisional and disabled in the cloud. The existing local daily template plan is not dot AI creation and was not changed.
