# Trusted sync bridge checkpoint

This continues the approved dot delivery design. The independent candidate now supports a Main-only native directory chooser, immutable local channel mapping, configured project `incoming` -> private verified deliveries, and database-backed receipts -> project `receipts`.

Security/recovery: bounded stable reads, strict schemas and exact SHA256, fully decoded bounded still covers, no traversal/links/hardlinks, staging outside scanned deliveries and READY last, atomic directory promotion, no overwrite of accepted IDs, persisted sync/IO retry, receipt replay per delivery without starvation, and Windows atomic no-replace File.Move for receipts. Its fixed hidden PowerShell helper accepts only Source/Destination parameters; paths are not interpolated into shell code. The helper is physical in the portable build and explicitly unpacked/resolved for future ASAR packaging. A failed move does not create hardlink aliases. Public requests cannot supply filesystem paths; only a native chooser or explicitly authorized local setup configures the root.

Core control requests cancel scans synchronously before the serialized RPC queue, with validation/revision checks and scan epochs. Actual-Core held-decoder regressions verify bridge pause, inbox pause and source replacement stop before private promotion/import. Status distinguishes incomplete sync, permanent conflict, receipt waiting and locally written receipt. Local writing never asserts cloud delivery.

Verification completed before packaging:

- 51 contract/image/store/receiver/bridge tests passed, including real hidden .NET no-replace moves and a foreign receipt arriving during publication. Log `output/dot-delivery-tests/bridge-verified-tests.log`.
- 4 actual-Core cancellation tests passed (wrapper plus3 control paths). Log `output/dot-delivery-tests/core-cancel-tests.log`.
- 64 existing-album/Core/Main/publication/receipt-barrier/material-scope offline regressions passed. Real account, generation and platform writes remain prohibited. Log `output/dot-delivery-tests/publishing-regression.log`.
- Independent review identified and rechecked receipt publication race, replay starvation, serialized cancellation, ASAR helper visibility and hardlink crash recovery. All fixed; final reviewer reported no blocker.
- Typecheck and desktop build passed; existing Vite chunk-size advisory remains. This turn performs no native GUI/visual acceptance or window launch.

Actual Google Drive discovery used normal-user background reads because the restricted desktop token cannot access the mounted filesystem. Drive label Google Drive, root G: ready; exact project folder and both child directories exist. Their actual paths are recorded in ignored local connection evidence and the user's isolated settings, never guessed by product code. The Drive window exposed no visible email; identity remains user-confirmed, not independently verified, and no credentials/tokens were read.

Fresh isolated live-receive data root: `output/dot-drive-connected-20261018/candidate-data`. One windowless inbox-only scan against the actual project succeeded with zero candidates/assets/works/operations; no fixture was sent there. The temporary headless host runs only inbox scans, never Studio.tick or model/music/publishing; it holds the same workspace lease as the GUI, has a bounded explicit watch duration, no OS registration, and a local stop marker. A future GUI must use the same data root after this host releases the lease. Its record is `runtime/dot-inbox-host-status.json`, stop marker `runtime/dot-inbox-host.stop`.

Packaging uses the already-installed runtime/dependencies into a fresh `out/dot-delivery-bridge-<commit>-<time>` directory. It includes the remaining existing-album publication integration, whose real runtime writes stay locked as `EXISTING_ALBUM_WRITE_INTEGRATION_UNVERIFIED`. Candidate manifest declares unlaunched/unaccepted, no automatic dot creation/music/publication, and isolated data root. Formal desktop pointer, shortcut and formal data are untouched.

Remaining acceptance: parent sends an actual dot-created package from cloud; verify private import and observe its exact receipt back through cloud. The shipped format fixture is not creative output. Cloud scheduling remains parent-controlled and not enabled here. Candidate GUI/visual acceptance and any formal upgrade require a later stage; this turn explicitly prohibits windows.
