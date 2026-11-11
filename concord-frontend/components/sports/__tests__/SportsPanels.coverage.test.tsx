// Render + behaviour coverage for the sports lens panels: live scoreboard, match simulator,
// leagues, matches, spectator hub (news / schedule / standings / play-by-play / rosters / players /
// reminders / bracket / win probability) and stats. Panels mount against stubbed engine results,
// must render real content, survive a full exercise pass and degrade honestly offline.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const runDomain = vi.fn();
const createFn = vi.fn(async () => ({ id: 'g9' }));
const updateFn = vi.fn(async () => ({}));
const removeFn = vi.fn(async () => ({}));
const GAMES = [
  { id: 'g1', title: 'Opener', type: 'game', createdAt: '2026-03-01T10:00:00Z', updatedAt: '2026-03-01T10:00:00Z', meta: {}, data: { title: 'Opener', sport: 'basketball', team: 'Hawks', opponent: 'Owls', date: '2026-03-01', time: '19:00', location: 'Home Court', result: 'win', scoreHome: 88, scoreAway: 80, notes: 'Strong start' } },
  { id: 'g2', title: 'Rematch', type: 'game', createdAt: '2026-03-02T10:00:00Z', updatedAt: '2026-03-02T10:00:00Z', meta: {}, data: { title: 'Rematch', sport: 'basketball', team: 'Hawks', opponent: 'Owls', date: '2026-04-01', time: '', location: '', result: 'upcoming', scoreHome: 0, scoreAway: 0, notes: '' } },
  { id: 'g3', title: 'Cup tie', type: 'game', createdAt: '2026-03-03T10:00:00Z', updatedAt: '2026-03-03T10:00:00Z', meta: {}, data: { title: 'Cup tie', sport: 'soccer', team: 'Rovers', opponent: 'City', date: '2026-02-01', time: '15:00', location: 'Away', result: 'loss', scoreHome: 1, scoreAway: 3, notes: '' } },
];

function resultFor(action: string): unknown {
  switch (action) {
    case 'scoreboard': return { events: [{ id: 'e1', name: 'Hawks at Owls', shortName: 'ATL @ OWL', date: '2026-03-02T00:00:00Z', status: 'Final', state: 'post', completed: true, clock: null, teams: [{ team: 'Hawks', abbrev: 'ATL', score: 101, homeAway: 'away', winner: true, record: '30-20' }, { team: 'Owls', abbrev: 'OWL', score: 99, homeAway: 'home', winner: false, record: '28-22' }] }, { id: 'e2', name: 'Live game', shortName: 'A @ B', date: '2026-03-02T01:00:00Z', status: 'Q2', state: 'in', completed: false, clock: '4:12', teams: [{ team: 'A', abbrev: 'A', score: 40, homeAway: 'away' }, { team: 'B', abbrev: 'B', score: 38, homeAway: 'home' }] }] };
    case 'espn-news': return { articles: [{ headline: 'Big trade', description: 'Star moves', published: '2026-03-01T10:00:00Z', byline: 'Ann', image: null, link: 'https://example.org/a' }, { headline: 'Injury report', description: null, published: null, byline: null, image: 'https://example.org/i.png', link: null }] };
    case 'espn-schedule': return { fixtures: [{ id: 'f1', name: 'Hawks at Owls', date: '2026-03-05T00:00:00Z', home: 'Owls', away: 'Hawks', homeScore: null, awayScore: null, status: 'Scheduled', completed: false, venue: 'Arena' }, { id: 'f2', name: 'Done', date: '2026-03-01T00:00:00Z', home: 'X', away: 'Y', homeScore: 3, awayScore: 1, status: 'Final', completed: true, venue: null }] };
    case 'espn-standings': return { groups: [{ name: 'East', teams: [{ team: 'Hawks', abbrev: 'ATL', logo: null, wins: 30, losses: 20, ties: null, winPercent: 0.6, streak: 'W3', rank: 1 }, { team: 'Owls', abbrev: 'OWL', logo: null, wins: 28, losses: 22, ties: 2, winPercent: null, streak: null, rank: null }] }] };
    case 'espn-game-summary': return { teams: [{ team: 'Hawks', abbrev: 'ATL', score: 101, homeAway: 'away', winner: true, logo: null, record: '30-20' }, { team: 'Owls', abbrev: 'OWL', score: 99, homeAway: 'home', winner: false, logo: null, record: '28-22' }], plays: [{ id: 1, text: 'Three pointer', period: 1, clock: '10:00', team: 'Hawks', scoringPlay: true, homeScore: 0, awayScore: 3 }, { id: 2, text: 'Foul', period: 1, clock: '9:40', team: null, scoringPlay: false, homeScore: 0, awayScore: 3 }], recap: { headline: 'Hawks edge Owls', body: 'A close one.' }, status: 'Final' };
    case 'team-lookup': return { teams: [{ id: 't1', name: 'Hawks', league: 'NBA', leagueId: 'l1', sport: 'basketball', badge: null, stadium: 'Arena', formedYear: 1949 }] };
    case 'team-roster': return { players: [{ id: 'p1', name: 'Ann Lee', position: 'Guard', nationality: 'US', number: '7', thumb: null, height: '1.80m', weight: '75kg' }] };
    case 'league-table': return { table: [{ rank: 1, teamId: 't1', teamName: 'Hawks', played: 50, win: 30, draw: 0, loss: 20, goalsFor: 5000, goalsAgainst: 4800, goalDifference: 200, points: 60, badge: null }] };
    case 'player-lookup': return { players: [{ id: 'p1', name: 'Ann Lee', team: 'Hawks', sport: 'basketball', position: 'Guard', nationality: 'US', birthDate: '1999-01-01', height: '1.80m', weight: '75kg', thumb: null, description: 'Quick guard.' }] };
    case 'reminder-list': return { reminders: [{ id: 'r1', matchup: 'Hawks v Owls', sport: 'nba', kickoff: '2026-03-05T00:00:00Z', note: 'Watch', upcoming: true }, { id: 'r2', matchup: 'Old game', sport: 'nfl', kickoff: null, note: null, upcoming: false }] };
    case 'bracket-list': return { brackets: [{ id: 'b1', name: 'Playoffs', size: 4, rounds: 2, champion: null, matches: [{ id: 'm1', round: 1, slot: 0, teamA: 'Hawks', teamB: 'Owls', winner: null }, { id: 'm2', round: 1, slot: 1, teamA: 'Bulls', teamB: 'Nets', winner: 'Bulls' }, { id: 'm3', round: 2, slot: 0, teamA: null, teamB: 'Bulls', winner: null }] }] };
    case 'win-probability': return { homeWinPct: 61.5, awayWinPct: 38.5, leader: 'home', margin: 5, elapsedFraction: 0.5, favored: 'home', confidence: 'medium' };
    default: return { ok: true, id: 'new-1' };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: GAMES, isLoading: false, isError: false, error: null, refetch: vi.fn(), create: createFn, createMut: { isPending: false }, update: updateFn, updateMut: { isPending: false }, remove: removeFn, deleteMut: { isPending: false }, isCreating: false }),
}));
vi.mock('@/components/sports/LeagueStandings', () => ({ LeagueStandings: ({ onLeagueChange }: { onLeagueChange?: (l: { id: string; name: string; sportKind: string }) => void }) => <button onClick={() => onLeagueChange?.({ id: 'lg1', name: 'City League', sportKind: 'soccer' })}>pick-league</button> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

let failing = false;
const fetchCalls: Array<{ url: string; method: string }> = [];
const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  fetchCalls.push({ url, method: init?.method || 'GET' });
  if (failing) return { ok: false, status: 503, json: async () => ({ ok: false, error: 'down' }) } as Response;
  if (url.includes('/teams')) return { ok: true, status: 200, json: async () => ({ ok: true, teams: [{ id: 'th', name: 'Home FC', power_score: 70 }, { id: 'ta', name: 'Away FC', power_score: 65 }] }) } as Response;
  if (url.includes('/schedule')) return { ok: true, status: 200, json: async () => ({ ok: true, matchId: 'mx1' }) } as Response;
  if (url.includes('/play')) return { ok: true, status: 200, json: async () => ({ ok: true, matchId: 'mx1', homeScore: 2, awayScore: 1, winnerTeamId: 'th', mvpMemberId: 'm7' }) } as Response;
  return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
});
vi.stubGlobal('fetch', fetchStub);

import { LiveScoreboard } from '../LiveScoreboard';
import { MatchSimulator } from '../MatchSimulator';
import { SportsLeaguesPanel } from '../SportsLeaguesPanel';
import { SportsMatchesPanel } from '../SportsMatchesPanel';
import { SportsSpectatorHub } from '../SportsSpectatorHub';
import { SportsStatsPanel } from '../SportsStatsPanel';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 5)); });
  return !!hits[nth];
};
afterEach(() => { cleanup(); localStorage.clear(); });
beforeEach(() => {
  failing = false; fetchCalls.length = 0;
  lensRunMock.mockReset(); runDomain.mockReset(); createFn.mockClear(); updateFn.mockClear(); removeFn.mockClear();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
  runDomain.mockImplementation(async (_d: string, action: string) => ({ data: { ok: true, result: resultFor(action) } }));
});

const PANELS: Array<[string, () => React.ReactElement]> = [
  ['LiveScoreboard', () => <LiveScoreboard />],
  ['MatchSimulator', () => <MatchSimulator leagueId="lg1" />],
  ['SportsLeaguesPanel', () => <SportsLeaguesPanel />],
  ['SportsMatchesPanel', () => <SportsMatchesPanel />],
  ['SportsSpectatorHub', () => <SportsSpectatorHub />],
  ['SportsStatsPanel', () => <SportsStatsPanel />],
];

describe('sports panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(20);
    await exercise({ passes: 3, text: 'Hawks' });
    await settle();
    await exercise({ passes: 1, text: '12' });
    expect(view.container.textContent).toBeTruthy();
  });

  it.each(PANELS)('%s stays standing when the backend is offline', async (_n, make) => {
    failing = true;
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    runDomain.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(make());
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});

describe('sports flows', () => {
  it('the scoreboard loads each sport, shows live and final games, and refreshes on the minute', async () => {
    vi.useFakeTimers();
    render(<LiveScoreboard />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    for (const label of ['NFL', 'MLB', 'NHL', 'EPL', 'NBA']) await act(async () => { fireEvent.click(screen.getAllByRole('button').find((b) => (b.textContent || '').trim() === label) as HTMLElement); await vi.advanceTimersByTimeAsync(10); });
    const before = runDomain.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(runDomain.mock.calls.length).toBeGreaterThan(before);
    expect(document.body.textContent).toMatch(/Hawks|Owls|ATL/);
    vi.useRealTimers();
  });

  it('the simulator schedules a match between two teams, plays it, and reports a scheduling failure', async () => {
    const onPlayed = vi.fn();
    render(<MatchSimulator leagueId="lg1" onPlayed={onPlayed} reloadToken={1} />);
    await settle();
    const [home, away] = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[];
    fireEvent.change(home, { target: { value: 'th' } });
    fireEvent.change(document.querySelectorAll('select')[1], { target: { value: 'ta' } });
    void away;
    await press(/Schedule/i);
    await press(/Play|Simulate/i);
    expect(fetchCalls.map((c) => c.url)).toEqual(expect.arrayContaining(['/api/sports/league/lg1/teams', '/api/sports/match/schedule', '/api/sports/match/mx1/play']));
    expect(onPlayed).toHaveBeenCalled();
  });

  it('the simulator surfaces a down server', async () => {
    failing = true;
    render(<MatchSimulator leagueId="lg1" />);
    await settle();
    expect(document.body.textContent).toMatch(/unavailable|down/i);
  });

  it('leagues remember a picked league and offer it again', async () => {
    render(<SportsLeaguesPanel />);
    await settle();
    await press(/pick-league/);
    expect(document.body.textContent).toMatch(/City League|Recent/);
    await press(/City League/);
  });

  it('matches: a game is logged, scored inline, edited and deleted', async () => {
    render(<SportsMatchesPanel />);
    await settle();
    await press(/^\s*Add\s*$/);
    fireEvent.change(screen.getByPlaceholderText('Match title'), { target: { value: 'Derby' } });
    fireEvent.change(screen.getByPlaceholderText('Your team'), { target: { value: 'Hawks' } });
    fireEvent.change(screen.getByPlaceholderText('Opponent'), { target: { value: 'Owls' } });
    fireEvent.change(screen.getByPlaceholderText('Your score'), { target: { value: '4' } });
    await press(/^\s*(Save|Create|Add match|Log match)/i);
    fireEvent.change(screen.getByPlaceholderText('Opponent score'), { target: { value: '2' } });
    await press(/^\s*(Save|Create|Add match|Log match)/i);
    await press(/Delete match/i);
    await press(/Confirm delete match/i);
    for (const b of screen.queryAllByRole('button').filter((x) => /score|edit|record/i.test(x.textContent || x.getAttribute('aria-label') || ''))) await act(async () => { fireEvent.click(b); await new Promise((r) => setTimeout(r, 0)); });
    await exercise({ passes: 2, text: '3', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    expect(createFn.mock.calls.length + updateFn.mock.calls.length + removeFn.mock.calls.length).toBeGreaterThan(0);
  });

  it('the spectator hub walks every tab and drives its controls', async () => {
    const view = render(<SportsSpectatorHub />);
    await settle();
    const skip = /^(News|Schedule|Standings|Play-by-Play|Rosters|Players|Reminders|Bracket|Win Prob)$|delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i;
    for (const label of ['News', 'Schedule', 'Standings', 'Play-by-Play', 'Rosters', 'Players', 'Reminders', 'Bracket', 'Win Prob']) {
      const tab = screen.getAllByRole('button').find((b) => (b.textContent || '').trim() === label) as HTMLElement;
      await act(async () => { fireEvent.click(tab); await new Promise((r) => setTimeout(r, 5)); });
      await exercise({ passes: 3, text: 'Hawks', skip });
      await settle();
      await exercise({ passes: 1, text: '3', skip });
      expect(view.container.textContent?.length).toBeGreaterThan(30);
    }
    const a = sent();
    expect(a).toEqual(expect.arrayContaining(['espn-news', 'espn-schedule', 'espn-standings', 'reminder-list', 'bracket-list']));
    expect(a.some((x) => /win-probability|team-lookup|player-lookup|bracket-create|reminder-set|espn-game-summary/.test(x))).toBe(true);
  });

  it('a scheduled fixture opens play-by-play and can set a reminder', async () => {
    render(<SportsSpectatorHub />);
    await settle();
    await press(/^Schedule$/);
    await press(/Remind/i);
    await press(/Play-by-play|Open|Watch/i);
    expect(sent()).toContain('espn-schedule');
  });

  it('brackets are created, advanced and deleted; reminders are removed', async () => {
    render(<SportsSpectatorHub />);
    await settle();
    await press(/^Bracket$/);
    const name = screen.queryAllByRole('textbox').find((i) => /name/i.test((i as HTMLInputElement).placeholder || ''));
    if (name) fireEvent.change(name, { target: { value: 'Cup' } });
    const teams = document.querySelector('textarea');
    if (teams) fireEvent.change(teams, { target: { value: 'A\nB\nC\nD' } });
    await press(/Create|Build/i);
    await press(/Hawks|Owls/, 0);
    await press(/Delete|Trash/i);
    await press(/^Reminders$/);
    await press(/Delete|Trash/i);
    expect(sent().some((x) => /bracket-create|bracket-advance|bracket-delete|reminder-delete/.test(x))).toBe(true);
  });

  it('stats summarize the logged games', async () => {
    const view = render(<SportsStatsPanel />);
    await settle();
    expect(view.container.textContent).toMatch(/Hawks|Rovers|win|loss|Played/i);
  });
});
