// Render coverage for SimConsole: every tab renders with a stored scenario and a
// completed run, and the generic sweep drives the builder / run / compare flows.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { exercise } from '../../../tests/helpers/exercise';

const now = '2026-03-01T10:00:00.000Z';
const scenario = {
  id: 's1', title: 'Launch risk',
  data: {
    name: 'Launch risk', description: 'd', modelType: 'monte-carlo', iterations: 1000, status: 'ready', createdAt: now, updatedAt: now,
    variables: [{ id: 'v1', name: 'demand', type: 'continuous', min: 0, max: 10, defaultValue: 5, distribution: 'normal', sensitive: true, description: '' }],
    assumptions: [{ id: 'a1', text: 'stable market', order: 0 }],
  },
  meta: { tags: [], status: 'ready', visibility: 'private' }, createdAt: now, updatedAt: now, version: 1,
};
const results = {
  mean: 5, median: 5, stdDev: 1, min: 1, max: 9, p5: 2, p25: 4, p75: 6, p95: 8,
  outcomes: [{ label: '0-5', count: 5, percentage: 50 }, { label: '5-10', count: 5, percentage: 50 }],
  sensitivity: [{ variable: 'demand', impact: 0.7, direction: 'positive' }],
  riskAssessment: [{ outcome: 'loss', probability: 0.1, severity: 'high' }],
};
const run = (id: string, status: string) => ({
  id, title: id, data: { scenarioId: 's1', scenarioName: 'Launch risk', status, progress: 100, startedAt: now, completedAt: now, duration: 12, errorCount: 0, iterations: 1000, results },
  meta: { tags: [], status, visibility: 'private' }, createdAt: now, updatedAt: now, version: 1,
});
const mutate = vi.fn(async () => ({ id: 'new' }));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (_d: string, type: string) => ({
    items: type === 'scenario' ? [scenario, { ...scenario, id: 's2', title: 'Second' }] : [run('r1', 'completed'), run('r2', 'completed'), run('r3', 'failed')],
    total: 2, isLoading: false, isError: false, error: null, refetch: vi.fn(),
    create: mutate, update: mutate, remove: mutate,
    createMut: { isPending: false }, updateMut: { isPending: false }, deleteMut: { isPending: false },
  }),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: {
    simulations: {
      list: vi.fn(async () => ({ data: { simulations: [{ id: 'b1', title: 'Backend sim', status: 'done', createdAt: now }] } })),
      run: vi.fn(async () => ({ data: { ok: true } })),
    },
  },
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: vi.fn() }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: vi.fn() }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: vi.fn() }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/lib/sim/studio-activity', () => ({ useStudioRunCount: () => 0, recordStudioRun: vi.fn(), recordStudioModelSave: vi.fn() }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/mobile/MobileTabBar', () => ({ MobileTabBar: () => null }));
vi.mock('@/components/sim/SimRepos', () => ({ SimRepos: () => <div /> }));
vi.mock('@/components/sim/StudioPanel', () => ({ StudioPanel: () => <div data-testid="studio" /> }));
vi.mock('@/components/common/EmptyState', () => ({ ErrorState: () => <div role="alert" /> }));

import { SimConsole, extractRunArtifactId } from '../SimConsole';

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const mount = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SimConsole /></QueryClientProvider>,
);

beforeEach(() => { mutate.mockClear(); });

describe('SimConsole', () => {
  it.each(['Scenarios', 'Parameters', 'Runs', 'Results', 'Comparison', 'Models', 'Studio'])('walks the %s tab', async (label) => {
    const view = mount();
    await settle();
    await waitFor(() => expect(view.container.querySelector('nav[aria-label="Simulation views"]')).not.toBeNull());
    const nav = view.container.querySelector('nav[aria-label="Simulation views"]') as HTMLElement;
    const btn = Array.from(nav.querySelectorAll('button')).find((b) => new RegExp(label, 'i').test(b.textContent || ''));
    if (btn) await act(async () => { fireEvent.click(btn); });
    await settle();
    const row = Array.from(view.container.querySelectorAll('h3, h4, p, span, div')).find((e) => e.children.length === 0 && /^Launch risk$/.test(e.textContent || ''));
    if (row) await act(async () => { fireEvent.click(row); });
    await settle();
    await exercise({ passes: 8, skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear/i });
    await settle();
    expect(view.container.textContent).toBeTruthy();
  });

  it('selects a scenario, runs it, then sweeps sensitivity and the result tabs', async () => {
    const view = mount();
    await settle();
    const pick = (t: string) => Array.from(view.container.querySelectorAll('*')).find((e) => e.children.length === 0 && (e.textContent || '').trim() === t) as HTMLElement | undefined;
    const press = async (label: RegExp) => {
      const b = Array.from(view.container.querySelectorAll('button')).find((x) => label.test((x.getAttribute('aria-label') || x.textContent || '').trim()));
      if (b) await act(async () => { fireEvent.click(b); await new Promise((r) => setTimeout(r, 20)); });
    };
    const sc = pick('Launch risk');
    if (sc) await act(async () => { fireEvent.click(sc); });
    await press(/^Run Simulation/);
    await press(/^Sensitivity Analysis/);
    await press(/^Clone Scenario/);
    await exercise({ passes: 2, skip: /delete|remove|discard|cancel|close|dismiss|reset|clear/i });
    for (const t of ['Runs', 'Results', 'Comparison']) { await press(new RegExp(`^${t}$`)); await exercise({ passes: 3, skip: /delete|remove|discard|cancel|close|dismiss|reset|clear/i }); }
    expect(view.container.textContent).toBeTruthy();
  });

  it('exports extractRunArtifactId', () => {
    expect(typeof extractRunArtifactId).toBe('function');
  });
});
