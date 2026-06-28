/**
 * /lenses/aviation — four-UX-state contract for the Aviation bench
 * (components/aviation/AviationActionPanel.tsx — the named *ActionPanel).
 *
 * The panel's externally-loaded surface is the lens-run channel:
 *   apiHelpers.lens.runDomain('aviation', action, { input })  →  airport-lookup
 *   / weather-metar / perf-takeoff / perf-landing result cards.
 * This pins the four states against that REAL channel:
 *
 *   LOADING   — an in-flight perf calc → role="status" "Working…"
 *   ERROR     — a failed calc → role="alert" + a WORKING Retry that RE-RUNS
 *               the SAME action (runDomain fires again), never a swallowed-fetch
 *               silent-empty
 *   EMPTY     — no run yet → honest "No flight prep yet" CTA, no fabricated card
 *   POPULATED — a real perf-takeoff result renders its EXACT computed fields
 *               (groundRoll_ft / over50ft_ft / inputs.isaTemp)
 *
 * No fabricated data: the populated state asserts the EXACT fields the handler
 * returns (groundRoll_ft etc.), driven through a mocked runDomain standing in
 * for the real /api/lens/run backend in the exact envelope the panel consumes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── lens-run channel (drives loading/error/populated) ────────────────────────
const runDomain = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a) } },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
}));

// panel-polish: keep pipe/recall inert.
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({ run: (fn: () => Promise<unknown>) => fn(), label: '', pending: false, undo: vi.fn() }),
  RecallSlot: () => null,
}));

// framer-motion: render plain elements so animated nodes mount synchronously.
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

import { AviationActionPanel } from '@/components/aviation/AviationActionPanel';

// EXACT envelope the panel's callMacro unwraps: r.data.{ok,result}.
function envelope<T>(result: T) { return { data: { ok: true, result } }; }
const TAKEOFF_RESULT = { groundRoll_ft: 1240, over50ft_ft: 2269, inputs: { pressureAlt: 5000, oat: 25, weight: 2400, headwind: 0, slope: 0, isaTemp: 5 }, notes: 'Simplified C172 perf model.' };

function fillPerfInputs(container: HTMLElement) {
  const set = (placeholder: string, value: string) => {
    const el = container.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement;
    fireEvent.change(el, { target: { value } });
  };
  set('Press alt ft', '5000');
  set('OAT °C', '25');
  set('Weight lb', '2400');
  set('Headwind kt', '0');
  set('Slope %', '0');
}

beforeEach(() => {
  runDomain.mockReset();
  window.localStorage.clear();
});

describe('aviation lens — four UX states (AviationActionPanel)', () => {
  it('EMPTY: no run yet shows an honest CTA and no result card', () => {
    const { getByText, queryByText } = render(<AviationActionPanel />);
    expect(getByText(/No flight prep yet/i)).toBeInTheDocument();
    expect(queryByText(/ft roll/i)).toBeNull();
  });

  it('LOADING: an in-flight perf calc shows a role=status indicator', async () => {
    let resolve!: (v: unknown) => void;
    runDomain.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { container, getByText } = render(<AviationActionPanel />);
    fillPerfInputs(container);
    await act(async () => { fireEvent.click(getByText('Takeoff')); });
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
    await act(async () => { resolve(envelope(TAKEOFF_RESULT)); });
  });

  it('POPULATED: a real perf-takeoff result renders its EXACT computed fields', async () => {
    runDomain.mockResolvedValue(envelope(TAKEOFF_RESULT));
    const { container, getByText, findByText } = render(<AviationActionPanel />);
    fillPerfInputs(container);
    await act(async () => { fireEvent.click(getByText('Takeoff')); });
    // EXACT rendered fields from r.result: groundRoll_ft + over50ft_ft + inputs.isaTemp
    await findByText('1240');
    expect(getByText(/over 50 ft: 2269 ft/i)).toBeInTheDocument();
    expect(getByText(/ISA temp at alt: 5°C/i)).toBeInTheDocument();
    expect(runDomain).toHaveBeenCalledWith('aviation', 'perf-takeoff', { input: { pressureAlt: 5000, oat: 25, weight: 2400, headwind: 0, slope: 0 } });
  });

  it('ERROR: a failed calc shows role=alert + a working Retry that re-runs (not a silent empty)', async () => {
    runDomain.mockResolvedValue({ data: { ok: false, error: 'perf service offline' } });
    const { container, getByText, queryByText } = render(<AviationActionPanel />);
    fillPerfInputs(container);
    await act(async () => { fireEvent.click(getByText('Takeoff')); });

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/perf service offline/i)).toBeInTheDocument();
    // a silent-empty would fall back to the CTA — it must NOT.
    expect(queryByText(/No flight prep yet/i)).toBeNull();

    // Retry must re-invoke the backend (runDomain), not be a dead button.
    runDomain.mockClear();
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() => expect(runDomain).toHaveBeenCalledWith('aviation', 'perf-takeoff', expect.anything()));
  });
});
