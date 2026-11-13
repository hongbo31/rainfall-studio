/** Live first-step upload verified 2026-11-11. Desktop upload transport is still gated pending integration acceptance. */
export const fanqieCapabilities = Object.freeze({
  preparation: true, formObserved: true, upload: false, draft: false,
  submission: false, album: false, reason: 'FANQIE_BROWSER_RUNTIME_UNAVAILABLE',
});
export const fanqieOrigin = 'https://www.novelfm.com';
export const fanqieStages = {
  prepared: '信息已准备', uploading: '上传中', unknown: '需核对结果',
  contract_pending: '合同待确认', submitted: '已提交', reviewing: '审核中',
  published: '已上架', rejected: '未通过', withdrawn: '已下架',
} as const;
export type FanqieStage = keyof typeof fanqieStages;
export type FanqieRole = 'audio' | 'lyrics' | 'cover';
export type FanqieAsset = { file: string; sha256: string; bytes: number };
export type FanqieAssets = Record<'audio'|'cover',FanqieAsset> & {lyrics?:FanqieAsset};
const vocalRoles = ['audio','lyrics','cover'] as const;
const instrumentalRoles = ['audio','cover'] as const;
export const fanqieRoles = (instrumental?:boolean): readonly FanqieRole[] => instrumental ? instrumentalRoles : vocalRoles;
export type FanqieScope = { accountId: string; artistId: string; sessionId: string };
export type FanqieAuthorizationPreference = {mode:'exclusive'|'nonexclusive';platforms:('fanqie_music'|'fanqie_audio')[];confirmContractManually:true};
export type FanqieAuthorizationResult = {
  id: string;
  title: string;
  status: string;
  phase: 'already_processed' | 'awaiting_signature';
};
export type FanqieInput = {
  authorizationPreference?: FanqieAuthorizationPreference;
  workId: string; scope: FanqieScope; title: string; ai: boolean;
  musicType: 'original' | 'cover'; rightsConfirmed: boolean; coverAuthorization?: string;
  authors: { lyricist: string; composer: string; singer: string };
  instrumental?: true;
  lyricsMatchConfirmed: boolean; assets: FanqieAssets;
};
export type FanqieObservation = {
  origin: string; scope: FanqieScope; source: 'browser' | 'fixture';
  formVerified: boolean; songCount: number; songKey: string;
  /** Fingerprint must include all visible metadata and role-specific artist selections. */
  metadataFingerprint: string | null;
  uploads: Partial<Record<FanqieRole, { sha256: string; remoteId: string }>>;
};
/** Main-owned interface. Production bridge is intentionally not installed yet. */
export interface FanqieBrowserPort {
  source: 'browser' | 'fixture';
  /** Read the full catalog in the verified account/session, preserving any active editor. */
  readCatalog(): Promise<import('./fanqie-catalog').FanqieCatalog & {scope: FanqieScope}>;
  observe(): Promise<FanqieObservation>;
  /** Supported re-claim only. Must preserve tab/login and perform no site writes. */
  reclaim(): Promise<void>;
  fill(input: FanqieInput, songKey: string): Promise<void>;
  /** Implementations must use waitForEvent('filechooser') and the exact observed role control. */
  chooseFile(role: FanqieRole, asset: FanqieAsset, songKey: string): Promise<void>;
}
