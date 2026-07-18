/**
 * /lenses/lock — "Invariant Enforcement" panel's live runtime feed.
 *
 * Closes docs/WAVE4_INVENTORY.md's "lock" row: the sovereignty dashboard's
 * ethos-invariants were a frozen constant list with no live, runtime-checked
 * pass/fail history. server.js now records real enforceEthosInvariant()
 * calls into a bounded in-memory ring buffer and returns them from
 * GET /api/sovereignty/status as `recentEnforcement` + `enforcementStats`
 * (see hooks/use70Lock.ts). This file pins that the lock lens page renders
 * that real feed -- both a populated feed (real rows, real stats) and the
 * honest empty state when the buffer is empty (no fabricated placeholder
 * rows) -- rather than asserting on the (unrelated, unchanged) frozen
 * invariant list or the concurrency profiler.
 *
 * Every non-essential child component/hook is mocked to an inert stub so
 * this file isolates the one panel under test, following the pattern in
 * tests/retail-lens-states.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// ── controllable use70Lock mock ─────────────────────────────────────────
const use70LockMock = vi.fn();
vi.mock('@/hooks/use70Lock', () => ({
  use70Lock: () => use70LockMock(),
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/lib/api/client', () => ({
  apiHelpers: { sovereignty: { audit: vi.fn(() => Promise.resolve({ data: { ok: true, audit: { passed: true, checks: [] } } })) } },
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    create: vi.fn(() => Promise.resolve()),
  }),
}));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

// ── headless chrome + heavy side panels: render-only / inert stubs ──────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lock/SecurityRepos', () => ({ SecurityRepos: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/common/EmptyState', () => ({ ErrorState: () => null }));
vi.mock('@/components/lens/UniversalActions', () => ({ UniversalActions: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/lens/ConnectiveTissueBar', () => ({ ConnectiveTissueBar: () => null }));
vi.mock('@/components/sovereignty/SovereigntyDashboard', () => ({ SovereigntyDashboard: () => null }));
vi.mock('@/components/sovereignty/SovereigntySetup', () => ({ SovereigntySetup: () => null }));
vi.mock('@/components/sovereignty/SovereigntyPrompt', () => ({ SovereigntyPrompt: () => null }));
vi.mock('@/components/sovereignty/LockDashboard', () => ({ LockDashboard: () => null }));
vi.mock('@/components/lock/LockProfiler', () => ({ LockProfiler: () => null }));

import LockLensPage from '@/app/lenses/lock/page';

function baseHookReturn(overrides: Partial<ReturnType<typeof use70LockMock>> = {}) {
  return {
    lockPercentage: 85,
    invariants: [
      { id: 'no-telemetry', name: 'NO_TELEMETRY', status: 'enforced', description: 'x', lastChecked: '2026-07-17T00:00:00.000Z' },
    ],
    lastAudit: undefined,
    isHealthy: true,
    recentEnforcement: [],
    enforcementStats: undefined,
    isLocked: true,
    lockColor: 'sovereignty-locked',
    invariantSummary: { enforced: 1, warning: 0, violated: 0 },
    isLoading: false,
    error: null,
    runAudit: vi.fn(),
    isAuditing: false,
    ...overrides,
  };
}

describe('Lock lens — Live Enforcement feed', () => {
  beforeEach(() => {
    use70LockMock.mockReset();
  });

  it('renders the honest empty state when no enforcement events have occurred since boot', () => {
    use70LockMock.mockReturnValue(baseHookReturn({ recentEnforcement: [] }));
    render(React.createElement(LockLensPage));

    expect(screen.getByText('Live Enforcement')).toBeTruthy();
    expect(screen.getByText('No enforcement events since boot.')).toBeTruthy();
  });

  it('renders real feed rows (pass and blocked) with action name, invariant, and stats -- no fabricated rows', () => {
    use70LockMock.mockReturnValue(
      baseHookReturn({
        recentEnforcement: [
          { action: 'read_dtu_ordinary', invariant: null, result: 'pass', at: '2026-07-17T10:00:00.000Z' },
          { action: 'telemetry_report', invariant: 'NO_TELEMETRY', result: 'blocked', at: '2026-07-17T10:00:05.000Z' },
        ],
        enforcementStats: {
          totalChecks: 12,
          totalBlocked: 1,
          bufferedCount: 2,
          capacity: 500,
          bootAt: '2026-07-17T09:00:00.000Z',
          scope: 'runtime-since-boot',
        },
      })
    );
    render(React.createElement(LockLensPage));

    // Real rows rendered, not the empty state.
    expect(screen.queryByText('No enforcement events since boot.')).toBeNull();
    expect(screen.getByText('read_dtu_ordinary')).toBeTruthy();
    expect(screen.getByText('telemetry_report')).toBeTruthy();
    // 'NO_TELEMETRY' also appears in the (unrelated, unchanged) static
    // invariant list above the feed -- assert the feed's own badge exists
    // among the matches rather than requiring exactly one.
    expect(screen.getAllByText('NO_TELEMETRY').length).toBeGreaterThanOrEqual(2);

    // Honest counters sourced directly from the real enforcementStats, not
    // derived/fabricated client-side.
    expect(screen.getByText(/12 checks · 1 blocked · since boot/)).toBeTruthy();

    // Runtime-vs-CI honesty label present.
    expect(screen.getByText(/not persisted, not a CI\/detector result/)).toBeTruthy();
  });
});
