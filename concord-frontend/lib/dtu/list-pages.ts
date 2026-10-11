// GET /api/dtus omits a limit and the server returns the newest 50.
// Callers that need the whole match set walk explicit pages. The server
// cap stays: each request names a limit, and this walk stops.

export const LIST_PAGE_SIZE = 200;
export const SCOPE_PAGE_SIZE = 50;

export type DtuRow = {
  id?: string;
  title?: string;
  tags?: string[];
  createdAt?: string;
  scope?: string;
  domain?: string;
  [key: string]: unknown;
};

export type DtuListBody = {
  dtus?: DtuRow[];
  total?: number;
  limit?: number;
  offset?: number;
};

export type DtuPageQuery = {
  limit: number;
  offset: number;
  scope?: string;
};

export type ScopeDtuQuery =
  | { via: 'dtus'; params: DtuPageQuery }
  | { via: 'scope'; scope: string; params: { limit: number; offset: number } };

const TOPIC_CATEGORIES = ['News', 'Tech', 'Community', 'Creative', 'Science'];

export async function listAllDtuPages(
  fetchPage: (query: DtuPageQuery) => Promise<DtuListBody | null | undefined>,
  options?: { scope?: string; pageSize?: number; maxPages?: number },
): Promise<{ dtus: DtuRow[]; total: number }> {
  const pageSize = options?.pageSize ?? LIST_PAGE_SIZE;
  const maxPages = options?.maxPages ?? 100;
  const out: DtuRow[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  for (let page = 0; page < maxPages && offset < total; page += 1) {
    const body = await fetchPage({
      limit: pageSize,
      offset,
      ...(options?.scope ? { scope: options.scope } : {}),
    });
    const rows = Array.isArray(body?.dtus) ? body.dtus : [];
    const reported = Number(body?.total);
    if (Number.isFinite(reported) && reported >= 0) {
      total = Math.max(reported, offset + rows.length);
    } else if (rows.length < pageSize) {
      total = offset + rows.length;
    }

    let fresh = 0;
    for (const row of rows) {
      const id = row?.id != null ? String(row.id) : '';
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      out.push(row);
      fresh += 1;
    }

    if (rows.length === 0 || fresh === 0) break;
    const served = Number(body?.limit);
    const full = Number.isFinite(served) && served > 0 ? served : pageSize;
    offset += rows.length;
    if (rows.length < full) break;
  }

  return {
    dtus: out,
    total: Number.isFinite(total) ? total : out.length,
  };
}

export function sortDtusNewest<T extends { createdAt?: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

/** Export corpus. Every matching row, across pages. */
export function loadExportDtus(
  fetchPage: (query: DtuPageQuery) => Promise<DtuListBody | null | undefined>,
) {
  return listAllDtuPages(fetchPage, { pageSize: LIST_PAGE_SIZE });
}

/** Council's debate pair only reads the row id. */
export type CouncilDtu = {
  id: string;
};

export function councilDtusFromRows(rows: readonly DtuRow[]): CouncilDtu[] {
  const out: CouncilDtu[] = [];
  for (const row of sortDtusNewest(rows)) {
    if (typeof row.id === 'string' && row.id.length > 0) out.push({ id: row.id });
  }
  return out;
}

/** Council debate pool. Newest first, including rows past the first page. */
export async function loadCouncilDtus(
  fetchPage: (query: DtuPageQuery) => Promise<DtuListBody | null | undefined>,
): Promise<{ dtus: CouncilDtu[]; total: number }> {
  const page = await listAllDtuPages(fetchPage, { pageSize: LIST_PAGE_SIZE });
  return { total: page.total, dtus: councilDtusFromRows(page.dtus) };
}

export function tagsFromDtuRows(rows: Array<{ tags?: string[] }>): string[] {
  const tags = new Set<string>();
  for (const row of rows) {
    for (const tag of row.tags || []) {
      if (tag) tags.add(String(tag));
    }
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}

/** Board tag index. Tags that exist only on older pages are included. */
export async function loadBoardTags(
  fetchPage: (query: DtuPageQuery) => Promise<DtuListBody | null | undefined>,
) {
  const page = await listAllDtuPages(fetchPage, { pageSize: LIST_PAGE_SIZE });
  return tagsFromDtuRows(page.dtus);
}

export type FeedTopic = { id: string; tag: string; category: string; posts: number };

/** Rank DTU tags by how many rows carry them. */
export function topicsFromDtuTags(rows: Array<{ tags?: string[] }>, limit = 5): FeedTopic[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const tag of row.tags || []) {
      if (!tag) continue;
      const key = String(tag);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tag, posts], i) => ({
      id: `t-${i}`,
      tag: `#${tag}`,
      category: TOPIC_CATEGORIES[i % TOPIC_CATEGORIES.length],
      posts,
    }));
}

/** Feed trending fallback. Counts tags across every page, then keeps five. */
export async function loadFeedTopics(
  fetchPage: (query: DtuPageQuery) => Promise<DtuListBody | null | undefined>,
) {
  const page = await listAllDtuPages(fetchPage, { pageSize: LIST_PAGE_SIZE });
  return topicsFromDtuTags(page.dtus, 5);
}

/** One page of Scope controls. `page` is 0-based. */
export function scopeDtuQuery(activeScope: string, page: number): ScopeDtuQuery {
  const limit = SCOPE_PAGE_SIZE;
  const offset = Math.max(0, page) * limit;
  if (activeScope === 'all') return { via: 'dtus', params: { limit, offset } };
  if (activeScope === 'local' || activeScope === 'global') {
    return { via: 'dtus', params: { limit, offset, scope: activeScope } };
  }
  return { via: 'scope', scope: activeScope, params: { limit, offset } };
}

/** Walk every scope page. Same query the controls send for each click. */
export async function loadScopePages(
  activeScope: string,
  fetchQuery: (query: ScopeDtuQuery) => Promise<DtuListBody | null | undefined>,
): Promise<DtuRow[]> {
  const out: DtuRow[] = [];
  const seen = new Set<string>();
  let page = 0;
  let total = Number.POSITIVE_INFINITY;
  while (page < 100 && page * SCOPE_PAGE_SIZE < total) {
    const body = await fetchQuery(scopeDtuQuery(activeScope, page));
    const rows = Array.isArray(body?.dtus) ? body.dtus : [];
    const reported = Number(body?.total);
    if (Number.isFinite(reported) && reported >= 0) total = reported;
    else if (rows.length < SCOPE_PAGE_SIZE) total = page * SCOPE_PAGE_SIZE + rows.length;

    let fresh = 0;
    for (const row of rows) {
      const id = row?.id != null ? String(row.id) : '';
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      out.push(row);
      fresh += 1;
    }
    if (rows.length === 0 || fresh === 0 || rows.length < SCOPE_PAGE_SIZE) break;
    page += 1;
  }
  return out;
}
