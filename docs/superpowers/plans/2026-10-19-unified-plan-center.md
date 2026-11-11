# Unified Plan Center Implementation Plan

> **For agentic workers:** Use executing-plans for inline implementation, with independent agents only for non-overlapping engine/scoring/UI review tasks. User has explicitly authorized implementation after this written plan; no further ordinary approval gate.

**Goal:** One persistent plan center with honest external capability states, safe migration, bounded scoring, stop/reconcile and independent publishing attempts.

**Architecture:** Shared schemas and a namespace-backed SQLite engine own Plan/Run/Item/StageAttempt/PublishAttempt. Native adapters remain separate; missing ports return blocked/waiting. Studio/RPC and React PlanCenter integrate this engine, replacing scattered schedule UI.

**Tech Stack:** Existing Node24/Electron44/React/TypeScript/Zod/Luxon/better-sqlite3/Playwright. No new dependency installation.

**Spec:** `docs/superpowers/specs/2026-10-19-unified-plan-center.md`

## Global Constraints

- Background only; no visible client/browser, focus changes, formal install promotion, paid music generation, publication or terms acceptance.
- Preserve prior scoring edits, original data and credentials; use isolated test roots only.
- Do not change parent-managed dot schedules or replace dot with Work.
- Explicit adapter capabilities; no fake albums, models, scores, receipts or audio aesthetic evaluation.

## Review Focus

- SQLite cross-connection claims and duplicate manual/scheduled triggers.
- Stop during dispatch and unknown reconciliation after restart.
- Album identity reuse across runs and uncertain creation.
- Legacy enabled state/history with ownership and CAS rollback.
- Model score versus rules, original/revised identity and cover refresh.

### Task 1: Preserve checkpoint, audit, contracts and design

- [x] Save existing diff/new helper under output checkpoint without touching formal data.
- [x] Audit actual menus/three legacy scheduler namespaces and external capability source.
- [x] Write spec, risk and acceptance matrix, announce implementation boundaries.
- [x] Define `shared/plan-center.ts` schema/actions/capability result shapes with strict inputs.

### Task 2: Persistent unified engine and migration

Files: `core/plan-center/*`, `shared/plan-center.ts`, `tests/plan-center*.test.mjs`, test runner script.

- [x] Write and run failing tests for schedule/manual isolation, locks, item counts, attempts, stops, restart, migration and albums.
- [x] Implement namespace storage, configuration snapshots, deterministic occurrence/claim keys, bounded catch-up and per-stage transitions.
- [x] Implement legacy migration/ownership and row-scoped CAS rollback; leave history intact.
- [x] Implement per-account album bindings and independent publish outcomes with material gates.
- [x] Run offline suite; no live adapters or real roots.

### Task 3: Scoring checkpoint and dot quality integration

Files: prior 5 scoring files, inbox status, TextCandidates renderer and scoring tests.

- [x] Finish/check prior bounded inbox scoring integration against existing DeepSeek cost/response contracts.
- [x] Confirm low quality→at most2 rewrites→bounded rescoring; unknown outcomes freeze; originals remain.
- [x] Add truthful configuration/error/status display; consume incoming candidates by exact expected identity.
- [x] Verify no music/work/publication side effect.

### Task 4: Plan center UI/RPC and menu migration

Files: `renderer/pages/PlanCenter.tsx`, style, main navigation, Create/ChatCreation/ConfigurationCenter, Studio/RPC schemas.

- [x] Implement blue-white forms and list; daily/weekly/once, independent count, output selection, routes/models, per-account album forms.
- [x] Require in-app run confirmation with hashed summary; block duplicate ▶ and expose stop-current-run.
- [x] Remove only audited schedule/config embeddings from manual creation; retain standalone manual flows and manual publishing.
- [x] Add trusted capability/catalog endpoints with unavailable reasons for unimplemented real providers.
- [x] Headless UI flow and screenshot check using local fixture RPC; no visible browser.

### Task 5: Verify, review and package

- [x] Run typecheck, targeted prior/new regressions and desktop build; fix failures based on evidence.
- [x] Independent whole-change review, resolve material findings.
- [x] Commit isolated source and create new Windows portable candidate with fresh empty preview data root.
- [x] Deliver commit, actual test logs, screenshots, artifact paths and explicit missing real integrations. Do not promote formal shortcut/install.

## Verification record

Implementation and offline acceptance completed on 2026-10-19. See `docs/release/unified-plan-center-0.9.0.md` for exact scope, test evidence, the failed-review fixes and intentionally unavailable real integrations. Native GUI, formal entry promotion and live provider actions are excluded from this release.
