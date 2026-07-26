/// <reference types="@testing-library/jest-dom/vitest" />
// Vitest for the Ops Telemetry lens page's "Federation mesh" (#38) card —
// pins the real peer list rendered from a mocked `fedmesh.peers` response,
// the honest "no peers registered" empty state, the automatic-sync summary
// sourced from the real `fedmesh-sync-cycle` row already present in the
// heartbeat-stats payload, and the manual "Drain inbox now" trigger showing
// the real accepted/rejected counts from a mocked `fedmesh.drain` response.
// Never a fabricated "Synced ✓" boolean anywhere in this card.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/admin/LivenessPanel', () => ({ LivenessPanel: () => null }));

import OpsTelemetryPage from './page';

/** lensRun envelope: { data: { ok, result, error } } where result is the
 *  unwrapped macro payload (itself an { ok, ...fields } object) — matches
 *  the real shape returned by fedmesh.peers / fedmesh.drain. */
function ok(payload: Record<string, unknown>) {
  return { data: { ok: true, result: { ok: true, ...payload }, error: null } };
}
function fail(reason: string) {
  return { data: { ok: true, result: { ok: false, reason }, error: null } };
}

function peerRow(over: Record<string, unknown> = {}) {
  return {
    peerId: 'peer-alpha',
    url: 'https://alpha.example.org',
    brainUrl: 'https://alpha.example.org/brain',
    capabilities: ['dtu-exchange'],
    revoked: 0,
    ...over,
  };
}

/** Standard "everything is empty/uninteresting" answer for the five plain
 * /api/admin/* REST endpoints ops-telemetry's refresh() fetches directly.
 * `hbModules` lets a test inject a real fedmesh-sync-cycle heartbeat row. */
function adminFetchMock(hbModules: unknown[] = []) {
  return vi.fn(async (url: string) => {
    if (url === '/api/admin/heartbeat-stats') {
      return { status: 200, json: async () => ({ ok: true, modules: hbModules }) } as unknown as Response;
    }
    if (url === '/api/admin/worker-stats') {
      return { status: 200, json: async () => ({ ok: true, macroPool: null, heartbeatPool: null }) } as unknown as Response;
    }
    if (url === '/api/admin/brain-endpoints') {
      return { status: 200, json: async () => ({ ok: true, brains: [] }) } as unknown as Response;
    }
    if (url === '/api/admin/world-shards') {
      return { status: 200, json: async () => ({ ok: true, shards: [], sharded: false }) } as unknown as Response;
    }
    if (url.startsWith('/api/admin/inference-costs')) {
      return { status: 200, json: async () => ({ ok: false }) } as unknown as Response;
    }
    if (url === '/api/admin/brain-activity') {
      return { status: 200, json: async () => ({ ok: true, brains: [] }) } as unknown as Response;
    }
    return { status: 200, json: async () => ({ ok: false }) } as unknown as Response;
  });
}

/** Routes lensRun calls by (domain, action); anything unmatched (e.g.
 * worldstate.overview, which this file doesn't care about) gets a bland
 * `ok({})`. */
function lensRunRouter(handlers: Record<string, (input: unknown) => unknown>) {
  return (domain: string, action: string, input: unknown) => {
    const key = `${domain}.${action}`;
    if (handlers[key]) return Promise.resolve(handlers[key](input));
    return Promise.resolve(ok({}));
  };
}

describe('Ops Telemetry lens page — Federation mesh (#38)', () => {
  beforeEach(() => {
    lensRun.mockReset();
    vi.unstubAllGlobals();
  });

  it('renders the real peer list, active/revoked counts, and capabilities from a mocked fedmesh.peers response', async () => {
    vi.stubGlobal('fetch', adminFetchMock());
    lensRun.mockImplementation(
      lensRunRouter({
        'fedmesh.peers': () =>
          ok({
            peers: [
              peerRow(),
              peerRow({ peerId: 'peer-beta', url: 'https://beta.example.org', brainUrl: null, capabilities: [], revoked: 1 }),
            ],
          }),
      }),
    );

    render(<OpsTelemetryPage />);

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('fedmesh', 'peers', { includeRevoked: true }));

    const panel = await screen.findByTestId('fedmesh-panel');
    await waitFor(() => expect(within(panel).getByText('peer-alpha')).toBeInTheDocument());
    expect(within(panel).getByText('peer-beta')).toBeInTheDocument();
    expect(within(panel).getByText('dtu-exchange')).toBeInTheDocument();
    // Per-row status badges (span text, distinct from the Metric tile labels below).
    expect(within(panel).getAllByText('active').length).toBeGreaterThanOrEqual(1);
    expect(within(panel).getAllByText('revoked').length).toBeGreaterThanOrEqual(1);

    // Real counts computed from the real array: 2 known, 1 active, 1 revoked.
    const knownLabel = within(panel).getByText('known peers');
    expect((knownLabel.nextElementSibling as HTMLElement).textContent).toBe('2');
    const activeLabel = within(panel).getByText('active peers');
    expect((activeLabel.nextElementSibling as HTMLElement).textContent).toBe('1');
    const revokedLabel = within(panel).getByText('revoked peers');
    expect((revokedLabel.nextElementSibling as HTMLElement).textContent).toBe('1');
  });

  it('shows the honest "No peers registered" empty state when fedmesh.peers returns zero peers — never a fabricated row', async () => {
    vi.stubGlobal('fetch', adminFetchMock());
    lensRun.mockImplementation(lensRunRouter({ 'fedmesh.peers': () => ok({ peers: [] }) }));

    render(<OpsTelemetryPage />);

    const panel = await screen.findByTestId('fedmesh-panel');
    await waitFor(() => expect(within(panel).getByText('No peers registered.')).toBeInTheDocument());
    expect(within(panel).queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows an honest error state when fedmesh.peers fails — never renders a stale or fabricated peer list', async () => {
    vi.stubGlobal('fetch', adminFetchMock());
    lensRun.mockImplementation(lensRunRouter({ 'fedmesh.peers': () => fail('no_db') }));

    render(<OpsTelemetryPage />);

    const panel = await screen.findByTestId('fedmesh-panel');
    await waitFor(() => expect(within(panel).getByText('no_db')).toBeInTheDocument());
    expect(within(panel).queryByText('No peers registered.')).not.toBeInTheDocument();
  });

  it('surfaces the real fedmesh-sync-cycle heartbeat row (last-ran + run count) instead of a fabricated "Synced" badge', async () => {
    const lastAt = Date.now() - 45_000;
    vi.stubGlobal(
      'fetch',
      adminFetchMock([
        {
          id: 'fedmesh-sync-cycle',
          frequency: 120,
          scope: 'global',
          serial: false,
          worker: true,
          sampleCount: 3,
          p50: 2.1,
          p90: 3.4,
          p99: 4.0,
          max: 4.2,
          lastMs: 2.5,
          lastAt,
          totalRuns: 7,
        },
      ]),
    );
    lensRun.mockImplementation(lensRunRouter({ 'fedmesh.peers': () => ok({ peers: [] }) }));

    render(<OpsTelemetryPage />);

    const panel = await screen.findByTestId('fedmesh-panel');
    await waitFor(() => expect(within(panel).getByText(/45s ago/)).toBeInTheDocument());
    expect(within(panel).getByText(/7 runs since boot/)).toBeInTheDocument();
    // The card must never claim a synced/success boolean the backend doesn't
    // actually expose for the automatic cycle.
    expect(within(panel).queryByText(/synced/i)).not.toBeInTheDocument();
  });

  it('shows "no heartbeat sample yet" when the fedmesh-sync-cycle row is absent — honest, not a fake timestamp', async () => {
    vi.stubGlobal('fetch', adminFetchMock([]));
    lensRun.mockImplementation(lensRunRouter({ 'fedmesh.peers': () => ok({ peers: [] }) }));

    render(<OpsTelemetryPage />);

    const panel = await screen.findByTestId('fedmesh-panel');
    await waitFor(() => expect(within(panel).getByText(/no heartbeat sample yet/)).toBeInTheDocument());
  });

  it('manual "Drain inbox now" renders the real accepted/rejected counts from a mocked fedmesh.drain response', async () => {
    vi.stubGlobal('fetch', adminFetchMock());
    lensRun.mockImplementation(
      lensRunRouter({
        'fedmesh.peers': () => ok({ peers: [] }),
        'fedmesh.drain': () => ok({ accepted: 3, rejected: 1 }),
      }),
    );

    render(<OpsTelemetryPage />);

    const panel = await screen.findByTestId('fedmesh-panel');
    await waitFor(() => expect(within(panel).getByText('No peers registered.')).toBeInTheDocument());

    fireEvent.click(within(panel).getByRole('button', { name: /drain inbox now/i }));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('fedmesh', 'drain', {}));
    await waitFor(() =>
      expect(within(panel).getByText(/3 accepted, 1 rejected/)).toBeInTheDocument(),
    );
  });

  it('manual drain shows an honest error, never a fabricated success, when fedmesh.drain fails', async () => {
    vi.stubGlobal('fetch', adminFetchMock());
    lensRun.mockImplementation(
      lensRunRouter({
        'fedmesh.peers': () => ok({ peers: [] }),
        'fedmesh.drain': () => fail('no_db'),
      }),
    );

    render(<OpsTelemetryPage />);

    const panel = await screen.findByTestId('fedmesh-panel');
    await waitFor(() => expect(within(panel).getByText('No peers registered.')).toBeInTheDocument());

    fireEvent.click(within(panel).getByRole('button', { name: /drain inbox now/i }));

    await waitFor(() => expect(within(panel).getByText('no_db')).toBeInTheDocument());
    // The static helper copy mentions "accepted/rejected counts" generically;
    // what must never appear is the rendered *result* line with real numbers.
    expect(within(panel).queryByText(/\d+ accepted, \d+ rejected/)).not.toBeInTheDocument();
  });
});
