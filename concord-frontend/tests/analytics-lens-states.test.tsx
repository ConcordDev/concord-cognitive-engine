/**
 * /lenses/analytics — four-UX-state contract for the analyst-bench calculator
 * surface (AnalyticsActionPanel), the PATH-3 component that drives the four
 * pure-compute analytics calculators:
 *   funnelAnalysis · cohortAnalysis · detectAnomalies · trendForecast
 *
 * The panel reaches the backend through apiHelpers.lens.runDomain('analytics',
 * action, { input: { artifact: { data } } }) → POST /api/lens/run. We mock that
 * single channel and pin:
 *   IDLE/EMPTY  — no JSON pasted: clicking a calculator surfaces an honest
 *                 "Paste ... JSON first" cue and renders NO result card (the
 *                 component never round-trips an empty textarea).
 *   LOADING     — while runDomain is in-flight the clicked action shows a busy
 *                 spinner and every action button is disabled.
 *   ERROR       — a backend {ok:false} (and a thrown request) surfaces the error
 *                 text in a visible feedback row — NOT a swallowed fetch that
 *                 leaves a silent-empty surface. This is the regression the
 *                 dead-calculator class hides behind.
 *   POPULATED   — a real result renders the EXACT fields the component reads
 *                 (funnel overallConversion + per-stage bar; trend slope +
 *                 forecast). A guidance {message} result does NOT crash the
 *                 stages/forecast map — it routes to the feedback row.
 *
 * No fabricated data — every state is produced by a mocked runDomain standing in
 * for the real dispatch in the exact { ok, result } envelope it returns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── the one backend channel: apiHelpers.lens.runDomain ──────────────────────
const runDomain = vi.fn();
const apiPost = vi.fn(() => Promise.resolve({ data: {} }));
const apiDelete = vi.fn(() => Promise.resolve({ data: {} }));

vi.mock('@/lib/api/client', () => ({
  api: { post: (...a: unknown[]) => apiPost(...a), delete: (...a: unknown[]) => apiDelete(...a) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a) } },
}));

// panel-polish: inert piping + recall (no real undo timers in the test).
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({ run: async (fn: () => Promise<unknown>) => fn(), label: '' }),
  RecallSlot: () => null,
}));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import { AnalyticsActionPanel } from '@/components/analytics/AnalyticsActionPanel';

// Helper: type real JSON into a labelled textarea, then click its calculator.
function pasteAndRun(
  utils: ReturnType<typeof render>,
  labelText: RegExp,
  json: unknown,
  buttonText: string,
) {
  const { container, getByText } = utils;
  const labels = Array.from(container.querySelectorAll('label'));
  const label = labels.find((l) => labelText.test(l.textContent || ''));
  const ta = label?.parentElement?.querySelector('textarea') as HTMLTextAreaElement;
  fireEvent.change(ta, { target: { value: JSON.stringify(json) } });
  return act(async () => { fireEvent.click(getByText(buttonText)); });
}

beforeEach(() => {
  runDomain.mockReset();
  apiPost.mockReset();
  apiPost.mockImplementation(() => Promise.resolve({ data: {} }));
  apiDelete.mockReset();
});

describe('analytics action panel — IDLE / EMPTY', () => {
  it('clicking Funnel with no JSON surfaces an honest cue and runs NO backend call', async () => {
    const utils = render(<AnalyticsActionPanel />);
    await act(async () => { fireEvent.click(utils.getByText('Funnel')); });
    expect(utils.getByText(/Paste funnel JSON first/i)).toBeInTheDocument();
    expect(runDomain).not.toHaveBeenCalled();
    // no result card rendered
    expect(utils.container.textContent).not.toMatch(/top-to-bottom|Funnel · /);
  });
});

describe('analytics action panel — LOADING', () => {
  it('shows a busy spinner + disables actions while the funnel request is in flight', async () => {
    let resolve!: (v: unknown) => void;
    runDomain.mockReturnValue(new Promise((r) => { resolve = r; }));
    const utils = render(<AnalyticsActionPanel />);
    await pasteAndRun(utils, /Funnel JSON/i, { stages: [{ name: 'A', count: 100 }, { name: 'B', count: 50 }] }, 'Funnel');
    // mid-flight: a spinner element is present and buttons are disabled.
    await waitFor(() => expect(utils.container.querySelector('.animate-spin')).toBeTruthy());
    const buttons = Array.from(utils.container.querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons.some((b) => b.disabled)).toBe(true);
    // settle so React state updates don't leak across tests.
    await act(async () => { resolve({ data: { ok: true, result: { ok: true, result: { stages: [], overallConversion: 0 } } } }); });
  });
});

describe('analytics action panel — ERROR (not swallowed → silent empty)', () => {
  it('a backend {ok:false} surfaces the error text in the feedback row', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: false, error: 'compute offline' } } });
    const utils = render(<AnalyticsActionPanel />);
    await pasteAndRun(utils, /Funnel JSON/i, { stages: [{ name: 'A', count: 1 }, { name: 'B', count: 1 }] }, 'Funnel');
    await waitFor(() => expect(utils.getByText(/compute offline/i)).toBeInTheDocument());
    // no result card leaked.
    expect(utils.container.textContent).not.toMatch(/top-to-bottom/);
  });

  it('a thrown request is caught and surfaced, not swallowed into a blank panel', async () => {
    runDomain.mockRejectedValue(new Error('network down'));
    const utils = render(<AnalyticsActionPanel />);
    await pasteAndRun(utils, /Time series JSON/i, { dataPoints: [{ value: 1 }, { value: 2 }, { value: 3 }] }, 'Forecast');
    await waitFor(() => expect(utils.getByText(/network down/i)).toBeInTheDocument());
  });

  it('a guidance {message} result routes to feedback and does NOT crash the stages map', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: true, result: { message: 'Add at least 2 funnel stages with counts.' } } } });
    const utils = render(<AnalyticsActionPanel />);
    await pasteAndRun(utils, /Funnel JSON/i, { stages: [{ name: 'Only', count: 10 }] }, 'Funnel');
    await waitFor(() => expect(utils.getByText(/Add at least 2 funnel stages/i)).toBeInTheDocument());
    expect(utils.container.textContent).not.toMatch(/Funnel · /);
  });
});

describe('analytics action panel — POPULATED', () => {
  it('renders the real funnel result fields the component reads', async () => {
    runDomain.mockResolvedValue({
      data: { ok: true, result: { ok: true, result: {
        stages: [
          { stage: 'Visit', count: 1000, dropoff: 0, conversionFromTop: 100 },
          { stage: 'Buy', count: 80, dropoff: 92, conversionFromTop: 8 },
        ],
        overallConversion: 8, worstDropoff: 'Buy', worstDropoffRate: 92,
      } } } },
    );
    const utils = render(<AnalyticsActionPanel />);
    await pasteAndRun(utils, /Funnel JSON/i, { stages: [{ name: 'Visit', count: 1000 }, { name: 'Buy', count: 80 }] }, 'Funnel');
    await waitFor(() => expect(utils.getByText(/Funnel · 8%/i)).toBeInTheDocument());
    expect(utils.getByText('Visit')).toBeInTheDocument();
    expect(utils.getByText('Buy')).toBeInTheDocument();
    expect(utils.getByText(/worst drop: Buy \(92%\)/i)).toBeInTheDocument();
  });

  it('renders the real trend forecast result fields (slope + per-period prediction)', async () => {
    runDomain.mockResolvedValue({
      data: { ok: true, result: { ok: true, result: {
        trend: 'upward', slope: 10, dataPoints: 4, lastValue: 40,
        forecast: [{ periodsAhead: 1, predicted: 50 }, { periodsAhead: 5, predicted: 90 }],
        confidence: 'low',
      } } } },
    );
    const utils = render(<AnalyticsActionPanel />);
    await pasteAndRun(utils, /Time series JSON/i, { dataPoints: [{ value: 10 }, { value: 20 }, { value: 30 }, { value: 40 }] }, 'Forecast');
    await waitFor(() => expect(utils.getByText('upward')).toBeInTheDocument());
    expect(utils.getByText(/slope 10 · last 40/i)).toBeInTheDocument();
    expect(utils.getByText('50')).toBeInTheDocument();
    expect(utils.getByText('90')).toBeInTheDocument();
  });
});
