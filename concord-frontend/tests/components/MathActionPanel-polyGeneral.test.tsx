/**
 * MathActionPanel — polynomialRootsGeneral (Durand-Kerner "Poly⁺" action).
 *
 * server/domains/math.js#polynomialRootsGeneral is the arbitrary-degree
 * companion to polynomialAnalysis (which only solves degree<=4). This file
 * pins the UI contract for that macro specifically:
 *   - real macro call with real coefficients (domain/action/input shape)
 *   - complex-root rendering (`2 + 3i` / `2 − 3i` style, real roots plain)
 *   - honest non-convergence indicator — a `converged:false` root must be
 *     visibly flagged, never silently presented as an exact answer
 *     (per CLAUDE.md: fabricated precision is a correctness bug, not polish)
 *
 * We mock the single backend channel (apiHelpers.lens.runDomain) in the
 * exact { data: { ok, result } } envelope callMacro() unwraps, and assert
 * against real rendered output — no fabricated data on either side.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

const runDomain = vi.fn();
const apiPost = vi.fn(() => Promise.resolve({ data: {} }));
const apiDelete = vi.fn(() => Promise.resolve({ data: {} }));

vi.mock('@/lib/api/client', () => ({
  api: { post: (...a: unknown[]) => apiPost(...a), delete: (...a: unknown[]) => apiDelete(...a) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a) } },
}));

// panel-polish: inert piping + recall (no real undo timers in the test) — same
// stand-in pattern as tests/analytics-lens-states.test.tsx.
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({ run: async (fn: () => Promise<unknown>) => fn(), label: '' }),
  RecallSlot: () => null,
}));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import { MathActionPanel } from '@/components/math/MathActionPanel';

function setPolyCoefficients(utils: ReturnType<typeof render>, csv: string) {
  const { container } = utils;
  const labels = Array.from(container.querySelectorAll('label'));
  const label = labels.find((l) => /Polynomial coef/i.test(l.textContent || ''));
  const ta = label?.parentElement?.querySelector('textarea') as HTMLTextAreaElement;
  fireEvent.change(ta, { target: { value: csv } });
}

async function runPolyGeneral(utils: ReturnType<typeof render>, csv: string) {
  setPolyCoefficients(utils, csv);
  await act(async () => { fireEvent.click(utils.getByText('Poly⁺')); });
}

beforeEach(() => {
  runDomain.mockReset();
  apiPost.mockReset();
  apiPost.mockImplementation(() => Promise.resolve({ data: {} }));
  apiDelete.mockReset();
});

describe('MathActionPanel — Poly⁺ (polynomialRootsGeneral) — real macro call', () => {
  it('calls the math domain with the polynomialRootsGeneral action and the parsed coefficients', async () => {
    runDomain.mockResolvedValue({
      data: { ok: true, result: { degree: 2, coefficients: [1, -5, 6], leadingZerosStripped: 0,
        roots: [
          { re: 2, im: 0, isReal: true, converged: true },
          { re: 3, im: 0, isReal: true, converged: true },
        ], allConverged: true, iterations: 9, method: 'durand-kerner', maxIterations: 500 } },
    });
    const utils = render(<MathActionPanel />);
    await runPolyGeneral(utils, '1, -5, 6');
    await waitFor(() => expect(runDomain).toHaveBeenCalled());
    const [domain, action, payload] = runDomain.mock.calls[0] as [string, string, { input?: { coefficients?: number[] } }];
    expect(domain).toBe('math');
    expect(action).toBe('polynomialRootsGeneral');
    expect(payload?.input?.coefficients).toEqual([1, -5, 6]);
  });

  it('rejects with no backend call when fewer than 2 coefficients are given', async () => {
    const utils = render(<MathActionPanel />);
    await runPolyGeneral(utils, '5');
    expect(utils.getByText(/Add polynomial coefficients/i)).toBeInTheDocument();
    expect(runDomain).not.toHaveBeenCalled();
  });
});

describe('MathActionPanel — Poly⁺ — real complex-root rendering', () => {
  it('renders a mix of real and complex roots in 2±3i style, all converged, no warning', async () => {
    // x^4 - 1 → {1, -1, i, -i}
    runDomain.mockResolvedValue({
      data: { ok: true, result: { degree: 4, coefficients: [1, 0, 0, 0, -1], leadingZerosStripped: 0,
        roots: [
          { re: -1, im: 0, isReal: true, converged: true },
          { re: 0, im: -1, isReal: false, converged: true },
          { re: 0, im: 1, isReal: false, converged: true },
          { re: 1, im: 0, isReal: true, converged: true },
        ], allConverged: true, iterations: 13, method: 'durand-kerner', maxIterations: 500 } },
    });
    const utils = render(<MathActionPanel />);
    await runPolyGeneral(utils, '1, 0, 0, 0, -1');
    await waitFor(() => expect(utils.getByText(/Poly⁺ \(Durand-Kerner\)/)).toBeInTheDocument());
    // real roots render as plain numbers
    expect(utils.getByText('1.0000')).toBeInTheDocument();
    expect(utils.getByText('-1.0000')).toBeInTheDocument();
    // complex roots render in "0.0000 + 1.0000i" / "0.0000 − 1.0000i" form
    expect(utils.getByText('0.0000 + 1.0000i')).toBeInTheDocument();
    expect(utils.getByText('0.0000 − 1.0000i')).toBeInTheDocument();
    // 2 real + 2 complex labels
    expect(utils.getAllByText('(real)').length).toBe(2);
    expect(utils.getAllByText('(complex)').length).toBe(2);
    // no non-convergence warning anywhere
    expect(utils.queryByText(/not all roots converged/i)).toBeNull();
    expect(utils.container.textContent).not.toMatch(/⚠/);
  });

  it('renders a complex-conjugate pair with the correct sign formatting', async () => {
    // (x-1)(x-2-3i)(x-2+3i) → {1, 2+3i, 2-3i}
    runDomain.mockResolvedValue({
      data: { ok: true, result: { degree: 3, coefficients: [1, -5, 17, -13], leadingZerosStripped: 0,
        roots: [
          { re: 1, im: 0, isReal: true, converged: true },
          { re: 2, im: -3, isReal: false, converged: true },
          { re: 2, im: 3, isReal: false, converged: true },
        ], allConverged: true, iterations: 10, method: 'durand-kerner', maxIterations: 500 } },
    });
    const utils = render(<MathActionPanel />);
    await runPolyGeneral(utils, '1, -5, 17, -13');
    await waitFor(() => expect(utils.getByText('2.0000 + 3.0000i')).toBeInTheDocument());
    expect(utils.getByText('2.0000 − 3.0000i')).toBeInTheDocument();
  });
});

describe('MathActionPanel — Poly⁺ — honest non-convergence indicator', () => {
  it('flags allConverged:false with a visible warning and marks the specific unconverged root', async () => {
    // (x-2)^3 — the genuine Durand-Kerner slow-convergence failure case.
    runDomain.mockResolvedValue({
      data: { ok: true, result: { degree: 3, coefficients: [1, -6, 12, -8], leadingZerosStripped: 0,
        roots: [
          { re: 1.9999956474, im: 0.0000075684, isReal: true, converged: false },
          { re: 2.0000003509, im: 0.0000006559, isReal: true, converged: false },
          { re: 2.0000018701, im: -0.0000029063, isReal: true, converged: false },
        ], allConverged: false, iterations: 500, method: 'durand-kerner', maxIterations: 500,
        note: 'One or more roots did not converge below tolerance within the iteration budget — a known Durand-Kerner limitation for polynomials with very close or repeated roots. Treat roots with converged:false as approximate, not exact.' } },
    });
    const utils = render(<MathActionPanel />);
    await runPolyGeneral(utils, '1, -6, 12, -8');
    // visible header warning
    await waitFor(() => expect(utils.getByText(/not all roots converged/i)).toBeInTheDocument());
    // per-root warning glyph present (at least one root marked unconverged)
    expect(utils.getAllByText('⚠').length).toBeGreaterThan(0);
    // the honest limitation note is surfaced verbatim, not hidden
    expect(utils.getByText(/known Durand-Kerner limitation/i)).toBeInTheDocument();
    // the feedback row also carries an honest (not celebratory) message
    await waitFor(() => expect(utils.getByText(/not all converged/i)).toBeInTheDocument());
  });

  it('a fully-converged result shows the ok feedback and no warning glyph', async () => {
    runDomain.mockResolvedValue({
      data: { ok: true, result: { degree: 2, coefficients: [1, -5, 6], leadingZerosStripped: 0,
        roots: [
          { re: 2, im: 0, isReal: true, converged: true },
          { re: 3, im: 0, isReal: true, converged: true },
        ], allConverged: true, iterations: 9, method: 'durand-kerner', maxIterations: 500 } },
    });
    const utils = render(<MathActionPanel />);
    await runPolyGeneral(utils, '1, -5, 6');
    await waitFor(() => expect(utils.getByText(/all converged/i)).toBeInTheDocument());
    expect(utils.queryByText(/not all roots converged/i)).toBeNull();
  });
});

describe('MathActionPanel — Poly⁺ — backend refusal is surfaced, not swallowed', () => {
  it('an {ok:false} refusal (e.g. all-zero polynomial) shows the real error text', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: false, error: 'The zero polynomial has infinitely many roots — not a well-posed root-finding request.' } } });
    const utils = render(<MathActionPanel />);
    await runPolyGeneral(utils, '0, 0, 0');
    await waitFor(() => expect(utils.getByText(/zero polynomial has infinitely many roots/i)).toBeInTheDocument());
  });
});
