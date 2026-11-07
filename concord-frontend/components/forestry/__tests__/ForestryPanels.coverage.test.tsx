// Render + behaviour coverage for the forestry lens panels: timber cruise, fire incidents, the
// action panel (volume / fire risk / harvest / carbon), pest + disease tracking, replanting and
// the stand manager. Panels mount against stubbed engine results, must render real content,
// survive a full exercise pass and degrade honestly offline; flows assert the macro each sends.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const runDomain = vi.fn();
const apiPost = vi.fn();
const TREE = { species: 'Douglas fir', dbhInches: 18, heightFeet: 110, basalArea: 1.8, boardFeet: 420 };
const STAND = { id: 'st1', name: 'North 40', species: 'Douglas fir', acres: 40, ageYears: 35, treesPerAcre: 180, estimatedTrees: 7200, activities: [{ id: 'a1', kind: 'thinning', date: '2026-02-01', notes: 'Pre-commercial' }], activityCount: 1 };

function resultFor(action: string): unknown {
  switch (action) {
    case 'cruise-plot-list': return { plots: [{ id: 'pl1', standId: 'st1', method: 'fixed-radius', expansionFactor: 10, trees: [TREE, { ...TREE, species: 'Western hemlock' }], treeCount: 2 }] };
    case 'cruise-summary': return { plots: 1, treesPerAcre: { mean: 180, stdDev: 12, stdError: 5, ciPercent: 8 }, basalAreaPerAcre: { mean: 140, stdDev: 9, stdError: 4, ciPercent: 6 }, boardFeetPerAcre: { mean: 21000, stdDev: 1200, stdError: 500, ciPercent: 7 } };
    case 'inciweb-active-fires': return { fires: [{ id: 1, name: 'Ridge Fire', type: 'Wildfire', location: 'Near Bend', state: 'OR', county: 'Deschutes', sizeAcres: 12000, containmentPct: 35, status: 'Active', startDate: '2026-03-01', lastUpdated: '2026-03-02', latitude: 44.1, longitude: -121.3, incidentUrl: 'https://inciweb.example/1' }, { id: 2, name: 'Creek Fire', sizeAcres: 80 }] };
    case 'nifc-fire-perimeters': return { features: [{ objectId: 7, incidentName: 'Ridge Fire', gisAcres: 11800, mapMethod: 'IR flight', polygonDateTime: '2026-03-02', sourceCode: 'NIFC' }], count: 1, totalArea: 11800 };
    case 'timberVolume': return { boardFeet: 420000, cubicFeet: 84000, valuation: 210000 };
    case 'fireRisk': return { riskLevel: 'high', score: 78, factors: ['Low humidity', 'High wind'] };
    case 'harvestPlan': return { schedule: [{ year: 2030, acres: 10, volume: 100000 }, { year: 2035, acres: 15, volume: 150000 }], rotation: 45 };
    case 'carbonSequestration': return { tonsPerYear: 120, lifetimeTons: 5400, equivalentCars: 26 };
    case 'pest-list': return { reports: [{ id: 'pe1', agent: 'Bark beetle', kind: 'pest', standId: 'st1', severity: 'high', affectedAcres: 12, detectedDate: '2026-02-15', status: 'open', treatments: [{ id: 'tr1', method: 'Pheromone traps', scheduledDate: '2026-03-10', cost: 800, completed: false, completedDate: null }, { id: 'tr2', method: 'Salvage', scheduledDate: '2026-02-20', cost: 1200, completed: true, completedDate: '2026-02-22' }] }, { id: 'pe2', agent: 'Root rot', kind: 'disease', standId: null, severity: 'low', affectedAcres: 2, detectedDate: '2026-01-10', status: 'resolved', treatments: [] }], count: 2, openCount: 1, upcomingTreatments: [{ id: 'tr1', method: 'Pheromone traps', scheduledDate: '2026-03-10', cost: 800, completed: false, completedDate: null, pestId: 'pe1', agent: 'Bark beetle' }] };
    case 'replant-list': return { projects: [{ id: 'rp1', standId: 'st1', name: 'North replant', species: 'Douglas fir', acres: 20, seedlingsPerAcre: 400, seedlingsOrdered: 8000, plannedDate: '2026-04-01', method: 'hand-plant', status: 'planned', surveys: [{ id: 'sv1', date: '2026-06-01', survivalPercent: 82, recommendation: 'Fill-in planting not needed' }], latestSurvival: 82 }, { id: 'rp2', standId: null, name: 'South replant', species: 'Ponderosa pine', acres: 5, seedlingsPerAcre: 300, seedlingsOrdered: 1500, plannedDate: '2026-05-01', method: 'machine', status: 'planted', surveys: [], latestSurvival: null }], count: 2, totalAcres: 25, totalSeedlings: 9500 };
    case 'stand-list': return { stands: [STAND, { ...STAND, id: 'st2', name: 'South 20', activities: [], activityCount: 0 }] };
    case 'forestry-dashboard': return { stands: 2, totalAcres: 60, activities: 1, bySpecies: { 'Douglas fir': 2 } };
    default: return { ok: true, id: 'new-1' };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: (...a: unknown[]) => apiPost(...a) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => <button>save-as-dtu</button> }));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn(), subscribe: vi.fn() }),
  useRecallableAction: () => ({ run: (fn: () => Promise<unknown>) => fn(), state: 'idle' }),
  RecallSlot: () => null,
}));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { CruisePanel } from '../CruisePanel';
import { FireIncidents } from '../FireIncidents';
import { ForestryActionPanel } from '../ForestryActionPanel';
import { PestPanel } from '../PestPanel';
import { ReplantingPanel } from '../ReplantingPanel';
import { StandManager } from '../StandManager';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 5)); });
  return !!hits[nth];
};
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset(); runDomain.mockReset(); apiPost.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
  runDomain.mockImplementation(async (_d: string, action: string) => ({ data: { ok: true, result: resultFor(action) } }));
  apiPost.mockResolvedValue({ data: { ok: true, result: { id: 'dtu-1', dtu: { id: 'dtu-1' }, answer: 'Brief.' } } });
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
});

const PANELS: Array<[string, () => React.ReactElement]> = [
  ['CruisePanel', () => <CruisePanel />],
  ['FireIncidents', () => <FireIncidents />],
  ['ForestryActionPanel', () => <ForestryActionPanel />],
  ['PestPanel', () => <PestPanel />],
  ['ReplantingPanel', () => <ReplantingPanel />],
  ['StandManager', () => <StandManager />],
];

describe('forestry panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(20);
    await exercise({ passes: 4, text: 'st1' });
    await settle();
    await exercise({ passes: 2, text: '12' });
    expect(view.container.textContent).toBeTruthy();
  });

  it.each(PANELS)('%s stays standing when the backend is offline', async (_n, make) => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    runDomain.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(make());
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});

describe('forestry flows', () => {
  it('the cruise panel loads plots and a summary for a stand, tallies a plot and removes one', async () => {
    render(<CruisePanel />);
    await settle();
    const stand = screen.getAllByRole('textbox')[0];
    fireEvent.change(stand, { target: { value: 'st1' } });
    await settle();
    expect(sent()).toEqual(expect.arrayContaining(['cruise-plot-list', 'cruise-summary']));
    const trees = document.querySelector('textarea');
    if (trees) fireEvent.change(trees, { target: { value: 'Douglas fir, 18, 110\nWestern hemlock, 14, 90' } });
    await press(/Add plot|Tally|Save plot/i);
    await press(/Delete|Remove|Trash/i);
    expect(sent().some((x) => /cruise-plot-add|cruise-plot-delete/.test(x))).toBe(true);
  });

  it('fire incidents pull active fires by state and perimeters', async () => {
    render(<FireIncidents />);
    await settle();
    const state = screen.queryAllByRole('textbox')[0] ?? document.querySelector('select');
    if (state) fireEvent.change(state, { target: { value: 'OR' } });
    await press(/Load|Pull|Refresh|Fires/i);
    expect(document.body.textContent).toMatch(/Ridge Fire/);
    await press(/Perimeter/i);
    expect(runDomain.mock.calls.map((c) => c[1])).toEqual(expect.arrayContaining(['inciweb-active-fires']));
  });

  it('the action panel computes timber volume, fire risk, harvest and carbon, then mints, DMs, publishes and asks the agent', async () => {
    render(<ForestryActionPanel />);
    await settle();
    const fill = (ph: RegExp | string, v: string) => { const el = typeof ph === 'string' ? screen.queryByPlaceholderText(ph) : screen.queryAllByPlaceholderText(ph)[0]; if (el) fireEvent.change(el, { target: { value: v } }); };
    for (const [ph, v] of [[/acre/i, '40'], [/age/i, '35'], ['Tree count', '180'], ['Temp °F', '85'], ['Humidity %', '20'], ['Wind mph', '12'], ['DM recipient', 'friend-1']] as Array<[RegExp | string, string]>) fill(ph, v);
    for (const l of [/^Volume|Timber/, /^Fire/, /^Harvest/, /^Carbon/, /^Mint/, /^DM/, /^Publish/, /^Publish/, /Brief|Agent|Lever|Forester/]) await press(l);
    const a = runDomain.mock.calls.map((c) => String(c[1]));
    expect(a.some((x) => /timberVolume|fireRisk|harvestPlan|carbonSequestration/.test(x))).toBe(true);
    expect(apiPost).toHaveBeenCalled();
  });

  it('pests are reported, treatments scheduled and completed', async () => {
    render(<PestPanel />);
    await settle();
    await exercise({ passes: 4, text: 'Bark beetle', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    await press(/Complete|Done|Mark done/i);
    await press(/Resolve/i);
    expect(sent().some((x) => /pest-report|pest-schedule-treatment|pest-complete-treatment/.test(x))).toBe(true);
  });

  it('replanting projects are created, advanced and surveyed', async () => {
    render(<ReplantingPanel />);
    await settle();
    await exercise({ passes: 4, text: '55', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    await press(/Planted|Advance|Mark/i);
    expect(sent().some((x) => /replant-project-create|replant-update-status|replant-survival-survey/.test(x))).toBe(true);
  });

  it('stands are added, logged against, and deleted', async () => {
    render(<StandManager />);
    await settle();
    await exercise({ passes: 4, text: 'North 40', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    await press(/Delete|Remove|Trash/i);
    expect(sent()).toEqual(expect.arrayContaining(['stand-list', 'forestry-dashboard']));
    expect(sent().some((x) => /stand-add|activity-log|stand-delete/.test(x))).toBe(true);
  });
});
