/**
 * /lenses/saved — four-UX-state contract.
 *
 * Pins that the saved lens renders genuine loading (role=status) / error
 * (role=alert + a working Retry) / empty / populated states against the real
 * saved.* macro surface (driven by a mocked lensRun standing in for
 * POST /api/lens/run → server/domains/saved.js), plus a11y (the kind/state/
 * sort selects carry accessible names).
 *
 * No fabricated data: every state is driven by the exact { items, total,
 * matched } shape server/domains/saved.js#list returns.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';

// ── Mock the api client: lensRun is the only data path the lens uses. ────────
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  api: { get: vi.fn(() => Promise.resolve({ data: { ok: true, user: { id: 'u1' } } })) },
}));

// Heavy child components / shells are not under test here — stub to keep the
// render focused on the page's own four states. (No fake DATA is introduced;
// these are presentational shells.)
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/social/BookmarksList', () => ({ BookmarksList: () => null }));

import SavedLensPage from '@/app/lenses/saved/page';

const ITEM = {
  id: 'svd_1', kind: 'article', refId: null, title: 'Concord paper',
  url: 'https://x', author: 'A', excerpt: null, mediaType: 'text',
  folderId: null, tags: ['research'], note: '', state: 'unread',
  sourceLens: null, savedAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z', readAt: null,
};

// Resolves a lensRun call by (domain, action) so the page's parallel loads
// (folderList/stats/tags + list) all get a real shape.
function routeLensRun(listResult: Record<string, unknown> | { __error: string }) {
  return (_domain: string, action: string) => {
    if (action === 'list') {
      if ('__error' in listResult) {
        return Promise.resolve({ data: { ok: false, result: null, error: listResult.__error } });
      }
      return Promise.resolve({ data: { ok: true, result: listResult, error: null } });
    }
    if (action === 'folderList') return Promise.resolve({ data: { ok: true, result: { folders: [], unfiledCount: 0 }, error: null } });
    if (action === 'stats') return Promise.resolve({ data: { ok: true, result: { total: 0, folders: 0, byState: { unread: 0, read: 0, archived: 0 }, byKind: {}, byMediaType: {} }, error: null } });
    if (action === 'tags') return Promise.resolve({ data: { ok: true, result: { tags: [] }, error: null } });
    return Promise.resolve({ data: { ok: true, result: {}, error: null } });
  };
}

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('saved lens — four UX states', () => {
  it('LOADING: shows a role=status spinner while the list is in flight', async () => {
    // list never resolves → stuck loading; other loads resolve empty.
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'list') return new Promise(() => {});
      if (action === 'stats') return Promise.resolve({ data: { ok: true, result: { total: 0, folders: 0, byState: { unread: 0, read: 0, archived: 0 }, byKind: {}, byMediaType: {} }, error: null } });
      return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    });
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<SavedLensPage />); });
    const loading = view!.getByTestId('saved-loading');
    expect(loading).toBeInTheDocument();
    expect(loading).toHaveAttribute('role', 'status');
    expect(loading).toHaveAttribute('aria-busy', 'true');
  });

  it('ERROR: shows role=alert + a Retry that re-issues the list call', async () => {
    lensRunMock.mockImplementation(routeLensRun({ __error: 'boom' }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<SavedLensPage />); });

    await waitFor(() => expect(view!.getByTestId('saved-error')).toBeInTheDocument());
    expect(view!.getByTestId('saved-error')).toHaveAttribute('role', 'alert');
    expect(view!.getByTestId('saved-error').textContent).toMatch(/boom/);

    const listCallsBefore = lensRunMock.mock.calls.filter((c) => c[1] === 'list').length;
    await act(async () => { fireEvent.click(view!.getByText('Retry')); });
    const listCallsAfter = lensRunMock.mock.calls.filter((c) => c[1] === 'list').length;
    expect(listCallsAfter).toBeGreaterThan(listCallsBefore);
  });

  it('EMPTY: shows an honest empty state when nothing is saved', async () => {
    lensRunMock.mockImplementation(routeLensRun({ items: [], total: 0, matched: 0, offset: 0, limit: 200 }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<SavedLensPage />); });
    await waitFor(() => expect(view!.getByTestId('saved-empty')).toBeInTheDocument());
    expect(view!.getByTestId('saved-empty').textContent).toMatch(/nothing saved yet/i);
  });

  it('POPULATED: renders the saved item; filters carry accessible names (a11y)', async () => {
    lensRunMock.mockImplementation(routeLensRun({ items: [ITEM], total: 1, matched: 1, offset: 0, limit: 200 }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<SavedLensPage />); });
    await waitFor(() => expect(view!.getByTestId('saved-list')).toBeInTheDocument());
    expect(view!.getByTestId('saved-list').textContent).toMatch(/Concord paper/);
    // a11y: the filter/sort selects are labelled.
    expect(view!.getByLabelText('Filter by kind')).toBeInTheDocument();
    expect(view!.getByLabelText('Filter by state')).toBeInTheDocument();
    expect(view!.getByLabelText('Sort by')).toBeInTheDocument();
  });
});
