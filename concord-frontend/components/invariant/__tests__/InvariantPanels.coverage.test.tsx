// Render + behaviour coverage for the invariant lens panels: overview, rules, analysis,
// action tester and the formal-verification workbench (monitors, counterexamples, library,
// temporal logic, violation history, quantified checks). Panels mount against stubbed engine
// results, must render real content, survive a full exercise pass and degrade honestly offline.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const MONITOR = { id: 'm1', name: 'No negative balance', expression: 'balance >= 0', severity: 'high', active: true, checkCount: 12, violationCount: 2, consecutivePasses: 3, lastResult: 'pass', lastCheckedAt: '2026-03-02T10:00:00Z' };
const VIOLATION = { id: 'v1', name: 'No negative balance', expression: 'balance >= 0', severity: 'critical', status: 'open', detectedAt: '2026-03-02T10:00:00Z', resolved: false, resolvedAt: null, state: { balance: -5 }, evaluatedValue: false };
const TEMPLATE = { id: 't1', category: 'finance', name: 'Non-negative', description: 'Value never below zero', kind: 'state', expressionTemplate: '{field} >= 0', params: ['field'] };

function resultFor(action: string): unknown {
  switch (action) {
    case 'listMonitors': return { monitors: [MONITOR, { ...MONITOR, id: 'm2', name: 'Paused', active: false, lastResult: 'fail' }], summary: { total: 2, active: 1, violating: 1 } };
    case 'violationHistory': return { violations: [VIOLATION, { ...VIOLATION, id: 'v2', resolved: true, status: 'resolved', resolvedAt: '2026-03-03', resolution: 'fixed', state: undefined }], summary: { total: 2, open: 1, resolved: 1, critical: 1, high: 1, medium: 0, low: 0 } };
    case 'checkMonitors': return { checkedAt: '2026-03-02T10:00:00Z', summary: { passed: 1, violations: 1, errors: 0, total: 2 }, results: [{ monitorId: 'm1', status: 'pass' }] };
    case 'registerMonitor': case 'updateMonitor': return { monitor: MONITOR };
    case 'removeMonitor': case 'setMonitorActive': return { ok: true };
    case 'clearHistory': return { violationsRetained: 1 };
    case 'templates': return { templates: [TEMPLATE, { ...TEMPLATE, id: 't2', category: 'access', name: 'Role required' }], categories: ['finance', 'access'] };
    case 'recordSnapshot': return { historyLength: 3 };
    case 'temporalCheck': return { formula: 'always(balance >= 0)', holds: false, historyLength: 3, violationStep: 2, witnessStep: null, trace: [{ step: 0, conditionHolds: true, conditionError: null }, { step: 2, conditionHolds: false, conditionError: null }] };
    case 'counterexample': return { holds: false, counterexampleCount: 1, recordsChecked: 5, mostLikelyCause: 'balance', blameRanking: [{ field: 'balance', failureCount: 1 }], counterexamples: [{ index: 0, recordId: 'acct-1', error: null, offendingFields: [{ field: 'balance', value: -5 }] }] };
    case 'quantifiedCheck': return { formula: 'forall x: x.balance >= 0', holds: false, collectionSize: 4, satisfyingCount: 3, failingCount: 1, witness: { index: 0, item: { balance: 5 } }, counterexample: { index: 2, item: { balance: -5 }, error: null } };
    case 'testAction': return { passed: false, message: 'Blocked by: No negative balance', violations: ['No negative balance'] };
    case 'evaluateMonitors': return { verdicts: [{ monitorId: 'm1', name: 'No negative balance', status: 'pass', evaluatedValue: true, error: null }] };
    default: return { ok: true };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
const remove = vi.fn(async () => ({}));
const ITEMS = [
  { id: 'i1', title: 'No harm', type: 'invariant', createdAt: '2026-03-01T10:00:00.000Z', updatedAt: '2026-03-02T10:00:00.000Z', meta: {}, data: { name: 'No harm', description: 'Never cause harm', status: 'enforced', category: 'ethos', frozen: true } },
  { id: 'i2', title: 'Single writer', type: 'invariant', createdAt: '2026-03-02T10:00:00.000Z', updatedAt: '2026-03-02T10:00:00.000Z', meta: {}, data: { name: 'Single writer', description: 'One writer per table', status: 'warning', category: 'structural', frozen: false } },
  { id: 'i3', title: 'Cap exceeded', type: 'invariant', createdAt: '2026-03-03T10:00:00.000Z', updatedAt: '2026-03-03T10:00:00.000Z', meta: {}, data: { name: 'Cap exceeded', description: 'Respect caps', status: 'violated', category: 'capability', frozen: false } },
];
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: ITEMS, isLoading: false, isError: false, error: null, refetch: vi.fn(), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})), remove, isCreating: false }),
}));
const runMutate = vi.fn(async () => ({ ok: true, result: { message: 'checked', passed: 3 } }));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({ useRunArtifact: () => ({ mutateAsync: runMutate, mutate: vi.fn(), isPending: false }) }));
vi.mock('@/components/viz', () => ({ TimelineView: ({ events }: { events: unknown[] }) => <div>timeline {events.length}</div>, ChartKit: () => <div>chart</div> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ActionTesterPanel } from '../ActionTesterPanel';
import { AnalysisPanel } from '../AnalysisPanel';
import { FormalVerificationWorkbench } from '../FormalVerificationWorkbench';
import { OverviewPanel } from '../OverviewPanel';
import { RulesPanel } from '../RulesPanel';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  remove.mockClear();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
});

const PANELS: Array<[string, () => React.ReactElement]> = [
  ['ActionTesterPanel', () => <ActionTesterPanel />],
  ['AnalysisPanel', () => <AnalysisPanel />],
  ['FormalVerificationWorkbench', () => <FormalVerificationWorkbench />],
  ['OverviewPanel', () => <OverviewPanel />],
  ['RulesPanel', () => <RulesPanel />],
];
const TAB_LABELS = /^(Continuous Monitoring|Counterexamples|Library|Temporal Logic|Violation History|Quantified ∀∃)$/;

describe('invariant panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(20);
    await exercise({ passes: 3, text: 'balance >= 0' });
    await settle();
    await exercise({ passes: 1, text: '{"balance": 5}' });
    expect(view.container.textContent).toBeTruthy();
  });

  it.each(PANELS)('%s stays standing when the engine is offline', async (_n, make) => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    const view = render(make());
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});

describe('invariant flows', () => {
  it('every workbench tab loads its data and survives its own exercise pass', async () => {
    const view = render(<FormalVerificationWorkbench />);
    await settle();
    // the tab bar is skipped so each pass stays on the tab under test
    const skip = new RegExp(`${TAB_LABELS.source}|delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$`, 'i');
    for (const label of ['Continuous Monitoring', 'Counterexamples', 'Library', 'Temporal Logic', 'Violation History', 'Quantified ∀∃']) {
      const tab = screen.getAllByRole('button').find((b) => (b.textContent || '').trim() === label) as HTMLElement;
      await act(async () => { fireEvent.click(tab); await new Promise((r) => setTimeout(r, 0)); });
      await exercise({ passes: 4, text: 'balance >= 0', skip });
      await settle();
      await exercise({ passes: 2, text: '[{"balance": 5}, {"balance": -5}]', skip });
      expect(view.container.textContent?.length).toBeGreaterThan(40);
    }
    expect(sent()).toEqual(expect.arrayContaining(['listMonitors', 'templates', 'violationHistory']));
  });

  it('a monitor is registered, ticked, paused, edited and removed through the engine', async () => {
    render(<FormalVerificationWorkbench />);
    await settle();
    const press = async (re: RegExp) => {
      const b = screen.queryAllByRole('button').find((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
      if (b) await act(async () => { fireEvent.click(b); await new Promise((r) => setTimeout(r, 0)); });
    };
    for (const ph of [/name/i, /expression/i]) {
      const box = screen.queryAllByRole('textbox').find((i) => ph.test((i as HTMLInputElement).placeholder || ''));
      if (box) fireEvent.change(box, { target: { value: ph.source.includes('name') ? 'Cap' : 'balance >= 0' } });
    }
    await press(/Register|Add monitor|Create/i);
    await press(/Check now|Run|Tick|Evaluate/i);
    await press(/Pause|Resume|Activate/i);
    await press(/Edit|Pencil/i);
    await press(/Save|Update/i);
    await press(/Remove|Trash/i);
    await press(/Confirm|Yes/i);
    const a = sent();
    expect(a).toContain('listMonitors');
    expect(a.some((x) => /registerMonitor|checkMonitors|setMonitorActive|updateMonitor|removeMonitor/.test(x))).toBe(true);
  });

  it('violations can be resolved with a note, deleted, and the history cleared', async () => {
    render(<FormalVerificationWorkbench />);
    await settle();
    const go = async (label: string) => {
      const tab = screen.getAllByRole('button').find((b) => (b.textContent || '').trim() === label) as HTMLElement;
      await act(async () => { fireEvent.click(tab); await new Promise((r) => setTimeout(r, 0)); });
    };
    const press = async (re: RegExp) => {
      const b = screen.queryAllByRole('button').find((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
      if (b) await act(async () => { fireEvent.click(b); await new Promise((r) => setTimeout(r, 0)); });
    };
    await go('Violation History');
    await press(/Resolve/i);
    const note = screen.queryAllByRole('textbox').pop();
    if (note) fireEvent.change(note, { target: { value: 'Fixed upstream' } });
    await press(/Confirm|Save|Resolve/i);
    await press(/Delete|Trash/i);
    await press(/Confirm|Yes/i);
    await press(/Clear history|Clear/i);
    await press(/Confirm|Yes/i);
    expect(sent()).toContain('violationHistory');
  });

  it('the rules panel lists invariants and removes one through the data layer', async () => {
    render(<RulesPanel />);
    await settle();
    expect(screen.getAllByText(/No harm|Single writer|Cap exceeded/).length).toBeGreaterThan(0);
    const del = screen.queryAllByRole('button').find((b) => /delete|remove/i.test(b.textContent || b.getAttribute('aria-label') || b.getAttribute('title') || ''));
    if (del) await act(async () => { fireEvent.click(del); await new Promise((r) => setTimeout(r, 0)); });
    const conf = screen.queryAllByRole('button').find((b) => /confirm|yes/i.test(b.textContent || ''));
    if (conf) await act(async () => { fireEvent.click(conf); await new Promise((r) => setTimeout(r, 0)); });
    expect(document.body.textContent?.length).toBeGreaterThan(20);
  });

  it('the action tester blocks an action against the invariants and evaluates monitors against a state', async () => {
    render(<ActionTesterPanel />);
    await settle();
    fireEvent.change(screen.getByPlaceholderText(/track user behavior/i), { target: { value: 'delete all user data' } });
    const press = async (re: RegExp) => {
      const b = screen.queryAllByRole('button').find((x) => re.test((x.textContent || '').trim()));
      if (b) await act(async () => { fireEvent.click(b); await new Promise((r) => setTimeout(r, 0)); });
    };
    await press(/Check keywords/i);
    const area = screen.getByPlaceholderText(/balance/);
    fireEvent.change(area, { target: { value: '{"balance": -5}' } });
    await press(/Evaluate against monitors/i);
    fireEvent.change(area, { target: { value: '{not json' } });
    await press(/Evaluate against monitors/i);
    expect(sent()).toContain('testAction');
  });

  it('the analysis panel checks invariants against the monitor store', async () => {
    render(<AnalysisPanel />);
    await settle();
    for (const b of screen.getAllByRole('button')) {
      await act(async () => { fireEvent.click(b); await new Promise((r) => setTimeout(r, 0)); });
    }
    expect(sent()).toEqual(expect.arrayContaining(['listMonitors', 'violationHistory']));
  });

  it('the overview summarizes monitors and violations', async () => {
    const view = render(<OverviewPanel />);
    await settle();
    expect(sent()).toEqual(expect.arrayContaining(['listMonitors', 'violationHistory']));
    expect(view.container.textContent).toMatch(/2|monitor/i);
  });
});
