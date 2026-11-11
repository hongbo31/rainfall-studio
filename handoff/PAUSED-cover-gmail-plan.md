> PAUSED — archive only; do not execute or resume without new user direction.

# Gmail Cover Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Execute inline in the existing independent repository, as requested.

**Goal:** Two cover actions with durable jobs, honest Gmail readiness and idempotent automatic result import.

**Architecture:** Reuse CoverHandoff immutable requests and image validation. Core owns durable jobs and a scoped local result directory; Main owns the optional Gmail notifier. No Gmail transport or credentials are activated in this release. A future authorized event worker reads the saved local task, never commands or paths from email.

**Tech Stack:** Existing TypeScript, Electron, SQLite settings rows, zod, React, node:https; no added dependencies.

**Spec:** Latest delegated request (2026-10-16 21:32 China time) and `docs/integrations/dot-cover-bridge-readiness-2026-10-16.md`.

## Global Constraints

- Preserve existing song, selected cover, A/B audio, other works and publishing records.
- No music generation, publishing, paid APIs, credential creation, token copying, email test send or Git push.
- Authorized self-mail address is fixed to user@example.invalid Subject is `[Rainfall Cover Request] <task UUID>`; body has only version, task ID and work ID.
- Production notifier is unconfigured. Do not call parent connector tokens from the desktop or pretend an email wake-up already exists.

## Review Focus

- Repeated clicks/restarts must retain one pending task and never resend an uncertain notification.
- Emails cannot supply prompts, filesystem paths or executable instructions.
- Cross-work, stale-context, malformed and replayed result files must not alter the wrong cover.
- User-selected cover changes during generation must be preserved on automatic receipt.
- Unknown Gmail outcomes and absent authorization must not display sent/generating/completed.

## Task 1: Durable queue and local result consumer

Files: create `src/core/cover-jobs.ts`, modify Studio/Core wiring and schemas; test `tests/integration/cover-jobs.test.cjs`.

- [ ] Write failing tests for persistence/deduplication, notification lifecycle, claimed/generating acknowledgements, scoped result acceptance, idempotency, stale context and cover-selection races.
- [ ] Implement settings-backed `CoverJobs.enqueue/list/beginNotification/finishNotification/scanOnce/recover` and fixed per-job local directories. Expose only enqueue/list/retry through trusted Main; worker statuses enter through bounded local files.
- [ ] Run isolated tests and existing cover regressions.

## Task 2: Main notification boundary

Files: create `src/main/cover-notifications.ts`, modify Main/preload/contracts; test adapter and broker in `tests/cover-notifications.test.cjs`.

- [ ] Test exact minimal mail payload, authorized self-recipient, missing OAuth, 401/403 rejection, unknown outcomes and durable no-repeat dispatch.
- [ ] Implement injectable Gmail notifier and Main broker; production uses unconfigured adapter. Store only message IDs and redacted failure codes in Core.
- [ ] Verify no network call for unconfigured production or wrong account and no credentials enter renderer/Core/files.

## Task 3: Two-action UI and delivery

Files: modify `src/renderer/pages/CoverStudio.tsx`, fixtures and UI tests; add release/readiness notes.

- [ ] Test the two actions, no user-facing task/manifest exports, honest unavailable Gmail state and retained image preview/version controls.
- [ ] Replace manual handoff workflow with generation job status and simple local image import; keep layout export in secondary controls.
- [ ] Run focused integration, project tests, typecheck and Desktop build. Package an isolated candidate, use the same original data root, verify cover/A/B retention and inspect desktop screenshots. No generation/send action in the real library.
