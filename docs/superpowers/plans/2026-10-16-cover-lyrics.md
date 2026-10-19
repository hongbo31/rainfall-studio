# Cover and Lyrics Handoff Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Steps use checkbox tracking.

**Goal:** Receive verified real cover files against a song request and carry preserved lyric versions into publication materials.
**Architecture:** Core owns immutable requests/receipts/lyric versions in namespaced settings; managed assets remain the file authority. Main file dialogs accept local images/manifests/TXT, renderer presents handoff and explicit selection/confirmation. No provider or platform calls.
**Tech Stack:** Existing Electron, React, TypeScript, SQLite, sharp, Node test runner.
**Spec:** `docs/superpowers/specs/2026-10-16-cover-lyrics-design.md`

## Global Constraints

- Reuse independent rainfall-studio-tme-mvp checkout from 9d7fa76. No original repository changes, push, EXE replacement, installation or credentials.
- PowerShell 7 only. Client QA uses isolated data only. Later explicit authorization permits separate Tencent UI observation/upload-to-draft for the single supplied song, without review/contract decisions.
- Cover formats PNG/JPEG/WebP, square512–10000px, ≤50MiB/100MP; target3000px is local preset.
- No fabricated images, generation success or sync timestamps. Client QA makes no provider/platform calls. Separate authorized live UI action must preserve uncertainty; no automatic authorization choice or review submission. Production Tencent contract remains false.

## Review Focus

- Changed song/context while file decoding awaits must reject association (Task1).
- Same image with new request is a distinct receipt but never silently changes selected cover (Task1).
- Source file/managed image disappearing after prior receipt must not return unchecked success (Task1).
- Missing actual lyrics retain submitted lyrics as generation_input, not provider_actual or prompt (Task2).
- Re-selecting audio invalidates lyric alignment even if lyrics text is unchanged (Task2).

### Task 1: Verified cover handoff

**Files:** create `src/shared/cover-handoff.ts`, `src/core/cover-handoff.ts`; update Studio/schemas/internal import/export and tests.
**Interfaces:** `CoverHandoff.request({workId,requestId,brief,prompt?})`, `.list(workId?)`, `.receiveFile(source,workId,requestId,kind)`, `.exportRequest(requestId)`; request/receipt rows under settings. Request context includes work text/config, result imports use existing `Studio.importFile` without automatic selection.
- [x] Write `tests/integration/cover-lyrics.test.cjs`: real sharp fixture image, exact request binding, duplicate/conflicting receipt, dimensions/format/corruption, stale context and persistence.
- [x] Run `node scripts/test-headless.mjs`; expect missing cover RPC failure.
- [x] Implement strict schemas, immutable requests, manifest or bare-image ingress, full decode/hash/size checks and explicit version binding.
- [x] Run task tests; expected pass. Commit locally.

### Task 2: Lyric provenance and unified payload

**Files:** create `src/core/lyrics.ts`, `src/core/publication-payload.ts`; update music/candidate selection, shared cleaner, publication/material/TME and tests.
**Interfaces:** `LyricService.record(work,origin)`, `.preview(workId)`, `.confirm(input)`, `.importText(source,workId)`; `publicationPayload(studio,work)` produces selected asset identities, lyric text/source/confirmation/warnings. Music normalized result may carry `{actualLyrics:{text,version}}`.
- [x] Write failing tests for Chinese/English tag-only cleaning, immutable raw/version history, explicit audio match invalidation, actual-versus-input lyrics, selected cover/material/TME payload and restart.
- [x] Run task tests and verify RED.
- [x] Implement snapshot persistence and safe fallback without guessing YourMusic response fields, TXT import, confirmation hashes, and common payload/material export.
- [x] Run Core/TME/inbox regressions; expected green. Commit locally.

### Task 3: Interactive handoff and isolated acceptance

**Files:** CoverStudio, Track/lyric helper, PublishCenter, Main/preload/contracts/context, scripts/cover-lyrics-desktop-qa.mjs, release docs.
**Interfaces:** `pickImport(role,workId?,requestId?)`, export kind `coverRequest`; UI shows handoff awaiting/received, selected request and source, chosen image version, lyric original/plaintext and explicit match confirmation.
- [x] Add failing SSR/UI checks for unconfigured image provider, no direct-dot claim, awaiting results and missing lyrics/audio warning.
- [x] Implement UI/file dialog wiring and request export; preserve existing manual cover/lyrics editing.
- [x] Build/typecheck and run targeted + Core/inbox/TME regressions. Run one isolated Electron QA with local fixture assets and inspect screenshots; no real third-party communication.
- [x] One fresh whole-change review, fix Important/Critical with RED→GREEN. Record exact evidence, remaining real-file and Tencent limits, commit locally.
