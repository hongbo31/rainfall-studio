import type {Frame, Page} from 'playwright-core';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {fanqieOrigin} from '../../shared/fanqie';
import {
  fanqieCatalogPath, fanqieTitleKey, readFanqieWorkStatus,
  type FanqieCatalog, type FanqieCatalogQuery, type FanqieCatalogRow,
} from '../../shared/fanqie-catalog';
import {fanqieProfileUrl as profileUrl} from './directory-page';

const catalogUrl = fanqieOrigin + fanqieCatalogPath;
const listPath = '/api/author/book/music/ugc_product_list/v0/';
const pageSize = 10;
const maxTitleResults = 100;
const maxTitleLength = 40 + '(Cover )'.length + 40;
const statuses: Record<number, string> = {
  0: '待授权', 1: '待授权', 2: '审核中', 3: '未通过', 4: '审核中', 5: '未通过',
  6: '审核中', 7: '已上架', 8: '已下架', 10: '审核中',
};
const idSchema = z.string().regex(/^[1-9]\d{4,24}$/u);
const integer = z.union([z.number(), z.string().regex(/^\d+$/u).transform(Number)])
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
const workSchema = z.object({
  product_id: idSchema,
  contract_id: z.unknown().optional(),
  name: z.string().trim().min(1),
  music_ugc_product_status: integer.optional(),
  create_time: integer.nullish(),
  on_shelf_time: integer.nullish(),
  music_ugc_extra: z.object({
    music_audit_info: z.object({
      common_modify_audit_info: z.object({status: integer.optional()}).nullish(),
    }).nullish(),
  }).nullish(),
});
const responseSchema = z.object({
  code: z.literal(0),
  data: z.object({total_count: integer, music_ugc_product_list: z.array(workSchema).nullish()}),
});

function parseResponse(text: string) {
  // The site can encode 64-bit IDs as JSON numbers. Keep their exact digits.
  const decoded: unknown = JSON.parse(text, (key, value: unknown, context?: {source: string}) =>
    (key === 'product_id' || key === 'contract_id') && typeof value === 'number' ? context?.source ?? '' : value);
  if (typeof decoded === 'object' && decoded !== null && 'code' in decoded && decoded.code === -2)
    throw Error('FANQIE_CATALOG_LOOKUP_LOGIN_REQUIRED');
  const result = responseSchema.safeParse(decoded);
  if (!result.success) throw Error('FANQIE_CATALOG_LOOKUP_UNVERIFIED');
  return result.data.data;
}

type AccountDocument = Pick<Page | Frame, 'url' | 'locator'>;

async function readPage(page: AccountDocument, guard: () => void, query: FanqieCatalogQuery, index: number) {
  guard();
  if (page.url() !== profileUrl) throw Error('FANQIE_CATALOG_SCOPE_CHANGED');
  const parameters = new URLSearchParams({
    aid: '605243', app_name: 'novel_fm_creator',
    page_index: String(index), page_count: String(pageSize),
    music_ugc_product_status_list: Object.keys(statuses).join(','),
    name: query.title,
  });
  if (query.id) parameters.set('product_id', query.id);

  const text = await page.locator('body').evaluate(async (_, {profile, request}) => {
    if (location.href !== profile) return null;
    const result = await fetch(request, {
      method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-Fm-Browser-Platform': navigator.platform,
        'X-Fm-Browser-Version': navigator.appVersion,
        'X-Fm-Browser-Name': navigator.appCodeName,
      },
      signal: AbortSignal.timeout(12000),
    }).catch(() => null);
    return result?.ok ? result.text() : null;
  }, {profile: profileUrl, request: listPath + '?' + parameters}, {timeout: 14000});
  guard();
  if (page.url() !== profileUrl) throw Error('FANQIE_CATALOG_SCOPE_CHANGED');
  if (text === null) throw Error('FANQIE_CATALOG_LOOKUP_FAILED');
  try { return parseResponse(text); }
  catch (error) {
    if (error instanceof SyntaxError) throw Error('FANQIE_CATALOG_LOOKUP_UNVERIFIED');
    throw error;
  }
}

async function search(page: AccountDocument, guard: () => void, query: FanqieCatalogQuery) {
  const rows: FanqieCatalogRow[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  for (let index = 0; total === undefined || seen.size < total; index++) {
    const response = await readPage(page, guard, query, index);
    total ??= response.total_count;
    const records = response.music_ugc_product_list ?? [];
    if (response.total_count !== total || records.length !== Math.min(pageSize, total - index * pageSize))
      throw Error('FANQIE_CATALOG_LOOKUP_UNVERIFIED');
    if (total > maxTitleResults || (query.id && total > 1))
      throw Error('FANQIE_CATALOG_LOOKUP_TOO_BROAD');
    for (const record of records) {
      const id = record.product_id;
      if (seen.has(id) || (query.id && (id !== query.id || record.name !== query.title)))
        throw Error('FANQIE_CATALOG_LOOKUP_UNVERIFIED');
      seen.add(id);
      if (fanqieTitleKey(record.name) !== fanqieTitleKey(query.title)) continue;
      const status = record.music_ugc_product_status;
      const modificationFailed = record.music_ugc_extra?.music_audit_info?.common_modify_audit_info?.status === 3;
      const label = modificationFailed ? '修改失败' : status === undefined ? '' : statuses[status] ?? '';
      const contractId = idSchema.safeParse(record.contract_id);
      const contract = status === 0 ? {state: 'not_created' as const} : status === 1 ?
        {state: 'awaiting_signature' as const, id: contractId.data} : undefined;
      rows.push({
        id, title: record.name, ...readFanqieWorkStatus(label),
        ...(label === '待授权' && contract ? {contract} : {}),
        createdAtText: record.create_time ? String(record.create_time) : '',
        publishedAtText: record.on_shelf_time ? String(record.on_shelf_time) : '',
      });
    }
  }
  return rows;
}

/** Uses the creator site's read-only, filtered list request in the verified account tab. */
export async function readFanqieDirectoryCatalog(
  page: AccountDocument, guard: () => void, queries: readonly FanqieCatalogQuery[],
): Promise<FanqieCatalog> {
  const rows = new Map<string, FanqieCatalogRow>();
  const titles = new Set<string>();
  const searched = new Set<string>();
  const receiptDeadline = Date.now() + 15000;
  for (const {title: rawTitle, id, waitForReceipt} of queries) {
    const title = rawTitle.trim();
    if (!title || title.length > maxTitleLength || (id !== undefined && !idSchema.safeParse(id).success))
      throw Error('FANQIE_CATALOG_LOOKUP_UNVERIFIED');
    const key = JSON.stringify([title, id]);
    if (searched.has(key)) continue;
    let matches = await search(page, guard, {title, id});
    while (waitForReceipt && !matches.some(row => row.title === title) && Date.now() < receiptDeadline) {
      await delay(750);
      matches = await search(page, guard, {title, id});
    }
    searched.add(key);
    if (!id) titles.add(title);
    for (const row of matches) {
      const previous = rows.get(row.id);
      if (previous && (previous.title !== row.title || previous.stage !== row.stage ||
          JSON.stringify(previous.contract) !== JSON.stringify(row.contract)))
        throw Error('FANQIE_CATALOG_LOOKUP_UNVERIFIED');
      rows.set(row.id, row);
    }
  }
  return {
    source: 'browser', url: catalogUrl, complete: true, total: rows.size, rows: [...rows.values()],
    searchedTitles: [...titles], observedAt: new Date().toISOString(),
  };
}
