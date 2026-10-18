# Tencent Cover Scope and Candidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove lyric-driven cover false positives, verify the actual preparation path, and prepare an isolated desktop candidate while the current song agreement is disclosed separately.

**Architecture:** Keep Windows UIA host and Electron broker boundaries. Replace whole-page substring checks with exact visible UI text outside editable content, reuse the same crop evidence across parsing and confirmation, and retain fail-closed ambiguity checks. Native official-site activity remains separate from offline candidate verification.

**Tech Stack:** Existing PowerShell 7 UIA, Node 24 tests, esbuild/Vite/Electron packaging, existing headless Chromium.

**Spec:** Parent follow-up Sentinel_458e354ee1bc81918310db4e00d88b45 and amended scope Sentinel_f9993b4060888191bc978710313f17ed; prior evidence `output/playwright/qq-upload-resume-20261018-0129/FINAL-HANDOFF.json` and current `output/tme-save-followup/current-readonly.json`.

## Global Constraints

- Keep installed 0.8.3-preview.2, shortcut, source pointer and production data unchanged until native acceptance.
- Do not repeat any upload, create credentials, install software, generate paid music or push Git.
- Preview this song's current agreement; do not accept unknown terms or submit before the parent's specific disclosed-terms authorization.
- Keep author credit, rights, full listening and alignment confirmation truthful and separate.
- Candidate user-path checks run headlessly without production writes or third-party requests.
- Preserve the paused Gmail plan and all runtime backups/media.

## Review Focus

- Lyrics/description containing crop/banner phrases must not invent a UI dialog.
- Exact text inside an Edit descendant must remain user content, including multiline child text.
- A real visible crop heading must still block reupload and must retain structural confirmation proof.
- Hidden/decorative headings and independent duplicate crop headings must not authorize confirmation.
- Candidate must contain the exact tested native host and retain the installed pointer/data roots.

### Task 1: Scope cover evidence

**Files:** Modify `src/main/tme/ai-uia-host.ps1`; extend `tests/tme-ai-native-contract.test.mjs`.

**Interfaces:** Add `Get-CoverUiEvidence(nodes)` returning crop-heading nodes and a generator-banner boolean. `Get-ManualCoverState` consumes this evidence. `Crop-Proof` keeps its existing Group/confirm/image/replacement checks and consumes the same heading list. Reuse `Select-OuterControl` for proven nested official Documents; require every discarded candidate to reach the selected outer root and preserve strict bound-document identity.

- [x] Add production-function and entrypoint replays for lyrics/description phrases, exact text under Edit, real crop, hidden heading, duplicate heading and generated banner.
- [x] Run focused RED and confirm false positives occur for the stated reason.
- [x] Implement exact visible text matching with editable-ancestor exclusion; remove whole-page crop/banner checks from cover operations.
- [x] Run GREEN and existing broker/preparation regressions; retain input/output evidence.

### Task 2: Actual path and candidate

**Files:** Add release evidence under `output/tme-cover-scope-candidate`; update `docs/release/tme-native-readback-0.8.3.md`; use existing build/package scripts without installing.

**Interfaces:** Candidate manifest binds sourceCommit, source native-host SHA, packaged native-host SHA, desktop-pointer before/after hashes and existing explicit dataRoot. Renderer path verifies the real work revision and preparation boundaries from a read-only local snapshot.

- [x] Run default/typecheck/integration/native/prepare/submission/UI checks and a meaningful headless actual-work preparation path, retaining screenshots.
- [x] Obtain one final independent code review and fix material findings in one pass.
- [x] Commit intended source/tests/docs; build and package an isolated candidate, verify byte identity and no desktop replacement.
- [x] Report the exact candidate path, user-path outcomes, remaining native acceptance, and current official agreement decision boundary.
