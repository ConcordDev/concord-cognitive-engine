// Render coverage for the math panels: notebook, Q&A feed, action panel and the
// symbolic workbench each mount against stubbed macros, then the sweep drives them.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../tests/helpers/exercise';

const T = '2026-03-01T10:00:00.000Z';
const lensRunMock = vi.fn();
const runDomainMock = vi.fn();
const apiPost = vi.fn();
const SERIES = [{ expression: 'x^2', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], definedPoints: 2 }];
const LENS: Record<string, unknown> = {
  naturalQuery: { kind: 'evaluate', answer: 42 },
  casHistory: { recorded: true, history: [{ kind: 'naturalQuery', input: '6*7', answer: 42, at: T }, { kind: 'plot', input: 'x', error: 'bad', at: T }] },
  symbolicCompute: { output: 'x^2', derivative: '2x' },
  stepSolve: { kind: 'linear', roots: [2], steps: ['subtract 2', 'divide by 1'] },
  plotFunction: { series: SERIES },
  unitConvert: { converted: 100, to: 'cm', from: 'm' },
  numberTheory: { tool: 'gcd', gcd: 6 },
};
const MATH: Record<string, unknown> = {
  statisticalAnalysis: { count: 5, mean: 3, median: 3, stdDev: 1, sampleStdDev: 1.1, modes: [3], min: 1, max: 5, q1: 2, q3: 4 },
  matrixOperations: { matrix: [[1, 2], [3, 4]], determinant: -2, rank: 2, fullRank: true, eigenvalues: [1.5, { real: 2, imag: 1 }] },
  polynomialAnalysis: { degree: 2, roots: [1, 2], derivative: '2x+1' },
  polynomialRootsGeneral: { degree: 3, roots: [{ re: 1, im: 0, isReal: true, converged: true }, { re: 2, im: 1, isReal: false, converged: true }], allConverged: true, iterations: 12, method: 'Durand-Kerner' },
  regressionFit: { coefficients: [2, 1], rSquared: 0.98, equation: 'y = 2x + 1' },
};

vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { post: (...a: unknown[]) => apiPost(...a), get: vi.fn(async () => ({ data: {} })), delete: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomainMock(...a) } },
}));
vi.mock('@/lib/public-lookup', () => ({
  publicLookup: vi.fn(async () => ({ items: [{ question_id: 1, title: 'Why is 0.999... = 1?', link: 'https://math.stackexchange.com/q/1', score: 12, answer_count: 3, view_count: 100, is_answered: true, tags: ['calculus'], accepted_answer_id: 2 }] })),
  carryLookupMeta: (_f: unknown, t: unknown) => t,
}));
vi.mock('@/components/common/LookupNotice', () => ({ LookupNotice: () => null }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => <button>Save as DTU</button>, default: () => <button>Save as DTU</button> }));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({ withContentLicense: (x: unknown) => x }));
vi.mock('@/components/viz', () => ({ ChartKit: () => <div data-testid="chart" /> }));
vi.mock('@/components/math/MathFormula', () => ({ MathFormula: ({ latex }: { latex: string }) => <span>{latex}</span> }));
vi.mock('@/components/ui/ErrorState', () => ({ ErrorState: () => <div role="alert" /> }));
vi.mock('@/components/ui/EmptyState', () => ({ EmptyState: () => <div /> }));
vi.mock('@/components/ui/Skeleton', () => ({ Skeleton: () => <div /> }));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn(), subscribe: vi.fn(), items: [] }),
  useRecallableAction: () => ({ run: vi.fn(async (fn: () => Promise<unknown>) => fn()), recall: vi.fn(), state: null, armed: false, slot: null }),
  RecallSlot: () => null,
}));
const mutate = vi.fn(async () => ({}));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (_d: string, type: string) => ({
    items: type === 'expression'
      ? [{ id: 'x1', title: '2+2', data: { expression: '2+2', result: '4', verified: true, evaluatedAt: T }, meta: { tags: [], status: 'proven', visibility: 'private' }, createdAt: T, updatedAt: T, version: 1 }]
      : [{ id: 'f1', title: 'Quadratic', data: { name: 'Quadratic', latex: 'x=\\frac{-b}{2a}', description: 'roots', category: 'algebra' }, meta: { tags: [], status: 'draft', visibility: 'private' }, createdAt: T, updatedAt: T, version: 1 }],
    isLoading: false, isError: false, error: null, refetch: vi.fn(), create: mutate, update: mutate, remove: mutate,
  }),
}));

import { FormulaNotebookPanel } from './FormulaNotebookPanel';
import { MathStackFeed } from './MathStackFeed';
import { MathActionPanel } from './MathActionPanel';
import { SymbolicWorkbench } from './SymbolicWorkbench';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset(); runDomainMock.mockReset(); apiPost.mockReset(); mutate.mockClear();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: LENS[actionOf(a)] ?? {}, error: null } }));
  runDomainMock.mockImplementation(async (_d: string, name: string) => ({ data: { ok: true, result: { ok: true, result: MATH[name] ?? { steps: ['a'], roots: [1] } } } }));
  apiPost.mockImplementation(async () => ({ data: { ok: true, result: { answer: 'done', dtu: { id: 'd1' } }, message: { id: 'm1' } } }));
});

describe.each([
  ['FormulaNotebookPanel', FormulaNotebookPanel],
  ['MathStackFeed', MathStackFeed],
  ['MathActionPanel', MathActionPanel],
  ['SymbolicWorkbench', SymbolicWorkbench],
])('%s', (_n, Comp: React.ComponentType) => {
  it('renders and drives its controls', async () => {
    const view = render(<Comp />);
    await settle();
    expect(view.container.textContent).toBeTruthy();
    await exercise({ passes: 6 });
    await settle();
  });
  it('survives offline macros', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    runDomainMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(<Comp />);
    await settle();
    await exercise({ passes: 1 });
    expect(view.container.textContent).toBeTruthy();
  });
});

describe('MathActionPanel numeric input', () => {
  it('runs every action with numeric data', async () => {
    const view = render(<MathActionPanel />);
    await settle();
    await exercise({ passes: 3, text: '1, 2, 3, 4' });
    await settle();
    expect(view.container.textContent).toBeTruthy();
  });
});

describe('SymbolicWorkbench panels', () => {
  it.each(['Ask', 'Symbolic CAS', 'Step Solver', 'Plotter', 'Units', 'Number Theory', 'History'])('walks the %s panel', async (label) => {
    render(<SymbolicWorkbench />);
    await settle();
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: new RegExp(`^${label}$`) })[0]); });
    await settle();
    await exercise({ passes: 3, skip: /^(ask|symbolic cas|step solver|plotter|units|number theory|history)$/i });
    await settle();
    expect(document.body.textContent).toBeTruthy();
  });
});
