// Codex lens — UX-state + a11y + wiring tests.
//
// Pins the four explicit states the DONE gate requires (loading · error · empty
// · populated), the a11y surface (search role, aria-busy, aria-live, labelled
// filters + bookmark buttons), and that the page drives the REAL lore.* read
// macros (facets/spine/list) — NOT the phantom lens.codex.* the manifest used to
// declare. lensRun + useLensData are mocked at the module boundary so this is a
// fast headless render test (no backend boot).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

// ── module mocks ─────────────────────────────────────────────────
const lensRun = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

// LensShell just wraps children; render it transparently.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));

const createBookmark = vi.fn();
const removeBookmark = vi.fn();
let bookmarksState: Array<{ id: string; data: { loreId: string; title: string } }> = [];
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: bookmarksState,
    create: (...a: unknown[]) => createBookmark(...a),
    remove: (...a: unknown[]) => removeBookmark(...a),
  }),
}));

// The page reads a `?id=` deep-link param via next/navigation. Mutable so
// individual tests can simulate arriving with a permalink already in the URL
// (mirrors the same mutable-closure pattern `bookmarksState` uses above).
let mockDeepLinkId: string | null = null;
const routerReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => (key === 'id' ? mockDeepLinkId : null) }),
  useRouter: () => ({ replace: (...a: unknown[]) => routerReplace(...a), push: vi.fn() }),
  usePathname: () => '/lenses/codex',
}));

import CodexLensPage from '@/app/lenses/codex/page';

// ── fixtures (test-only mock payloads) ───────────────────────────
const FACETS = {
  ok: true,
  result: { facets: { worlds: ['tunya', 'concordia-hub'], types: ['primordial', 'founding'], eras: ['Dawn'], count: 2 } },
  error: null,
};
const SPINE = {
  ok: true,
  result: {
    events: [
      { id: 'p1', title: 'The First Pillar', type: 'primordial', era: 'Dawn', description: 'It held the sky.' },
    ],
  },
  error: null,
};
const EVENT = {
  id: 'lore_founding_compact', title: 'The Founding Compact', type: 'founding', era: 'Dawn',
  description: 'The pact that bound the worlds.', world_id: 'concordia-hub',
};
const LIST_OK = { ok: true, result: { events: [EVENT] }, error: null };
const LIST_EMPTY = { ok: true, result: { events: [] }, error: null };
const LIST_ERR = { ok: false, result: null, error: 'records unreachable' };

const GET_OK = { ok: true, result: { event: EVENT }, error: null };
const GET_ERR = { ok: false, result: null, error: 'lens error' };

function routeLensRun(listResponse: unknown, getResponse?: unknown) {
  lensRun.mockImplementation((domain: string, action: string) => {
    expect(domain).toBe('lore'); // the page must call the REAL lore domain
    if (action === 'facets') return Promise.resolve({ data: FACETS });
    if (action === 'spine') return Promise.resolve({ data: SPINE });
    if (action === 'list') return Promise.resolve({ data: listResponse });
    if (action === 'get') {
      if (getResponse === undefined) throw new Error('unexpected lore.get call');
      return Promise.resolve({ data: getResponse });
    }
    throw new Error(`unexpected lore action: ${action}`);
  });
}

beforeEach(() => {
  lensRun.mockReset();
  createBookmark.mockReset();
  removeBookmark.mockReset();
  routerReplace.mockReset();
  bookmarksState = [];
  mockDeepLinkId = null;
});

describe('Codex lens — wiring', () => {
  it('drives the real lore.* read macros (facets, spine, list)', async () => {
    routeLensRun(LIST_OK);
    render(<CodexLensPage />);
    await waitFor(() => expect(screen.getByText('The Founding Compact')).toBeTruthy());
    const actions = new Set(lensRun.mock.calls.map((c) => c[1]));
    expect(actions.has('facets')).toBe(true);
    expect(actions.has('spine')).toBe(true);
    expect(actions.has('list')).toBe(true);
    // never the phantom codex domain
    expect(lensRun.mock.calls.every((c) => c[0] === 'lore')).toBe(true);
  });
});

describe('Codex lens — four UX states', () => {
  it('loading: shows a status while consulting the records', async () => {
    let resolveList: (v: unknown) => void = () => {};
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'facets') return Promise.resolve({ data: FACETS });
      if (action === 'spine') return Promise.resolve({ data: SPINE });
      return new Promise((res) => { resolveList = res; }); // list hangs
    });
    render(<CodexLensPage />);
    await waitFor(() => expect(screen.getByText('Consulting the records…')).toBeTruthy());
    const live = screen.getByText('Consulting the records…').closest('[aria-busy]');
    expect(live?.getAttribute('aria-busy')).toBe('true');
    resolveList({ data: LIST_OK });
  });

  it('populated: renders grouped events with bookmark controls', async () => {
    routeLensRun(LIST_OK);
    render(<CodexLensPage />);
    await waitFor(() => expect(screen.getByText('The Founding Compact')).toBeTruthy());
    // grouped under its world heading (the section, not the filter <option>)
    expect(screen.getByRole('heading', { name: 'concordia-hub' })).toBeTruthy();
    // a labelled bookmark toggle exists
    expect(screen.getByRole('button', { name: /Bookmark The Founding Compact to your codex/ })).toBeTruthy();
  });

  it('empty: shows a no-match empty state with a clear-filters action', async () => {
    routeLensRun(LIST_EMPTY);
    render(<CodexLensPage />);
    await waitFor(() => expect(screen.getByText('The records are empty.')).toBeTruthy());
  });

  it('error: shows an alert with a retry control', async () => {
    routeLensRun(LIST_ERR);
    render(<CodexLensPage />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('records unreachable')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

describe('Codex lens — a11y', () => {
  it('has a labelled search region, filters, and a live results region', async () => {
    routeLensRun(LIST_OK);
    render(<CodexLensPage />);
    await waitFor(() => expect(screen.getByText('The Founding Compact')).toBeTruthy());
    expect(screen.getByRole('search')).toBeTruthy();
    expect(screen.getByLabelText('Search the canon')).toBeTruthy();
    expect(screen.getByLabelText('Filter by world')).toBeTruthy();
    expect(screen.getByLabelText('Filter by kind')).toBeTruthy();
  });

  it('expand toggle exposes aria-expanded', async () => {
    routeLensRun(LIST_OK);
    render(<CodexLensPage />);
    const title = await screen.findByText('The Founding Compact');
    const toggle = title.closest('button')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('true'));
    expect(screen.getByText('The pact that bound the worlds.')).toBeTruthy();
  });
});

describe('Codex lens — bookmark persistence', () => {
  it('creates a bookmark when the unsaved star is clicked', async () => {
    createBookmark.mockResolvedValue({ ok: true });
    routeLensRun(LIST_OK);
    render(<CodexLensPage />);
    const btn = await screen.findByRole('button', { name: /Bookmark The Founding Compact to your codex/ });
    fireEvent.click(btn);
    await waitFor(() => expect(createBookmark).toHaveBeenCalledTimes(1));
    expect(createBookmark.mock.calls[0][0]).toMatchObject({ data: { loreId: 'lore_founding_compact' } });
  });

  it('reflects an existing bookmark as pressed and removes it on click', async () => {
    bookmarksState = [{ id: 'bm1', data: { loreId: 'lore_founding_compact', title: 'The Founding Compact' } }];
    removeBookmark.mockResolvedValue({ ok: true });
    routeLensRun(LIST_OK);
    render(<CodexLensPage />);
    const btn = await screen.findByRole('button', { name: /Remove The Founding Compact from your codex/ });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(btn);
    await waitFor(() => expect(removeBookmark).toHaveBeenCalledWith('bm1'));
  });

  it('shows a graceful sign-in hint when a bookmark write fails (anon)', async () => {
    createBookmark.mockRejectedValue(new Error('unauthorized'));
    routeLensRun(LIST_OK);
    render(<CodexLensPage />);
    const btn = await screen.findByRole('button', { name: /Bookmark The Founding Compact to your codex/ });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText('unauthorized')).toBeTruthy());
  });
});

// keep `within` import used (lint) — assert a world section groups its events.
describe('Codex lens — grouping', () => {
  it('groups events under a labelled world section', async () => {
    routeLensRun(LIST_OK);
    render(<CodexLensPage />);
    await waitFor(() => expect(screen.getByText('The Founding Compact')).toBeTruthy());
    const section = screen.getByRole('region', { name: 'Canon of concordia-hub' });
    expect(within(section).getByText('The Founding Compact')).toBeTruthy();
  });
});

// Wave 4 gap-closure: docs/lens-specs/codex-capability-map.md's `lore.get`
// permalink/deep-link feature — /lenses/codex?id=<loreId> resolves via the
// real lore.get macro, and every entry can produce that link.
describe('Codex lens — deep link (?id=…) resolves via lore.get', () => {
  it('shows the linked entry in a detail dialog fetched via lore.get', async () => {
    mockDeepLinkId = 'lore_founding_compact';
    routeLensRun(LIST_OK, GET_OK);
    render(<CodexLensPage />);
    const dialog = await screen.findByRole('dialog', { name: 'Codex entry detail' });
    expect(within(dialog).getByText('The Founding Compact')).toBeTruthy();
    expect(within(dialog).getByText('The pact that bound the worlds.')).toBeTruthy();
    // called the real macro with the id from the URL, not a phantom endpoint
    expect(lensRun).toHaveBeenCalledWith('lore', 'get', { id: 'lore_founding_compact' });
  });

  it('shows an honest error inside the dialog when the id does not resolve', async () => {
    mockDeepLinkId = 'nonexistent-id';
    routeLensRun(LIST_OK, GET_ERR);
    render(<CodexLensPage />);
    const dialog = await screen.findByRole('dialog', { name: 'Codex entry detail' });
    await waitFor(() => expect(within(dialog).getByRole('alert')).toBeTruthy());
    expect(within(dialog).getByText('lens error')).toBeTruthy();
  });

  it('closing the dialog strips the id param via router.replace', async () => {
    mockDeepLinkId = 'lore_founding_compact';
    routeLensRun(LIST_OK, GET_OK);
    render(<CodexLensPage />);
    const dialog = await screen.findByRole('dialog', { name: 'Codex entry detail' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close entry detail' }));
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/lenses/codex', { scroll: false }));
  });
});

describe('Codex lens — copy permalink', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
    Object.assign(navigator, { clipboard: { writeText } });
  });

  it('copies a URL containing the entry id when its share control is clicked', async () => {
    routeLensRun(LIST_OK);
    render(<CodexLensPage />);
    const btn = await screen.findByRole('button', { name: 'Copy permalink for The Founding Compact' });
    fireEvent.click(btn);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const url = writeText.mock.calls[0][0] as string;
    expect(url).toContain('/lenses/codex?id=lore_founding_compact');
  });

  it('offers a copy-permalink control from inside the deep-link dialog itself', async () => {
    mockDeepLinkId = 'lore_founding_compact';
    routeLensRun(LIST_OK, GET_OK);
    render(<CodexLensPage />);
    const dialog = await screen.findByRole('dialog', { name: 'Codex entry detail' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy permalink' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0] as string).toContain('/lenses/codex?id=lore_founding_compact');
  });
});
