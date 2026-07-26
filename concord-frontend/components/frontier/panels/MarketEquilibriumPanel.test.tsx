/// <reference types="@testing-library/jest-dom/vitest" />
// MarketEquilibriumPanel — behavioral tests against a mocked
// /api/lens/run, exercising the real `markets.mixedNash` /
// `markets.replicatorDynamics` / `markets.equilibriumAnalysis` response
// envelope shapes (see server/domains/markets.js +
// server/lib/game-theory/{mixed-nash,replicator,market-equilibrium}.js).
//
// Mocks `api.post` (not `lensRun`) — same convention as
// QecDecoderPanel.test.tsx / ModelCheckerPanel.test.tsx — because the
// panel calls `lensRun`, which closes over the module-scoped `api`.
//
// Two things this file pins on purpose (per the panel's own header
// comment):
//   1. `replicatorDynamics` genuinely returning `converged:false` (e.g.
//      rock-paper-scissors, which orbits its interior equilibrium
//      forever) is a REAL, COMPLETE outcome, not a failure — it must
//      render in the 'ok' Verify state with the honest non-convergence
//      copy, never as 'refused'/'error'.
//   2. `mixedNash`'s refusal shape uses `reason`, not `error` — the
//      shared `lensRun()` client's generic `ok:false` recovery only reads
//      `.error`, so this specific shape genuinely degrades to the literal
//      string "lens error" on the wire. `describeRefusal()` detects that
//      exact degraded case and says so plainly rather than inventing a
//      specific reason the client can't actually recover — this test pins
//      that this is real, verified client behavior, not a made-up string.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import { api } from '@/lib/api/client';
const post = vi.spyOn(api, 'post');

import { MarketEquilibriumPanel } from './MarketEquilibriumPanel';
import { getFrontierEngine } from '@/lib/frontier-engines';

const engine = getFrontierEngine('economic-equilibrium')!;

function httpResponse(payload: unknown) {
  return { data: { ok: true, result: payload } };
}

type Body = { action: string; input: Record<string, unknown> };
function routeByAction(handlers: Record<string, (body: Body) => unknown>) {
  post.mockImplementation(((_url: string, body: Body) => {
    const h = handlers[body.action];
    if (!h) return Promise.reject(new Error(`unexpected action ${body.action}`));
    return Promise.resolve(httpResponse(h(body)));
  }) as unknown as typeof api.post);
}

beforeEach(() => { post.mockReset(); });

// Copied verbatim from the panel's own module-private preset tables
// (components/frontier/panels/MarketEquilibriumPanel.tsx) — these aren't
// exported, so the real default matrices the component sends are
// reproduced here rather than re-typed from memory, to keep the outgoing
// `toMatchObject` assertions honest.
const BATTLE_OF_SEXES = { A: [[2, 0], [0, 1]], B: [[1, 0], [0, 2]] };
const HAWK_DOVE = { A: [[-1.5, 1], [0, 0.5]], x0: [0.5, 0.5], tEnd: 200 };
const ROCK_PAPER_SCISSORS = { A: [[0, -1, 1], [1, 0, -1], [-1, 1, 0]], x0: [0.6, 0.25, 0.15], tEnd: 60 };

// The real disclaimer string market-equilibrium.js#DISCLAIMER returns on
// every equilibriumAnalysis call — copied verbatim so the mocked response
// matches the real live shape, including its exact prose.
const LIVE_MARKET_DISCLAIMER =
  "Descriptive and observational only. 'Consistent with a cartel' is a structural " +
  '+ game-theoretic reading of ledger data, not proof of intent or manipulation. ' +
  'This function never mutates balances and never blocks a trade.';

describe('MarketEquilibriumPanel', () => {
  it('shows the idle Verify state and the persistent honest-boundary cell before any run', () => {
    render(<MarketEquilibriumPanel engine={engine} />);
    expect(screen.getByText(/Run the compute cell above/)).toBeInTheDocument();
    expect(screen.getByText(engine.boundary!)).toBeInTheDocument();
  });

  it('runs mixedNash with the real default battle-of-sexes matrices and renders the real returned equilibria', async () => {
    routeByAction({
      mixedNash: () => ({
        ok: true,
        equilibria: [
          { support1: [0], support2: [0], p: [1, 0], q: [1, 0], payoffs: [2, 1] },
          { support1: [1], support2: [1], p: [0, 1], q: [0, 1], payoffs: [1, 2] },
          { support1: [0, 1], support2: [0, 1], p: [0.667, 0.333], q: [0.333, 0.667], payoffs: [0.667, 0.667] },
        ],
        candidatesExamined: 6,
      }),
    });
    render(<MarketEquilibriumPanel engine={engine} />);
    // default sub-engine is 'mixed-nash', default preset 'battle-of-sexes' — no change needed.
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByText('Equilibria found')).toBeInTheDocument());
    const foundStat = screen.getByText('Equilibria found').parentElement!;
    expect(within(foundStat).getByText('3')).toBeInTheDocument();
    const examinedStat = screen.getByText('Candidates examined').parentElement!;
    expect(within(examinedStat).getByText('6')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(4); // header + 3 equilibria

    const [, body] = post.mock.calls.at(-1)!;
    expect(body).toMatchObject({
      domain: 'markets',
      action: 'mixedNash',
      input: { payoffA: BATTLE_OF_SEXES.A, payoffB: BATTLE_OF_SEXES.B },
    });
  });

  it('renders the real mixedNash support_enumeration_exhausted refusal — the client can only recover the generic "lens error" for this shape, and says so honestly', async () => {
    routeByAction({
      // Real refusal shape from mixed-nash.js#mixedNashEquilibria: `reason`,
      // never `error`. lensRun()'s generic ok:false recovery only reads
      // `.error`, so this genuinely collapses to 'lens error' on the wire.
      mixedNash: () => ({ ok: false, reason: 'support_enumeration_exhausted', maxSupportSize: 2, candidateCount: 36 }),
    });
    render(<MarketEquilibriumPanel engine={engine} />);
    fireEvent.change(screen.getByLabelText(/Max candidates/), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByText(/Honest refusal — not a fabricated pass\./)).toBeInTheDocument());
    expect(screen.getByText(/Refused by the server \(invalid matrix shape, or the support-enumeration cap was hit\)/)).toBeInTheDocument();
    expect(screen.getByText(/reads a `reason` field the client only handles as `error`/)).toBeInTheDocument();

    const [, body] = post.mock.calls.at(-1)!;
    expect(body).toMatchObject({ domain: 'markets', action: 'mixedNash', input: { maxCandidates: 10 } });
  });

  it('runs replicatorDynamics (hawk-dove, converges) and renders the real trajectory chart', async () => {
    routeByAction({
      replicatorDynamics: () => ({
        converged: true,
        x: [0.75, 0.25],
        finalDelta: 8e-9,
        steps: 1200,
        trajectory: [{ t: 0, x: [0.5, 0.5] }, { t: 100, x: [0.75, 0.25] }],
      }),
    });
    render(<MarketEquilibriumPanel engine={engine} />);
    fireEvent.change(screen.getByLabelText('Sub-engine'), { target: { value: 'replicator' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByText('Converged to a fixed point')).toBeInTheDocument());
    const sharesStat = screen.getByText('Final shares').parentElement!;
    expect(within(sharesStat).getByText('[0.750, 0.250]')).toBeInTheDocument();
    const stepsStat = screen.getByText('Steps').parentElement!;
    expect(within(stepsStat).getByText('1200')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Population share vs time per strategy/ })).toBeInTheDocument();

    const [, body] = post.mock.calls.at(-1)!;
    expect(body).toMatchObject({
      domain: 'markets',
      action: 'replicatorDynamics',
      input: { payoffMatrix: HAWK_DOVE.A, initialShares: HAWK_DOVE.x0, dt: 0.01, tEnd: HAWK_DOVE.tEnd, tolerance: 1e-7, includeTrajectory: true },
    });
  });

  it('renders a genuine replicatorDynamics NON-convergence (rock-paper-scissors) as a real, complete outcome — never an error', async () => {
    routeByAction({
      replicatorDynamics: () => ({
        converged: false,
        x: [0.34, 0.33, 0.33],
        finalDelta: 0.0021,
        steps: 6000,
        reason: 'no_fixed_point_within_horizon',
        trajectorySamples: 500,
      }),
    });
    render(<MarketEquilibriumPanel engine={engine} />);
    fireEvent.change(screen.getByLabelText('Sub-engine'), { target: { value: 'replicator' } });
    fireEvent.change(screen.getByLabelText('Population game preset'), { target: { value: 'rock-paper-scissors' } });
    fireEvent.click(screen.getByLabelText(/Include the full trajectory/)); // uncheck — request only the sample count

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByText(
      /Did not converge within the horizon — a real, complete outcome \(e\.g\. an orbiting interior equilibrium\), not an error/,
    )).toBeInTheDocument());
    expect(screen.getByText(/reason: no_fixed_point_within_horizon/)).toBeInTheDocument();
    expect(screen.getByText(/Server returned 500 trajectory samples/)).toBeInTheDocument();
    // No fabricated chart when the trajectory itself was never fetched.
    expect(screen.queryByRole('img', { name: /Population share vs time per strategy/ })).not.toBeInTheDocument();

    const [, body] = post.mock.calls.at(-1)!;
    expect(body).toMatchObject({
      domain: 'markets',
      action: 'replicatorDynamics',
      input: { payoffMatrix: ROCK_PAPER_SCISSORS.A, initialShares: ROCK_PAPER_SCISSORS.x0, tEnd: ROCK_PAPER_SCISSORS.tEnd, includeTrajectory: false },
    });
  });

  it('runs the live-market equilibriumAnalysis (no payoff matrix input) and renders the real ledger-derived classification', async () => {
    routeByAction({
      equilibriumAnalysis: () => ({
        ok: true,
        classification: 'competitive_equilibrium_consistent',
        tradeCount: 42,
        agentCount: 9,
        rings: [],
        reciprocalPairs: [{ a: 'user-1', b: 'user-2' }],
        ringVolumeFraction: 0.0123,
        signals: { structuralSignal: true, nashSupportsRing: false, replicatorFavorsRing: false },
        disclaimer: LIVE_MARKET_DISCLAIMER,
      }),
    });
    render(<MarketEquilibriumPanel engine={engine} />);
    fireEvent.change(screen.getByLabelText('Sub-engine'), { target: { value: 'live-market' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByText('competitive equilibrium consistent')).toBeInTheDocument());
    const tradesStat = screen.getByText('Trades in window').parentElement!;
    expect(within(tradesStat).getByText('42')).toBeInTheDocument();
    const agentsStat = screen.getByText('Distinct agents').parentElement!;
    expect(within(agentsStat).getByText('9')).toBeInTheDocument();
    expect(screen.getByText('user-1 ↔ user-2')).toBeInTheDocument();
    expect(screen.getByText(LIVE_MARKET_DISCLAIMER)).toBeInTheDocument();

    const [, body] = post.mock.calls.at(-1)!;
    expect(body).toMatchObject({
      domain: 'markets',
      action: 'equilibriumAnalysis',
      input: { minEdgeTrades: 3, minRingSize: 3, windowMs: 30 * 86400000, minRingVolumeFraction: 0.05 },
    });
  });

  it('renders a genuine equilibriumAnalysis ledger-read failure with its real reason string (not the degraded generic case)', async () => {
    routeByAction({
      // Real shape from market-equilibrium.js when the ledger query throws:
      // {ok:false, reason:'ledger_read_failed', error: <real message>} —
      // this one DOES carry an `error` field, so it's recovered verbatim,
      // unlike the mixedNash refusal above.
      equilibriumAnalysis: () => ({ ok: false, reason: 'ledger_read_failed', error: 'no such table: economy_ledger' }),
    });
    render(<MarketEquilibriumPanel engine={engine} />);
    fireEvent.change(screen.getByLabelText('Sub-engine'), { target: { value: 'live-market' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByText(/Honest refusal — not a fabricated pass\./)).toBeInTheDocument());
    expect(screen.getByText('no such table: economy_ledger')).toBeInTheDocument();
  });
});
