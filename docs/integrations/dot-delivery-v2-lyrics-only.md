# dot directory delivery v2: lyrics-only compatibility

`deliveryVersion: 1` retains its existing meaning: every text item requires one verified cover. A lyrics-only plan must never be made compatible with v1 by silently generating a cover. Any delivery carrying text v2/R is now also constrained by that saved R, including a v1 envelope: wrapping text v2 in delivery v1 cannot permit an unrequested cover. Legacy text v1 + delivery v1 retains its original behavior when no saved R matches. If its channel/workspace/artist/external ID/revision matches a saved R, that R also constrains the legacy delivery; multiple historical owners of that identity require explicit v2 requestEcho and are rejected. Removing the echo cannot bypass output scope. The private text inbox already accepts `schemaVersion: 2` with an exact `requestEcho`; directory delivery v2 carries that same text through the existing Bridge and Receiver.

## Envelope and output scope

The v2 manifest has exactly the v1 fields, with `deliveryVersion: 2`. `images` may be empty. `READY.json` remains `{deliveryId, manifestSha256}` and must be published last. SHA256 values hash the exact UTF-8 file bytes. Unknown versions and unknown fields fail closed.

```json
{
  "deliveryVersion": 2,
  "deliveryId": "new-unique-delivery-id",
  "createdAt": "2026-10-19T00:00:00Z",
  "targetWorkspaceRef": "the-request-workspaceRef",
  "text": {"file": "text.json", "sha256": "64-lowercase-hex-of-text-bytes"},
  "images": []
}
```

For each text item, use `schemaVersion: 2` and copy the complete saved PlanDot request R into `requestEcho`. The existing request ID/hash, channel, workspace, artist identity, external item ID and revision checks still apply. Delivery v2 additionally requires `R.outputs.lyrics === true` and `R.outputs.music === false`. Cover descriptors must match exactly those items whose saved `R.outputs.cover === true`, with one cover per requested item. Consequently:

| R.outputs | Directory package |
| --- | --- |
| `{lyrics:true, cover:false, music:false}` | v2, text v2, `images:[]`; no image files or assets |
| `{lyrics:true, cover:true, music:false}` | v2, text v2, exactly the requested verified cover |
| `music:true` or `lyrics:false` | Rejected by delivery v2; this transport does not grant other output scope |

This is a transport extension, not permission to omit an explicitly requested cover. Legacy text v1 is rejected by delivery v2 because it lacks exact R ownership. Unrelated legacy delivery v1 and private inbox text v1 remain supported. A v1 directory associated with R requires `R.outputs.cover === true`; a lyrics-only R must use delivery v2. The stricter `lyrics:true/music:false` combination applies only to delivery v2. V1 retains its prior whole-plan output compatibility: `R.outputs.music:true` can describe a subsequent local music stage, and `lyrics:false` can describe a cover-only plan. Neither makes a text+cover directory package an audio delivery or grants new output scope.

Bridge checks saved R before private staging. Receiver checks it again before media installation, and Store checks it inside the SQLite transaction. A producer cannot change `requestEcho.outputs`, recompute its hash, use another channel/workspace/artist, or replay a changed delivery/revision to broaden scope.

## Receipts, association and stopping

Delivery v1 still emits `receiptVersion: 1` and required `coverAssetId`/`coverSha256` per item. Delivery v2 emits `receiptVersion: 2` with the same delivery/hash/batch/workspace/import time/status fields. A lyrics-only item includes `externalItemId`, `revision`, `candidateId`, `draftId`, and `evaluationState: "model_pending"`; it **omits** both cover fields. Requested and verified covers include both fields. Consumers must dispatch on `receiptVersion`; do not assume every item has a cover.

The existing requestEcho/association journal owns the candidate. Repeated scans retain candidate/draft/receipt IDs and attach only once. A stopped or expired R may still be acknowledged and journaled as stopped/expired, following existing inbox semantics; it cannot resume execution, attach, or score. Pausing the bridge/channel blocks intake until resumed. Conflicting content or saved R drift is rejected rather than replaced. Directory sync acknowledgements confirm local import, not remote generation, model evaluation, music creation, or publication.

## Offline producer example

Save this as an `.mjs` file and run it with four explicit local arguments: an app-owned complete projection file, one requestId selected from it, a local CreativeDraft JSON file, and the configured project root. This example only produces lyrics-only packages. It uses no network or generation API and never reads or creates an image.

```js
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
const [projectionFile, requestId, draftFile, projectRoot] = process.argv.slice(2);
if (!projectionFile || !requestId || !draftFile || !projectRoot) throw Error('Four local arguments required');
const digest = b => createHash('sha256').update(b).digest('hex');
const canonical = v => Array.isArray(v) ? '['+v.map(canonical).join(',')+']'
  : v && typeof v === 'object' ? '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}'
  : JSON.stringify(v);
const p = JSON.parse(fs.readFileSync(projectionFile, 'utf8'));
const {contentHash, ...content} = p;
if (p.projectionVersion !== 2 || p.protocolVersion !== 2 || p.producer !== 'rainfall-plan-center'
  || digest(canonical(content)) !== contentHash) throw Error('Invalid projection');
// Select the highest complete, validated projection sequence for this owner before using this example.
const R = p.requests.find(r => r.requestId === requestId);
if (!R || !p.requestStates.some(s => s.requestId === requestId && s.state === 'pending')) throw Error('Request is not pending');
const {requestHash, ...requestBody} = R;
if (digest(canonical(requestBody)) !== requestHash || !R.outputs.lyrics || R.outputs.cover || R.outputs.music
  || Date.now() >= Date.parse(R.expiresAt)) throw Error('Not an active lyrics-only request');
const stamp = new Date().toISOString(), deliveryId = randomUUID();
const text = {schemaVersion:2, batchId:deliveryId, createdAt:stamp, targetWorkspaceRef:R.workspaceRef, items:[{
  externalItemId:R.expectedExternalItemId, revision:R.revision, parentRevision:null,
  artistRef:R.artistRef, seriesRef:null, draft:JSON.parse(fs.readFileSync(draftFile,'utf8')),
  provenance:{producer:'local-dot-producer',model:null,promptVersion:null,generatedAt:stamp}, requestEcho:R
}]};
const textBytes = Buffer.from(JSON.stringify(text));
const manifest = {deliveryVersion:2, deliveryId, createdAt:stamp, targetWorkspaceRef:R.workspaceRef,
  text:{file:'text.json',sha256:digest(textBytes)}, images:[]};
const manifestBytes = Buffer.from(JSON.stringify(manifest));
const folder = path.join(projectRoot, 'incoming', deliveryId);
fs.mkdirSync(folder); // Exclusive new delivery directory; never replace a prior delivery.
function write(name, bytes) {
  const fd=fs.openSync(path.join(folder,name),'wx');
  try {fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
}
write('text.json', textBytes);
write('manifest.json', manifestBytes);
write('READY.json', JSON.stringify({deliveryId,manifestSha256:digest(manifestBytes)}));
console.log(deliveryId);
```

The producer must use the latest complete validated projection for the correct owner. An incomplete higher generation does not replace the last complete generation. Do not edit R or infer an R from an external item ID alone. The sample's `seriesRef:null` assumes an ungrouped item; use an explicitly configured existing series mapping where applicable.

## Isolated verification

`node --test tests/dot-delivery-lyrics.test.mjs` builds local production code and uses unique `output/test-runs/dot-lyrics-*` SQLite/filesystem fixtures. Networking and external processes are denied except the shipped hidden atomic File.Move helper, confined to those fixture paths. The suite covers actual production Core startup/RPC, Bridge → Receiver → requestEcho/association → receipt, no images/assets for lyrics-only, requested covers, unchanged v1 rules, extra-cover refusal, scope/hash/output drift, conflicting replay, pause/resume and stopped-run collection. It does not read a user library, access a Drive path, generate real content, or open a GUI.
