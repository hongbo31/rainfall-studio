# Tencent Native Readback Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Correct native preparation failures observed during the authorized A-WAV and cover upload without adding publication or agreement capabilities.

**Architecture:** Keep Windows UIA and the existing preparation broker boundaries. Add bounded read-only waits after one mutation, distinguish a partial uploaded intake from expanded metadata, and normalize only proven nested controls. Continue failing closed for independent ambiguous controls, changed documents, wrong picker owners, and uncertain write outcomes.

**Tech Stack:** PowerShell 7 UIA host; TypeScript Electron main; Node test runner with PS AST extraction and offline broker tests.

**Spec:** `output/playwright/qq-upload-resume-20261018-0129/FINAL-HANDOFF.json`; actual scope: background repairs only, installed 0.8.3-preview.2 unchanged, no new upload, no new agreement acceptance, no review submission.

## Global Constraints

- No live browser calls during automated regression.
- Do not install software, add credentials, touch the paused Gmail plan, or alter the installed desktop pointer/data.
- A wait may re-read state, never repeat a click, file invocation, field write, or legal action.
- Do not interpret artist credits or self-author shortcuts as verified commercial rights.
- Keep `save_album` as the existing local snapshot; live Save semantics are unverified.

## Review Focus

- Two independent same-name radios must remain ambiguous; only ancestor/descendant mirrors may collapse.
- An owned picker appearing late may be awaited; a wrong owner, selected file, or nonempty filename must abort.
- Partial song cards must preserve existing-audio detection, never cause another upload.
- The observed manual-cover button requires a closed crop dialog and no generated-cover banner; unobserved aliases are rejected.
- Readback timeout remains an uncertain result; no automatic write retry or permission broadening.

### Task 1: Bounded readback and control normalization

**Files:** Modify `src/main/tme/ai-uia-host.ps1`; create `tests/tme-ai-native-contract.test.mjs`.

**Interfaces:** Internal `Wait-NativeReadback(Read, Ready, TimeoutMs, FailureCode, TransientErrors)` returns the ready value; `Select-OuterControl(candidates, Parent)` returns one proven root or throws `CONTROL_NOT_UNIQUE`.

- [x] Write offline failing tests for delayed state, timeout, immediate safety errors, nested radios and independent ambiguity.
- [x] Run `node --test tests/tme-ai-native-contract.test.mjs` and retain expected failures.
- [x] Implement the two helpers, use waits after one field/toggle write and picker open/directory navigation, and collapse only nested radio/toggle mirrors.
- [x] Re-run the focused tests; verify no browser entrypoint runs.

### Task 2: Partial form and manual-cover contracts

**Files:** Modify `src/main/tme/ai-uia-host.ps1`; extend `tests/tme-ai-native-contract.test.mjs` and existing upload-control regression as needed.

**Interfaces:** `Form` keeps mode `editor` with `metadataExpanded=false` and nullable unavailable metadata for a partial uploaded card. Full metadata exposes `metadataExpanded=true`. `Get-ManualCoverState(nodes,text)` recognizes the exact observed Button label `更换图片`, with the crop closed and generator banner absent. Base-client source already had this label; the mismatched `修改图片` expectation belonged to an auxiliary verifier.

- [x] Add failing replay tests for uploaded partial cards, full nested-radio metadata, cover labels, crop-open state, and generated banner.
- [x] Implement minimal parsing and explicit incomplete-metadata guards, preserving identity/file provenance checks.
- [x] Verify the new contracts and existing preparation broker tests.

### Task 3: Regression and handoff

- [x] Run `npm test`, `npm run typecheck`, `npm run test:qq-preparation`, `npm run test:integration`, and the appropriate UI/core regression runner; record every failure.
- [x] Request one independent code review and address material findings, without live uploads or desktop reinstallation.
- [x] Document what is fixed, tested, and still requires native validation; retain screenshot Library IDs and the unclicked Save decision.
- [x] Commit only intended source/tests/docs if checks pass; leave installed 0.8.3-preview.2 and its data untouched.
