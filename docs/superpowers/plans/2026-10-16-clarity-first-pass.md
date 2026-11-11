# Clarity First Pass Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Steps use checkbox tracking.

**Goal:** Make existing local workflows and their next actions clear without enabling new services or restructuring the whole app.
**Architecture:** Renderer-only presentation helpers consume current metrics and publication payloads; existing Core/IPC/schema remain unchanged. Keep the current navigation structure while correcting entry routing and labels. Tencent external UI diagnosis remains separate from product acceptance.
**Tech Stack:** Existing React/TypeScript, Electron, Node tests, esbuild, Playwright isolated QA. No installations.
**Spec:** Astra's complete `C:/Users/CLOUD_USER/Documents/Codex/2026-10-16/task/rainfall-ux-review/rainfall-product-ux-design.md`, its brief/evidence, and parent instruction adding a small work next-step summary and explicit client connection state to this pass.

## Global Constraints

- Reuse the independent checkout; baseline3fbcb08 includes all cover/lyrics fixes. Branch feature/clarity-first-pass, local commits only; no EXE/daily data replacement.
- PowerShell7 only. Keep Core, schema, browser adapter and real-execution switches unchanged.
- No fake AI reply, upload, publication, metrics, synchronization or audio match. No third-party calls during client QA.
- Five-item navigation, one-shot existing-song importer, cover regrouping and persistent-error overhaul remain later phases.
- Statistics aggregate only a selected date/platform with explicitly confirmed same basis; no metric metadata exists to infer basis automatically. Known0 remains0; unknown remainsnull/—.

## Review Focus

- Empty/all-null/partial metrics must stay distinguishable from measured zero; Task1 tests.
- Changing a date/platform or replacing source rows must invalidate the user's basis confirmation; Task1 UI QA.
- Different dates/platforms cannot be silently combined; Task1 tests and UI QA.
- Missing/stale publication preview or unsaved text cannot advertise ready materials; Task2 tests/QA.
- Listening to B must not change publication audio A or falsely confirm lyric match; Task2 QA.

### Task1: Trustworthy report summaries

**Files:** create `src/renderer/insights-summary.ts`, tests/fixtures/clarity-ui.tsx, tests/clarity.test.mjs, scripts/test-clarity.mjs; modify Insights.tsx.
**Interfaces:** `summarizeReports(rows, {platform,date,basisConfirmed})` returns filtered rows, status, per-metric value/known/total/overflow. SSR fixture exports the helper and page render for tests.
- [x] Write tests for missing/all-null/zero/partial metrics, date/platform isolation, basis gate and integer overflow; run `node scripts/test-clarity.mjs`, expect missing module/helper RED.
- [x] Implement summary helper, null/coverage UI, required date/platform selection and basis confirmation invalidated by scoped source signature.
- [x] Run targeted tests/typecheck, expect all pass; commit locally.

### Task2: Clear entry points, material next steps and connection boundaries

**Files:** Overview.tsx, Create.tsx, Library.tsx, ChatCreation.tsx, main.tsx, TmeDraftStudio.tsx, Track.tsx, LyricsPublicationPanel.tsx; create components/WorkNextStep.tsx and work-readiness.ts; extend targeted tests and add scripts/clarity-desktop-qa.mjs; release docs/README.
**Interfaces:** `describeWorkReadiness(work,payload,saveState)` returns current local missing items and next section/action. WorkNextStep reads existing publication.payload, never writes confirmations. Track prepares exactly its work via setSelected([id]) then existing publish route after successful save.
- [x] Write RED semantic tests for missing/complete/unsaved material state and original-vs-publish audio. Add isolated QA for home→chat save without Key, template labels, report gates/coverage, idle/player state, work anchors and Tencent unconnected blocks.
- [x] Correct labels and add small work summary/anchors. Preserve existing media/confirmation behavior and production gates. No importer or navigation rewrite.
- [x] Build/typecheck; targeted/Core/inbox/TME/base regressions and one isolated Electron visual QA; inspect screenshots. Expect no renderer errors or observed client HTTP/HTTPS requests.
- [x] One fresh whole-branch review; Important/Critical get one RED→GREEN fix pass. Record tests, exact deliverables, current live-upload and album-transfer limits; local commits, no push or release replacement.
