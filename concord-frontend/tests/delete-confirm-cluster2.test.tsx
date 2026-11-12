/**
 * Theme-5 sticky-confirm cluster 2 (FIX-fractal-007 · FIX-consulting-005 ·
 * FIX-global-014 · FIX-inheritance-005): fractal preset, consulting
 * engagement, global saved-view, and inheritance beneficiary/asset/executor
 * deletes no longer fire on the first click. First click arms a confirm
 * that NAMES the record (and, for an engagement with logged time, the
 * consequence) and sends nothing; Confirm sends the delete.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/components/viz', () => ({
  ChartKit: () => React.createElement('div', { 'data-testid': 'chart' }),
  TimelineView: () => React.createElement('div', { 'data-testid': 'timeline' }),
}));
vi.mock('@/components/global/IndicatorPicker', () => ({ IndicatorPicker: () => null }));
vi.mock('@/components/global/CountryPicker', () => ({ CountryPicker: () => null }));

// ── inheritance estate context ──────────────────────────────────────────────
const removeBeneficiary = vi.fn();
const removeAsset = vi.fn();
const removeExecutor = vi.fn();
const noop = () => {};
const estateValue = {
  beneficiaries: [{ id: 'b1', name: 'Nia Heir', relationship: 'daughter', sharePct: 50, heirUserId: null, contingentOn: '' }],
  assets: [{ id: 'a1', label: 'Lake House', category: 'property', valueCc: 5000, location: 'Poughkeepsie', notes: '' }],
  executors: [{ id: 'x1', name: 'Ed Executor', role: 'primary', consent: 'accepted' }],
  removeBeneficiary, removeAsset, removeExecutor,
  addBeneficiary: noop, addAsset: noop, assignExecutor: noop, respondConsent: noop, reShare: noop, notifyHeir: noop, loadAll: noop,
  loadAllRef: { current: null }, inp: 'inp', btn: 'btn', tone: () => '',
  loading: false, loadError: null, status: '', activeWill: null, intestacyResult: null,
  intestacyStates: [], intestacySelected: '', listings: [], locks: [], notices: [], pendingTransfers: [], wills: [], timeline: [], assetByCat: [], overview: null,
  notifyDraft: {}, notifyBusy: null, intestacyBusy: false, olBusy: false, escrowedCc: 0, remainderPct: 50,
  bName: '', bRel: '', bShare: '', bContingentOn: '', bHeir: '', wTitle: '', wBody: '', wKind: '',
  aLabel: '', aCat: '', aValue: '', aLoc: '', aNotes: '', eName: '', eRole: '', olNpc: '', olPrice: '',
} as Record<string, unknown>;
for (const k of ['setACat','setALabel','setALoc','setANotes','setAValue','setActiveWill','setAssetByCat','setAssets','setBContingentOn','setBHeir','setBName','setBRel','setBShare','setBeneficiaries','setEName','setERole','setEscrowedCc','setExecutors','setIntestacyBusy','setIntestacyResult','setIntestacySelected','setIntestacyStates','setListings','setLoadError','setLoading','setLocks','setNotices','setNotifyBusy','setNotifyDraft','setOlBusy','setOlNpc','setOlPrice','setOverview','setPendingTransfers','setRemainderPct','setStatus','setTimeline','setWBody','setWKind','setWTitle','setWills']) {
  estateValue[k] = noop;
}
vi.mock('@/components/inheritance/EstateContext', () => ({
  useEstate: () => estateValue,
}));

import { EngagementTracker } from '@/components/consulting/EngagementTracker';
import { FractalRenderer } from '@/components/fractal/FractalRenderer';
import { DataExplorer } from '@/components/global/DataExplorer';
import { BeneficiariesPanel } from '@/components/inheritance/BeneficiariesPanel';
import { AssetsPanel } from '@/components/inheritance/AssetsPanel';
import { ExecutorsPanel } from '@/components/inheritance/ExecutorsPanel';

const ENG = { id: 'e1', name: 'Harbor Engagement', client: 'Acme', rate: 100, budgetHours: 40, status: 'active', loggedHours: 2, billed: 200, utilizationPct: 5, timeEntries: [{ id: 't1', hours: 2, note: 'kickoff', date: '2026-11-01' }] };
const calls = () => lensRunMock.mock.calls.map((c) => ({ domain: c[0], action: c[1], input: (c[2] || {}) as Record<string, unknown> }));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

beforeEach(() => {
  lensRunMock.mockReset();
  removeBeneficiary.mockClear(); removeAsset.mockClear(); removeExecutor.mockClear();
  lensRunMock.mockImplementation(async (_d: string, action: string) => {
    const results: Record<string, unknown> = {
      'engagement-list': { engagements: [ENG] },
      'consulting-dashboard': { engagements: 1, active: 1, loggedHours: 2, billed: 200 },
      listPresets: { presets: [{ id: 'p1', name: 'Ember Drift', config: { type: 'mandelbrot' }, imported: false }] },
      listRenders: { renders: [] },
      paletteFor: { swatches: [{ rgb: [10, 20, 30] }, { rgb: [40, 50, 60] }] },
      listViews: { views: [{ id: 'v1', label: 'APAC View', createdAt: '2026-11-01T00:00:00.000Z' }] },
    };
    return { data: { ok: true, result: results[action] ?? {}, error: null } };
  });
});

describe('FIX-consulting-005 — engagement delete confirms first, naming the time consequence', () => {
  it('arm sends nothing; the confirm names the logged hours; Confirm sends engagement-delete', async () => {
    wrap(<EngagementTracker />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Harbor Engagement' }));
    const confirm = await screen.findByRole('button', { name: 'Confirm delete Harbor Engagement' });
    expect(confirm.textContent).toMatch(/also deletes 2h of logged time/i);
    expect(calls().some((c) => c.action === 'engagement-delete')).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(calls().some((c) => c.action === 'engagement-delete' && c.input.id === 'e1' && c.input.confirmDeleteTime === true)).toBe(true));
  });
});

describe('FIX-fractal-007 — preset delete confirms first', () => {
  it('arm sends nothing, Confirm sends deletePreset', async () => {
    wrap(<FractalRenderer />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete preset Ember Drift' }));
    expect(await screen.findByRole('button', { name: 'Confirm delete preset Ember Drift' })).toBeTruthy();
    expect(calls().some((c) => c.action === 'deletePreset')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete preset Ember Drift' }));
    await waitFor(() => expect(calls().some((c) => c.action === 'deletePreset' && c.input.id === 'p1')).toBe(true));
  });
});

describe('FIX-global-014 — saved-view delete confirms first', () => {
  it('arm sends nothing, Confirm sends deleteView', async () => {
    wrap(<DataExplorer />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete view APAC View' }));
    expect(await screen.findByRole('button', { name: 'Confirm delete view APAC View' })).toBeTruthy();
    expect(calls().some((c) => c.action === 'deleteView')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete view APAC View' }));
    await waitFor(() => expect(calls().some((c) => c.action === 'deleteView' && c.input.id === 'v1')).toBe(true));
  });
});

describe('FIX-inheritance-005 — beneficiary / asset / executor removes confirm first', () => {
  it('beneficiary: arm does not remove, Confirm removes', async () => {
    wrap(<BeneficiariesPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove beneficiary Nia Heir' }));
    expect(await screen.findByRole('button', { name: 'Confirm remove beneficiary Nia Heir' })).toBeTruthy();
    expect(removeBeneficiary).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove beneficiary Nia Heir' }));
    await waitFor(() => expect(removeBeneficiary).toHaveBeenCalledWith('b1'));
  });

  it('asset: arm does not remove, Confirm removes', async () => {
    wrap(<AssetsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove asset Lake House' }));
    expect(await screen.findByRole('button', { name: 'Confirm remove asset Lake House' })).toBeTruthy();
    expect(removeAsset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove asset Lake House' }));
    await waitFor(() => expect(removeAsset).toHaveBeenCalledWith('a1'));
  });

  it('executor: arm does not remove, Confirm removes', async () => {
    wrap(<ExecutorsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove executor Ed Executor' }));
    expect(await screen.findByRole('button', { name: 'Confirm remove executor Ed Executor' })).toBeTruthy();
    expect(removeExecutor).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove executor Ed Executor' }));
    await waitFor(() => expect(removeExecutor).toHaveBeenCalledWith('x1'));
  });
});
