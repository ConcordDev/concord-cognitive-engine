import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { LeagueStandings } from '@/components/sports/LeagueStandings';

describe('LeagueStandings', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('lifts the real created league id/name/sportKind to the parent via onLeagueChange (the dead-end bug fix)', async () => {
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      if (url === '/api/sports/league' && opts?.method === 'POST') {
        return { json: async () => ({ ok: true, leagueId: 'league-abc-123' }) } as Response;
      }
      if (url.includes('/teams')) {
        return { json: async () => ({ ok: true, teams: [] }) } as Response;
      }
      return { json: async () => ({ ok: false }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const onLeagueChange = vi.fn();
    render(<LeagueStandings onLeagueChange={onLeagueChange} />);

    fireEvent.change(screen.getByPlaceholderText('League name'), { target: { value: 'Sunday League' } });
    fireEvent.click(screen.getByText('Create league'));

    await waitFor(() => expect(onLeagueChange).toHaveBeenCalledWith({
      id: 'league-abc-123', name: 'Sunday League', sportKind: 'soccer',
    }));
    // The component itself now shows the standings view (no longer stuck
    // on the create form), proving it didn't just fire the callback while
    // staying dead internally.
    expect(await screen.findByText('Standings')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('exposes the full league id via a real copy-to-clipboard affordance (not a truncated, un-copyable slice)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/teams')) return { json: async () => ({ ok: true, teams: [] }) } as Response;
      return { json: async () => ({ ok: false }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<LeagueStandings leagueId="league-full-uuid-0001" />);
    await screen.findByText('Standings');

    const copyBtn = screen.getByLabelText('Copy league id');
    fireEvent.click(copyBtn);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('league-full-uuid-0001');
    expect(await screen.findByText('copied')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('re-syncs when the parent switches the controlled leagueId prop (recent-leagues picker)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/league-1/teams')) return { json: async () => ({ ok: true, teams: [{ id: 't1', league_id: 'league-1', name: 'Home Team', power_score: 10 }] }) } as Response;
      if (url.includes('/league-2/teams')) return { json: async () => ({ ok: true, teams: [{ id: 't2', league_id: 'league-2', name: 'Away Team', power_score: 20 }] }) } as Response;
      return { json: async () => ({ ok: false }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(<LeagueStandings leagueId="league-1" />);
    expect(await screen.findByText('Home Team')).toBeInTheDocument();

    rerender(<LeagueStandings leagueId="league-2" />);
    expect(await screen.findByText('Away Team')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
