import {fanqieOrigin, type FanqieStage} from './fanqie';

export const fanqieCatalogPath = '/creator/music/finished/ugc';
const statuses = {
  '待授权': 'contract_pending', '审核中': 'reviewing', '已上架': 'published',
  '未通过': 'rejected', '已下架': 'withdrawn',
} as const;
export type FanqieCatalogRow = {
  id: string; title: string; stage: FanqieStage; officialStatus: string;
  createdAtText: string; publishedAtText: string;
  contract?: {state: 'not_created'} | {state: 'awaiting_signature'; id?: string};
};
export type FanqieCatalogQuery = {title: string; id?: string; waitForReceipt?: boolean};
export type FanqieCatalog = {
  source: 'browser' | 'fixture'; url: string; observedAt: string;
  total: number; complete: boolean; rows: FanqieCatalogRow[];
  searchedTitles?: readonly string[];
};
export type FanqieCatalogReport = FanqieCatalog & {accountKey: string; maskedAccount: string};

export function pendingFanqieContractId(row: Pick<FanqieCatalogRow, 'stage' | 'contract'> | undefined) {
  const id = row?.stage === 'contract_pending' && row.contract?.state === 'awaiting_signature' ? row.contract.id : undefined;
  return typeof id === 'string' && /^[1-9]\d{4,24}$/u.test(id) ? id : undefined;
}

type WorkFields = {title: string; idText: string};
type CatalogReadback = {
  selectedTab: string; query: string; headers: string[]; rows: string[][]; workFields?: (WorkFields | null)[];
};
type RowErrorCode = 'FANQIE_CATALOG_WORK_TITLE_UNVERIFIED' | 'FANQIE_CATALOG_WORK_ID_UNVERIFIED' | 'FANQIE_CATALOG_DUPLICATE_ID';

export class FanqieCatalogRowError extends Error {
  page?: number;
  constructor(code: RowErrorCode, readonly row: number) { super(code); }
}

export function fanqieWorkIdTextPattern(id?: string) {
  if (id !== undefined && !/^[1-9]\d{4,24}$/u.test(id)) throw Error('FANQIE_CATALOG_WORK_ID_UNVERIFIED');
  const digits = id === undefined ? '([1-9１-９][0-9０-９]{4,24})' : Array.from(id, digit =>
    '[' + digit + String.fromCharCode(digit.charCodeAt(0) + 0xfee0) + ']').join('');
  return new RegExp('^作品\\s*[IiＩｉ]\\s*[DdＤｄ](?:\\s*[:：]\\s*|\\s+)' + digits + '(?:\\s*复制)?$', 'u');
}

const workIdLabel = fanqieWorkIdTextPattern();
export function parseFanqieWorkIdentity(cell: string, fields: WorkFields | null | undefined, row: number) {
  const [fallbackTitle = '', ...rest] = cell.trim().split(/\r?\n/u);
  const title = (fields?.title ?? fallbackTitle).trim();
  if (!title || workIdLabel.test(title)) throw new FanqieCatalogRowError('FANQIE_CATALOG_WORK_TITLE_UNVERIFIED', row);
  const id = workIdLabel.exec((fields?.idText ?? rest.join('\n')).trim())?.[1];
  if (!id) throw new FanqieCatalogRowError('FANQIE_CATALOG_WORK_ID_UNVERIFIED', row);
  return {title, id: id.normalize('NFKC')};
}

export function readFanqieWorkStatus(text: string): Pick<FanqieCatalogRow, 'stage' | 'officialStatus'> {
  const status = text.trim();
  const key = status.replace(/\s+/gu, '');
  if (Object.hasOwn(statuses, key)) return {stage: statuses[key as keyof typeof statuses], officialStatus: key};
  return {stage: 'unknown', officialStatus: status || '状态未读取'};
}

export function assertFanqieCatalogUrl(raw: string | undefined) {
  const u = raw ? new URL(raw) : null;
  if (!u || u.origin !== fanqieOrigin || u.pathname !== fanqieCatalogPath ||
      u.username || u.password || u.search || u.hash) throw Error('FANQIE_CATALOG_PAGE_REQUIRED');
  return u.href;
}
/** Only visible official rows; IDs stay strings to preserve all 64-bit digits. */
export function parseFanqieCatalog(raw: CatalogReadback) {
  const count = /^全部[·・](\d+)$/.exec(raw.selectedTab.trim());
  if (!count || raw.query !== '') throw Error('FANQIE_CATALOG_FILTERED');
  if (raw.headers.join('|') !== '作品信息|作品状态|创建时间|上架时间|操作') throw Error('FANQIE_CATALOG_LAYOUT_CHANGED');
  const total = Number(count[1]);
  if (!Number.isSafeInteger(total) || total < 0) throw Error('FANQIE_CATALOG_COUNT_INVALID');
  const seen = new Set<string>();
  const rows = raw.rows.map((cells, index) => {
    if (cells.length !== 5) throw Error('FANQIE_CATALOG_LAYOUT_CHANGED');
    const identity = parseFanqieWorkIdentity(cells[0], raw.workFields?.[index], index + 1);
    if (seen.has(identity.id)) throw new FanqieCatalogRowError('FANQIE_CATALOG_DUPLICATE_ID', index + 1);
    seen.add(identity.id);
    return {...identity, ...readFanqieWorkStatus(cells[1]), createdAtText: cells[2].trim(), publishedAtText: cells[3].trim()};
  });
  if (rows.length > total) throw Error('FANQIE_CATALOG_COUNT_INVALID');
  // A page with fewer rows than the total cannot prove absence on other pages.
  return {total, complete: rows.length === total, rows};
}

export const fanqieTitleKey = (title: string) => title.normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase('en-US');
/** A matching title is a duplicate warning, never proof of matching audio bytes. */
export function checkFanqieNewUpload(catalog: FanqieCatalog, title: string) {
  assertFanqieCatalogUrl(catalog.url);
  if (!title.trim()) throw Error('FANQIE_TITLE_INVALID');
  const matches = catalog.rows.filter(row => fanqieTitleKey(row.title) === fanqieTitleKey(title));
  if (matches.length) return {allowed: false as const, reason: 'FANQIE_OFFICIAL_RECORD_ALREADY_EXISTS', matches};
  if (!catalog.complete || catalog.rows.length !== catalog.total ||
    (catalog.searchedTitles && !catalog.searchedTitles.includes(title.trim())))
    return {allowed: false as const, reason: 'FANQIE_CATALOG_INCOMPLETE', matches};
  return {allowed: true as const, reason: null, matches};
}
