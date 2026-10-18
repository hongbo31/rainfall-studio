# Existing-album integration checkpoint, phase 2

2026-10-18. Parent requested terminal checkpoint; no tests or builds were cancelled. This supersedes phase 1 for current status.

## New official fact (read-only verification)

At 2026-10-18T17:59:27.310Z the fresh official account fingerprint matched the independently saved earlier fingerprint. Independent song record 18281901 (便利店门口的晴天) remains in existing album 6437318 (那场雨).

The record has left the pending list. The page-triggered official getAlbumSongList response states status=1 / 审核通过, qqmusicstatus=1, kugoustatus=1 and platformPublishStatusStr=QQ音乐、酷狗音乐已上架; 酷我音乐上架中. UI separately verifies released-album membership and the exact song title. The real published-song table does not show a per-song audit label, so this is not presented as one.

No generation, upload, agreement acceptance, or submission was performed this round. Existing submission materials and formal installed data remain unchanged. Only isolated candidate receipt data was updated.

Evidence (ignored private output):
- output/new-song-convenience-20261018/official-readonly-recovery.json
- output/new-song-convenience-20261018/readonly-record-import.json
- output/new-song-convenience-20261018/candidate-data/production/tme-external-receipts/5de029aae17a886ecb1d87da58d84a2fe5fac038f2959dbc4a0d5863dc5f7c6f.json
- Same directory has a stop-only .stop.json marker.
Original local submission timestamp is labelled local-observation, not a platform timestamp.

## Integration now landed in source

- Bounded existing-album browser preparation/submission adapter is wired through normal Main transport.
- Actual runtime writer stays unavailable: EXISTING_ALBUM_WRITE_INTEGRATION_UNVERIFIED. Only the isolated Main constructor fixture seam enables positive writer tests; renderer cannot supply it.
- Former one-time fillIntakeFields runtime entry is unconditionally locked.
- Main broker propagates inherited/read-only cover proofs, official baseline IDs and authorization PDF SHA. It never claims the new local cover was uploaded to an old album.
- Core checks external receipts by work ID and source recording SHA at registration/start/every preparation claim, including restored old grants.
- Main checks current resolved audio before direct preparation, supports legacy manifest checks, and persists stop-only files from existing receipt records before preparing. These files survive older SQLite restoration.
- External official recovery requires the already-bound full account hash, exact independent song ID, title, artist and album. It checks full identity before/after and preserves the main browser page.
- Pending reader waits through default unbound profile scaffolds, supports observed page-triggered GET/POST list reads, and uses temporary tabs.
- Released-record fallback uses the observed official menu, exact released album and song membership, rejects contradictory UI state, and requires explicit official QQ/Kugou release response.
- Simplified publication UI displays the existing receipt before generic not-submitted text and exposes read-only recovery separately from writer availability.
- Normal coordinator can reconcile external records without preparation/submission dispatch.

## Verification completed

All counts below are targeted groups, not a new full suite:
- Main submission/RPC: 17/17.
- Legacy Main preparation broker: 22/22.
- Main existing-album preparation: latest 8/8.
- Existing-album Core: latest 11/11.
- Cloud session: latest 10/10.
- Metadata form: 8/8.
- Bounded browser adapter: 15/15, all HTTP intercepted.
- Official browser helpers + external reader + durable barrier: latest combined 28/28.
- Unified Main coordinator/transport: 17/17 before final async barrier hook adjustment; rerun this small group next.
- Unified Core publication: previous 14/14; no new terminal-state fabrication permitted.
- Final current-tree TypeScript: exit 0.
- Final current-tree desktop build: exit 0. Only Vite chunk-size advisory (>500kB).
- Fresh independent review: no remaining critical/high issue; git diff --check passed.

Positive integrated uploads, accepting terms and submissions are fixture-only. This song was not used for live writer testing. Runtime writer remains locked pending a separately authorized independent acceptance on a different appropriate work; no consent expansion is implied.

## Remaining delivery work (not yet claimed)

1. Run the small Unified Main group after the async barrier callback change, plus final metadata/UI assertions if new concerns arise.
2. Finish the local source commit after confirming final checks. HEAD still ace6137fd220399bc7b103a9273f9a44a757fc17; current changes remain uncommitted.
3. Package a new portable candidate using existing Electron runtime: node scripts/package-tme-candidate.mjs --simple-publishing after source commit. The newest existing old package still references 13a26ba and must not be described as this code.
4. Execute NEW scripts/native-existing-receipt-acceptance.mjs <candidate-manifest.json>. This script is written but NOT YET EXECUTED: it copies only isolated DB/media/barrier data, blocks renderer HTTP/native effects, clicks the protected existing song, uses only official read-only recovery, checks repeat-publish protection and screenshots.
5. Inspect native screenshots; finish candidate validation and source/patch/evidence archive. Do not include browser profiles, credentials, signed URLs, raw provider responses or authentication data.
6. Provide candidate path, source commit and evidence. Formal desktop installation upgrade remains pending and unchanged.

Existing browser remains open. Do not rerun scripts/run-authorized-music.mjs submit or any original one-time submit script. No new software, credentials, real account binding, remote Git push or formal installation change occurred.
