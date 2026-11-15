/**
 * GraphField "Find a node" — suggestions track the current query
 * (FIX-graph-003).
 *
 * The dropdown used to key entirely on the debounced query: while the
 * debounce/fetch caught up, the PREVIOUS query's suggestions (or its
 * no-match line) stayed on screen under the new text; clearing the box
 * left them standing until the debounce fired; and the list carried no
 * z-index over the field's z-10 chrome, so it could paint underneath
 * it. These pins hold the corrected contract: results render only when
 * they belong to the exact text in the box, a Searching row shows
 * while they don't, and clearing resets at once.
 *
 * Real timers with a poll settle: the debounce is a real 250 ms and
 * react-query's notification scheduling does not complete under fake
 * timers in this harness.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const search = vi.fn();
const force = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    graph: {
      search: (...a: unknown[]) => search(...(a as [string, number])),
      force: (...a: unknown[]) => force(...(a as [Record<string, unknown>])),
    },
    dtus: { create: vi.fn(async () => ({ data: { ok: true, id: 'n-new' } })) },
  },
}));
vi.mock('@/components/dtu/DTUDetailView', () => ({ DTUDetailView: () => null }));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({
  withContentLicense: (x: unknown) => x,
}));

import { GraphField } from '@/components/graph/GraphField';

const RESULTS: Record<string, { id: string; title: string; tier: string }[]> = {
  alpha: [{ id: 'n-alpha', title: 'Alpha node', tier: 'canonical' }],
  beta: [{ id: 'n-beta', title: 'Beta node', tier: 'canonical' }],
  zzzz: [],
};

function renderField() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GraphField />
    </QueryClientProvider>,
  );
}
// Poll until the predicate holds (the 250 ms debounce + fetch settle).
async function until(pred: () => boolean, ms = 2500) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('until: timed out');
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  }
}

beforeEach(() => {
  search.mockReset();
  force.mockReset();
  force.mockImplementation(async () => ({ data: { ok: true, nodes: [], links: [] } }));
  search.mockImplementation(async (q: string) => ({ data: { results: RESULTS[q] ?? [] } }));
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(() => cleanup());

describe('GraphField find-a-node suggestions (FIX-graph-003)', () => {
  it('suggestions track the text in the box — never the previous query', async () => {
    renderField();
    const input = screen.getByLabelText('Find a node');
    fireEvent.change(input, { target: { value: 'alpha' } });
    await until(() => !!screen.queryByText('Alpha node'));
    expect(screen.getByText('Alpha node').closest('ul')?.className).toContain('z-20');

    // Retype: the old suggestions must leave at once, replaced by the
    // pending row for the NEW text — not linger through the debounce.
    fireEvent.change(input, { target: { value: 'beta' } });
    expect(screen.queryByText('Alpha node')).toBeNull();
    expect(screen.getByText('Searching for “beta”…')).toBeInTheDocument();
    await until(() => !!screen.queryByText('Beta node'));
    expect(screen.queryByText('Searching for “beta”…')).toBeNull();
  });

  it('clearing the box resets at once — no suggestions, no pending row, no stale no-match', async () => {
    renderField();
    const input = screen.getByLabelText('Find a node');
    fireEvent.change(input, { target: { value: 'alpha' } });
    await until(() => !!screen.queryByText('Alpha node'));
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.queryByText('Alpha node')).toBeNull();
    expect(screen.queryByText(/Searching for/)).toBeNull();
    expect(screen.queryByText(/No node matches/)).toBeNull();
  });

  it('a no-match line names the current query and leaves the moment the text changes', async () => {
    renderField();
    const input = screen.getByLabelText('Find a node');
    fireEvent.change(input, { target: { value: 'zzzz' } });
    await until(() => !!screen.queryByText('No node matches “zzzz”.'));
    fireEvent.change(input, { target: { value: 'alpha' } });
    expect(screen.queryByText(/No node matches/)).toBeNull();
    await until(() => !!screen.queryByText('Alpha node'));
  });
});
