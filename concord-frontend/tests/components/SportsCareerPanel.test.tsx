/**
 * SportsCareerPanel — the sports half of the Careers lens, surfaced.
 *
 * Drives the component against a mocked lensRun standing in for the real
 * `sports_careers` macros (leagues / teams / my_career / request_tryout /
 * constants), exactly the shapes server/domains/sports-careers.js returns.
 * No fabricated data: leagues, teams, and the career come straight from the
 * mocked macro responses; a world with no leagues renders the honest empty
 * state instead of invented ones.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

const addToast = vi.fn();
vi.mock('@/store/ui', () => ({
  useUIStore: (selector: (s: { addToast: typeof addToast }) => unknown) => selector({ addToast }),
}));

let mockUser: { id: string } | null = { id: 'player-1' };
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser, isLoading: false, isAuthenticated: !!mockUser }),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, {
    get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]),
  });
});

import { SportsCareerPanel } from '@/components/careers/SportsCareerPanel';

function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result } });
}

const LEAGUE = { id: 'lg_1', name: 'Hoops League', sport_kind: 'basketball', season_num: 2, team_count: 2 };
const TEAMS = [
  { id: 't1', name: 'Lakers', wins: 3, losses: 1, draws: 0, power_score: 80 },
  { id: 't2', name: 'Knicks', wins: 1, losses: 3, draws: 0, power_score: 50 },
];
const CAREER = {
  id: 'car_1', sport_kind: 'basketball', stage: 'amateur',
  tryouts_attempted: 1, tryouts_passed: 1, matches_played: 2, total_score: 30, mvp_awards: 0,
  retired_at: null,
};
const CONSTANTS = {
  STAGE_THRESHOLDS: {
    amateur: { matches: 0, mvp: 0, total: 0 },
    semi_pro: { matches: 5, mvp: 0, total: 50 },
    pro: { matches: 20, mvp: 2, total: 200 },
  },
};

function mockSurface(overrides: Record<string, unknown> = {}) {
  lensRun.mockImplementation((domain: string, name: string) => {
    if (domain !== 'sports_careers') return reply({ ok: true });
    if (name === 'leagues') return reply(overrides.leagues ?? { ok: true, leagues: [LEAGUE] });
    if (name === 'teams') return reply({ ok: true, teams: TEAMS });
    if (name === 'my_career') return reply({ ok: true, career: CAREER });
    if (name === 'constants') return reply({ ok: true, constants: CONSTANTS });
    if (name === 'request_tryout') return reply(overrides.tryout ?? { ok: true, passed: true, composite: 62, required: 30 });
    return reply({ ok: true });
  });
}

beforeEach(() => {
  lensRun.mockReset();
  addToast.mockReset();
  mockUser = { id: 'player-1' };
});

describe('SportsCareerPanel', () => {
  it('renders the world\'s real leagues, teams, and the player\'s career', async () => {
    mockSurface();
    const { getByText } = render(<SportsCareerPanel />);
    await waitFor(() => expect(getByText(/Hoops League · basketball · season 2 · 2 teams/)).toBeInTheDocument());
    await waitFor(() => expect(getByText('Lakers')).toBeInTheDocument());
    expect(getByText(/3W · 1L · 0D · power 80/)).toBeInTheDocument();
    await waitFor(() => expect(getByText(/2 matches · 30 total points · 0 MVPs/)).toBeInTheDocument());
    expect(getByText(/semi pro opens at 5 matches · 50 total points · 0 MVPs/)).toBeInTheDocument();
  });

  it('an empty world shows the honest empty state — no invented league', async () => {
    mockSurface({ leagues: { ok: true, leagues: [] } });
    const { getByText, queryByText } = render(<SportsCareerPanel />);
    await waitFor(() => expect(getByText(/No leagues have been founded in this world yet/)).toBeInTheDocument());
    expect(queryByText(/Hoops League/)).toBeNull();
  });

  it('a tryout reports its real result against the stage bar', async () => {
    mockSurface();
    const { getByLabelText, getByText } = render(<SportsCareerPanel />);
    await waitFor(() => expect(getByText(/Hoops League · basketball · season 2 · 2 teams/)).toBeInTheDocument());
    fireEvent.click(getByLabelText('Request a tryout for the selected league'));
    await waitFor(() => expect(getByText(/Tryout passed — composite 62 against the 30 bar/)).toBeInTheDocument());
    expect(lensRun.mock.calls.some((c) => c[0] === 'sports_careers' && c[1] === 'request_tryout' && c[2]?.leagueId === 'lg_1')).toBe(true);
  });

  it('a failed tryout is reported as a result, not an error', async () => {
    mockSurface({ tryout: { ok: true, passed: false, composite: 12, required: 30 } });
    const { getByLabelText, getByText } = render(<SportsCareerPanel />);
    await waitFor(() => expect(getByText(/Hoops League · basketball · season 2 · 2 teams/)).toBeInTheDocument());
    fireEvent.click(getByLabelText('Request a tryout for the selected league'));
    await waitFor(() => expect(getByText(/Not this time — composite 12 against the 30 bar/)).toBeInTheDocument());
  });
});
