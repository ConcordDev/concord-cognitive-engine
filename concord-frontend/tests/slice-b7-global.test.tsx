// @vitest-environment jsdom
/**
 * Slice B7 — FIX-global-007: saved views gain a name at save time and a
 * rename afterwards. The saver types a name (empty keeps the auto-name);
 * each saved row's Rename opens an inline form wired to global.renameView.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));
vi.mock('@/components/global/ChoroplethMap', () => ({ ChoroplethMap: () => null }));
vi.mock('@/components/global/IndicatorPicker', () => ({ IndicatorPicker: () => null }));
vi.mock('@/components/global/CountryPicker', () => ({ CountryPicker: () => null }));

import { DataExplorer } from '@/components/global/DataExplorer';

interface ViewRec { id: string; mode: string; label: string; config: Record<string, unknown>; createdAt: string }
let serverViews: ViewRec[] = [];
const calls: Array<{ action: string; params: Record<string, unknown> }> = [];

function ok(result: unknown) { return { data: { ok: true, result, error: null } }; }

function mockBackend() {
  lensRunMock.mockImplementation(async (_domain: string, action: string, params: Record<string, unknown> = {}) => {
    calls.push({ action, params });
    if (action === 'listViews') return ok({ views: [...serverViews], total: serverViews.length });
    if (action === 'saveView') {
      const view = params.view as { mode: string; label: string; config: Record<string, unknown> };
      const rec: ViewRec = { id: `gv_test_${serverViews.length + 1}`, mode: view.mode, label: view.label, config: view.config || {}, createdAt: new Date().toISOString() };
      serverViews = [rec, ...serverViews];
      return ok({ saved: rec, shareLink: `/lenses/global?view=${rec.id}`, total: serverViews.length });
    }
    if (action === 'renameView') {
      const v = serverViews.find((x) => x.id === params.id);
      if (!v) return { data: { ok: false, result: null, error: 'Saved view not found.' } };
      v.label = String(params.label);
      return ok({ saved: v, total: serverViews.length });
    }
    if (action === 'deleteView') { serverViews = serverViews.filter((v) => v.id !== params.id); return ok({ deleted: params.id, total: serverViews.length }); }
    return { data: { ok: false, result: null, error: 'not in this test' } };
  });
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DataExplorer /></QueryClientProvider>);
}

beforeEach(() => { serverViews = []; calls.length = 0; lensRunMock.mockReset(); mockBackend(); });
afterEach(() => cleanup());

describe('FIX-global-007 saved-view naming', () => {
  it('the typed view name is sent as the save label', async () => {
    mount();
    fireEvent.change(await screen.findByLabelText('View name'), { target: { value: 'Spain deep dive' } });
    fireEvent.click(screen.getByRole('button', { name: /Save view/ }));
    await waitFor(() => expect(calls.some((c) => c.action === 'saveView')).toBe(true));
    const save = calls.find((c) => c.action === 'saveView')!;
    expect((save.params.view as { label: string }).label).toBe('Spain deep dive');
    expect(await screen.findByText('Spain deep dive')).toBeTruthy();
  });

  it('rename rewrites the saved label through renameView', async () => {
    serverViews = [{ id: 'gv_1', mode: 'profile', label: 'Country Profile: ESP · NY.GDP.PCAP.CD', config: { country: 'ESP' }, createdAt: new Date().toISOString() }];
    mount();
    fireEvent.click(await screen.findByLabelText('Rename view Country Profile: ESP · NY.GDP.PCAP.CD'));
    fireEvent.change(await screen.findByLabelText('New view name'), { target: { value: 'Iberia notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.action === 'renameView')).toBe(true));
    expect(calls.find((c) => c.action === 'renameView')!.params).toMatchObject({ id: 'gv_1', label: 'Iberia notes' });
    expect(await screen.findByText('Iberia notes')).toBeTruthy();
  });
});
