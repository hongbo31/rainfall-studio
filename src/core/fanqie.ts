import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { hash, type Repository } from './database';
import { probe } from './assets';
import { fanqieOrigin, fanqieRoles, type FanqieInput, type FanqieObservation, type FanqieBrowserPort, type FanqieRole, type FanqieStage } from '../shared/fanqie';
import {checkFanqieNewUpload} from '../shared/fanqie-catalog';
import {assertPublicationFile,assertPublicationUploadReceipt,publicationRecordingKey,nextPublicationCheckpoint,interruptedPublicationState,fanqiePreparationPhases,publicationPhase,readPublicationAfterRecovery,auditPublicationTransition} from './publication-foundation';

const prefix = 'fanqie:preparation:v1:';
const max = 1024 * 1024;
export function fanqieMetadataFingerprint(input: FanqieInput) {
  return hash({ title: input.title, ai: input.ai, musicType: input.musicType, authors: input.authors });
}
/** Fresh bytes and decoded properties, never caller-supplied duration/size claims. */
export async function verifyFanqieMaterials(input: FanqieInput) {
  if (!input || !input.scope || Object.values(input.scope).some(v => typeof v !== 'string' || !v.trim()) ||
      !input.scope.accountId || !input.scope.artistId || !input.scope.sessionId) throw Error('FANQIE_IDENTITY_REQUIRED');
  if (!input.workId?.trim() || !input.title?.trim() || Array.from(input.title).length > 40) throw Error('FANQIE_TITLE_INVALID');
  if (typeof input.ai !== 'boolean') throw Error('FANQIE_AI_DECLARATION_REQUIRED');
  if (!['original', 'cover'].includes(input.musicType) || input.rightsConfirmed !== true ||
      input.musicType === 'cover' && !input.coverAuthorization?.trim()) throw Error('FANQIE_RIGHTS_REQUIRED');
  if (!input.authors || ['lyricist', 'composer', 'singer'].some(k => !input.authors[k as keyof typeof input.authors]?.trim())) throw Error('FANQIE_AUTHORS_REQUIRED');
  if (input.assets.lyrics && input.lyricsMatchConfirmed !== true) throw Error('FANQIE_LYRICS_MATCH_REQUIRED');
  for (const role of fanqieRoles(!!input.assets.lyrics)) {
    const a = input.assets?.[role];
    if (!a || !path.isAbsolute(a.file) || !/^[a-f0-9]{64}$/.test(a.sha256)) throw Error('FANQIE_ASSET_INVALID');
    if(a.bytes<=0)throw Error('FANQIE_ASSET_CHANGED');
    assertPublicationFile(a,{error:'FANQIE_ASSET_CHANGED'});
    const ext = path.extname(a.file).toLowerCase();
    if (role === 'audio') {
      if (!['.wav', '.mp3'].includes(ext) || a.bytes > 200 * max) throw Error('FANQIE_AUDIO_FORMAT');
      const metadata = probe(a.file), stream = metadata.streams?.filter((s: any) => s.codec_type === 'audio');
      const s = stream?.[0], format = String(metadata.format?.format_name ?? '').split(',');
      if (stream?.length !== 1 || !format.includes(ext.slice(1)) || !Number.isFinite(Number(metadata.format?.duration)) ||
          Number(metadata.format.duration) <= 30 || Number(s.sample_rate) < 44100 || Number(s.channels) !== 2 ||
          !Number.isFinite(Number(s.sample_rate))) throw Error('FANQIE_AUDIO_PROPERTIES');
      // The official form accepts MP3 (verified with an uploaded record on 2026-11-11).
      // MP3 has no PCM bit-depth field; this requirement applies to the WAV input.
      if (ext === '.mp3' && s.codec_name !== 'mp3') throw Error('FANQIE_AUDIO_FORMAT');
      if (ext === '.wav' && (Number(s.bits_per_raw_sample || s.bits_per_sample) < 16 || !Number.isFinite(Number(s.bits_per_raw_sample || s.bits_per_sample)))) throw Error('FANQIE_AUDIO_BIT_DEPTH_UNVERIFIED');
    } else if (role === 'cover') {
      if (!['.jpg', '.jpeg', '.png'].includes(ext) || a.bytes > 10 * max) throw Error('FANQIE_COVER_FORMAT');
      const m = await sharp(a.file, { limitInputPixels: 100_000_000 }).metadata();
      if (m.format !== (ext === '.png' ? 'png' : 'jpeg') || (m.pages ?? 1) !== 1 || !m.width || !m.height || m.width < 1440 || m.height !== m.width) throw Error('FANQIE_COVER_DIMENSIONS');
    } else {
      if (ext !== '.txt' || a.bytes > max) throw Error('FANQIE_LYRICS_FORMAT');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(a.file));
      if (!text.trim() || text.includes('\0')) throw Error('FANQIE_LYRICS_INVALID');
    }
  }
}
type Job = { id: string; input: FanqieInput; fingerprint: string; stage: FanqieStage; revision: number; source: 'local' | 'offline-fixture';
  songKey?: string; pending?: string; reason?: string; metadata: boolean;
  uploads: Partial<Record<FanqieRole, string>>; };
/** Durable intent is stored before every external write. Unknown writes are never retried automatically. */
export class FanqiePreparationService {
  constructor(private repo: Repository, private verify = verifyFanqieMaterials) {
    repo.transaction(() => { for (const j of this.list()) if (publicationPhase(j.stage,fanqiePreparationPhases)==='writing') this.put({ ...j, stage: interruptedPublicationState(j.stage,fanqiePreparationPhases,'unknown') as FanqieStage, reason: 'FANQIE_INTERRUPTED' }); });
  }
  list(): Job[] { return this.repo.all('settings').filter(r => r.id.startsWith(prefix)).map(r => structuredClone(r.value)); }
  private put(j: Job) {
    return this.repo.transaction(() => {
    const current = this.repo.maybe('settings', prefix + j.id)?.value;
    if ((current?.revision ?? 0) !== j.revision) throw Error('FANQIE_REVISION_CONFLICT');
    const value = nextPublicationCheckpoint(j,{}); this.repo.save('settings', { id: prefix + j.id, value });
    auditPublicationTransition(this.repo,{platform:'fanqie',id:value.id,state:value.stage,revision:value.revision,reason:value.reason});return structuredClone(value);
    });
  }
  private get(id: string): Job { const j = this.repo.get('settings', prefix + id).value; return structuredClone(j); }
  async prepare(raw: FanqieInput) {
    const input = structuredClone(raw); await this.verify(input);
    const id = publicationRecordingKey('fanqie',input.scope.accountId,input.assets.audio.sha256,input.scope.artistId);
    const fingerprint = hash(input);
    return this.repo.transaction(() => {
      const old = this.repo.maybe('settings', prefix + id)?.value as Job | undefined;
      if (old) { if (old.fingerprint !== fingerprint) throw Error('FANQIE_EXISTING_RECORDING_REQUIRES_RECONCILIATION'); return structuredClone(old); }
      return this.put({ id, input, fingerprint, stage: 'prepared', revision: 0, source: 'local', metadata: false, uploads: {} });
    });
  }
  private async observe(port: FanqieBrowserPort) {
    return readPublicationAfterRecovery(()=>port.observe(),{reclaim:()=>port.reclaim(),retryable:e=>/Debugger unattached|timed? ?out|timeout/i.test(String(e))});
  }
  private assertScope(j: Job, o: FanqieObservation, source: FanqieBrowserPort['source']) {
    if (o.origin !== fanqieOrigin || !o.formVerified || o.source !== source || o.songCount !== 1 || !o.songKey ||
      ['accountId', 'artistId', 'sessionId'].some(k => o.scope?.[k as keyof typeof o.scope] !== j.input.scope[k as keyof typeof j.input.scope]) ||
      j.songKey && j.songKey !== o.songKey) throw Error('FANQIE_PAGE_SCOPE_CHANGED');
    if (!j.input.assets.lyrics && o.uploads.lyrics) throw Error('FANQIE_UPLOAD_CHANGED');
    for (const role of fanqieRoles(!!j.input.assets.lyrics)) if (j.uploads[role] &&
      (o.uploads[role]?.remoteId !== j.uploads[role] || o.uploads[role]?.sha256 !== j.input.assets[role]?.sha256)) throw Error('FANQIE_UPLOAD_CHANGED');
  }
  async upload(id: string, port: FanqieBrowserPort, authorization: { fingerprint: string; upload: boolean }) {
    let j = this.get(id);
    // No production bridge has been calibrated/installed. Fixture ports cannot unlock production.
    if (port.source !== 'fixture') throw Error('FANQIE_BROWSER_RUNTIME_UNAVAILABLE');
    if (authorization.upload !== true || authorization.fingerprint !== j.fingerprint) throw Error('FANQIE_UPLOAD_AUTHORIZATION_REQUIRED');
    if (publicationPhase(j.stage,fanqiePreparationPhases) !== 'prepared') throw Error('FANQIE_RECONCILIATION_REQUIRED');
    await this.verify(j.input);
    // Persist before first await into the browser; a second worker sees uploading.
    j = this.repo.transaction(() => {
      const fresh = this.get(id); if (fresh.revision !== j.revision || fresh.stage !== 'prepared') throw Error('FANQIE_BUSY');
      return this.put({ ...fresh, source: 'offline-fixture', stage: 'uploading', pending: 'observe' });
    });
    try {
      const catalog = await port.readCatalog();
      if (catalog.source !== port.source || ['accountId','artistId','sessionId'].some(k =>
        catalog.scope?.[k as keyof typeof catalog.scope] !== j.input.scope[k as keyof typeof j.input.scope])) throw Error('FANQIE_CATALOG_SCOPE_CHANGED');
      const duplicate = checkFanqieNewUpload(catalog, j.input.title);
      if (!duplicate.allowed) throw Error(duplicate.reason);
      let o = await this.observe(port); this.assertScope(j, o, port.source);
      if (Object.keys(o.uploads).length || o.metadataFingerprint) throw Error('FANQIE_EXISTING_FORM_REQUIRES_RECONCILIATION');
      j = this.put({ ...j, songKey: o.songKey, pending: 'metadata' });
      await port.fill(j.input, o.songKey);
      o = await this.observe(port); this.assertScope(j, o, port.source);
      if (o.metadataFingerprint !== fanqieMetadataFingerprint(j.input)) throw Error('FANQIE_METADATA_READBACK_REQUIRED');
      j = this.put({ ...j, metadata: true, pending: undefined });
      for (const role of fanqieRoles(!!j.input.assets.lyrics)) {
        await this.verify(j.input);
        o = await this.observe(port); this.assertScope(j, o, port.source);
        if (o.metadataFingerprint !== fanqieMetadataFingerprint(j.input)) throw Error('FANQIE_METADATA_CHANGED');
        if (o.uploads[role]) throw Error('FANQIE_EXISTING_UPLOAD_REQUIRES_RECONCILIATION');
        j = this.put({ ...j, pending: role });
        const asset=j.input.assets[role];
        if(!asset)throw Error('FANQIE_ASSET_INVALID');
        await port.chooseFile(role, asset, o.songKey);
        o = await this.observe(port); this.assertScope(j, o, port.source);
        if (o.metadataFingerprint !== fanqieMetadataFingerprint(j.input)) throw Error('FANQIE_METADATA_CHANGED');
        assertPublicationUploadReceipt(o.uploads[role],asset.sha256,'FANQIE_UPLOAD_READBACK_REQUIRED');
        j = this.put({ ...j, pending: undefined, uploads: { ...j.uploads, [role]: o.uploads[role]!.remoteId } });
      }
      // Fixture evidence remains explicitly fixture-only and never advances production submission.
      return this.put({ ...j, stage: 'contract_pending', reason: 'OFFLINE_FIXTURE_ONLY' });
    } catch (e) { this.put({ ...j, stage: 'unknown', reason: e instanceof Error ? e.message : 'FANQIE_UNKNOWN_RESULT' }); throw e; }
  }
  /** Read-only reconciliation; no reset-to-prepared and no retry of an ambiguous upload. */
  async reconcile(id: string, port: FanqieBrowserPort) {
    const j = this.get(id); const revision = j.revision;
    if (j.source === 'offline-fixture' && port.source !== 'fixture') throw Error('FANQIE_FIXTURE_CANNOT_AUTHORIZE_PRODUCTION');
    await this.verify(j.input);
    const o = await this.observe(port); this.assertScope(j, o, port.source);
    const complete = o.metadataFingerprint === fanqieMetadataFingerprint(j.input) &&
      fanqieRoles(!!j.input.assets.lyrics).every(role => o.uploads[role]?.remoteId && o.uploads[role]?.sha256 === j.input.assets[role]?.sha256);
    return this.repo.transaction(() => {
      const fresh = this.get(id); if (fresh.revision !== revision || !['unknown', 'contract_pending'].includes(fresh.stage)) throw Error('FANQIE_RECONCILIATION_CONFLICT');
      return this.put({ ...fresh, stage: complete ? 'contract_pending' : 'unknown', reason: complete ? (port.source === 'fixture' ? 'OFFLINE_FIXTURE_ONLY' : 'FANQIE_CONTRACT_CONFIRMATION_REQUIRED') : 'FANQIE_UPLOAD_RECONCILIATION_REQUIRED' });
    });
  }
}
