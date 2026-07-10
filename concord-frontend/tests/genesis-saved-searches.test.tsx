/**
 * SavedSearchesPanel — pins two real bugs found + fixed in the Wave-3
 * genesis-lens audit (2026-07-10):
 *
 * 1. The stored shape from `genesis.search-save` nests filters under
 *    `.filters.{query,role,state,focus}` (server/domains/genesis.js) — the
 *    component previously read flat `s.query`/`s.role` fields that never
 *    existed on the returned object, so the saved-search summary always
 *    rendered blank.
 * 2. `onRun` existed as a prop but `app/lenses/genesis/page.tsx` never
 *    passed a handler, so clicking a saved search did nothing. This test
 *    exercises the component directly (the way it's actually wired now,
 *    with `currentFilters`/`onRun` supplied by the parent) rather than
 *    re-asserting the page's own wiring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { SavedSearchesPanel } from '@/components/genesis/SavedSearchesPanel';

function withNestedFilters() {
  return {
    ok: true,
    result: {
      searches: [
        {
          id: 'gs_1',
          label: 'Active scholars',
          filters: { query: '', role: 'scholar', state: 'active', focus: '' },
          createdAt: Date.now(),
        },
      ],
    },
  };
}

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('SavedSearchesPanel', () => {
  it('renders the filter summary from the nested `.filters` shape the backend actually returns (was blank before the fix)', async () => {
    lensRunMock.mockResolvedValue({ data: withNestedFilters() });
    render(<SavedSearchesPanel currentFilters={{ query: '', role: '', focus: '', state: 'all' }} />);

    await waitFor(() => expect(screen.getByText('Active scholars')).toBeInTheDocument());
    // The summary is derived from filters.role + filters.state — proves the
    // component is reading the real nested shape, not undefined flat fields.
    expect(screen.getByText('role:scholar · active')).toBeInTheDocument();
  });

  it('clicking a saved search calls onRun with the extracted, flattened filter set', async () => {
    lensRunMock.mockResolvedValue({ data: withNestedFilters() });
    const onRun = vi.fn();
    render(<SavedSearchesPanel currentFilters={{ query: '', role: '', focus: '', state: 'all' }} onRun={onRun} />);

    await waitFor(() => expect(screen.getByText('Active scholars')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Active scholars'));

    expect(onRun).toHaveBeenCalledWith({ query: '', role: 'scholar', focus: '', state: 'active' });
  });

  it('the run button is disabled (not silently inert) when no onRun handler is supplied', async () => {
    lensRunMock.mockResolvedValue({ data: withNestedFilters() });
    render(<SavedSearchesPanel currentFilters={{ query: '', role: '', focus: '', state: 'all' }} />);

    await waitFor(() => expect(screen.getByText('Active scholars')).toBeInTheDocument());
    expect(screen.getByText('Active scholars').closest('button')).toBeDisabled();
  });

  it('"Save current filters" is disabled with no active roster filters, and enabled once one is set', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { searches: [] } } });
    const { rerender } = render(
      <SavedSearchesPanel currentFilters={{ query: '', role: '', focus: '', state: 'all' }} />,
    );
    await waitFor(() => expect(screen.getByText(/No saved searches yet/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Save current filters/i })).toBeDisabled();

    rerender(<SavedSearchesPanel currentFilters={{ query: '', role: 'mentor', focus: '', state: 'all' }} />);
    fireEvent.change(screen.getByPlaceholderText('Label this search'), { target: { value: 'Mentors' } });
    expect(screen.getByRole('button', { name: /Save current filters/i })).not.toBeDisabled();
  });

  it('saving sends the full current filter set (query/role/focus/state) to genesis.search-save, not just a typed query', async () => {
    lensRunMock.mockImplementation((_domain: string, action: string) => {
      if (action === 'search-list') return Promise.resolve({ data: { ok: true, result: { searches: [] } } });
      if (action === 'search-save') return Promise.resolve({ data: { ok: true, result: {} } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(
      <SavedSearchesPanel currentFilters={{ query: 'topology', role: 'scholar', focus: 'math', state: 'active' }} />,
    );
    await waitFor(() => expect(screen.getByText(/No saved searches yet/)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Label this search'), { target: { value: 'My scholars' } });
    fireEvent.click(screen.getByRole('button', { name: /Save current filters/i }));

    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('genesis', 'search-save', {
        label: 'My scholars',
        query: 'topology',
        role: 'scholar',
        focus: 'math',
        state: 'active',
      }),
    );
  });
});
