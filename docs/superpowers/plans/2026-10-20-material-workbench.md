# Material Workbench Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for bounded task ownership with tests and final independent review.

**Goal:** Add a read-only material list and full-lifecycle generation queue linked to the existing publication center.
**Architecture:** Shared typed contract; Core repository stores collections/materials/jobs; Main owns directory selection and credential-bound provider operations; React materials page and existing PublishCenter consume the same stable IDs/work audio. Production fee safety remains blocked without evidence.
**Tech Stack:** Existing TypeScript, React, Zod, SQLite repository, YourMusicAdapter, Sharp/FFprobe, esbuild/Vite and node tests. No new dependencies.
**Spec:** docs/superpowers/specs/2026-10-20-material-workbench-design.md

## Global constraints
- No production data/credential access in tests; no real API or publishing; no desktop switch; no user browser operations.
- Earlier Fanqie/credential patch is an explicit dependency, not edits to its original candidate.
- Original files and all audio generations are retained. Stable IDs and revisions guard every operation.

## Review focus
- Same numbered files in different collections must not merge.
- Rename preserves stable identity; ambiguity/missing/changed bytes cannot trigger dispatch.
- Interrupted paid submit becomes unknown and blocks successor; queries/downloads reuse provider task IDs.
- Budget reserve cannot be released on unknown results or be presented as supplier enforcement.
- Generated state requires verified audio; per-platform reviewing/published/unknown must prevent resubmission.

## Tasks
1. Core material service and shared contract: implement scanner+repository/queue with failing tests for100 mapping, revisions/rename/ambiguity and serial/recovery/budget/version invariants. Own new shared/core files and dedicated tests/scripts.
2. Materials React page: implement pending/default/generated filters, selection by stableID, details/source checks, directory/configuration/queue controls. Own new page/style and fixture tests; root routes integrated by controller.
3. Existing publication center: enhance existing page only, real audio/version filtering/platform status and disabled capability/cover preflight; reuse existing records and TME paths. Own PublishCenter and publication helper tests.
4. Controller integration: Main directory/broker, Core RPC/schema/Studio snapshot, routes, fixture transport and orchestration; ensure strict production write gates and no real calls.
5. Run targeted suites then existing regression/typecheck/build; source-only100 verification, headless UI actions, independent review and candidate package with explicit limits, no promotion.

Each task: write/run red tests, implement, run green scoped tests, report changed files and remaining issues. Review integration and final diff before completion.
