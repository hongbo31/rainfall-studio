# Trusted dot sync bridge implementation plan

Approved continuation of `docs/integrations/dot-scheduled-delivery-proposal-20261018.md` and the parent instruction to finish configurable local bridging while Google login is pending. Implement inline in this isolated repository; no extra approval needed for routine implementation.

Goal: user-selected project folder `incoming/<deliveryId>` -> byte-verified private `inbox-v1/deliveries/<deliveryId>` -> existing atomic importer -> database-backed receipt written to project `receipts/<deliveryId>.json`. Actual sync path is unset until human chooses it; local receipt write is not verified cloud arrival.

- [ ] Shared bounded stable file/package snapshot helpers reused by receiver and bridge; preserve v1 and all38 current tests.
- [ ] `dot-delivery-bridge.ts`: validate trusted project root/child directories and private-root separation, no symlinks/hardlinks, complete hashes and image decode before private staging, READY last, atomic directory promotion, immutable conflict protection, durable retry and DB receipt replay, pause during async decode. Test complete, partial marker/image, conflict, link/path abuse, IO recovery, restart/dedup and no music/publication effects.
- [ ] Native Main-only directory chooser handler: empty public request, trusted caller, scope/generation guard, internal Core config only. Public bridge pause/resume with revision checks. Test chooser using mocks only; never open a window during this turn.
- [ ] Existing inbox controller scan/pause integration, persisted bridge status and concise UI configuration/status. No scheduler, HTTP, new credentials, installs or hardcoded Drive path.
- [ ] Independent review and offline receiver/publishing regressions, typecheck/build. Commit. Package using already-installed Electron into fresh `out/` candidate, explicit unlaunched manifest, source hashes and offline package integrity checks. Do not replace formal pointer/shortcut/data and do not launch candidate.

Review focus: source root switching while decode in progress; stale partial READY; complete but changed accepted delivery; receipt conflict/readonly/cloud-offline folder; accidental root overlap or link substitution. Each is covered by bridge/Main tests.
