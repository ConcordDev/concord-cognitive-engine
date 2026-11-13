// @vitest-environment jsdom
/**
 * FIX-global-008 — the Global page's "Saved Views" stat card kept
 * showing 1 after the only saved view was deleted. The card reads its
 * own react-query count; the explorer's save/delete refreshed only its
 * local list, so the card's count lagged until a reload. Saving or
 * deleting now invalidates the count query, and the card recounts at
 * once. The probe below mirrors the page's stat query exactly (same
 * key, same staleTime).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// Heavy sibling surfaces are not what this test exercises.
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));
vi.mock('@/components/global/ChoroplethMap', () => ({ ChoroplethMap: () => null }));
vi.mock('@/components/global/IndicatorPicker', () => ({ IndicatorPicker: () => null }));
vi.mock('@/components/global/CountryPicker', () => ({ CountryPicker: () => null }));

import { DataExplorer } from '@/components/global/DataExplorer';

interface ViewRec {
  id: string;
  mode: string;
  label: string;
  config: Record<string, unknown>;
  createdAt: string;
}

let serverViews: ViewRec[] = [];

function ok(result: unknown) {
  return { data: { ok: true, result, error: null } };
}

function mockBackend() {
  lensRunMock.mockImplementation(async (_domain: string, action: string, params: Record<string, unknown> = {}) => {
    if (action === 'listViews') return ok({ views: [...serverViews], total: serverViews.length });
    if (action === 'deleteView') {
      serverViews = serverViews.filter((v) => v.id !== params.id);
      return ok({ deleted: params.id, total: serverViews.length });
    }
    if (action === 'saveView') {
      const view = params.view as { mode: string; label: string; config: Record<string, unknown> };
      const rec: ViewRec = {
        id: `gv_test_${serverViews.length + 1}`,
        mode: view.mode,
        label: view.label,
        config: view.config || {},
        createdAt: new Date().toISOString(),
      };
      serverViews = [rec, ...serverViews];
      return ok({ saved: rec, shareLink: `/lenses/global?view=${rec.id}`, total: serverViews.length });
    }
    return { data: { ok: false, result: null, error: 'not in this test' } };
  });
}

// Mirrors app/lenses/global/page.tsx's Saved Views stat query.
function StatProbe() {
  const q = useQuery({
    queryKey: ['global-saved-views-count'],
    queryFn: () =>
      lensRunMock('global', 'listViews', {}).then(
        (r: { data: { ok: boolean; result?: { total: number } } }) => (r.data.ok ? r.data.result?.total ?? 0 : null),
      ),
    staleTime: 60000,
    retry: false,
  });
  return <div>Saved Views stat: {q.data ?? '—'}</div>;
}

function renderAll(qc: QueryClient) {
  return render(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(StatProbe),
      React.createElement(DataExplorer),
    ),
  );
}

describe('DataExplorer — Saved Views stat card follows save/delete (FIX-global-008)', () => {
  let qc: QueryClient;
  beforeEach(() => {
    lensRunMock.mockReset();
    serverViews = [];
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    mockBackend();
  });
  afterEach(() => {
    cleanup();
    qc.clear();
  });

  it('deleting the only view drops the stat to 0 with no reload', async () => {
    serverViews = [
      { id: 'gv_test_1', mode: 'compare', label: 'Compare: GDP', config: {}, createdAt: new Date().toISOString() },
    ];
    renderAll(qc);
    expect(await screen.findByText('Saved Views stat: 1')).toBeTruthy();
    expect(await screen.findByText('Compare: GDP')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete view' }));
    });

    await waitFor(() => expect(screen.getByText('Saved Views stat: 0')).toBeTruthy(), { timeout: 3000 });
    await waitFor(() => expect(screen.queryByText('Compare: GDP')).toBeNull(), { timeout: 3000 });
  });

  it('saving a view raises the stat to 1 with no reload', async () => {
    renderAll(qc);
    expect(await screen.findByText('Saved Views stat: 0')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save view/ }));
    });

    await waitFor(() => expect(screen.getByText('Saved Views stat: 1')).toBeTruthy(), { timeout: 3000 });
  });
});
