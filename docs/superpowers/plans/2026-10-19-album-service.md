# Album Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Root owns shared seams and commits.

**Goal:** Complete account-scoped album operations and exact availability reporting without external writes.
**Architecture:** Dedicated Core catalog/operation ledger; Main-owned browser contracts; existing publication queue and rights gates; safe renderer actions.
**Tech Stack:** Existing TypeScript, Electron, SQLite, Playwright; no installation.
**Spec:** docs/superpowers/specs/2026-10-19-album-service-design.md

## Global Constraints

Background only; no Main GUI, login, real provider writes, charges or formal pointer update. Preserve works/configuration. Fixture results stay fixture. Never invent platform endpoints, album IDs or DOM calibration.

## Review Focus

- Same TME account across QQ/Kugou with conflicting album intentions must fail before create.
- Account identity changes invalidate catalog, binding and consent.
- Crash after write claim must reconcile the original operation instead of retrying.
- Same title without a remote album ID is not sufficient binding evidence.
- Existing legacy works and their global metadata stay unchanged.

## Task 1 — Core album catalog and operation ledger

Files: shared/plan-albums.ts, core/plan-albums.ts, targeted tests and runner. Scope/entries/catalog/binding/operation schemas are this task's public interfaces. Methods: catalog/status, recordCatalog internal, selectBinding, prepareCreate, authorize/claim/record/reconcile, bindingForTask. Operations carry source and onlineVerified.

- [ ] Add failing tests for exact scope, source/TTL/ID, stable create/unknown/restart, stop, duplicate and TME family conflict.
- [ ] Implement against settings with independent transactions and actual account.remoteSubject validation.
- [ ] Run targeted tests; give root exact exported signatures. Do not commit concurrently.

## Task 2 — Main browser album transport

Files: main/tme/album-browser.ts and main/plan-albums.ts, targeted fixtures/tests. Read existing observed fields; reuse account/official song readers. Provide visible candidate/catalog read and exact selection. Add calibrated-contract create/readback algorithm and original-operation reconciliation. Production contract remains explicitly uncalibrated.

- [ ] Test read-only query with no writes and ID-less candidates, exact choice, actual browser create/readback fixture, ambiguity, unknown and account drift.
- [ ] Implement transport and broker with Core claim-before-write and authoritative Main scope.
- [ ] Preserve original terms/submission route for append, with no duplicate uploader.

## Task 3 — Root plan/publication/UI integration

Files: Core RPC/catalog/publication/scope, bootstrap, PlanCenter and focused components.

- [ ] Connect service and Main transport; expose safe refresh/select/preview/confirm actions.
- [ ] Replace hardcoded album rejection with exact binding/contract checks; pass task-local album metadata and ID.
- [ ] Connect existing/new album controls and operation status; keep missing production contracts precise.
- [ ] Verify complete fixture create→binding→next-run reuse and existing-album→existing TME preparation/submission receipt.

## Task 4 — Protocol, independent review and delivery

- [ ] Save full dot/Drive contract and small design/screens to Library.
- [ ] Review scoped changes independently, fix findings, rerun relevant and combined verification.
- [ ] Commit new candidate and validate portable Core/relative data/dependency closure without Main GUI; provide exact capability gaps.
