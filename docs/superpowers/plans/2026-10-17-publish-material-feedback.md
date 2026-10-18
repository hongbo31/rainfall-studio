# Publish material feedback repair

> **For agentic workers:** Use superpowers:executing-plans inline. The delegated bug report authorizes implementation without another plan approval.

**Goal:** A publish click collects current materials and shows the matching per-song/per-platform task and blockers beside the button.
**Architecture:** Keep `publish.simple` local and idempotent. Freeze existing assets, clean lyrics, saved metadata and AI provenance in Core; refresh reused status without creating a submission. Render the returned tasks directly and focus them, independently of history order.
**Tech stack:** Existing TypeScript, React, SQLite, Node tests and installed Chrome headless. No new dependencies.
**Spec:** Parent delegation of 2026-10-17: publish button appears inert; prepare materials automatically, expose blockers, prevent duplicate clicks, no false legal/listening confirmation, no foreground or real publication.

## Constraints and rulings
- Existing isolated branch `feature/tme-uia-batch`, base `36ab2df`; preserve installed 0.8.2, desktop shortcut, live DB and paused Gmail work.
- No visible app/browser, restart, generation, paid export, native upload, terms acceptance or remote Git.
- Ruling: Saved local facts/defaults win; never infer an author from account nickname, prose or the old song. Actual local author defaults are blank and artist name is 我的艺人; disclose missing fields rather than hardcode 云端测试艺人 into product logic.
- Ruling: Prefer only a verified WAV belonging to the bound A recording; never replace it with B or an unrelated WAV. Keep exact input and selected asset identity, invalidating listening confirmation if the chosen bytes differ.
- Ruling: Keep prior immutable material snapshots for audit. Reused identical material may refresh current checks/timestamps; returned task IDs must be displayed even when another historical task is newer.

## Review focus
Account identity/status changes with unchanged material; asset corruption without revision increments; stale async results after selection/mode changes; returning to an older content fingerprint; unproven WAV relationship.

### Task 1: Core material and recheck contract
Files: `src/core/simple-publication.ts`, `src/shared/platform-config.ts`, new regression tests.
- [x] Add failing tests for saved artist/default/provenance collection, clean lyrics, bound WAV identity, missing material, stale reused status and changed assets/defaults.
- [x] Implement minimal typed snapshot additions and current-check refresh; preserve idempotent IDs, no native side effects or new legal consent.
- [x] Run targeted Core tests and existing simple publication regressions.

### Task 2: Visible interaction result
Files: `src/renderer/pages/PublishCenter.tsx`, focused result component and CSS, headless interaction fixture/tests.
- [x] Add failing click regressions: result appears beside action, unconnected QQ message, missing lyrics/cover actions, reuse of older ID, immediate busy lock and async errors.
- [x] Show returned per-song/per-platform task, current blockers/actions and folded material preview; focus/scroll result, disable concurrent selection and calls.
- [x] Run headless interactions and existing UI suite.

### Task 3: Actual material fixture and deliverable
- [x] Read actual new song/materials with read-only DB and in-memory writes; verify hashes, WAV/lyrics/AI without altering production.
- [x] Run typecheck, default/Core/UI regressions and desktop build; fresh independent whole-change review, fix important findings with RED/GREEN.
- [ ] Create an offline portable candidate, screenshot headless UI, document source/installed difference and pending native acceptance. Do not update desktop entry.

## Progress
2026-10-17: Core 27/27, headless interaction 10/10, full Core 201/201, existing UI 42/42, safe submission 16/16, default 3/3, typecheck/build passed. Independent review found three P2 issues; all reproduced RED and fixed GREEN: official subject identity hashing, inline stale-result reconciliation, and per-listing check/asset verification sharing (fresh across listings). Read-only actual-work acceptance passed; production writes/native actions/external requests all zero. Candidate packaging follows the source commit; its final path/hash/acceptance status are recorded in `output/publish-material-feedback/candidate-delivery.json`. Native acceptance and desktop promotion remain pending and are not claimed.
Investigation: UI only sets “已显示已有检查”; Core returns stored request unchanged on fingerprint hit; current page renders history far below and has no task focus/material viewer. Actual new work already has bound official WAV A/B and cover, AI generated, author defaults blank. No production mutation.
