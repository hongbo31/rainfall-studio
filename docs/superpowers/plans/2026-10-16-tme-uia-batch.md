# Tencent visible-window integration and selected-work batches

Approved scope: the parent confirmed the four-point design. Implement inline without another design approval. Local checkout only; no push, installed client replacement, real uploads, agreement acceptance or submissions during validation. The previously submitted song is read-only.

## Binding requirements

- Main owns a short-lived, user-selected Windows UI Automation window binding. No cookies, profile reads, CDP enablement, extensions, service or persistent access. Every action freshly checks process, window, Tencent origin and visible account. Visible nickname is not a provider-unique user ID; report that limitation.
- Existing-album intake preserves its shared cover. Original proof is optional on the observed site. Actual flow is audio → real fields → authorization → review submission. Never invent a save-draft action.
- Agreement acceptance and submission are separate per-song actions bound to fresh content hashes and short-lived single-use permits. Batch upload permission authorizes neither. Persist action intent before transport; interruption or uncertain result requires reconciliation and prohibits retransmission.
- Reuse Library selection and existing batches/units/claims storage. Same-account window executes serially. Independently preflight each selected work; skip known blocked items; pause at user decision or unknown outcome. Cancellation stops the next item. No global platform guard removal.
- Status evidence includes observation time, route, album ID and nullable song ID. Album ID is never substituted for song ID. A row match is a visible observation, not cryptographic audio identity or verified submission by this client.

## Tasks / interfaces

1. Add typed live observations/receipts, optional existing-album metadata and persistent Tencent batch operations in Core. Interfaces: TmeDraft optional live evidence; `tme.batchPlan/list`, Main-only batch update. RED: shared-cover/proof, duplicate claims, restart recovery and per-item blocks. GREEN focused Core tests.
2. Add strict Windows UIA transport and live coordinator. Interfaces: observe, stage, readAgreement, accept, submit, sync; guarded binding and action permits. RED: mismatch, timeout, duplicate, explicit action boundaries, serial/cancel/mixed outcomes. GREEN runner tests. Preserve legacy fixture path.
3. Wire trusted Main/preload, renderer selected batch and explicit per-song actions. No raw shell command or arbitrary UI target crosses IPC. Verify typecheck/build and existing TME suite.
4. Hidden isolated client UI QA and read-only current Tencent page sync. Run one fresh whole-change review, address Important/Critical issues with failing tests, record actual results and limits.

Review focus: hostile renderer input; stale window/account binding; mutation preceding durable intent; unknown outcomes after process restart; agreements changing between read and action; absent IDs; non-Tencent queue accidentally consuming these units; mixed-account batches; cancellation between items; shared album cover changes; duplicate local account remarks.

## Verification commands

`node scripts/test-tme-live.mjs` (new focused tests), `npm run test:tme`, `npm run typecheck`, `npm run desktop:build`; Core regression suite if storage changes affect shared behavior. All test platform effects use fixtures. A single real read-only observation is allowed.
