# Generic Material Import Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the independent Core importer and renderer tasks, with controller integration and final review. User explicitly requested a short plan followed by continued implementation/testing; no additional approval pause.

**Goal:** Safe ordinary-user material import with preview, repair, confirmation and explicit root rebinding.
**Architecture:** Core owns a staged import preview service integrated with existing MaterialWorkbenchService; Main alone chooses roots and serves validated preview covers; renderer has a focused import-preview component. Committed material/audio/publish histories remain in existing records.
**Tech Stack:** Existing TypeScript/Zod/Sharp/React/SQLite/Electron/Playwright, no new dependencies.
**Spec:** docs/superpowers/specs/2026-10-20-generic-material-import-design.md

## Global constraints
- Work only in current isolated branch based on7cbd9c7. No production/Demo/inbox changes or real provider/platform calls.
- Read-only sources. All file roles explicitly resolved within selected root; reject escape, links, ambiguous choices and unreadable inputs.
- Preview cannot mutate committed materials. Confirmation revalidates source revision and bytes. UUID/history retained; duplicate imports require acknowledgment and never silently merge.

## Review focus
- Same title/different directories and copied identical songs must not merge.
- A source mutation between preview and confirm must be rejected.
- Root rebind must preserve existing IDs/history only through explicit preview confirmation.
- Missing, ambiguous, permission denied, maliciousmanifest, junction/symlink must remain actionable failures.
- Old generated work covers/assets must remain frozen after source updates.

### Task1 Core import lifecycle
Files: new src/core/material-import.ts; modify src/core/material-workbench.ts; new shared material-import contract; tests/material-import.test.cjs + runner.
Interfaces: previewScan({sourceId,root?}) -> MaterialImportPreview; updatePreview({previewId,rowId,title,lyricsPath,stylePath,coverPath,existingMaterialId?}) -> preview; confirmImport({previewId,rowIds,confirmTitles:true,acceptDuplicates?:boolean}) -> snapshot; previewCoverPath({previewId,rowId}) -> validated path. Root optional only private Main rebind route. Contract exports actual per-row roles/checks, cover URLs, errors/warnings, relative candidates, duplicate IDs, baseSourceRevision and rebind flag.
- [x] Write RED tests for folder/manifest/legacy preview with zero committed changes; correct/failing path cases and explicit confirmation.
- [x] Implement safe discovery and staged validation; compatible legacy scanner reused only as internal adapter.
- [x] Prove stable UUID/revision/history across rescan/rename/copy/rebind; stale preview/permission/escape/link rejection. GREEN dedicated suite.

### Task2 Renderer import preview
Files: new src/renderer/components/MaterialImportPreview.tsx and style/tests; modify Materials.tsx only to integrate preview actions.
- [x] Tests: scan opens preview before any materials change; title/file role repairs, real thumbnail/details, duplicate acknowledgment, explicit commit/cancel and rebind.
- [x] Use Task1 contract; renderer calls materials.previewScan/updatePreview/confirmImport and chooseRebindDirectory. No raw root supplied by renderer.

### Task3 Controller, template and acceptance
Files: Main material broker/bootstrap; Studio/Core RPC/shared methods/offline allowlist; template/docs/package and isolated Electron test.
- [x] Wire trusted root picker and validated preview-cover protocol, strict schemas and local-only acceptance allowlist.
- [x] Create empty per-song template plus Chinese ordinary/advanced manifest documentation, bundle into candidate.
- [x] Read-only inspect local fee/Fanqie evidence and report exact remaining boundaries; no online account action.
- [x] Run importer/old Core/broker/renderer/full regression/typecheck/build and real Electron temp-root acceptance; independent review.
- [x] Explicit user authorization received after the rejected unexecuted attempt: local isolated-branch commit only, no push/merge/promotion. Package exact commit with source state and fingerprint; final native outcome is recorded per candidate, never inferred from earlier packages.
