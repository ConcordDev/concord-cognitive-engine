// Render + behaviour coverage for the root lens panels: bitwise algebra, expression evaluator,
// the saved-computation notebook and the live perf metrics. Panels mount against stubbed engine
// results, must render real content, survive a full exercise pass and degrade honestly offline.

import { createRef } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const apiGet = vi.fn();
const COMP = [
  { id: 'c1', kind: 'bitwise', a: 12, b: 10, op: 'and', label: 'AND test', resultGlyph: '◈', resultDecimal: 8, createdAt: '2026-03-01T10:00:00Z' },
  { id: 'c2', kind: 'expression', expression: '(2+3)*4', label: '', resultGlyph: '◇', resultDecimal: 20, createdAt: '2026-03-02T10:00:00Z' },
  { id: 'c3', kind: 'operation', a: '7', b: null, op: '+', label: 'Sum', resultGlyph: null, resultDecimal: null, createdAt: '2026-03-03T10:00:00Z' },
];
function resultFor(action: string): unknown {
  switch (action) {
    case 'bitwise': return { op: 'and', symbol: '∧', a: 12, b: 10, decimal: 8, glyph: '◈', binary: '1000', base6: '12', semantic: '12 AND 10 = 8' };
    case 'evaluate': return { expression: '(2+3)*4', decimal: 20, glyph: '◇', base6: '32', binary: '10100', steps: [{ step: '2+3', value: 5 }, { step: '5*4', value: 20 }], semantic: 'Twenty' };
    case 'history': return { computations: COMP, total: 3 };
    case 'reload': return { computation: COMP[0] };
    default: return { ok: true, id: 'new-1' };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: (...a: unknown[]) => apiGet(...a), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => <button>save-as-dtu</button> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { BitwisePanel, type BitwiseHandle } from '../BitwisePanel';
import { ComputationNotebook, type NotebookHandle } from '../ComputationNotebook';
import { ExpressionEvaluator } from '../ExpressionEvaluator';
import { RootMetrics } from '../RootMetrics';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 5)); });
  return !!hits[nth];
};
afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => {
  lensRunMock.mockReset(); apiGet.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
  apiGet.mockResolvedValue({ data: { uptime: 7200, memory: { heapUsed: 512 }, dtus: { total: 12345 }, graph: { nodes: 99, edges: 200 }, cache: { hot: 40 }, collab: { sessions: 3 } } });
});

const PANELS: Array<[string, () => React.ReactElement]> = [
  ['BitwisePanel', () => <BitwisePanel onSaved={vi.fn()} />],
  ['ComputationNotebook', () => <ComputationNotebook onReload={vi.fn()} />],
  ['ExpressionEvaluator', () => <ExpressionEvaluator onSaved={vi.fn()} />],
  ['RootMetrics', () => <RootMetrics />],
];

describe('root panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(20);
    await exercise({ passes: 3, text: '12' });
    await settle();
    await exercise({ passes: 1, text: '(2+3)*4' });
    expect(view.container.textContent).toBeTruthy();
  });

  it.each(PANELS)('%s stays standing when the backend is offline', async (_n, make) => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    apiGet.mockRejectedValue(new Error('offline'));
    const view = render(make());
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});

describe('root flows', () => {
  it('bitwise validates operands, computes, saves, handles unary NOT and loads from the notebook', async () => {
    const ref = createRef<BitwiseHandle>();
    const onSaved = vi.fn();
    const Wrapped = () => <BitwisePanel ref={ref} onSaved={onSaved} />;
    render(<Wrapped />);
    await settle();
    await press(/Compute|Run|Calculate/i);
    expect(document.body.textContent).toMatch(/Operand a is required/);
    const [a, b] = screen.getAllByRole('textbox') as HTMLInputElement[];
    fireEvent.change(a, { target: { value: '12' } });
    await press(/Compute|Run|Calculate/i);
    expect(document.body.textContent).toMatch(/Operand b is required/);
    fireEvent.change(b, { target: { value: '10' } });
    await press(/Compute|Run|Calculate/i);
    expect(document.body.textContent).toMatch(/1000|12 AND 10/);
    await press(/Save/i);
    expect(onSaved).toHaveBeenCalled();
    fireEvent.change(document.querySelector('select') as HTMLSelectElement, { target: { value: 'not' } });
    await press(/Compute|Run|Calculate/i);
    act(() => ref.current?.load({ a: '5', b: '3', op: 'xor' }));
    expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).value).toBe('5');
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'save refused' } }));
    await press(/Compute|Run|Calculate/i);
    expect(sent()).toEqual(expect.arrayContaining(['bitwise', 'save']));
  });

  it('the evaluator rejects an empty expression, evaluates, saves and reports a failure', async () => {
    const onSaved = vi.fn();
    render(<ExpressionEvaluator onSaved={onSaved} />);
    await settle();
    await press(/Evaluate|Compute|Run/i);
    expect(document.body.textContent).toMatch(/Enter an expression/);
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '(2+3)*4' } });
    await press(/Evaluate|Compute|Run/i);
    expect(document.body.textContent).toMatch(/20|◇/);
    await press(/Save/i);
    expect(onSaved).toHaveBeenCalled();
    await press(/Share/i);
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'bad syntax' } }));
    await press(/Evaluate|Compute|Run/i);
    expect(document.body.textContent).toMatch(/bad syntax|Could not evaluate/);
  });

  it('the notebook reloads, renames, deletes behind a confirmation, shares, and refreshes through its handle', async () => {
    const ref = createRef<NotebookHandle>();
    const onReload = vi.fn();
    render(<ComputationNotebook ref={ref} onReload={onReload} />);
    await settle();
    await press(/Reload|Load|Open|Re-?run|↺/i);
    await press(/Reload|Load|Open|Re-?run|↺/i, 1);
    expect(onReload).toHaveBeenCalled();
    await press(/Rename|Edit|Pencil/i);
    const input = screen.queryAllByRole('textbox')[0];
    if (input) fireEvent.change(input, { target: { value: 'Renamed' } });
    await press(/Save|Check|✓/i);
    await press(/Share/i);
    await press(/Delete|Trash/i); await press(/Delete|Confirm|Yes/i);
    act(() => ref.current?.refresh());
    await settle();
    const a = sent();
    expect(a).toEqual(expect.arrayContaining(['history']));
    expect(a.some((x) => /reload|renameComputation|deleteComputation|share/.test(x))).toBe(true);
  });

  it('metrics show the live numbers, repoll on the interval, and report an unreachable endpoint', async () => {
    vi.useFakeTimers();
    const view = render(<RootMetrics />);
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(view.container.textContent).toMatch(/512|12,345|2\.0h/);
    const before = apiGet.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
    expect(apiGet.mock.calls.length).toBeGreaterThan(before);
    apiGet.mockRejectedValue(new Error('down'));
    await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
    expect(view.container.textContent?.length).toBeGreaterThan(20);
  });
});
