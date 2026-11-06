/**
 * /lenses/docs — workspace search (S3; Review 2 finding F2,
 * `silent wrong answers`).
 *
 * The server `docs-search` macro always filtered correctly (title +
 * block content). The workspace control ran it ONLY on Enter, so
 * typing accepted input and changed nothing — the page tree kept
 * listing every page whatever was typed (R2's A5 FAIL: a nonsense
 * query and a marker query both left the page listed).
 *
 * Pinned here: the search runs as the user types (debounced; Enter
 * still runs it immediately), a nonsense query lands on an explicit
 * empty state, and title/content queries return the page (A5).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const PAGES = [
  { id: 'pg1', title: 'PR2 Docs Review 2026-10-30', icon: '📄', parentId: null, blockCount: 1 },
  { id: 'pg2', title: 'Meeting notes', icon: '📄', parentId: null, blockCount: 1 },
];
const BLOCKS: Record<string, string[]> = {
  pg1: ['the markerword lives in this page body'],
  pg2: ['agenda and minutes'],
};

/** The macro's real semantics: title or block-content substring hit. */
function macroSearch(query: string) {
  const q = query.toLowerCase();
  const results = PAGES.filter(
    (p) => p.title.toLowerCase().includes(q) || (BLOCKS[p.id] ?? []).some((t) => t.toLowerCase().includes(q)),
  ).map((p) => ({ id: p.id, title: p.title, icon: p.icon, snippet: '' }));
  return { data: { ok: true, result: { results, count: results.length }, error: null } };
}

const lensRun = vi.fn(async (domain: string, action: string, input: Record<string, unknown> = {}) => {
  if (domain === 'docs' && action === 'page-list') {
    return { data: { ok: true, result: { pages: PAGES }, error: null } };
  }
  if (domain === 'docs' && action === 'docs-search') {
    return macroSearch(String(input.query ?? ''));
  }
  if (domain === 'docs' && action === 'comment-list') {
    return { data: { ok: true, result: { count: 0 }, error: null } };
  }
  if (domain === 'docs' && action === 'page-detail') {
    const p = PAGES.find((x) => x.id === input.id) ?? PAGES[0];
    return {
      data: {
        ok: true,
        result: { page: { ...p, blocks: (BLOCKS[p.id] ?? []).map((text, i) => ({ id: `b${i}`, type: 'paragraph', text, checked: false })) } },
        error: null,
      },
    };
  }
  return { data: { ok: true, result: {}, error: null } };
});

vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...(a as [string, string, Record<string, unknown>])),
  api: { get: vi.fn(), post: vi.fn() },
  apiHelpers: { dtus: { myDtus: vi.fn() } },
}));

vi.mock('@/components/docs/usePagePresence', () => ({
  usePagePresence: () => ({ cursors: [], ping: () => {} }),
}));

import { DocsWorkspace } from '@/components/docs/DocsWorkspace';

beforeEach(() => {
  vi.clearAllMocks();
});

async function renderWorkspace() {
  render(<DocsWorkspace />);
  // The tree lists both pages once page-list resolves.
  await screen.findByText(/Meeting notes/);
}

describe('DocsWorkspace search — typing filters (F2)', () => {
  it('a title query typed (no Enter) returns the page', async () => {
    await renderWorkspace();
    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'PR2 Docs Review' } });
    await screen.findByText(/1 results/);
    expect(screen.getByText(/PR2 Docs Review 2026-10-30/)).toBeTruthy();
    // The search actually ran against the macro.
    expect(lensRun.mock.calls.some((c) => c[0] === 'docs' && c[1] === 'docs-search')).toBe(true);
  });

  it('a nonsense query lands on an explicit empty state', async () => {
    await renderWorkspace();
    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'zzqqnonexistent' } });
    await screen.findByText(/0 results/);
    expect(screen.getByText(/No pages match/)).toBeTruthy();
    expect(screen.getByText(/zzqqnonexistent/)).toBeTruthy();
    expect(screen.queryByText(/PR2 Docs Review 2026-10-30/)).toBeNull();
  });

  it('a content-word query finds the page by its body', async () => {
    await renderWorkspace();
    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'markerword' } });
    await screen.findByText(/1 results/);
    expect(screen.getByText(/PR2 Docs Review 2026-10-30/)).toBeTruthy();
  });

  it('clearing the query restores the full tree', async () => {
    await renderWorkspace();
    const input = screen.getByPlaceholderText('Search');
    fireEvent.change(input, { target: { value: 'zzqqnonexistent' } });
    await screen.findByText(/0 results/);
    fireEvent.change(input, { target: { value: '' } });
    await waitFor(() => expect(screen.getByText(/Meeting notes/)).toBeTruthy());
    expect(screen.queryByText(/0 results/)).toBeNull();
  });
});
