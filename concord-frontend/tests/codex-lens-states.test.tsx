// Codex lens — FOUR-UX-STATE gate (loading · error · empty · populated).
//
// LENS-ID ≠ DOMAIN: the lens dir is `codex` but the page drives the real
// `lore` backend domain (lensRun('lore', 'facets'|'spine'|'list')). The
// per-user bookmark store is the generic /api/lens/codex artifact endpoint via
// useLensData — both are real receivers, no phantom callers.
//
// This file complements tests/codex-lens.test.tsx (which pins wiring + a11y +
// bookmarks). Here we lock the FOUR explicit states precisely, with the exact
// ARIA roles the gate requires, and prove:
//   • loading  → role="status" inside an aria-busy region (no premature empty)
//   • error    → role="alert" + a Retry that RE-FIRES the list read
//   • empty    → a no-data / no-match CTA (clear-filters action present)
//   • populated→ grouped articles with the real title
//   • a NETWORK FAILURE (lensRun resolving ok:false) surfaces the alert, never a
//     silent-empty — the swallowed-fetch defect fixed across sibling lenses.
//
// lensRun + useLensData are mocked at the module boundary → fast headless render,
// no backend boot, no network.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
// Bookmark store is irrelevant to the four read-states — stub it empty.
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: [], create: vi.fn(), remove: vi.fn() }),
}));

import CodexLensPage from '@/app/lenses/codex/page';

// ── fixtures ─────────────────────────────────────────────────────
const FACETS = {
  ok: true,
  result: { facets: { worlds: ['concordia-hub', 'tunya'], types: ['founding', 'primordial'], eras: ['Year 0'], count: 1 } },
  error: null,
};
const SPINE = {
  ok: true,
  result: { events: [{ id: 'p1', title: 'The First Pillar', type: 'primordial', era: 'Dawn', description: 'It held the sky.' }] },
  error: null,
};
const EVENT = {
  id: 'lore_founding_compact', title: 'The Founding Compact', type: 'founding', era: 'Year 0',
  description: 'The pact that bound the worlds.', world_id: 'concordia-hub',
};
const LIST_OK = { ok: true, result: { events: [EVENT] }, error: null };
const LIST_EMPTY = { ok: true, result: { events: [] }, error: null };
const LIST_ERR = { ok: false, result: null, error: 'The records could not be consulted.' };

/** Route facets/spine to fixed fixtures; list returns the provided response. */
function routeList(listResponse: unknown) {
  lensRun.mockImplementation((domain: string, action: string) => {
    expect(domain).toBe('lore'); // page must hit the REAL lore domain, never `codex`
    if (action === 'facets') return Promise.resolve({ data: FACETS });
    if (action === 'spine') return Promise.resolve({ data: SPINE });
    if (action === 'list') return Promise.resolve({ data: listResponse });
    throw new Error(`unexpected lore action: ${action}`);
  });
}

beforeEach(() => { lensRun.mockReset(); });

describe('Codex lens — STATE 1: loading', () => {
  it('shows a role="status" while the list read is in flight, inside an aria-busy region', async () => {
    let resolveList: (v: unknown) => void = () => {};
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'facets') return Promise.resolve({ data: FACETS });
      if (action === 'spine') return Promise.resolve({ data: SPINE });
      return new Promise((res) => { resolveList = res; }); // list hangs → stuck loading
    });
    render(<CodexLensPage />);
    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/Consulting the records/i);
    const busyRegion = status.closest('[aria-busy]');
    expect(busyRegion?.getAttribute('aria-busy')).toBe('true');
    // It must NOT have prematurely rendered the empty state while loading.
    expect(screen.queryByText('The records are empty.')).toBeNull();
    resolveList({ data: LIST_OK });
  });
});

describe('Codex lens — STATE 2: error (+ working Retry)', () => {
  it('surfaces role="alert" with the backend message and a Retry control', async () => {
    routeList(LIST_ERR);
    render(<CodexLensPage />);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('The records could not be consulted.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('Retry RE-FIRES the list read and can recover into the populated state', async () => {
    // First list call errors; after Retry, the next list call succeeds.
    let listCalls = 0;
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'facets') return Promise.resolve({ data: FACETS });
      if (action === 'spine') return Promise.resolve({ data: SPINE });
      // list
      listCalls += 1;
      return Promise.resolve({ data: listCalls === 1 ? LIST_ERR : LIST_OK });
    });
    render(<CodexLensPage />);
    await screen.findByRole('alert');
    const listBefore = lensRun.mock.calls.filter((c) => c[1] === 'list').length;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    // Retry must issue ANOTHER list read (not a no-op).
    await waitFor(() =>
      expect(lensRun.mock.calls.filter((c) => c[1] === 'list').length).toBeGreaterThan(listBefore),
    );
    // …and recover into the populated state.
    await waitFor(() => expect(screen.getByText('The Founding Compact')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a NETWORK FAILURE (lensRun ok:false) surfaces the alert — never a silent-empty', async () => {
    // lensRun never throws; a transport failure arrives as { ok:false, error }.
    routeList({ ok: false, result: null, error: 'Network error' });
    render(<CodexLensPage />);
    await screen.findByRole('alert');
    // It must NOT have fallen through to the empty CTA (the swallowed-fetch bug).
    expect(screen.queryByText('The records are empty.')).toBeNull();
    expect(screen.getByText('Network error')).toBeTruthy();
  });
});

describe('Codex lens — STATE 3: empty (CTA)', () => {
  it('renders a no-data CTA when the canon is empty (no filters active)', async () => {
    routeList(LIST_EMPTY);
    render(<CodexLensPage />);
    await waitFor(() => expect(screen.getByText('The records are empty.')).toBeTruthy());
    // The unfiltered empty copy guides the operator (seeding hint), not a dead end.
    expect(screen.getByText(/has not been seeded for this instance/i)).toBeTruthy();
    // No alert, no loading status lingering.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a filtered no-match shows a Clear-filters CTA that re-broadens the search', async () => {
    routeList(LIST_EMPTY);
    render(<CodexLensPage />);
    // Apply a filter so hasFilters is true.
    fireEvent.change(screen.getByLabelText('Search the canon'), { target: { value: 'nothing-matches-xyz' } });
    await waitFor(() => expect(screen.getByText('No truths match this query.')).toBeTruthy());
    const clear = screen.getByRole('button', { name: 'Clear filters' });
    expect(clear).toBeTruthy();
    fireEvent.click(clear);
    await waitFor(() => expect((screen.getByLabelText('Search the canon') as HTMLInputElement).value).toBe(''));
  });
});

describe('Codex lens — STATE 4: populated', () => {
  it('renders the real authored event grouped under its world section', async () => {
    routeList(LIST_OK);
    render(<CodexLensPage />);
    await waitFor(() => expect(screen.getByText('The Founding Compact')).toBeTruthy());
    const section = screen.getByRole('region', { name: 'Canon of concordia-hub' });
    expect(within(section).getByText('The Founding Compact')).toBeTruthy();
    // No loading / error / empty surfaces remain.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('The records are empty.')).toBeNull();
  });
});
