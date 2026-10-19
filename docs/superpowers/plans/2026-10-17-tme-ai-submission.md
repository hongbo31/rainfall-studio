# Tencent AI submission guard and preflight implementation plan

> **For agentic workers:** Execute inline using superpowers:executing-plans. Preserve the existing checkout, live data and desktop pointer. No paid request, agreement acceptance, official upload or submission in this task.

**Goal:** Add a separately scoped, durable submission coordinator and an honest client preflight; keep real native writes disabled until the current official authorization and receipt controls have been validated.

**Architecture:** A Core journal binds one prepared recording, official identity, current terms hash and explicit consent. Main owns native observations and any future verified executor; the renderer receives sanitized readiness and cannot supply receipts, native controls or an executor. Existing preparation and older grants remain unchanged.

**Tech Stack:** Existing TypeScript, Zod, SQLite, Electron IPC, React and Node test tooling. No dependencies or installation.

**Spec:** Parent delegation of 2026-10-17: finish independent work while paid generation is forbidden; implement/verify the submission gap offline and perform safe preflight without submitting or accepting unconfirmed terms.

## Global constraints

- Existing draft `00000000-0000-4000-8000-000000000001` and old song must survive unchanged.
- Local approval never proves remote submission; official receipt must identify the exact recording's submission and status.
- Unknown native outcome must never enable a resend, including after process restart.
- Current v6 price remains unknown; no provider mutation or key extraction.
- Do not replace the installed 0.8.2 client or restart it. Background build and headless validation only.

## Review focus

- Stale or changed terms/account/assets must prevent native actions.
- A crash after dispatch must remain unknown; a valid receipt can reconcile without resubmission.
- A prepared-only old grant must not authorize formal submission.
- A local counter or success banner must not become an official receipt.
- Missing new-song materials must return actionable preflight blockers without opening the browser.

### Task 1: Durable recording-specific submission coordinator

Files: create `src/shared/tme-ai-submission.ts`, `src/core/tme-ai-submission.ts`, `src/main/tme/ai-submission.ts`; create `tests/tme-ai-submission.test.mjs`, `scripts/test-tme-ai-submission.mjs`.

- [x] Write failing behavioral tests for approval/terms/account binding, exactly one dispatch, restart-to-unknown, no receipt/no success, receipt-only reconciliation and workspace changes.
- [x] Run the offline suite and observe expected missing functionality failures.
- [x] Implement strict schemas, the persistent journal, and Main orchestration with a trusted optional executor. Default production executor remains unavailable; no renderer input enables it.
- [x] Run focused tests and existing preparation/broker tests.

### Task 2: Core/IPC/preflight panel integration

Files: modify `src/core/index.ts`, `src/main/bootstrap.ts`, `src/preload/index.ts`, `src/renderer/pages/PublishCenter.tsx`; create `src/core/tme-ai-submission-integration.ts`, `src/renderer/components/TmeAiSubmissionWorkspace.tsx` and offline render fixture/tests.

- [x] Add failing tests proving missing audio/cover cannot invoke native, and renderer cannot create receipts or approvals through ordinary Core RPC.
- [x] Implement `tmeAiSubmission(action,input)` for preflight/status and guarded submission; display actual capability rather than static success or static historical license duration.
- [x] Validate full build/typecheck and offline suites; inspect headless panel screenshot.
- [x] Record actual current preflight using the existing new draft, with no browser/network writes, and document native-contract and second-step dependencies.

### Task 3: Current pricing research and handoff

- [x] Inspect only public official documentation and the existing visible dashboard's budget controls. Never guess private endpoints or change any key quota.
- [x] Record whether v6 upper cost or a provider-enforced request cap exists; absence remains unknown.
- [x] Report deliverables, fresh verification evidence, exact installed-vs-source capability and remaining authorization/native-contract blockers.
