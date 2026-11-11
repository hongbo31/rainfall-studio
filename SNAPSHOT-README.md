# Current source integration — 2026-11-11

The local main branch now integrates development commit 0355281 and the prior material-workbench history. The application source matches that development commit. The provenance JSON files and original snapshot description below describe the historical v0.12.0-preview.4 export, not the current tree or a newly accepted desktop release.

Current changes include the material workbench, unified platform publishing, saved Fanqie configuration, guarded Fanqie upload automation and simplified cover layout. Type checking, desktop build, 81 Fanqie offline checks and the two offline layout checks passed. Live Fanqie upload acceptance remains pending; official desktop installation and user data have not been replaced. See docs/architecture/fanqie-first-step.md for the current acceptance boundary.

No user library, credentials, browser profile, song media or built installer is added by this integration. Uncommitted changes in other worktrees are excluded.

---
# Rainfall Studio 0.12.0-preview.4 source snapshot

Runtime source: cbcb396feb151a84bc45e24c091328f60c0f6e3b. Export tree: 731ec7615896095d9b96e9af09357b317e5cb236. All 239 runtime source files are byte-identical to the frozen source. No original Git history, user media/database/artwork, credentials, browser state, dependencies or built output is included. Historical local instructions and acceptance evidence are excluded.

The associated Setup is unsigned and its install/uninstall/native acceptance is separate from static package verification.

- Contains the frozen official-session read-only identity reader, Main/Core identity broker, explicit account connection UI, safe IPC error response, scheduler/UI regressions and long-path backup repair.
- Image source cards explicitly state local or external import needs no API key and image API is not connected; no image generation API was added.
- The exact portable candidate passed two real native processes and nine screenshots; this does not establish Setup installation/uninstallation acceptance.
- No new real binding, paid model call, credential, platform upload or publication was performed for this release task.
- Production stable identity binding, external-browser restart persistence, real provider billing and real publication still need separate acceptance.
- Formal launcher/data are unchanged; Setup is unsigned and needs separate isolated install acceptance.
