/// <reference types="@testing-library/jest-dom/vitest" />
// SpikingNetworkPanel — behavioral tests against a mocked /api/lens/run,
// exercising the real `sim.spikingNetworkSimulate` / `sim.spikingSTDPLearn`
// response envelope shapes (see server/domains/sim.js +
// server/lib/simulation/{spiking-network,stdp}.js).
//
// The panel calls `runFrontierMacro` (components/frontier/FrontierEngineShell.tsx),
// which itself calls `api.post('/api/lens/run', ...)` directly — so, same
// as the `lensRun`-based panels, spying on `api.post` (not mocking the
// module) is required and keeps the real one-envelope unwrap in
// `runFrontierMacro` under test.
//
// One run makes SEVEN real macro calls: 1 network simulate (pre/post),
// 1 STDP learn, then 6 membrane-probe simulate calls (one real, separate
// backend call per PROBE_SAMPLE_FRACTIONS entry) — all through the SAME
// action name `spikingNetworkSimulate`, distinguished only by their input
// shape (probe calls have a single 'probe' neuron and no synapses). The
// mock router below inspects the request body to answer each correctly,
// mirroring how the real dispatcher would just run whatever network spec
// it was given.
//
// This file pins the real cross-check: the panel re-derives the STDP
// weight-change for the real (pre,post) spike pair CLIENT-SIDE via the
// exact formula quoted from stdp.js, and asserts it reproduces the
// backend's own authoritative `deltaW` — never fabricating either side.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import { api } from '@/lib/api/client';
const post = vi.spyOn(api, 'post');

import { SpikingNetworkPanel } from './SpikingNetworkPanel';
import { getFrontierEngine } from '@/lib/frontier-engines';

const engine = getFrontierEngine('spiking-neural')!;

// Real shape /api/lens/run sends over HTTP for a `registerLensAction`
// handler: `{ ok:true, result:<payload> }`.
function httpResponse(payload: unknown) {
  return { data: { ok: true, result: payload } };
}

interface NeuronSpec { id: string }
type Body = { action: string; input: { neurons?: NeuronSpec[]; duration?: number } };

function isMainNetworkCall(input: Body['input']): boolean {
  return Array.isArray(input.neurons) && input.neurons.some((n) => n.id === 'pre');
}

beforeEach(() => { post.mockReset(); });

// Default LIF params the panel sends unchanged (see SpikingNetworkPanel.tsx
// initial useState values) — reproduced here so the mocked
// backend-authoritative deltaW is computed with the SAME stdp params the
// panel itself will use for its client-side cross-check.
const STDP_PARAMS = { A_plus: 0.01, A_minus: 0.012, tau_plus: 20, tau_minus: 20 };
// Real spike train: pre fires at t=5ms, post fires at t=8ms. Nearest-pairing
// (stdp.js#pairSpikes) yields exactly one pair: dt = 8 - 5 = 3.
const DT_PAIR = 3;
const BACKEND_DELTA_W = STDP_PARAMS.A_plus * Math.exp(-DT_PAIR / STDP_PARAMS.tau_plus); // canonical formula, computed once, shared by both "sides"

describe('SpikingNetworkPanel', () => {
  it('shows the idle Verify state and the persistent honest-boundary cell (verbatim HONEST_BOUNDARY) before any run', () => {
    render(<SpikingNetworkPanel engine={engine} />);
    expect(screen.getByText(/Run the compute cell above/)).toBeInTheDocument();
    expect(screen.getByText(engine.boundary!)).toBeInTheDocument();
  });

  it('runs the real 2-call network+STDP demo plus 6 real membrane-probe calls, and renders the real returned spike/weight/crosscheck data', async () => {
    post.mockImplementation(((_url: string, body: Body) => {
      if (body.action === 'spikingNetworkSimulate') {
        if (isMainNetworkCall(body.input)) {
          return Promise.resolve(httpResponse({
            spikeTrain: [{ neuron: 'pre', time: 5 }, { neuron: 'post', time: 8 }],
            spikeCounts: { pre: 1, post: 1 },
            finalPotentials: { pre: -65, post: -63.2 },
            synapses: [{ id: 'syn_pre_post', from: 'pre', to: 'post', weight: 0.05, delay: 1, enabled: true }],
            dt: 0.1,
            duration: 200,
            honestBoundary: engine.boundary,
          }));
        }
        // Membrane probe call — a single unconnected sub-threshold neuron;
        // never spikes at the default I_probe=0.9 (< the 1.5 subthreshold
        // cutoff for these default LIF params).
        return Promise.resolve(httpResponse({
          spikeTrain: [],
          spikeCounts: { probe: 0 },
          finalPotentials: { probe: -60 },
          synapses: [],
          dt: 0.1,
          duration: body.input.duration,
          honestBoundary: engine.boundary,
        }));
      }
      if (body.action === 'spikingSTDPLearn') {
        return Promise.resolve(httpResponse({
          spikeCounts: { pre: 1, post: 1 },
          weightsBefore: [{ id: 'syn_pre_post', from: 'pre', to: 'post', weight: 0.05, delay: 1, enabled: true }],
          stdpUpdates: [{ id: 'syn_pre_post', from: 'pre', to: 'post', weight: 0.05 + BACKEND_DELTA_W, deltaW: BACKEND_DELTA_W, pairCount: 1 }],
          weightsAfter: [{ id: 'syn_pre_post', from: 'pre', to: 'post', weight: 0.05 + BACKEND_DELTA_W, delay: 1, enabled: true }],
          topology: { pruned: [], grown: [] },
          dt: 0.1,
          duration: 200,
          honestBoundary: engine.boundary,
        }));
      }
      return Promise.reject(new Error(`unexpected action ${body.action}`));
    }) as unknown as typeof api.post);

    render(<SpikingNetworkPanel engine={engine} />);
    fireEvent.click(screen.getByRole('button', { name: /Run network \+ STDP demo/ }));

    await waitFor(() => expect(screen.getByText(/pre fired 1x, post fired 1x over 200ms/)).toBeInTheDocument());

    // Weights table: real before/after/deltaW/pairs for the one synapse.
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('syn_pre_post')).toBeInTheDocument();
    expect(within(rows[0]).getByText('pre → post')).toBeInTheDocument();
    expect(within(rows[0]).getByText('0.0500')).toBeInTheDocument();
    expect(within(rows[0]).getByText(`+${BACKEND_DELTA_W.toFixed(4)}`)).toBeInTheDocument();

    // The real cross-check: the panel's own client-side sum over the real
    // (dt=3) spike pair reproduces the backend's authoritative deltaW.
    await waitFor(() => expect(screen.getByText(
      new RegExp(`Σ\\(per-pair Δw computed here\\) = ${BACKEND_DELTA_W.toFixed(6)} vs\\. backend-authoritative deltaW = ${BACKEND_DELTA_W.toFixed(6)}`),
    )).toBeInTheDocument());
    expect(screen.getByText(/— match\./)).toBeInTheDocument();

    // 1 main network simulate + 6 real, separate membrane-probe simulate
    // calls (one per PROBE_SAMPLE_FRACTIONS entry) = 7 spikingNetworkSimulate
    // calls total, plus 1 spikingSTDPLearn call (8 macro calls overall).
    const simulateCalls = post.mock.calls.filter(([, b]) => (b as Body).action === 'spikingNetworkSimulate');
    expect(simulateCalls).toHaveLength(7);
    const mainCall = simulateCalls.find(([, b]) => isMainNetworkCall((b as Body).input))!;
    expect(mainCall[1]).toMatchObject({
      domain: 'sim',
      action: 'spikingNetworkSimulate',
      input: {
        neurons: [
          { id: 'pre', tau_m: 10, V_rest: -65, V_th: -50, V_reset: -65, R: 10, refractory: 2 },
          { id: 'post', tau_m: 10, V_rest: -65, V_th: -50, V_reset: -65, R: 10, refractory: 2 },
        ],
        synapses: [{ id: 'syn_pre_post', from: 'pre', to: 'post', weight: 0.05, delay: 1 }],
        dt: 0.1,
        duration: 200,
        externalCurrents: { pre: 2.0, post: 1.7 },
        seed: 42,
      },
    });

    const stdpCall = post.mock.calls.find(([, b]) => (b as Body).action === 'spikingSTDPLearn')!;
    expect(stdpCall[1]).toMatchObject({
      domain: 'sim',
      action: 'spikingSTDPLearn',
      input: { stdp: { A_plus: 0.01, A_minus: 0.012, tau_plus: 20, tau_minus: 20, w_min: 0, w_max: 1, mode: 'nearest' } },
    });
  });

  it('renders a genuine spikingNetworkSimulate refusal (real step-budget error) as an honest refusal, never a fabricated result — and never proceeds to the STDP call', async () => {
    post.mockImplementation(((_url: string, body: Body) => {
      if (body.action === 'spikingNetworkSimulate') {
        // Real error shape from sim.js's registerLensAction wrapper —
        // buildAndRunSpikingNetwork throws when duration/dt exceeds the
        // simulation step budget, and the handler wraps it in an
        // `{ok:false, error}` refusal envelope.
        return Promise.resolve(httpResponse({ ok: false, error: 'spikingNetworkSimulate failed: duration/dt exceeds the simulation step budget (20000)' }));
      }
      return Promise.reject(new Error(`unexpected action ${body.action} — STDP must not run after the network call refused`));
    }) as unknown as typeof api.post);

    render(<SpikingNetworkPanel engine={engine} />);
    fireEvent.click(screen.getByRole('button', { name: /Run network \+ STDP demo/ }));

    await waitFor(() => expect(screen.getByText(/Honest refusal — not a fabricated pass\./)).toBeInTheDocument());
    expect(screen.getByText(/duration\/dt exceeds the simulation step budget \(20000\)/)).toBeInTheDocument();

    const calls = post.mock.calls.filter(([, b]) => (b as Body).action === 'spikingNetworkSimulate');
    expect(calls).toHaveLength(1); // refused on the very first (main network) call, no probes attempted
  });
});
