# Existing-album integration safe checkpoint

Date: 2026-10-18. Parent requested an immediate safe checkpoint before further integration or packaging.

## Official result and Library evidence

Song: 便利店门口的晴天 / A. Official independent song record: 18281901.
Album: 那场雨 / 6437318. Status observed 2026-10-18T17:16:34.767Z: 审核中.
Only one formal submit click occurred in the completed calibration. No generation, upload, or submission was performed during this integration phase. This is not an approved/published release.

- Screenshot: libfile_d69e966ffc4081918eead650feecfc21 / file_00000000c7a081f49c6d7d1c55c21e29
- Receipt JSON: libfile_79587a4bdf088191b709b7b474cfc93c / file_00000000e704820680149edee29032c6
- Local metadata: output/new-song-convenience-20261018/receipt-library.json

Both uploads succeeded, version 0, and returned Library xattrs were applied to local files. The screenshot contains only the official song row. No cookies, authentication tokens, or temporary signed PDF URLs are included.

## Implemented, not yet packaged

- Core detects an external official receipt by work ID or recording SHA and prevents a fresh submission; current-work UI can show reviewing.
- Existing-album scope requires exact title and inherited/read-only cover proof. It does not claim local artwork was uploaded.
- Preparation snapshots preserve official-list baseline song IDs and agreement document SHA.
- Submission scope binds album title, baseline IDs and PDF SHA; known baseline receipts are rejected.
- Local intent timestamps are labelled dispatch-intent and must match the durable operation timestamp.
- New metadata forms default to existing album, preserve saved legacy behavior, and accurately describe author-list checkboxes.
- Read-only official browser helpers use separate temporary pages, preserve the draft, reverify artist/account, and cross-check observed official-list responses against visible rows.

## Executed verification

- Unified publication: 14/14 passed.
- Existing-album Core: 10/10 passed.
- Official read-only browser helpers: 14/14 offline tests passed.
- Legacy preparation: 30/30 passed.
- Legacy submission: 16/17 passed. Remaining failure: Main test RPC fixture does not implement the new broker action; x.service[action] is not a function at tests/tme-ai-submission.test.mjs:122.
- Full TypeScript check passed after the agents' changes.
- Earlier session-specific generation, native WAV and intake-field groups passed 5/5, 1/1 and 5/5 respectively; no new live operation was used to rerun them.

## Remaining work / limitations

1. Finish the bounded Main existing-album preparation/submission browser port and wire it into normal executor transport.
2. Adapt Main preparation broker to propagate inherited-cover/baseline/document proofs.
3. Finish read-only external receipt recovery with a verified account subject hash; the existing one-time receipt currently has no subjectHash.
4. Update the legacy Main RPC fixture and metadata UI expectations, then rerun the affected groups.
5. Complete simple-entry integration, candidate build, read-only candidate GUI acceptance, and fresh review.
6. Commit the completed changes locally after checks. No new build/package or source commit is claimed at this checkpoint.

All changes remain in this independent candidate repository. The installed launcher and original business repository/data remain unchanged. Browser session remains open. Never resubmit song 18281901 or B merely to test this integration.
