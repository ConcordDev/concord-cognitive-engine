/// <reference types="@testing-library/jest-dom/vitest" />
// Vitest for the Ops Telemetry lens page's Wave E "Simulation Overview"
// section — pins the real platform-wide rollup computed from a mocked
// worldstate.overview response, the deep-link to the full drill-down lens
// (/lenses/world-observatory), and the honest empty/error states (never a
// fabricated "N active worlds" placeholder before the real fetch resolves).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
// LivenessPanel does its own independent fetch('/api/admin/liveness') on
// mount — stub it out so this test file's fetch mock only has to answer the
// endpoints ops-telemetry's own refresh() calls directly.
vi.mock('@/components/admin/LivenessPanel', () => ({ LivenessPanel: () => null }));

import OpsTelemetryPage from './page';

/** lensRun envelope: { data: { ok, result, error } } where result is the
 *  unwrapped macro payload (itself an { ok, ...fields } object). */
function ok(payload: Record<string, unknown>) {
  return { data: { ok: true, result: { ok: true, ...payload }, error: null } };
}
function fail(reason: string) {
  return { data: { ok: true, result: { ok: false, reason }, error: null } };
}

/** Reads a Metric tile's value by its label — the two are sibling divs
 * (label then value). More robust than a bare `getByText(value)` because
 * some numeric values (e.g. "1" for a realm count vs. "1" for a warnings
 * count) legitimately recur across separate tiles. */
function metricValue(container: HTMLElement, label: string): string {
  const labelEl = within(container).getByText(label);
  const valueEl = labelEl.nextElementSibling as HTMLElement | null;
  return valueEl?.textContent?.trim() ?? '';
}

function worldRow(over: Record<string, unknown> = {}) {
  return {
    worldId: 'tunya',
    name: 'Tunya',
    activeUsers: 12,
    factionCount: 2,
    realmCount: 1,
    districtCount: 1,
    stuckFactionSchedulers: 0,
    ...over,
  };
}

/** Standard "everything is empty/uninteresting" answer for the five plain
 * /api/admin/* REST endpoints ops-telemetry's refresh() fetches directly —
 * every test in this file reuses it so only the worldstate.overview
 * lensRun mock needs to vary per-case. */
function adminFetchMock() {
  return vi.fn(async (url: string) => {
    if (url === '/api/admin/heartbeat-stats') {
      return { status: 200, json: async () => ({ ok: true, modules: [] }) } as unknown as Response;
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

describe('Ops Telemetry lens page — Simulation Overview (Wave E)', () => {
  beforeEach(() => {
    lensRun.mockReset();
    vi.unstubAllGlobals();
  });

  it('renders a real platform-wide rollup computed from a mocked worldstate.overview response', async () => {
    vi.stubGlobal('fetch', adminFetchMock());
    lensRun.mockImplementation((domain: string, action: string) => {
      if (domain === 'worldstate' && action === 'overview') {
        return Promise.resolve(
          ok({
            worlds: [
              worldRow(),
              worldRow({
                worldId: 'crime',
                name: 'Crime City',
                activeUsers: 4,
                factionCount: 3,
                realmCount: 0,
                districtCount: 2,
                stuckFactionSchedulers: 2,
              }),
            ],
          }),
        );
      }
      return Promise.resolve(ok({}));
    });

    render(<OpsTelemetryPage />);

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('worldstate', 'overview', {}));

    const panel = await screen.findByTestId('simulation-overview-panel');
    // Real sums over the two real rows, not fabricated: 12+4=16 active users,
    // 2+3=5 factions, 1+0=1 realm, 1+2=3 districts, 2 worlds, 1 world with a
    // liveness warning carrying 2 stuck schedulers.
    expect(metricValue(panel, 'worlds')).toBe('2');
    expect(metricValue(panel, 'active users')).toBe('16');
    expect(metricValue(panel, 'factions')).toBe('5');
    expect(metricValue(panel, 'realms')).toBe('1');
    expect(metricValue(panel, 'districts')).toBe('3');

    const warningsLabel = within(panel).getByText('worlds w/ warnings');
    const warningsValue = warningsLabel.nextElementSibling as HTMLElement;
    expect(warningsValue).toHaveTextContent(/^1\(2 stuck schedulers\)$/);

    // Deep-link to the dedicated drill-down lens, not a rebuilt duplicate grid.
    const link = within(panel).getByRole('link', { name: /full observatory/i });
    expect(link).toHaveAttribute('href', '/lenses/world-observatory');

    // The full per-world drill-down grid (world-observatory's own UI, e.g.
    // its "nominal"/faction-relation cards) must NOT be duplicated here.
    expect(within(panel).queryByText('nominal')).not.toBeInTheDocument();
  });

  it('shows an honest empty state when worldstate.overview reports zero worlds — never a fabricated count', async () => {
    vi.stubGlobal('fetch', adminFetchMock());
    lensRun.mockImplementation((domain: string, action: string) => {
      if (domain === 'worldstate' && action === 'overview') {
        return Promise.resolve(ok({ worlds: [] }));
      }
      return Promise.resolve(ok({}));
    });

    render(<OpsTelemetryPage />);

    const panel = await screen.findByTestId('simulation-overview-panel');
    await waitFor(() =>
      expect(within(panel).getByText('No worlds detected on this instance.')).toBeInTheDocument(),
    );
    expect(within(panel).queryByText('0')).not.toBeInTheDocument();
  });

  it('shows an honest error state when worldstate.overview fails — never renders a stale or fabricated rollup', async () => {
    vi.stubGlobal('fetch', adminFetchMock());
    lensRun.mockImplementation((domain: string, action: string) => {
      if (domain === 'worldstate' && action === 'overview') {
        return Promise.resolve(fail('no_db'));
      }
      return Promise.resolve(ok({}));
    });

    render(<OpsTelemetryPage />);

    const panel = await screen.findByTestId('simulation-overview-panel');
    await waitFor(() => expect(within(panel).getByText('no_db')).toBeInTheDocument());
    // No rollup metrics rendered alongside the error.
    expect(within(panel).queryByText('worlds')).not.toBeInTheDocument();
    expect(within(panel).queryByRole('link', { name: /full observatory/i })).toBeInTheDocument();
  });

  it('surfaces a network rejection from lensRun as an honest error, not a silent blank rollup', async () => {
    vi.stubGlobal('fetch', adminFetchMock());
    lensRun.mockImplementation((domain: string, action: string) => {
      if (domain === 'worldstate' && action === 'overview') {
        return Promise.reject(new Error('network down'));
      }
      return Promise.resolve(ok({}));
    });

    render(<OpsTelemetryPage />);

    const panel = await screen.findByTestId('simulation-overview-panel');
    await waitFor(() => expect(within(panel).getByText('network down')).toBeInTheDocument());
  });
});
