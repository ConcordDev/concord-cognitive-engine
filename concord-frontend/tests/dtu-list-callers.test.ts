import { describe, expect, it } from 'vitest';
import {
  LIST_PAGE_SIZE,
  SCOPE_PAGE_SIZE,
  loadBoardTags,
  loadCouncilDtus,
  loadExportDtus,
  loadFeedTopics,
  loadScopePages,
  scopeDtuQuery,
  type DtuListBody,
  type DtuPageQuery,
  type DtuRow,
  type ScopeDtuQuery,
} from '@/lib/dtu/list-pages';

function rows(n: number, map?: (i: number) => Partial<DtuRow>): DtuRow[] {
  return Array.from({ length: n }, (_, i) => ({ id: `row-${i}`, ...map?.(i) }));
}

function paged(all: DtuRow[]) {
  const calls: DtuPageQuery[] = [];
  const fetchPage = async (query: DtuPageQuery): Promise<DtuListBody> => {
    calls.push(query);
    return {
      dtus: all.slice(query.offset, query.offset + query.limit),
      total: all.length,
      limit: query.limit,
      offset: query.offset,
    };
  };
  return { calls, fetchPage };
}

describe('DTU list callers page past the default 50', () => {
  it('export walks every page and keeps the last row', async () => {
    const all = rows(LIST_PAGE_SIZE + 1);
    const { calls, fetchPage } = paged(all);
    const loaded = await loadExportDtus(fetchPage);
    expect(calls.map((c) => c.limit)).toEqual([LIST_PAGE_SIZE, LIST_PAGE_SIZE]);
    expect(calls.map((c) => c.offset)).toEqual([0, LIST_PAGE_SIZE]);
    expect(loaded.dtus).toHaveLength(all.length);
    expect(loaded.dtus.at(-1)?.id).toBe(all.at(-1)?.id);
    expect(loaded.total).toBe(all.length);
  });

  it('council keeps older pages and sorts the newest row first', async () => {
    const all = rows(LIST_PAGE_SIZE + 1, (i) => ({ createdAt: `2020-01-${String((i % 28) + 1).padStart(2, '0')}` }));
    all[all.length - 1] = { id: 'newest', createdAt: '2024-06-01T00:00:00.000Z' };
    const { calls, fetchPage } = paged(all);
    const loaded = await loadCouncilDtus(fetchPage);
    expect(calls).toHaveLength(2);
    expect(loaded.dtus).toHaveLength(all.length);
    expect(loaded.dtus[0]?.id).toBe('newest');
    expect(loaded.dtus.some((d) => d.id === 'row-0')).toBe(true);
  });

  it('board tags include a tag that exists only past the first page', async () => {
    const all = rows(LIST_PAGE_SIZE + 1, () => ({ tags: ['fresh'] }));
    all[all.length - 1] = { id: 'old', tags: ['archive-only'] };
    const loaded = await loadBoardTags(paged(all).fetchPage);
    expect(loaded).toContain('fresh');
    expect(loaded).toContain('archive-only');
  });

  it('feed topics count a tag that exists only past the first page', async () => {
    const all = [
      ...rows(LIST_PAGE_SIZE, (i) => ({ tags: [`solo-${i}`] })),
      ...rows(10, (i) => ({ id: `old-${i}`, tags: ['archive'] })),
    ];
    const { calls, fetchPage } = paged(all);
    const topics = await loadFeedTopics(fetchPage);
    expect(calls.length).toBeGreaterThan(1);
    expect(topics[0]).toMatchObject({ tag: '#archive', posts: 10 });
    expect(topics.some((t) => t.tag === '#archive')).toBe(true);
  });

  it('scope controls request an explicit page and a walk reaches every row', async () => {
    expect(scopeDtuQuery('all', 0)).toEqual({ via: 'dtus', params: { limit: SCOPE_PAGE_SIZE, offset: 0 } });
    expect(scopeDtuQuery('global', 2)).toEqual({
      via: 'dtus',
      params: { limit: SCOPE_PAGE_SIZE, offset: 100, scope: 'global' },
    });
    expect(scopeDtuQuery('local', 1)).toEqual({
      via: 'dtus',
      params: { limit: SCOPE_PAGE_SIZE, offset: SCOPE_PAGE_SIZE, scope: 'local' },
    });
    expect(scopeDtuQuery('marketplace', 1)).toEqual({
      via: 'scope',
      scope: 'marketplace',
      params: { limit: SCOPE_PAGE_SIZE, offset: SCOPE_PAGE_SIZE },
    });

    const all = rows(120);
    const seen: ScopeDtuQuery[] = [];
    const loaded = await loadScopePages('all', async (query) => {
      seen.push(query);
      if (query.via !== 'dtus') throw new Error('all uses the DTU list');
      return {
        dtus: all.slice(query.params.offset, query.params.offset + query.params.limit),
        total: all.length,
        limit: query.params.limit,
        offset: query.params.offset,
      };
    });
    expect(seen.map((q) => (q.via === 'dtus' ? q.params.offset : -1))).toEqual([0, 50, 100]);
    expect(loaded.map((d) => d.id)).toEqual(all.map((d) => d.id));
  });
});
