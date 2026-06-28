/**
 * /lenses/hr — four-UX-state contract for the HR lens's compute surface.
 *
 * The HR lens's load-bearing wired surface is HrActionPanel's four pure
 * calculators (compensationBenchmark / turnoverAnalysis / interviewScorecard /
 * ptoBalance), each driven through the REAL channel:
 *   HrActionPanel → callMacro(action, input) →
 *   apiHelpers.lens.runDomain('hr', action, { input })
 * and rendered field-for-field into result cards. Before the 2026-06-28
 * alignment fix EVERY card was DEAD (handler returned a different field set than
 * the card reads) — so this test pins the four states against that real channel
 * AND the EXACT rendered fields, so a green test can't coexist with blank cards:
 *
 *   EMPTY     — panel mounted, nothing run yet → NO result card, honest idle
 *   LOADING   — an in-flight macro → the pressed action shows a busy spinner
 *   ERROR     — a failed macro ({ok:false}) → a role-bearing red feedback line
 *               (the exact handler error), never a swallowed-fetch silent-empty
 *   POPULATED — a real macro result renders the EXACT aligned fields
 *               (market50 / ratePct / recommendation / remaining)
 *
 * No fabricated data: every state is driven by a mocked runDomain standing in
 * for the real /api/lens/run backend, returning the handler's true envelope
 * shape ({ data: { ok, result } }).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── the real compute channel: apiHelpers.lens.runDomain ─────────────────────
const runDomain = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })), get: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a) } },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
}));

// panel-polish piping + recall: inert (no substrate side effects in the test).
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({ run: async (fn: () => Promise<unknown>) => fn() }),
  RecallSlot: () => null,
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, { get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]) });
});

import { HrActionPanel } from '@/components/hr/HrActionPanel';

beforeEach(() => {
  runDomain.mockReset();
});

// Helper: type into an input by placeholder, then click an action button by its
// visible label.
function setInput(container: HTMLElement, placeholder: string, value: string) {
  const el = container.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement;
  expect(el).toBeTruthy();
  fireEvent.change(el, { target: { value } });
}
function clickAction(getAllByText: (t: string) => HTMLElement[], label: string) {
  // the action label appears once as the button caption.
  const btn = getAllByText(label).find((n) => n.closest('button'))?.closest('button') as HTMLButtonElement;
  expect(btn).toBeTruthy();
  fireEvent.click(btn);
}

describe('hr lens — four UX states (HrActionPanel compute surface)', () => {
  it('WIRING: a comp run calls runDomain on the hr domain with compensationBenchmark + the flat input the handler reads', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { role: 'Senior Engineer', market50: 247, market75: 291, rangeLow: 193, rangeHigh: 301, offerSuggestion: 269 } } });
    const { container, getAllByText } = render(<HrActionPanel />);
    setInput(container, 'Role (e.g. Senior Engineer)', 'Senior Engineer');
    setInput(container, 'Location', 'SF');
    await act(async () => { clickAction(getAllByText, 'Comp'); });
    await waitFor(() => expect(runDomain).toHaveBeenCalled());
    const [domain, action, body] = runDomain.mock.calls[0];
    expect(domain).toBe('hr');
    expect(action).toBe('compensationBenchmark');
    // the component sends FLAT { input: { role, location } } — the shape the
    // dispatch sets as virtualArtifact.data the handler reads.
    expect(body).toEqual({ input: { role: 'Senior Engineer', location: 'SF' } });
  });

  it('EMPTY: nothing run yet → no comp/turnover/interview/pto result card is rendered', () => {
    const { queryByText } = render(<HrActionPanel />);
    // result cards key off computed labels; none should be present at idle.
    expect(queryByText(/median/i)).toBeNull();
    expect(queryByText(/vs benchmark/i)).toBeNull();
    expect(queryByText(/threshold/i)).toBeNull();
    expect(queryByText(/rollover/i)).toBeNull();
  });

  it('LOADING: an in-flight comp macro shows a busy spinner on the pressed action', async () => {
    let resolve!: (v: unknown) => void;
    runDomain.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { container, getAllByText } = render(<HrActionPanel />);
    setInput(container, 'Role (e.g. Senior Engineer)', 'Senior Engineer');
    await act(async () => { clickAction(getAllByText, 'Comp'); });
    // the Comp button swaps its icon for the Loader2 spinner while busy.
    await waitFor(() => expect(container.querySelector('[data-testid="icon-Loader2"]')).toBeTruthy());
    await act(async () => { resolve({ data: { ok: true, result: { role: 'x', market50: 100, market75: 118, rangeLow: 78, rangeHigh: 122, offerSuggestion: 109 } } }); });
  });

  it('ERROR: a failed macro surfaces the exact handler error, never a silent-empty', async () => {
    runDomain.mockResolvedValue({ data: { ok: false, error: 'role required' } });
    const { container, getAllByText, getByText } = render(<HrActionPanel />);
    setInput(container, 'Role (e.g. Senior Engineer)', 'Senior Engineer');
    await act(async () => { clickAction(getAllByText, 'Comp'); });
    // honest error feedback, not a swallowed empty: the handler's error string shows.
    await waitFor(() => expect(getByText(/role required/i)).toBeInTheDocument());
    // and NO comp result card was fabricated.
    expect(() => getByText(/median/i)).toThrow();
  });

  it('POPULATED: each calculator renders the EXACT aligned fields it reads', async () => {
    // Comp → role/market50/market75/rangeLow/rangeHigh/offerSuggestion. The card
    // renders "$247k" + "median", "range $193-$301k · 75th $291k", and the
    // suggested-offer line — every field the handler now returns.
    runDomain.mockResolvedValueOnce({ data: { ok: true, result: { role: 'Senior Engineer', market50: 247, market75: 291, rangeLow: 193, rangeHigh: 301, offerSuggestion: 269 } } });
    const { container, getAllByText, getByText } = render(<HrActionPanel />);
    setInput(container, 'Role (e.g. Senior Engineer)', 'Senior Engineer');
    setInput(container, 'Location', 'SF');
    await act(async () => { clickAction(getAllByText, 'Comp'); });
    await waitFor(() => expect(getByText('median')).toBeInTheDocument());
    expect(getByText('range $193-$301k · 75th $291k')).toBeInTheDocument();
    expect(getByText('Suggested offer: $269k')).toBeInTheDocument();

    // Turnover → ratePct/benchmarkPct/band/topReason
    runDomain.mockResolvedValueOnce({ data: { ok: true, result: { ratePct: 26.1, benchmarkPct: 13, topReason: 'Compensation below market', band: 'critical' } } });
    setInput(container, 'Headcount', '100');
    setInput(container, 'Leavers 12mo', '30');
    await act(async () => { clickAction(getAllByText, 'Turnover'); });
    await waitFor(() => expect(getByText('Turnover (critical)')).toBeInTheDocument());
    expect(getByText('26.1%')).toBeInTheDocument();
    expect(getByText('vs benchmark 13%')).toBeInTheDocument();
    expect(getByText('Top reason: Compensation below market')).toBeInTheDocument();

    // Interview → totalScore/passingScore/recommendation/topStrengths/topWeaknesses
    runDomain.mockResolvedValueOnce({ data: { ok: true, result: { candidate: 'Dana', totalScore: 60, passingScore: 70, recommendation: 'maybe', topStrengths: ['technical'], topWeaknesses: ['systems'] } } });
    setInput(container, 'Candidate name', 'Dana');
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'technical 5\nsystems 1' } });
    await act(async () => { clickAction(getAllByText, 'Interview'); });
    await waitFor(() => expect(getByText('maybe')).toBeInTheDocument());
    expect(getByText('60/70 threshold')).toBeInTheDocument();
    expect(getByText('+ technical')).toBeInTheDocument();
    expect(getByText('⚠ systems')).toBeInTheDocument();

    // PTO → accrued/used/remaining/rolloverDate
    runDomain.mockResolvedValueOnce({ data: { ok: true, result: { employeeId: 'emp_42', accrued: 14, used: 3, remaining: 11, rolloverDate: '2027-01-01' } } });
    setInput(container, 'Employee id (PTO)', 'emp_42');
    setInput(container, 'PTO days/yr', '24');
    await act(async () => { clickAction(getAllByText, 'PTO'); });
    await waitFor(() => expect(getByText('11d')).toBeInTheDocument());
    expect(getByText('accrued 14 · used 3')).toBeInTheDocument();
    expect(getByText('rollover: 2027-01-01')).toBeInTheDocument();
  });
});
