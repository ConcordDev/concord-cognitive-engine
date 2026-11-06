/**
 * Connective tissue bar — Search DTUs finds what Publish wrote
 * (S3; Review 2 finding F5, `unwired/unreachable surfaces`).
 *
 * The split, verified in code: Publish writes via the `dtu create`
 * lens action into STATE.dtus (the write-through `dtu_store`),
 * stamped visibility 'private' + domain/lens/tags of the lens. The
 * bar's search read only GET /api/ct/search — the SQL `dtus` table
 * under a hard `status='published'` filter, on a public route with
 * no viewer identity. A just-published DTU was unfindable by
 * construction: wrong store AND a status a private publish never
 * takes (R2's A10 FAIL, verbatim "No DTUs matched that search."
 * minutes after a successful publish).
 *
 * Pinned here: the panel ALSO runs the `dtu search` lens action —
 * the viewer-scoped search over the publish store (own DTUs at any
 * visibility; title/tags/content) — scopes its hits to the lens by
 * the fields Publish stamps, and merges them with the public index
 * results, deduped by id. The publish→search loop closes through
 * the real components against a mocked store with the real
 * actions' semantics; the public index leg returns nothing, exactly
 * as it does for a private DTU.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

interface StoredDtu {
  id: string; title: string; content: string; visibility: string;
  domain?: string; lens?: string; meta?: { lens?: string }; tags?: string[];
}

const store = vi.hoisted(() => new Map<string, StoredDtu>());
const addToast = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-1', username: 'ramaj', email: 'r@example.com', role: 'user' },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

vi.mock('@/hooks/useConnectiveTissue', () => ({
  useTip: () => ({ mutate: vi.fn(), isPending: false }),
  usePostBounty: () => ({ mutate: vi.fn(), isPending: false }),
  useForkDTU: () => ({ mutate: vi.fn(), isPending: false }),
  useMeritCredit: () => ({ data: undefined }),
  // The public index: published-only, a different store — it has
  // nothing for the private DTU this test publishes.
  useDTUSearch: () => ({ data: { data: { results: [] } } }),
}));

vi.mock('@/components/dtu/DTUDetailView', () => ({ DTUDetailView: () => null }));

vi.mock('@/store/ui', () => ({
  useUIStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  lensRun: vi.fn(async (domain: string, action: string, input: Record<string, unknown> = {}) => {
    if (domain === 'dtu' && action === 'create') {
      const record: StoredDtu = {
        id: 'dtu_just_published',
        title: String(input.title ?? ''),
        content: String(input.content ?? ''),
        visibility: String(input.visibility ?? ''),
        domain: String(input.domain ?? ''),
        lens: String(input.lens ?? ''),
        meta: (input.meta as StoredDtu['meta']) ?? {},
        tags: (input.tags as string[]) ?? [],
      };
      store.set(record.id, record);
      return { data: { ok: true, result: { ok: true, dtu: record }, error: null } };
    }
    if (domain === 'dtu' && action === 'get') {
      const dtu = store.get(String(input.id ?? ''));
      if (!dtu) return { data: { ok: false, result: null, error: 'DTU not found' } };
      return { data: { ok: true, result: { ok: true, dtu }, error: null } };
    }
    if (domain === 'dtu' && action === 'search') {
      // The real action: viewer-visible DTUs (the caller's own at
      // any visibility), matched on title / tags / content. No lens
      // filter server-side — lens scoping is the panel's job.
      const q = String(input.query ?? '').toLowerCase();
      const dtus = [...store.values()].filter(
        (d) => d.title.toLowerCase().includes(q) || d.content.toLowerCase().includes(q) || d.tags.some((t) => t.includes(q)),
      );
      return { data: { ok: true, result: { ok: true, dtus, total: dtus.length }, error: null } };
    }
    return { data: { ok: true, result: {}, error: null } };
  }),
}));

import {
  ConnectiveTissueBar, dtuBelongsToLens, mergeDtuSearchResults,
} from '@/components/lens/ConnectiveTissueBar';

const TITLE = 'PR2 Docs Review';
const CONTENT = 'the riverbanks marker body';

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

async function publishThenSearch(query: string) {
  render(
    <ConnectiveTissueBar
      lensId="docs"
      getPublishable={() => ({ title: TITLE, content: CONTENT })}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Publish DTU/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Publish$/ }));
  // Publish completes: the bar verifies the stored content and toasts.
  await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })));
  fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
  fireEvent.change(screen.getByPlaceholderText('Search docs DTUs'), { target: { value: query } });
}

describe('publish → search loop (F5 / A10)', () => {
  it('a just-published private DTU is findable by its exact title', async () => {
    await publishThenSearch(TITLE);
    await screen.findByText(TITLE);
    expect(screen.queryByText('No DTUs matched that search.')).toBeNull();
  });

  it('and by a word that appears only in its content', async () => {
    await publishThenSearch('riverbanks');
    await screen.findByText(TITLE);
  });

  it('a DTU stamped for another lens does not leak into this lens’s results', async () => {
    store.set('dtu_chat_one', {
      id: 'dtu_chat_one', title: TITLE, content: CONTENT, visibility: 'private',
      domain: 'chat', lens: 'chat', meta: { lens: 'chat' }, tags: ['chat'],
    });
    render(<ConnectiveTissueBar lensId="docs" getPublishable={() => ({ title: 'x', content: 'y' })} />);
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
    fireEvent.change(screen.getByPlaceholderText('Search docs DTUs'), { target: { value: TITLE } });
    await screen.findByText('No DTUs matched that search.');
    expect(screen.queryByText(TITLE)).toBeNull();
  });
});

describe('search helpers — lens scoping and merge', () => {
  it('dtuBelongsToLens accepts any of the fields Publish stamps', () => {
    expect(dtuBelongsToLens({ id: 'a', domain: 'docs' }, 'docs')).toBe(true);
    expect(dtuBelongsToLens({ id: 'a', lens: 'docs' }, 'docs')).toBe(true);
    expect(dtuBelongsToLens({ id: 'a', meta: { lens: 'docs' } }, 'docs')).toBe(true);
    expect(dtuBelongsToLens({ id: 'a', tags: ['docs'] }, 'docs')).toBe(true);
    expect(dtuBelongsToLens({ id: 'a', domain: 'chat', tags: ['chat'] }, 'docs')).toBe(false);
    expect(dtuBelongsToLens(null, 'docs')).toBe(false);
  });

  it('mergeDtuSearchResults dedupes by id and keeps both sources', () => {
    const merged = mergeDtuSearchResults(
      [{ id: 'x', title: 'Indexed', score: 0.9 }],
      [{ id: 'x', title: 'Own copy' }, { id: 'y', title: 'Own only' }],
    );
    expect(merged.map((r) => r.id)).toEqual(['x', 'y']);
    expect(merged[0].title).toBe('Indexed');
    expect(mergeDtuSearchResults(undefined, undefined)).toEqual([]);
  });
});
