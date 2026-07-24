/// <reference types="@testing-library/jest-dom/vitest" />
// Vitest for the World Observatory lens page — pins the world-grid overview,
// the drill-down into worldstate.world_detail, and the honest empty states
// for a world with zero realms/districts/factions (never a fabricated
// placeholder card, per this repo's zero-demo-content invariant).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import WorldObservatoryPage from './page';

/** lensRun envelope: { data: { ok, result, error } } where result is the
 *  unwrapped macro payload (itself an { ok, ...fields } object). */
function ok(payload: Record<string, unknown>) {
  return { data: { ok: true, result: { ok: true, ...payload }, error: null } };
}
function fail(reason: string) {
  return { data: { ok: true, result: { ok: false, reason }, error: null } };
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

/** Real-shaped worldstate.world_detail payload with real numbers. */
function detailPayload(over: Record<string, unknown> = {}) {
  return {
    worldId: 'tunya',
    population: { activeUsers: 12 },
    factions: {
      count: 2,
      states: [
        { factionId: 'faction_alpha', stance: 'war', target: 'faction_beta', momentum: 0.42, phase: 'opening' },
        { factionId: 'faction_beta', stance: 'consolidate', target: null, momentum: -0.1, phase: null },
      ],
      relations: [
        { a: 'faction_alpha', b: 'faction_beta', score: -0.65, kind: 'war' },
      ],
    },
    realms: [
      {
        id: 'realm_1',
        name: 'Test Realm',
        factionId: 'faction_alpha',
        rulerKind: 'npc',
        rulerId: 'npc_f1_a',
        legitimacy: 72,
        treasury: 5000,
        taxRate: 0.15,
        citizens: { avg: 60, count: 2, low: 40, high: 80 },
      },
    ],
    districts: [
      { id: 'tunya:d1', name: 'Test District', areaM2: 10000, buildingCount: 1, lightingTag: 'warm_day' },
    ],
    health: {
      platformWideChecked: 5,
      factionSchedulerFindings: [
        { pathology: 'stuck_scheduler', category: 'liveness', subjectId: 'faction_alpha', disposition: 'healed', detail: { overdue_s: 90000 } },
      ],
    },
    ...over,
  };
}

/** Routes lensRun('worldstate', action, input) calls by action. */
function routeLensRun(overviewRes: unknown, detailFn: (input: Record<string, unknown>) => unknown) {
  lensRun.mockImplementation((_domain: string, action: string, input: Record<string, unknown>) => {
    if (action === 'overview') return Promise.resolve(overviewRes);
    if (action === 'world_detail') return Promise.resolve(detailFn(input));
    return Promise.resolve(ok({}));
  });
}

describe('World Observatory lens page', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });

  it('renders the world grid from real worldstate.overview data, including a liveness warning', async () => {
    routeLensRun(
      ok({
        worlds: [
          worldRow(),
          worldRow({ worldId: 'crime', name: 'Crime City', activeUsers: 4, factionCount: 3, realmCount: 0, districtCount: 2, stuckFactionSchedulers: 2 }),
        ],
      }),
      () => ok(detailPayload()),
    );

    render(<WorldObservatoryPage />);

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('worldstate', 'overview', {}));
    expect(await screen.findByText('Tunya')).toBeInTheDocument();
    expect(screen.getByText('Crime City')).toBeInTheDocument();

    // real counts surface
    expect(screen.getByText('12')).toBeInTheDocument(); // Tunya active users
    expect(screen.getByText('nominal')).toBeInTheDocument(); // Tunya: no stuck schedulers

    // real liveness warning for the stuck world — not decorative, tied to the real count
    expect(screen.getByLabelText('Drill into Crime City')).toBeInTheDocument();
    const stuckBadges = screen.getAllByText('2');
    expect(stuckBadges.length).toBeGreaterThan(0);
  });

  it('drills into worldstate.world_detail on click and renders real faction/realm/district sections', async () => {
    routeLensRun(
      ok({ worlds: [worldRow()] }),
      (input) => ok(detailPayload({ worldId: input.worldId })),
    );

    render(<WorldObservatoryPage />);
    await waitFor(() => expect(screen.getByText('Tunya')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Drill into Tunya'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('worldstate', 'world_detail', { worldId: 'tunya' }),
    );

    // Faction relation renders the real pair + kind + score. "faction_alpha"
    // legitimately appears more than once (state card + relation pill + the
    // liveness finding's subjectId), so assert presence via getAllByText.
    await waitFor(() => expect(screen.getAllByText('faction_alpha').length).toBeGreaterThan(0));
    expect(screen.getAllByText('faction_beta').length).toBeGreaterThan(0);
    // "war" appears both as faction_alpha's stance and the relation kind
    // (visual uppercase is CSS-only — the underlying real string is lowercase).
    expect(screen.getAllByText('war').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('-0.65')).toBeInTheDocument();

    // Faction state cards
    expect(screen.getByText('momentum 0.42')).toBeInTheDocument();

    // Realm card — real legitimacy/treasury/tax/citizens, not rounded-fabricated
    expect(screen.getByText('Test Realm')).toBeInTheDocument();
    expect(screen.getByText('72')).toBeInTheDocument(); // legitimacy
    expect(screen.getByText('5,000')).toBeInTheDocument(); // treasury
    expect(screen.getByText('15%')).toBeInTheDocument(); // tax rate
    expect(screen.getByText(/2 citizens · loyalty avg 60 \(range 40–80\)/)).toBeInTheDocument();

    // District row
    expect(screen.getByText('Test District')).toBeInTheDocument();
    expect(screen.getByText('10,000')).toBeInTheDocument();
    expect(screen.getByText('warm_day')).toBeInTheDocument();

    // Liveness finding surfaced with real overdue detail
    expect(screen.getByText(/stuck_scheduler/)).toBeInTheDocument();
    expect(screen.getByText(/overdue/)).toBeInTheDocument();
  });

  it('shows honest empty states for a world with zero factions/realms/districts — never a fabricated card', async () => {
    routeLensRun(
      ok({ worlds: [worldRow({ worldId: 'empty_world', name: 'Empty World', factionCount: 0, realmCount: 0, districtCount: 0 })] }),
      (input) =>
        ok(
          detailPayload({
            worldId: input.worldId,
            factions: { count: 0, states: [], relations: [] },
            realms: [],
            districts: [],
            health: { platformWideChecked: 5, factionSchedulerFindings: [] },
          }),
        ),
    );

    render(<WorldObservatoryPage />);
    await waitFor(() => expect(screen.getByText('Empty World')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Drill into Empty World'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('worldstate', 'world_detail', { worldId: 'empty_world' }),
    );

    expect(await screen.findByText('No factions have a living presence in this world.')).toBeInTheDocument();
    expect(screen.getByText('No realms have formed in this world yet.')).toBeInTheDocument();
    expect(screen.getByText('No districts platted in this world yet.')).toBeInTheDocument();
    expect(screen.getByText('No stuck faction schedulers detected.')).toBeInTheDocument();

    // Never a fabricated realm/district row
    expect(screen.queryByText('Test Realm')).not.toBeInTheDocument();
    expect(screen.queryByText('Test District')).not.toBeInTheDocument();
  });

  it('shows an honest error state when the overview call fails, and never renders fabricated worlds', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'overview') return Promise.resolve(fail('no_db'));
      return Promise.resolve(ok({}));
    });

    render(<WorldObservatoryPage />);

    await waitFor(() => expect(screen.getByText('no_db')).toBeInTheDocument());
    expect(screen.queryByText('Worlds')).not.toBeInTheDocument();
  });

  it('renders an honest per-realm empty-citizens state instead of a fabricated average', async () => {
    routeLensRun(
      ok({ worlds: [worldRow()] }),
      (input) =>
        ok(
          detailPayload({
            worldId: input.worldId,
            realms: [
              {
                id: 'realm_2', name: 'Ghost Realm', factionId: null, rulerKind: null, rulerId: null,
                legitimacy: 50, treasury: 0, taxRate: 0.1,
                citizens: { avg: 50, count: 0, low: 0, high: 0 },
              },
            ],
          }),
        ),
    );

    render(<WorldObservatoryPage />);
    await waitFor(() => expect(screen.getByText('Tunya')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Drill into Tunya'));

    await waitFor(() => expect(screen.getByText('Ghost Realm')).toBeInTheDocument());
    // Honest: the backend's degenerate avg:50 fallback for zero citizens is
    // never presented as a real average.
    expect(screen.getByText('no citizens tracked')).toBeInTheDocument();
    expect(screen.queryByText(/loyalty avg 50/)).not.toBeInTheDocument();
  });

  it('refreshes both overview and the selected world detail on manual refresh', async () => {
    routeLensRun(
      ok({ worlds: [worldRow()] }),
      (input) => ok(detailPayload({ worldId: input.worldId })),
    );

    render(<WorldObservatoryPage />);
    await waitFor(() => expect(screen.getByText('Tunya')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Drill into Tunya'));
    await waitFor(() => expect(screen.getByText('Test Realm')).toBeInTheDocument());

    const overviewCalls = lensRun.mock.calls.filter((c) => c[1] === 'overview').length;
    const detailCalls = lensRun.mock.calls.filter((c) => c[1] === 'world_detail').length;

    fireEvent.click(screen.getByLabelText('Refresh the observatory'));

    await waitFor(() =>
      expect(lensRun.mock.calls.filter((c) => c[1] === 'overview').length).toBe(overviewCalls + 1),
    );
    expect(lensRun.mock.calls.filter((c) => c[1] === 'world_detail').length).toBe(detailCalls + 1);
  });
});
