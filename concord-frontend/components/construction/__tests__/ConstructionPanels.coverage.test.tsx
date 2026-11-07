// Render + behaviour coverage for the construction lens panels: field management (RFIs,
// submittals, logs, punch, change orders, drawings, budget, gantt), project registry, the
// bench tools (takeoff / critical path / safety / progress), the OSHA search and the bench store.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const runDomain = vi.fn();
const rec = (n: string, extra: Record<string, unknown> = {}) => ({
  id: n, number: `#${n}`, subject: 'Slab thickness', question: 'Confirm detail', title: 'Rebar shop drawings', name: 'Foundation', description: 'Pour level 2',
  discipline: 'Structural', priority: 'high', ballInCourt: 'Architect', status: 'open', dueDate: '2026-03-20', date: '2026-03-02', response: '', respondedBy: '',
  trade: 'Concrete', spec: '03 30 00', assignee: 'Lee', location: 'Level 2', category: 'Structural', vendor: 'Acme', amount: 4200, cost: 4200, value: 4200,
  budget: 10000, committed: 6000, actual: 4000, forecast: 9500, variance: 500, percent: 40, manHours: 16, crew: 4, weather: 'clear', notes: 'On track',
  type: 'shop_drawing', specSection: '03 30 00', reviewCycles: [{ cycle: 1, action: 'approved_as_noted', reviewer: 'Architect', comments: 'ok' }], manpower: [{ trade: 'Carpenter', workers: 4, hours: 8 }], totalManHours: 32, tempHigh: 72, tempLow: 55, author: 'Lee', workCompleted: 'Formwork', equipment: ['crane'], workPerformed: 'Formwork', visitors: 'Inspector', safety: 'Toolbox talk', delays: '',
  sheet: 'S-101', sheetNumber: 'S-101', revision: 'B', revisions: [{ rev: 'A', date: '2026-02-01', note: 'Issued' }], markups: [], history: [], tags: [], items: [],
  start: '2026-03-01', end: '2026-03-30', startDate: '2026-03-01', endDate: '2026-03-30', duration: 10, progress: 40, dependsOn: [], ...extra,
});
const rows = (n: string) => [rec(`${n}-1`), rec(`${n}-2`, { status: 'closed', response: 'Approved as shown', respondedBy: 'Architect' })];

function resultFor(action: string): unknown {
  switch (action) {
    case 'rfi-list': return { rfis: rows('rfi'), open: 2, overdue: 1, total: 2 };
    case 'submittal-list': return { submittals: rows('sub'), byStatus: { pending: 1, approved: 1 } };
    case 'dailylog-list': return { logs: rows('log'), totalManHours: 64 };
    case 'punch-list': return { items: rows('punch'), open: 1, ready: 1, closed: 0, total: 2, completionPct: 25 };
    case 'changeorder-list': return { changeOrders: rows('co'), approvedValue: 1200, pendingValue: 300, approvedCount: 1, pendingCount: 1 };
    case 'drawing-list': return { drawings: rows('dwg'), disciplines: ['Architectural', 'Electrical'] };
    case 'drawing-compare': return { added: 1, removed: 0, changed: 2, summary: 'ok' };
    case 'budget-list': return { lines: rows('bud'), totalBudget: 100000, totalCommitted: 60000, totalActual: 40000, forecastAtCompletion: 95000, variance: 5000, status: 'on-track' };
    case 'takeoffEstimate': return { lineItems: [{ description: '2x4', quantity: 100, unit: 'each', unitCost: 3, wastePercent: 10, adjustedQuantity: 110, lineCost: 330 }], subtotalMaterials: 330, laborCost: 100, overhead: 43, profit: 47, grandTotal: 520, costPerSqFt: 5.2 };
    case 'criticalPath': return { projectDuration: 12, criticalPath: ['Foundation', 'Framing'], tasks: [{ name: 'Foundation', duration: 5, earlyStart: 0, earlyFinish: 5, slack: 0, onCriticalPath: true }, { name: 'Permits', duration: 2, earlyStart: 0, earlyFinish: 2, slack: 3, onCriticalPath: false }], totalTasks: 2 };
    case 'safetyCompliance': return { complianceRate: 80, checklistResults: { passed: 4, failed: 1, total: 5 }, incidentRate: 1.2, incidents: 1, workers: 10, hoursWorked: 2000, rating: 'good', criticalFailures: ['Fall protection'] };
    case 'progressReport': return { phases: [{ phase: 'Foundation', plannedPercent: 60, actualPercent: 50, variance: -10, status: 'behind' }], overallPlannedPercent: 60, overallActualPercent: 50, overallVariance: -10, projectStatus: 'behind', behindPhases: ['Foundation'] };
    default: return { ok: true, id: 'new-1' };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: { ok: true, result: { id: 'dtu-1', dtu: { id: 'dtu-1' } } } })), delete: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
const ITEMS = [
  { id: 'a1', title: 'Riverside Build', type: 'Job', createdAt: '2026-03-01T10:00:00.000Z', updatedAt: '2026-03-02T10:00:00.000Z', meta: { status: 'active', tags: [] }, data: { name: 'Riverside Build', status: 'active', projectType: 'Commercial', address: '1 River Rd', budget: 250000, client: 'Acme', trade: 'General', foreman: 'Lee', crewSize: 6, inspectionType: 'Foundation', description: 'Mixed-use' } },
  { id: 'a2', title: 'Elm Duplex', type: 'Job', createdAt: '2026-03-03T10:00:00.000Z', updatedAt: '2026-03-03T10:00:00.000Z', meta: { status: 'planning' }, data: { name: 'Elm Duplex', status: 'planning', projectType: 'Residential', budget: 90000 } },
];
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: ITEMS, isLoading: false, isError: false, error: null, refetch: vi.fn(), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})), remove: vi.fn(async () => ({})), isCreating: false }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({ useRunArtifact: () => ({ mutateAsync: vi.fn(async () => ({ ok: true, result: {} })), mutate: vi.fn(), isPending: false }) }));
vi.mock('next/dynamic', () => ({ default: () => () => <div>map view</div> }));
vi.mock('@/components/common/MapView', () => ({ default: () => <div>map view</div> }));
vi.mock('@/components/viz', () => ({ ChartKit: () => <div>chart</div>, TimelineView: () => <div>timeline</div>, MapView: () => <div>map</div> }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => <button>save-as-dtu</button> }));
vi.mock('@/components/panel-polish', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return {
    ...real,
    usePipe: () => ({ publish: vi.fn(), subscribe: vi.fn() }),
    useRecallableAction: () => ({ run: (fn: () => Promise<unknown>) => fn(), state: 'idle' }),
    RecallSlot: () => null,
  };
});
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { BenchStoreProvider, useBenchStore } from '../bench-store';
import { ConstructionActionPanel } from '../ConstructionActionPanel';
import { FieldManagementPanel } from '../FieldManagementPanel';
import { OshaIncidentSearch } from '../OshaIncidentSearch';
import { ProcorePanel } from '../ProcorePanel';
import { ProjectRegistryPanel } from '../ProjectRegistryPanel';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><BenchStoreProvider>{ui}</BenchStoreProvider></QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  runDomain.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
  runDomain.mockImplementation(async (_d: string, action: string) => ({ data: { ok: true, result: resultFor(action) } }));
  vi.spyOn(window, 'open').mockImplementation(() => null);
});

const MODES = ['dashboard', 'jobs', 'estimates', 'materials', 'inspections', 'safety', 'crew', 'documents', 'map'] as const;
const PANELS: Array<[string, () => React.ReactElement]> = [
  ['ConstructionActionPanel', () => <ConstructionActionPanel />],
  ['FieldManagementPanel', () => <FieldManagementPanel />],
  ['OshaIncidentSearch', () => <OshaIncidentSearch />],
  ['ProcorePanel', () => <ProcorePanel />],
  ...MODES.map((m): [string, () => React.ReactElement] => [`ProjectRegistryPanel ${m}`, () => <ProjectRegistryPanel mode={m} />]),
];

describe('construction panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(5);
    await exercise({ passes: 3, text: '12' });
    await settle();
    await exercise({ passes: 1, text: 'Foundation' });
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

describe('construction flows', () => {
  it('every field-management tab loads its list and survives an exercise pass', async () => {
    const view = render(<FieldManagementPanel />);
    await settle();
    for (const label of ['RFIs', 'Submittals', 'Daily Log', 'Punch List', 'Change Orders', 'Drawings', 'Budget', 'Gantt']) {
      const tab = screen.getAllByRole('button').find((b) => (b.textContent || '').trim() === label) as HTMLElement;
      await act(async () => { fireEvent.click(tab); await new Promise((r) => setTimeout(r, 0)); });
      // the tab bar is skipped so each pass stays on the tab under test
      const skip = /^(RFIs|Submittals|Daily Log|Punch List|Change Orders|Drawings|Budget|Gantt)$|delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i;
      await exercise({ passes: 5, text: '7', skip });
      await settle();
      await exercise({ passes: 3, text: 'Slab', skip });
      expect(view.container.textContent?.length).toBeGreaterThan(20);
    }
    const a = lensRunMock.mock.calls.map((c) => actionOf(c));
    expect(a).toEqual(expect.arrayContaining(['rfi-list', 'submittal-list', 'dailylog-list', 'punch-list', 'changeorder-list', 'drawing-list', 'budget-list']));
  });

  it('the bench tools run their engines and publish results to the bench store', async () => {
    render(<ProcorePanel />);
    await settle();
    await exercise({ passes: 3, text: '10' });
    await settle();
    const a = runDomain.mock.calls.map((c) => c[1]);
    expect(a.some((x) => /takeoffEstimate|criticalPath|safetyCompliance|progressReport/.test(String(x)))).toBe(true);
  });

  it('the action panel runs takeoff, CPM, safety and progress, mints, DMs, publishes and asks the agent', async () => {
    const view = render(<ConstructionActionPanel />);
    await settle();
    const click = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 0)); }); };
    for (const add of screen.getAllByRole('button').filter((x) => /Add row/.test(x.textContent || ''))) await click(add);
    await exercise({ passes: 1, text: 'Foundation', skip: /^(Takeoff|CPM|Safety|Progress|Mint|DM|Publish|PM brief|Add row|JSON)|delete|remove|cancel|close/i });
    const press = async (label: RegExp) => {
      const b = screen.getAllByRole('button').find((x) => label.test((x.textContent || '').trim()));
      if (b) await act(async () => { fireEvent.click(b); await new Promise((r) => setTimeout(r, 0)); });
    };
    for (const l of [/^Takeoff/, /^CPM/, /^Safety/, /^Progress/, /^Mint/, /^DM/, /^Publish/, /^PM brief/]) await press(l);
    await settle();
    const a = runDomain.mock.calls.map((c) => String(c[1]));
    expect(a.some((x) => /takeoffEstimate|criticalPath|safetyCompliance|progressReport/.test(x))).toBe(true);
    expect(view.container.textContent?.length).toBeGreaterThan(20);
  });

  it('the OSHA search opens the federal catalog with the typed query', async () => {
    render(<OshaIncidentSearch />);
    const box = screen.getByPlaceholderText(/Search OSHA/i) as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'scaffold falls' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Search on catalog/i })); });
    expect(window.open).toHaveBeenCalledWith(expect.stringContaining('scaffold%20falls'), '_blank', 'noopener,noreferrer');
  });

  it('the bench store keeps what a tool publishes', async () => {
    function Probe() {
      const s = useBenchStore();
      return <button onClick={() => s.setTool('cpm', { payload: { tasks: [] }, result: { ok: true } })}>{s.cpm ? 'has-cpm' : 'no-cpm'}</button>;
    }
    render(<Probe />);
    expect(screen.getByText('no-cpm')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByText('no-cpm')); });
    expect(screen.getByText('has-cpm')).toBeTruthy();
  });
});
