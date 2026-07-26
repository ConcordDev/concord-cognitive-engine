/// <reference types="@testing-library/jest-dom/vitest" />
// QecDecoderPanel — behavioral tests against a mocked /api/lens/run,
// exercising the real response envelope shape for the four `quantum.qec*`
// macros. Mocks `api.post` (not `lensRun`) so the tests run through the
// REAL envelope-unwrap logic in lib/api/client.ts, the same convention
// MaterialsDegradationPanel.test.tsx uses.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

// Spy on the real axios instance's `post` rather than vi.mock-ing the whole
// client module. The panel calls `lensRun`, and `lensRun` closes over the
// module-scoped `api` object — so replacing the module's exports would leave
// `lensRun` undefined (and a module-mock that re-exports `lensRun` from
// importActual would still route through the ORIGINAL `api`, not the mock).
// Spying on the instance method intercepts at call time and keeps the REAL
// envelope-unwrap logic in lib/api/client.ts under test, which is the point.
import { api } from '@/lib/api/client';
const post = vi.spyOn(api, 'post');

import { QecDecoderPanel } from './QecDecoderPanel';
import { getFrontierEngine } from '@/lib/frontier-engines';

const engine = getFrontierEngine('qec-decoder')!;

// Real shape /api/lens/run sends over HTTP for a `registerLensAction`
// handler: `{ ok:true, result:<payload> }`, where <payload> is whatever
// `_unwrapLensEnvelope` extracted server-side (see server.js).
function httpResponse(payload: unknown) {
  return { data: { ok: true, result: payload } };
}

function routeByAction(handlers: Record<string, () => unknown>) {
  // Cast: axios's `post` is generic/overloaded, so a plain (url, body)
  // implementation isn't structurally assignable to its declared type.
  post.mockImplementation(((_url: string, body: { action: string }) => {
    const h = handlers[body.action];
    if (!h) return Promise.reject(new Error(`unexpected action ${body.action}`));
    return Promise.resolve(httpResponse(h()));
  }) as unknown as typeof api.post);
}

beforeEach(() => { post.mockReset(); });

describe('QecDecoderPanel', () => {
  it('shows the idle Verify state and the persistent honest-boundary cell before any run', () => {
    render(<QecDecoderPanel engine={engine} />);
    expect(screen.getByText(/Run the compute cell above/)).toBeInTheDocument();
    expect(screen.getByText(engine.boundary!)).toBeInTheDocument();
  });

  it('runs qecLatticeInfo with the real params and renders the real returned lattice facts', async () => {
    routeByAction({
      qecLatticeInfo: () => ({ d: 3, numNodes: 9, numQubits: 18, boundaryConditions: 'toroidal (periodic)', honestBoundary: engine.boundary }),
    });
    render(<QecDecoderPanel engine={engine} />);
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'lattice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByText('9')).toBeInTheDocument());
    expect(screen.getByText('18')).toBeInTheDocument();
    const [, body] = post.mock.calls.at(-1)!;
    expect(body).toMatchObject({ domain: 'quantum', action: 'qecLatticeInfo', input: { d: 3 } });
  });

  it('renders a real qecDecodeSingle logical failure with the actual error/syndrome/correction qubit sets, not fabricated ones', async () => {
    routeByAction({
      qecDecodeSingle: () => ({
        d: 3, numQubits: 18, channel: 'bitflip',
        errorQubits: [1, 5, 15], syndromeNodes: [0, 1, 2, 3, 5, 6], correctionQubits: [0, 9, 15, 11],
        rounds: 1, residualSyndromeClosed: true, logicalSuccess: false, logicalFailure: true,
        honestBoundary: engine.boundary,
      }),
    });
    render(<QecDecoderPanel engine={engine} />);
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'decode' } });
    // The honest no-op note for "depolarizing" on this specific macro.
    expect(screen.getByText(/does not change the sampling here/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByText(/Logical failure/)).toBeInTheDocument());
    const errorRow = screen.getByText('Error qubits (3)').parentElement!;
    expect(within(errorRow).getByText('1')).toBeInTheDocument();
    expect(within(errorRow).getByText('5')).toBeInTheDocument();
    expect(within(errorRow).getByText('15')).toBeInTheDocument();
  });

  it('accumulates a real per-session tally across repeated qecRunTrial runs (no fabricated aggregate)', async () => {
    render(<QecDecoderPanel engine={engine} />);
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'trial' } });

    post
      .mockImplementationOnce(() => Promise.resolve(httpResponse({
        d: 5, p: 0.08, channel: 'bitflip', success: true, logicalFailure: false, rounds: 2,
        errorWeight: 3, syndromeSize: 4, residualSyndromeClosed: true, honestBoundary: engine.boundary,
      })))
      .mockImplementationOnce(() => Promise.resolve(httpResponse({
        d: 5, p: 0.08, channel: 'bitflip', success: false, logicalFailure: true, rounds: 3,
        errorWeight: 5, syndromeSize: 6, residualSyndromeClosed: true, honestBoundary: engine.boundary,
      })));

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByText('Trials run this session')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument());
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
  });

  it('computes the threshold crossing purely from the real returned series (never a hardcoded number)', async () => {
    routeByAction({
      qecSimulateThreshold: () => ({
        channel: 'bitflip', trials: 200, pValues: [0, 1], distances: [3, 5],
        series: {
          d3: [{ p: 0, logicalErrorRate: 0.5, trials: 200, d: 3 }, { p: 1, logicalErrorRate: 0.5, trials: 200, d: 3 }],
          d5: [{ p: 0, logicalErrorRate: 0.4, trials: 200, d: 5 }, { p: 1, logicalErrorRate: 0.6, trials: 200, d: 5 }],
        },
        reference: 'Published UF-decoder toric-code threshold ~9.9% (Delfosse & Nickerson, arXiv:1709.06218) under a bit-flip channel with perfect syndrome measurement.',
        honestBoundary: engine.boundary,
      }),
    });
    render(<QecDecoderPanel engine={engine} />);
    // default action is 'threshold'
    fireEvent.change(screen.getByLabelText('p-values (comma-separated, ≤25, each 0–1)'), { target: { value: '0,1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    // diff(p=0) = 0.4-0.5 = -0.1 (<=0); diff(p=1) = 0.6-0.5 = 0.1 (>0)
    // frac = 0.1/0.2 = 0.5; crossing = 0 + 0.5*(1-0) = 0.5000
    // Scope to the crossing Stat specifically — a bare /0\.5000/ also matches
    // the plotted series values (both d3 points are 0.5), so the loose matcher
    // was ambiguous rather than wrong.
    await waitFor(() =>
      expect(screen.getByText('Measured crossing (d3↔d5, this run)')).toBeInTheDocument());
    const crossingStat = screen.getByText('Measured crossing (d3↔d5, this run)').parentElement!;
    expect(within(crossingStat).getByText('0.5000')).toBeInTheDocument();
    expect(screen.getByText(/Delfosse & Nickerson/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Logical error rate/ })).toBeInTheDocument();
  });

  it('never calls the macro when the threshold sweep has no distances or p-values (client-side validation, not a silent no-op)', () => {
    render(<QecDecoderPanel engine={engine} />);
    fireEvent.change(screen.getByLabelText('Distances (comma-separated, ≤4, each 2–15)'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('renders a genuine server-side exception as an honest error, not a fabricated result', async () => {
    routeByAction({ qecDecodeSingle: () => ({ ok: false, error: 'Cannot read properties of undefined' }) });
    render(<QecDecoderPanel engine={engine} />);
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'decode' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByText('Request failed.')).toBeInTheDocument());
    expect(screen.getByText('Cannot read properties of undefined')).toBeInTheDocument();
  });
});
