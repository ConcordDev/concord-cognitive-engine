/**
 * Null payloads from GET /api/analytics must render as a dash plus the
 * reason. A missing measurement is not a zero and must not throw.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/lib/api/client', () => ({ lensRun: vi.fn() }));
vi.mock('@/lib/design-system', () => ({ ds: { panelFloating: 'panel' } }));

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

describe('AnalyticsDashboard null payload', () => {
  it('renders dashes and reasons instead of throwing on unmeasured personal fields', () => {
    render(<AnalyticsDashboard personalStats={nullPersonal} worldStats={nullWorld} />);
    expect(screen.getAllByText('no_ledger_table').length).toBeGreaterThan(0);
    expect(screen.getByText('not_recorded')).toBeInTheDocument();
    expect(screen.getByText('no_reputation_table')).toBeInTheDocument();
    expect(screen.getByText('no_streak_table')).toBeInTheDocument();
    expect(screen.getByText(/no_building_table/)).toBeInTheDocument();
    expect(screen.getByText(/no_visit_table/)).toBeInTheDocument();
    expect(screen.queryByText('null')).not.toBeInTheDocument();
    expect(screen.queryByText('null%')).not.toBeInTheDocument();
  });

  it('renders dashes and reasons on the world gauges', () => {
    render(<AnalyticsDashboard personalStats={nullPersonal} worldStats={nullWorld} />);
    fireEvent.click(screen.getByRole('button', { name: 'world' }));
    expect(screen.getByText('no_buildings')).toBeInTheDocument();
    expect(screen.getByText('no_sample')).toBeInTheDocument();
    expect(screen.queryByText('null%')).not.toBeInTheDocument();
  });

  it('still prints a real royalty total', () => {
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
  });
});
