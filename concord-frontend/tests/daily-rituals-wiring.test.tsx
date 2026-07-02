/**
 * /lenses/self — Rituals tab wiring (H2): DailyRituals is honest-by-construction.
 *
 * The mount site passes ONLY substrate-backed props:
 *   • streak          ← self.streaks  (overall consecutive-day ledger streak)
 *   • suggestedAction ← beats.list    (top OPEN personal beat, mig-129 player_beats)
 *
 * This test pins:
 *   1. the streak props are mapped EXACTLY from the macro payload
 *      (currentStreak = overall, todayCheckedIn = loggedToday,
 *       longestStreak = max(overall, per-metric longest)),
 *   2. rewards === [] always (no reward substrate — nothing is fabricated),
 *   3. suggestedAction comes from the first OPEN beat's real prose (completed /
 *      resolved beats are skipped),
 *   4. failed queries → the props stay undefined (no fabrication on error),
 *   5. no open beats → suggestedAction stays undefined,
 *   6. everything with no substrate (checkIn / overnightSummary /
 *      dailyChallenge / newspaper / communityUpdates / weatherForecast /
 *      npcMemories) is NEVER passed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ── capture DailyRituals props via the dynamic() loader ──────────────────────
const captured = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));

const runDomain = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a) } },
}));

vi.mock('@/components/world-lens/DailyRituals', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    captured.props.push(props);
    return React.createElement('div', { 'data-testid': 'daily-rituals-mock' });
  },
}));

// next/dynamic → resolve the real loader (which hits the mock above).
vi.mock('next/dynamic', () => ({
  __esModule: true,
  default: (loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>) => {
    const Lazy = React.lazy(loader);
    const Dyn = (props: Record<string, unknown>) =>
      React.createElement(React.Suspense, { fallback: null }, React.createElement(Lazy, props));
    return Dyn;
  },
}));

// ── heavy page deps → inert stubs (same set as self-lens-states.test.tsx) ────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LensVerticalHero', () => ({ LensVerticalHero: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/self/SelfFeed', () => ({ SelfFeed: () => null }));
vi.mock('@/components/self/LogMetricForm', () => ({ LogMetricForm: () => null }));
vi.mock('@/components/self/OverviewDashboard', () => ({ OverviewDashboard: () => null }));
vi.mock('@/components/self/TrendPanel', () => ({ TrendPanel: () => null }));
vi.mock('@/components/self/CorrelationPanel', () => ({ CorrelationPanel: () => null }));
vi.mock('@/components/self/GoalsPanel', () => ({ GoalsPanel: () => null }));
vi.mock('@/components/self/DigestPanel', () => ({ DigestPanel: () => null }));
vi.mock('@/components/self/StreaksPanel', () => ({ StreaksPanel: () => null }));
vi.mock('@/components/self/ImportPanel', () => ({ ImportPanel: () => null }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) =>
    React.createElement('div', props, (props as { children?: React.ReactNode }).children) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SelfPage from '@/app/lenses/self/page';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(SelfPage)),
  );
}

// safeRunDomain reads (r.data?.result ?? r.data) — mirror the server envelopes:
//   self.streaks    → { ok, result: {...} }        → callers see the inner result
//   beats.list      → { ok, result: { ok, beats } } → callers see { ok, beats }
function envelope(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}

/** Route the page's other cross-substrate pulls harmlessly. */
function baseDomain(domain: string, action: string): Promise<unknown> | null {
  if (domain === 'auth' && action === 'whoami') return envelope({}); // no userId → no achievements fetch
  if (domain === 'fitness' && action === 'activity-summary') return envelope({ days: [] });
  if (domain === 'affect' && action === 'trends') return envelope({ hasData: false });
  return null;
}

async function openRitualsTab(utils: ReturnType<typeof renderPage>) {
  fireEvent.click(utils.getByText('Rituals'));
  await waitFor(() => expect(captured.props.length).toBeGreaterThan(0));
}

function lastProps() {
  return captured.props[captured.props.length - 1];
}

beforeEach(() => {
  runDomain.mockReset();
  captured.props.length = 0;
});

describe('Rituals tab — DailyRituals wiring (H2, honest-by-construction)', () => {
  it('maps streak + suggestedAction exactly from the real macro payloads; rewards === []', async () => {
    runDomain.mockImplementation((domain: string, action: string) => {
      if (domain === 'self' && action === 'streaks') {
        return envelope({
          overall: 4,
          loggedToday: true,
          perMetric: [
            { metric: 'steps', longest: 9 },
            { metric: 'mood', longest: 2 },
          ],
          bestStreak: { metric: 'steps', current: 3, longest: 9 },
          activeDays: 12,
        });
      }
      if (domain === 'beats' && action === 'list') {
        return envelope({
          ok: true,
          beats: [
            // newest first, per the server's ORDER BY surfaced_at DESC —
            // completed/resolved beats MUST be skipped, not surfaced.
            { id: 'b2', prose: 'Old resolved beat', surfaced_at: 1750001000, completed_at: 1750002000, outcome: 'realised' },
            { id: 'b1', prose: 'Seek out the mason near the plaza.', surfaced_at: 1750000000, completed_at: null, outcome: null },
          ],
        });
      }
      return baseDomain(domain, action) ?? envelope({});
    });

    const utils = renderPage();
    await openRitualsTab(utils);
    await waitFor(() => expect(lastProps().streak).toBeTruthy());
    await waitFor(() => expect(lastProps().suggestedAction).toBeTruthy());

    const props = lastProps();
    expect(props.streak).toEqual({
      currentStreak: 4,          // ← overall, verbatim
      longestStreak: 9,          // ← max(overall, per-metric longest)
      todayCheckedIn: true,      // ← loggedToday, verbatim
      rewards: [],               // ← ALWAYS [] — no reward substrate; never fabricated
    });

    const sa = props.suggestedAction as { action: string; reason: string; district?: string };
    expect(sa.action).toBe('Seek out the mason near the plaza.'); // ← the OPEN beat's real prose
    expect(sa.reason).toMatch(/personal beat/i);                  // ← real metadata, not invented "why"
    expect(sa.district).toBeUndefined();                          // ← no district substrate on player_beats
  });

  it('passes NOTHING for sections without a substrate (per audit)', async () => {
    runDomain.mockImplementation((domain: string, action: string) => {
      if (domain === 'self' && action === 'streaks') {
        return envelope({ overall: 1, loggedToday: false, perMetric: [] });
      }
      if (domain === 'beats' && action === 'list') return envelope({ ok: true, beats: [] });
      return baseDomain(domain, action) ?? envelope({});
    });

    const utils = renderPage();
    await openRitualsTab(utils);
    await waitFor(() => expect(lastProps().streak).toBeTruthy());

    const props = lastProps();
    // No open beats → the suggested-action section honestly hides.
    expect(props.suggestedAction).toBeUndefined();
    // No substrate → never passed (the component hides each section).
    for (const key of [
      'checkIn', 'overnightSummary', 'dailyChallenge', 'newspaper',
      'communityUpdates', 'weatherForecast', 'npcMemories',
    ]) {
      expect(props[key], `${key} must stay unwired (no substrate)`).toBeUndefined();
    }
    // loggedToday:false maps through verbatim.
    expect((props.streak as { todayCheckedIn: boolean }).todayCheckedIn).toBe(false);
  });

  it('failed macro calls → props stay undefined (no fabrication on error)', async () => {
    runDomain.mockImplementation((domain: string, action: string) => {
      if (domain === 'self' && action === 'streaks') return Promise.reject(new Error('network down'));
      if (domain === 'beats' && action === 'list') return Promise.reject(new Error('network down'));
      return baseDomain(domain, action) ?? envelope({});
    });

    const utils = renderPage();
    await openRitualsTab(utils);
    // Let the (rejected) queries settle.
    await waitFor(() =>
      expect(runDomain.mock.calls.some((c) => c[0] === 'self' && c[1] === 'streaks')).toBe(true));
    await new Promise((r) => setTimeout(r, 0));

    const props = lastProps();
    expect(props.streak).toBeUndefined();
    expect(props.suggestedAction).toBeUndefined();
  });

  it('drives the REAL self.streaks + beats.list macros', async () => {
    runDomain.mockImplementation((domain: string, action: string) =>
      baseDomain(domain, action) ?? envelope({}));

    const utils = renderPage();
    await openRitualsTab(utils);
    await waitFor(() => {
      expect(runDomain.mock.calls.some((c) => c[0] === 'self' && c[1] === 'streaks')).toBe(true);
      expect(runDomain.mock.calls.some((c) => c[0] === 'beats' && c[1] === 'list')).toBe(true);
    });
  });
});
