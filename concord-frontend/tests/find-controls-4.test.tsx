/**
 * Audit sweep CB-0481 (missing find controls, second leg), FE pins 2:
 *   disputes-002   CasesPanel case search + sort
 *   carpentry-008  JobOps CrewSchedule scheduled-job search (jobs leg)
 *   creative-writing-002 CwBinderPanel binder title filter
 *   crafting-007   crafting bench piece search
 *   photography-003 photography page roll search (name/date)
 *   energy-007     EnergyWorkspace meter picker search
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const lensRun = vi.fn();
const apiGet = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: vi.fn(() => Promise.resolve({ data: { ok: true } })),
    put: vi.fn(() => Promise.resolve({ data: { ok: true } })),
    patch: vi.fn(() => Promise.resolve({ data: { ok: true } })),
    delete: vi.fn(() => Promise.resolve({ data: { ok: true } })),
  },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, isLoading: false }) }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => ({}) }));
vi.mock('@/lib/lens-state-persistence', () => ({
  useLensStatePersistence: () => ({
    restore: () => ({ view: 'now', selectedMeterId: '' }),
    persist: () => {},
  }),
}));
vi.mock('@/lib/hooks/use-lens-data', () => ({ useLensData: () => ({ items: [], isLoading: false }) }));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({ useRunArtifact: () => ({ mutateAsync: vi.fn() }) }));
vi.mock('@/components/viz', () => ({
  TimelineView: ({ events }: { events: Array<{ label: string }> }) => (
    <div>{events.map((e) => <span key={e.label}>{e.label}</span>)}</div>
  ),
  ChartKit: () => null,
}));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));
// Energy sibling panels are other views; the workspace shell + picker are the surface.
vi.mock('@/components/energy/EiaPanel', () => ({ EiaPanel: () => null }));
vi.mock('@/components/energy/EnergyActionStack', () => ({ EnergyActionStack: () => null }));
vi.mock('@/components/energy/EnergyBillingPanel', () => ({ EnergyBillingPanel: () => null }));
vi.mock('@/components/energy/EnergyCheapestWindowPanel', () => ({ EnergyCheapestWindowPanel: () => null }));
vi.mock('@/components/energy/EnergyDisaggregationPanel', () => ({ EnergyDisaggregationPanel: () => null }));
vi.mock('@/components/energy/EnergyGridCalcPanel', () => ({ EnergyGridCalcPanel: () => null }));
vi.mock('@/components/energy/EnergyInsightsPanel', () => ({ EnergyInsightsPanel: () => null }));
vi.mock('@/components/energy/EnergyLivePanel', () => ({ EnergyLivePanel: () => null }));
vi.mock('@/components/energy/EnergySolarPanel', () => ({ EnergySolarPanel: () => null }));
vi.mock('@/components/energy/EnergyTouPanel', () => ({ EnergyTouPanel: () => null }));
vi.mock('@/components/energy/EnergyUsagePanel', () => ({ EnergyUsagePanel: () => null }));

import { CasesPanel } from '@/components/disputes/CasesPanel';
import { JobOps } from '@/components/carpentry/JobOps';
import { CwBinderPanel } from '@/components/creative-writing/CwBinderPanel';
import CraftingPage from '@/app/lenses/crafting/page';
import PhotographyPage from '@/app/lenses/photography/page';
import { EnergyWorkspace } from '@/components/energy/EnergyWorkspace';

function reply(result: unknown) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}

beforeEach(() => { lensRun.mockReset(); apiGet.mockReset(); window.localStorage.clear(); });

describe('disputes-002 — case search + sort', () => {
  const disputes = [
    { id: 'd1', dispute_type: 'not_as_described', reporter_id: 'u1', reported_user_id: 'u2', reported_content_id: 'c1', description: 'The lamp arrived broken', evidence: [], status: 'open', resolution: null, opened_at: '2026-11-01T10:00:00Z' },
    { id: 'd2', dispute_type: 'payment', reporter_id: 'u1', reported_user_id: 'u3', reported_content_id: 'c2', description: 'Charged twice for the desk', evidence: [], status: 'open', resolution: null, opened_at: '2026-11-05T10:00:00Z' },
  ];
  it('search narrows by description text; sort orders by opened date', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/disputes/my') return Promise.resolve({ data: { disputes } });
      return Promise.resolve({ data: {} });
    });
    lensRun.mockImplementation(() => reply({}));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <CasesPanel />
      </QueryClientProvider>,
    );
    await screen.findByText('Not As Described');
    fireEvent.change(screen.getByLabelText('Search cases'), { target: { value: 'desk' } });
    expect(screen.queryByText('Not As Described')).toBeNull();
    expect(screen.getByText('d2')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search cases'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Sort cases'), { target: { value: 'oldest' } });
    await waitFor(() => {
      const ids = screen.getAllByText(/^d[12]$/).map((n) => n.textContent);
      expect(ids).toEqual(['d1', 'd2']);
    });
  });
});

describe('carpentry-008 — scheduled job search (jobs leg)', () => {
  it('filters the dispatch list by title/address/crew', async () => {
    const entries = [
      { id: 'j1', title: 'Deck build', date: '2026-11-20', startTime: '08:00', endTime: '16:00', crewIds: [], crewNames: ['Sam'], jobId: 'JOB-1', address: '12 Oak St', status: 'scheduled', notes: '' },
      { id: 'j2', title: 'Kitchen remodel', date: '2026-11-21', startTime: '09:00', endTime: '17:00', crewIds: [], crewNames: ['Jo'], jobId: 'JOB-2', address: '9 Pine Ave', status: 'scheduled', notes: '' },
    ];
    lensRun.mockImplementation((...args: unknown[]) => {
      const action = args[1] as string;
      if (action === 'crewList') return reply({ members: [] });
      if (action === 'scheduleList') return reply({ entries });
      return reply({});
    });
    render(<JobOps />);
    fireEvent.click(screen.getByRole('button', { name: /Dispatch/ }));
    await screen.findByText(/12 Oak St/);
    fireEvent.change(screen.getByLabelText('Search scheduled jobs'), { target: { value: 'pine' } });
    expect(screen.queryByText(/12 Oak St/)).toBeNull();
    expect(screen.getByText(/9 Pine Ave/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search scheduled jobs'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/No scheduled jobs match/)).toBeTruthy();
  });
});

describe('creative-writing-002 — binder title filter', () => {
  it('a scene title match keeps its chapter and hides sibling scenes', async () => {
    const chapters = [{ id: 'ch1', title: 'Chapter One', order: 1 }];
    const scenes = [
      { id: 'sc1', projectId: 'p1', chapterId: 'ch1', title: 'Opening Image', synopsis: null, status: 'draft', content: '', wordCount: 10, povCharacterId: null, order: 1 },
      { id: 'sc2', projectId: 'p1', chapterId: 'ch1', title: 'Midpoint Twist', synopsis: null, status: 'draft', content: '', wordCount: 20, povCharacterId: null, order: 2 },
    ];
    lensRun.mockImplementation((...args: unknown[]) => {
      const action = args[1] as string;
      if (action === 'project-get') return reply({ chapters, scenes, characters: [] });
      if (action === 'thread-list') return reply({ threads: [] });
      return reply({});
    });
    render(<CwBinderPanel projectId="p1" onChange={() => {}} />);
    await screen.findByText('Opening Image');
    fireEvent.change(screen.getByLabelText('Filter binder by title'), { target: { value: 'midpoint' } });
    expect(screen.queryByText('Opening Image')).toBeNull();
    expect(screen.getByText('Midpoint Twist')).toBeTruthy();
    expect(screen.getAllByText('Chapter One').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Filter binder by title'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/No chapters or scenes match/)).toBeTruthy();
  });
});

describe('crafting-007 — bench piece search', () => {
  it('filters own pieces by name', async () => {
    const recipes = [
      { id: 'r1', title: 'Bench hook', type: 'recipe', data: { spec: { name: 'Bench hook', output_type: 'piece', output_subtype: 'piece' } } },
      { id: 'r2', title: 'Wall shelf', type: 'recipe', data: { spec: { name: 'Wall shelf', output_type: 'piece', output_subtype: 'piece' } } },
    ];
    const artifacts = [
      { id: 'a1', domain: 'crafting', type: 'recipe', title: 'Bench hook', data: { recipeId: 'r1' }, meta: { visibility: 'private' } },
      { id: 'a2', domain: 'crafting', type: 'recipe', title: 'Wall shelf', data: { recipeId: 'r2' }, meta: { visibility: 'private' } },
    ];
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/crafting/recipes') return Promise.resolve({ data: { ok: true, recipes } });
      if (url === '/api/lens/crafting') return Promise.resolve({ data: { ok: true, artifacts, total: 2 } });
      return Promise.resolve({ data: {} });
    });
    lensRun.mockImplementation((...args: unknown[]) => {
      const action = args[1] as string;
      if (action === 'load') return reply({ ok: true, draft: null });
      return reply({ ok: true });
    });
    render(<CraftingPage />);
    await screen.findByText('Bench hook');
    fireEvent.change(screen.getByLabelText('Search your pieces'), { target: { value: 'shelf' } });
    expect(screen.queryByText('Bench hook')).toBeNull();
    expect(screen.getByText('Wall shelf')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search your pieces'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/No pieces match/)).toBeTruthy();
  });
});

describe('photography-003 — roll search', () => {
  it('filters rolls by name and by date text', async () => {
    const shoots = [
      { id: 'sh1', name: 'Harbor at dawn', createdAt: '2026-10-02', frames: [] },
      { id: 'sh2', name: 'Studio portraits', createdAt: '2026-11-09', frames: [] },
    ];
    lensRun.mockImplementation((...args: unknown[]) => {
      const action = args[1] as string;
      if (action === 'shoot-list') return reply({ shoots });
      return reply({});
    });
    render(<PhotographyPage />);
    await screen.findByText('Harbor at dawn');
    fireEvent.change(screen.getByLabelText('Search rolls'), { target: { value: '2026-11' } });
    expect(screen.queryByText('Harbor at dawn')).toBeNull();
    expect(screen.getByText('Studio portraits')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search rolls'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/No rolls match/)).toBeTruthy();
  });
});

describe('energy-007 — meter picker search', () => {
  it('filters the meter list in the picker', async () => {
    const devices = [
      { id: 'm1', name: 'Main House Meter', category: 'meter', wattage: 0, alwaysOn: true, totalKwh: 100 },
      { id: 'm2', name: 'Barn Meter', category: 'meter', wattage: 0, alwaysOn: true, totalKwh: 40 },
    ];
    lensRun.mockImplementation((...args: unknown[]) => {
      const action = args[1] as string;
      if (action === 'device-list') return reply({ devices });
      if (action === 'energy-dashboard') return reply({});
      return reply({});
    });
    render(<EnergyWorkspace />);
    await screen.findByText('No meter selected');
    fireEvent.click(screen.getAllByRole('button', { name: 'Choose a meter' })[0]);
    await screen.findByText('Main House Meter');
    fireEvent.change(screen.getByLabelText('Search meters'), { target: { value: 'barn' } });
    expect(screen.queryByText('Main House Meter')).toBeNull();
    expect(screen.getByText('Barn Meter')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search meters'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/No meters match/)).toBeTruthy();
  });
});
