/**
 * Null payloads from GET /api/analytics must render as "Not available" plus a
 * plain-language reason. Raw reason codes must never reach the DOM, and a
 * missing value must never print as null / undefined / NaN or a fake 0.
 * A real measured 0 still renders as 0.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/client', () => ({ lensRun: vi.fn() }));
vi.mock('@/lib/design-system', () => ({ ds: { panelFloating: 'panel' } }));

import { lensRun } from '@/lib/api/client';
import AnalyticsDashboard from './AnalyticsDashboard';

const nullPersonal = {
  totalCitations: null,
  totalRoyalties: null,
  royaltyReason: 'no_ledger_table',
  mostCitedDTU: null,
  mostUsedMaterial: null,
  mostUsedMaterialReason: 'not_recorded',
  reputationByDomain: {
    structural: null, materials: null, infrastructure: null, energy: null,
    architecture: null, mentorship: null, governance: null, exploration: null,
  },
  reputationReason: 'no_reputation_table',
  buildCount: null,
  buildReason: 'no_building_table',
  playtime: null,
  playtimeReason: 'no_visit_table',
  loginStreak: null,
  loginStreakReason: 'no_streak_table',
};

const nullWorld = {
  worldId: 'w1',
  population: 0,
  buildingCount: 0,
  infraCoverage: null,
  infraReason: 'no_buildings',
  envScore: null,
  envReason: 'no_sample',
  economicActivity: 0,
  visitorCount: 0,
};

const RAW_CODES = /no_ledger_table|no_building_table|no_reputation_table|no_visit_table|no_streak_table|no_buildings|no_sample|not_recorded/;

function expectNoRawOrEmptyText() {
  const text = document.body.textContent ?? '';
  expect(text).not.toMatch(/\bnull\b/);
  expect(text).not.toMatch(/undefined/);
  expect(text).not.toMatch(/NaN/);
  expect(text).not.toMatch(RAW_CODES);
}

describe('AnalyticsDashboard null payload — personal tab', () => {
  beforeEach(() => { vi.mocked(lensRun).mockReset(); });

  it('renders Not available with a plain reason for each unmeasured field', () => {
    render(<AnalyticsDashboard personalStats={nullPersonal} worldStats={nullWorld} />);
    // Total Citations, Royalties Earned, and Most Cited DTU all key off the ledger reason.
    expect(screen.getAllByText('Not available — no royalty ledger yet')).toHaveLength(3);
    expect(screen.getByText('Not available — no login streak records yet')).toBeInTheDocument();
    expect(screen.getByText('Not available — not recorded')).toBeInTheDocument();
    expect(screen.getByText('Not available — no reputation records yet')).toBeInTheDocument();
    expect(screen.getByText('Not available — no building records yet')).toBeInTheDocument();
    expect(screen.getByText('Not available — no visit records yet')).toBeInTheDocument();
    expectNoRawOrEmptyText();
  });

  it('prints a real royalty total and real non-zero counts as before', () => {
    render(<AnalyticsDashboard personalStats={{
      ...nullPersonal,
      totalCitations: 3,
      totalRoyalties: 10.5,
      royaltyReason: null,
      mostCitedDTU: { name: 'x', citations: 3 },
      mostUsedMaterial: { name: 'y', uses: 2 },
      mostUsedMaterialReason: null,
      loginStreak: 1,
      loginStreakReason: null,
      buildCount: 4,
      buildReason: null,
      playtime: 2,
      playtimeReason: null,
      reputationByDomain: { structural: 8 },
      reputationReason: null,
    }} />);
    expect(screen.getByText('10.50')).toBeInTheDocument();
    expect(screen.getByText('y')).toBeInTheDocument();
    expect(screen.getByText('2 uses')).toBeInTheDocument();
    expect(screen.getByText('4 saved dashboards')).toBeInTheDocument();
    expect(screen.getByText('2h playtime')).toBeInTheDocument();
    expect(screen.getByText('3 citations')).toBeInTheDocument();
  });

  it('renders a real measured zero as 0, not as Not available', () => {
    render(<AnalyticsDashboard personalStats={{
      ...nullPersonal,
      totalCitations: 0,
      totalRoyalties: 0,
      royaltyReason: null,
      loginStreak: 0,
      loginStreakReason: null,
      buildCount: 0,
      buildReason: null,
      playtime: 0,
      playtimeReason: null,
    }} />);
    expect(screen.getByText('0.00')).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('0 saved dashboards')).toBeInTheDocument();
    expect(screen.getByText('0h playtime')).toBeInTheDocument();
    expect(screen.queryByText(/Not available — no royalty ledger yet/)).not.toBeInTheDocument();
  });

  it('does not show event counts from the fallback macro as citations or a streak', async () => {
    vi.mocked(lensRun).mockResolvedValue({
      data: { ok: true, result: { totalEvents: 7, uniqueUsers: 2, eventsToday: 2, savedDashboards: 0 } },
    } as never);
    render(<AnalyticsDashboard />);
    await waitFor(() => expect(screen.getAllByText('Not available — not recorded').length).toBeGreaterThan(0));
    expect(screen.getByText('0 saved dashboards')).toBeInTheDocument();
    expect(screen.queryByText('7')).not.toBeInTheDocument();
    expect(screen.queryByText('2')).not.toBeInTheDocument();
    expectNoRawOrEmptyText();
  });
});

describe('AnalyticsDashboard null payload — world tab', () => {
  it('renders Not available with a plain reason on the world gauges and counts', () => {
    render(<AnalyticsDashboard personalStats={nullPersonal} worldStats={nullWorld} />);
    fireEvent.click(screen.getByRole('button', { name: 'world' }));
    expect(screen.getByText('Not available — no buildings in this world yet')).toBeInTheDocument();
    expect(screen.getByText('Not available — no players have an ecosystem score here yet')).toBeInTheDocument();
    expect(screen.getByText(/Economic Activity: 0 CC/)).toBeInTheDocument();
    expectNoRawOrEmptyText();
  });

  it('renders a real measured gauge value with a percent sign', () => {
    render(<AnalyticsDashboard personalStats={nullPersonal} worldStats={{
      ...nullWorld, infraCoverage: 67, infraReason: null, envScore: 0, envReason: null,
    }} />);
    fireEvent.click(screen.getByRole('button', { name: 'world' }));
    expect(screen.getByText('67%')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
    expectNoRawOrEmptyText();
  });
});
