# Provider Wiring Implementation Plan

> **For agentic workers:** Use executing-plans inline, with independent agents assigned non-overlapping music, publication and dot adapters. User explicitly requested design first followed by implementation without another ordinary approval round.

**Goal:** Connect PlanCenter to existing real provider/services and dot delivery protocol, keeping every current external write offline during development.

**Architecture:** Stable managed music children reuse ProductionFlowService/Main broker; local item-work-material mappings reuse UnifiedPublicationService. A persistent dot request manifest bridges incoming/receipts without inventing a dot API.

**Tech Stack:** Existing Electron44, Node24, TypeScript, React, Zod, SQLite. No dependency installation.

**Spec:** `docs/superpowers/specs/2026-10-19-provider-wiring-design.md`

## Global Constraints

- Background only; no visible client/browser, real payment/upload/publication/terms, original database/credentials, formal entry update, remote push or parent dot schedule changes.
- Model contract support and account verification remain distinct; absent endpoints cannot be invented.
- Preserve operation/receipt evidence and immutable snapshots; unknown never means safe to resubmit.

## Review Focus

- Shared music daily budget across independent items and recovery of unknown reservations.
- Stop while accepted music is polling; collect original outputs without new writes.
- Cross-account publication scope and global config/identity drift.
- Reused externalItemId, conflicting request echoes and late/stopped dot deliveries.
- Existing work/asset changes after binding and A/B selection before publication.

### Task 1: Music provider wiring

**Files:** production-flow.ts, shared/production-flow.ts, production-integration.ts, workflow/yourmusic.ts, new plan-center-music.ts, targeted tests and runner.

**Interfaces:** `ProductionFlowService.startManagedMusic(input)` returns stable text-free child; `stopManagedMusic(ownerKey)` preserves existing receipts. `startPlanMusic(s,run,item,attempt)` and `syncPlanMusic(s,run,item)` connect child outputs. Exact returned mapping includes childRunId/workId/operationId and original asset versions.

- [ ] Add failing tests for accepted/query/download, shared budget, strict final draft, duplicate owner, unknown/restart/stop and model-specific history recovery.
- [ ] Implement managed child and explicit credit-policy grant; reuse original Main broker, downloader and work materializer.
- [ ] Run new suite and existing ProductionFlow/music/broker regressions with fixture transport only.

### Task 2: Dot request and delivery protocol

**Files:** new shared/plan-dot.ts, core/plan-center-dot.ts; inbox schemas/service and bridge producer as required, dedicated tests.

**Interfaces:** `syncPlanDot(s)` creates/persists requests and exact delivery associations; `planDotStatus(s)` exposes safe manifest/associations; `exportPlanDotRequests(s)` creates local JSON file for file bridge. `requestId/requestHash/planId/runId/itemId/externalItemId` remain immutable.

- [ ] Add failing tests for emitted manifest, v2 strict echo, legacy unique-ID compatibility, duplicate consumption, wrong channel, reuse, stop/expiry/restart.
- [ ] Implement strict schema and transactional consumer; preserve Inbox v1 behavior and receipts, persist artistRef.
- [ ] Verify late outputs remain stored/associated while no new business operation runs.

### Task 3: Publication and album capability wiring

**Files:** new core/plan-center-publication.ts, shared/plan-publication.ts, Main capability seam; tme-ai-scope.ts, tme-ai-prepare-integration.ts and unified-publication-integration.ts for exact task/account scope; targeted tests.

**Interfaces:** `syncPlanPublications(s)` maps bound item materials to stable existing unified tasks and reads their verified states; `planPublicationCapabilities(s)` reports actual installed capability reasons. Local request state and verified online receipt state are distinct.

- [ ] Add failing tests for same item/account idempotency, two accounts, stale materials, unknown, verified receipt mapping and unsupported album operations.
- [ ] Reuse existing queue/preparation/submission; add exact publicationTaskId/account scope without removing nonce/terms/identity/production gates.
- [ ] Run unified/TME scope regressions with no native actions and expose missing real catalog/create/append evidence.

### Task 4: Core/UI integration and asset binding

**Files:** shared/plan-center.ts, core/plan-center/index.ts, plan-center-integration.ts, plan-center-catalog.ts, PlanCenter.tsx, Main/bootstrap and RPC whitelist as needed.

**Interfaces:** public safe actions include catalog/status/request export, existing-work/audio binding and A/B choice; arbitrary stage records/receipts stay internal.

- [ ] Add failing integration tests for item→existing work, source/hash/artist validation, final scored lyrics, manual selection and stop receipts.
- [ ] Connect music/dot/publication adapters into the same loop; replace unconditional music/queue blockers with exact dynamic capability evidence.
- [ ] Add model source/expiry and music budget/credit-policy controls; existing work selector, A/B selection and publication/late delivery status.
- [ ] Verify complete headless UI path against real isolated Core, then review screenshots.

### Task 5: Review and delivery

- [ ] Run npm test, typecheck, relevant regressions, desktop build and independent whole-change review.
- [ ] Fix findings and verify final portable Core/dependencies/data path without Main GUI.
- [ ] Commit new version; package with fresh preview root; provide source/artifacts/screens/logs and evidence-backed remaining limits. Do not promote formal install.
