import {fanqieOrigin, type FanqieStage} from './fanqie';

export const fanqieCatalogPath = '/creator/music/finished/ugc';
const statuses = {
  '待授权': 'contract_pending', '审核中': 'reviewing', '已上架': 'published',
  '未通过': 'rejected', '已下架': 'withdrawn',
} as const;
export type FanqieCatalogRow = {
  id: string; title: string; stage: FanqieStage; officialStatus: string;
  createdAtText: string; publishedAtText: string;
};
export type FanqieCatalog = {
  source: 'browser' | 'fixture'; url: string; observedAt: string;
  total: number; complete: boolean; rows: FanqieCatalogRow[];
};
export type FanqieCatalogReport = FanqieCatalog & {accountKey: string; maskedAccount: string};
type CatalogReadback = {
  selectedTab: string; query: string; headers: string[]; rows: string[][];
};
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
  const rows = raw.rows.map(cells => {
    if (cells.length !== 5) throw Error('FANQIE_CATALOG_LAYOUT_CHANGED');
    const info = /^(.+)\n作品ID[：:]\s*([1-9]\d{4,24})$/.exec(cells[0].trim());
    const status = cells[1].trim();
    if (!info || !Object.hasOwn(statuses, status)) throw Error('FANQIE_CATALOG_ROW_UNVERIFIED');
    if (seen.has(info[2])) throw Error('FANQIE_CATALOG_DUPLICATE_ID');
    seen.add(info[2]);
    return {id: info[2], title: info[1].trim(), stage: statuses[status as keyof typeof statuses],
      officialStatus: status, createdAtText: cells[2].trim(), publishedAtText: cells[3].trim()};
  });
  if (rows.length > total) throw Error('FANQIE_CATALOG_COUNT_INVALID');
  // A page with fewer rows than the total cannot prove absence on other pages.
  return {total, complete: rows.length === total, rows};
}

const normalizedTitle = (title: string) => title.normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase('en-US');
/** A matching title is a duplicate warning, never proof of matching audio bytes. */
export function checkFanqieNewUpload(catalog: FanqieCatalog, title: string) {
  assertFanqieCatalogUrl(catalog.url);
  if (!title.trim()) throw Error('FANQIE_TITLE_INVALID');
  const matches = catalog.rows.filter(row => normalizedTitle(row.title) === normalizedTitle(title));
  if (matches.length) return {allowed: false as const, reason: 'FANQIE_OFFICIAL_RECORD_ALREADY_EXISTS', matches};
  if (!catalog.complete || catalog.rows.length !== catalog.total) return {allowed: false as const, reason: 'FANQIE_CATALOG_INCOMPLETE', matches};
  return {allowed: true as const, reason: null, matches};
}
