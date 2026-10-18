# Daily lyric pipeline audit — 2026-10-18 18:09 UTC

Priority changed to explaining the installed daily lyric chain and the existing dot import format. No model, music or publication request was initiated.

## Installed configuration, read-only

Installed source 0a0ed141f21a9062235ec0ebbd60709a7afc93fc, version 0.8.3-preview.2.
Plan 160b098d-84a3-465c-ba6f-a4598fd71c94: enabled=true, Asia/Shanghai 09:00, candidateMode=local_template, scoreMode=rule_based, text=null, music=null, publication=null, autoContinue=false, maxRevisions=2, maxScoreRetries=2.
DeepSeek text profile exists (deepseek-flash, revision1), but its encrypted credential file is absent. Thus no configured paid DeepSeek text generation is available. YourMusic's separate music credential file exists; it is irrelevant to text generation.
The installed inbox-channel setting is absent; dot receiving is not configured.

The client Core ticks once per second and evaluates the plan while running. Main pumps external tasks every2seconds. This path does not call a Codex Work task, Codex CLI, Claude CLI or dot. CLI providers remain unconfigured entries. Windows scheduled-task enumeration was denied by the OS; code inspection finds no scheduler registration for this chain. Do not claim that OS task absence was independently verified.

The completed convenience-store song's lyrics came from the earlier development conversation (codex-assisted-original). They were supplied to the music generator; they are not evidence this daily plan called an AI lyric model.

## Offline diagnosis performed on isolated copy

Source DB was opened readonly and backed up to output/daily-lyrics-audit-20261018/isolated-local-1792346798887. No credentials/media copied. Network was guarded off.

Run 9f8e7408-e7db-4aa1-a57d-7b6bee0429f3 created one real local-template candidate c4c0ea76-4223-4254-b9b9-8e9fc35708d1 and one local work b82f5cc9-a082-4a8f-9c55-e07a0ac315bc. A local-only candidate approval in that isolated copy exercised rules scoring and work materialization. Structural score100/threshold75 is not literary or model quality. It then stopped at music/blocked with NEEDS_MUSIC_MATERIALS and MUSIC_AUTHORIZATION_REQUIRED.

Same requestId reused the same run; restarting preserved candidate/work IDs and one work. There were zero external, music or publication operations. Original settings/works/operations table hashes remained unchanged.

24/24 focused production-flow offline tests passed, including schedule/day idempotency, sleep-gap skip, bounded rewrite/score retry, work creation and unknown dispatch restart protection. Real model retry was not exercised: no DeepSeek key.

Evidence:
- output/daily-lyrics-audit-20261018/installed-config-readonly.json
- output/daily-lyrics-audit-20261018/local-run-report.json
- output/daily-lyrics-audit-20261018/local-candidate-lyrics.txt

## dot handoff

Current preference: this dot conversation writes lyrics + style prompt, then imports completed structured text. No extra Codex/Claude lyric-generation request, new paid model request, recurring automation or new credentials were created.

docs/integrations/dot-minimal-inbox-example.json is a complete schema-valid FORMAT SAMPLE, not a created song and not imported. All placeholder creative text must be replaced. The receiver requires all CreativeDraft fields, including both musicPrompts.suno and musicPrompts.yourmusic. Set model:null when the current model is unknown. Map workspaceRef and artistRef through the existing client UI first; current installed channel is unconfigured.

Once a channel is deliberately configured, UI returns the actual <dataRoot>/production/inbox-v1 path. Write only incoming/<batchId>.json as UTF-8, via unique .partial then rename. Read and match receipts/<batchId>.json. A successful import saves drafts/textCandidates with imported/model_pending and local hard checks. It does not call dot, perform model evaluation, generate music or publish. inbox.selectMusicInput only confirms/selects the imported source; it is not an AI score.

Imported source producer/model fields are declarations, not verified identity. Same externalItemId+revision+same content reuses records; changed content under same identity is rejected.

## Earlier delivery retained

e68e862 commits the publishing/receipt integration. Unified Main17/17 passed this turn; last current-tree typecheck/build passed in phase2. Portable candidate packaging/native GUI screenshots/source+patch archive remain pending because this new user priority interrupted them. No formal installation change occurred. The requested released-backend Library screenshot is still pending; no new Library success is claimed.
