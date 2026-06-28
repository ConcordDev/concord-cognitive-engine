/**
 * /lenses/ops-telemetry — four-UX-state contract.
 *
 * Ops Telemetry is a read-only operator DASHBOARD, REST-backed by design (a
 * Datadog/Grafana analog). Unlike a macro lens, it does NOT call lensRun — it
 * fetches six admin-gated /api/admin/* routes directly. These tests pin that the
 * dashboard renders genuine loading / error (with a working Retry that
 * re-fetches) / empty / populated states, the 403 admin-gate fallback, and a11y
 * (initial loading is role=status; initial error is role=alert; tables carry
 * aria-labels).
 *
 * No fabricated data: every state is driven by a mocked global fetch standing in
 * for the real backend, in exactly the flat shapes the admin routes return
 * ({ ok, modules } / { ok, macroPool, heartbeatPool } / { ok, brains } /
 * { ok, shards, sharded } / { ok, ...costs }). The headless LensShell,
 * AdminRequiredState, and the sub-fetching LivenessPanel are stubbed so the test
 * stays on the page's own state machine.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/common/EmptyState', () => ({
  AdminRequiredState: () =>
    React.createElement('div', { 'data-testid': 'admin-required' }, 'Admin required'),
}));
// LivenessPanel does its own /api/admin/liveness fetch — stub it so the test
// exercises only the ops-telemetry page state machine.
vi.mock('@/components/admin/LivenessPanel', () => ({
  LivenessPanel: () => React.createElement('div', { 'data-testid': 'liveness-panel' }),
}));
vi.mock('@/components/lens/ManifestActionBar', () => ({
  ManifestActionBar: () => null,
}));
vi.mock('@/components/lens/DepthBadge', () => ({
  DepthBadge: () => null,
}));

// Import AFTER mocks are registered.
import OpsTelemetryPage from '@/app/lenses/ops-telemetry/page';

// ── canonical route payloads (the real flat shapes the admin routes return) ──
const HB_ROW = {
  id: 'social-npc-bridge', frequency: 5, scope: 'global', serial: true, worker: false,
  sampleCount: 12, p50: 4.2, p90: 9.1, p99: 18.5, max: 30, lastMs: 5.0, lastAt: Date.now(), totalRuns: 120,
};
const MACRO_POOL = {
  poolSize: 4, ready: true, busy: 1, idle: 3, queueLength: 0,
  metrics: { dispatched: 100, completed: 99, errors: 1, timeouts: 0, queueHighWater: 2, avgLatencyMs: 12 },
};
const BRAIN = {
  brain: 'conscious', model: 'concord-conscious:latest', maxConcurrent: 4,
  endpoints: [{ url: 'http://ollama-conscious:11434', inflight: 0, failures: 0, lastHealthyAt: Date.now() }],
};
const SHARD = {
  worldId: 'concordia-hub', status: 'running', pid: 4242, startedAt: Date.now(),
  lastTickAt: Date.now(), lastTickCount: 50, restartCount: 0,
};

type RouteMap = Record<string, () => Promise<Response> | Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

/** Build a fetch impl that dispatches by URL substring (longest fragment wins,
 *  so e.g. `world-shards/.../restart` is matched before the generic `world-shards`). */
function wire(map: RouteMap): typeof fetch {
  const frags = Object.keys(map).sort((a, b) => b.length - a.length);
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const frag of frags) {
      if (url.includes(frag)) return map[frag]();
    }
    // Default OK-empty for any unmapped admin route (e.g. liveness, if it leaked).
    return jsonResponse({ ok: true });
  }) as unknown as typeof fetch;
}

const POPULATED: RouteMap = {
  'heartbeat-stats': () => jsonResponse({ ok: true, modules: [HB_ROW] }),
  'worker-stats': () => jsonResponse({ ok: true, macroPool: MACRO_POOL, heartbeatPool: MACRO_POOL }),
  'brain-endpoints': () => jsonResponse({ ok: true, brains: [BRAIN] }),
  'brain-activity': () => jsonResponse({ ok: true, brains: [{ brain: 'conscious', role: 'chat', model: 'm', enabled: true, requests: 7, errors: 0, dtusGenerated: 0, avgMs: 30, idleSeconds: 5 }] }),
  'world-shards': () => jsonResponse({ ok: true, shards: [SHARD], sharded: true }),
  'inference-costs': () => jsonResponse({ ok: true, calls: 42, tokensIn: 1000, tokensOut: 500, costLabel: '$0.01', byBrain: { conscious: { calls: 42 } } }),
};

const EMPTY: RouteMap = {
  'heartbeat-stats': () => jsonResponse({ ok: true, modules: [] }),
  'worker-stats': () => jsonResponse({ ok: true, macroPool: null, heartbeatPool: null }),
  'brain-endpoints': () => jsonResponse({ ok: true, brains: [] }),
  'brain-activity': () => jsonResponse({ ok: true, brains: [] }),
  'world-shards': () => jsonResponse({ ok: true, shards: [], sharded: false }),
  'inference-costs': () => jsonResponse({ ok: true, calls: 0, tokensIn: 0, tokensOut: 0, costLabel: '$0.00', byBrain: {} }),
};

beforeEach(() => { vi.useRealTimers(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('ops-telemetry lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the first fetch is in flight', async () => {
    // Primary endpoint never resolves → page stays in initial-loading.
    global.fetch = wire({ 'heartbeat-stats': () => new Promise<Response>(() => {}) });
    const { container, getByText } = render(<OpsTelemetryPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
    expect(getByText(/Loading telemetry/i)).toBeInTheDocument();
  });

  it('ERROR: a thrown first fetch shows role=alert + a working Retry that re-fetches', async () => {
    let fail = true;
    global.fetch = wire({
      ...POPULATED,
      'heartbeat-stats': () => fail
        ? Promise.reject(new Error('network down'))
        : jsonResponse({ ok: true, modules: [HB_ROW] }),
    });
    const { container, getByText } = render(<OpsTelemetryPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/Telemetry failed to load/i)).toBeInTheDocument();

    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    // recovers to populated — the heartbeat module row appears
    await waitFor(() => expect(getByText('social-npc-bridge')).toBeInTheDocument());
  });

  it('EMPTY: succeeds with no data and shows honest per-panel empty states', async () => {
    global.fetch = wire(EMPTY);
    const { getByText } = render(<OpsTelemetryPage />);
    await waitFor(() => expect(getByText(/no samples yet/i)).toBeInTheDocument());
    expect(getByText(/no endpoints loaded/i)).toBeInTheDocument();
    expect(getByText(/no brain activity loaded/i)).toBeInTheDocument();
    // shards disabled note
    expect(getByText(/disabled — in-process/i)).toBeInTheDocument();
  });

  it('EMPTY: a null inference window shows the honest "living on instinct" note', async () => {
    // inference-costs returns ok:false → costs stays null → the null-state copy shows.
    global.fetch = wire({ ...EMPTY, 'inference-costs': () => jsonResponse({ ok: false }) });
    const { getByText } = render(<OpsTelemetryPage />);
    await waitFor(() => expect(getByText(/no samples yet/i)).toBeInTheDocument());
    expect(getByText(/living on instinct/i)).toBeInTheDocument();
  });

  it('POPULATED: renders heartbeat rows, pool stats, brain endpoints, costs, and shards', async () => {
    global.fetch = wire(POPULATED);
    const { getByText, container } = render(<OpsTelemetryPage />);
    await waitFor(() => expect(getByText('social-npc-bridge')).toBeInTheDocument());

    // pool stats
    expect(getByText('Macro worker pool')).toBeInTheDocument();
    // brain endpoint — the endpoint url is unique to the endpoints panel
    expect(getByText('http://ollama-conscious:11434')).toBeInTheDocument();
    // brain endpoints section header present
    expect(getByText(/Brain endpoints \(Phase D\)/i)).toBeInTheDocument();
    // cost story
    expect(getByText('$0.01')).toBeInTheDocument();
    // shards enabled + a row
    expect(getByText('enabled')).toBeInTheDocument();
    expect(getByText('concordia-hub')).toBeInTheDocument();

    // a11y: the two data tables carry aria-labels
    expect(container.querySelector('table[aria-label="Heartbeat module timings"]')).toBeTruthy();
    expect(container.querySelector('table[aria-label="World shard status"]')).toBeTruthy();
  });

  it('OPERATOR: shard Restart POSTs the restart route then re-refreshes', async () => {
    const restart = vi.fn(() => jsonResponse({ ok: true }));
    global.fetch = wire({ ...POPULATED, 'world-shards/concordia-hub/restart': restart });
    const { getByText, getByLabelText } = render(<OpsTelemetryPage />);
    await waitFor(() => expect(getByText('concordia-hub')).toBeInTheDocument());

    await act(async () => { fireEvent.click(getByLabelText(/Restart shard concordia-hub/i)); });
    await waitFor(() => expect(restart).toHaveBeenCalled());
  });

  it('FORBIDDEN: a 403 on the primary route surfaces the AdminRequired fallback', async () => {
    global.fetch = wire({ 'heartbeat-stats': () => jsonResponse({ ok: false }, 403) });
    const { getByTestId } = render(<OpsTelemetryPage />);
    await waitFor(() => expect(getByTestId('admin-required')).toBeInTheDocument());
  });
});
