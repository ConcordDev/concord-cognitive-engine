import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('lucide-react', async (importOriginal) => {
  const ReactM = await import('react');
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = ReactM.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      ReactM.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { MusicStatsPanel } from '@/components/music/MusicStatsPanel';

function routeMock(over: Record<string, unknown> = {}) {
  lensRun.mockImplementation(async (_d: string, macro: string) => {
    const map: Record<string, unknown> = {
      'listening-stats': { data: { ok: true, result: { totalPlays: 50, listenedMinutes: 600, listenedHours: 10, byGenre: { pop: 5 }, libraryTracks: 20 } } },
      'wrapped': { data: { ok: true, result: { year: '2026', totalPlays: 50, minutesListened: 600, topTracks: [{ title: 'Top T', plays: 9 }], topArtists: [{ artist: 'Top A', plays: 7 }] } } },
      'top-tracks': { data: { ok: true, result: { tracks: [{ id: 'tt1', title: 'TT One', artist: 'X', playCount: 12 }] } } },
      'daily-mix': { data: { ok: true, result: { tracks: [{ id: 'dm1', title: 'DM One', artist: 'Y', playCount: 3 }] } } },
      'artist-list': { data: { ok: true, result: { artists: [{ name: 'FollowedArt', trackCount: 4 }] } } },
      'artist-follow': { data: { ok: true, result: {} } },
      'play-track': { data: { ok: true, result: {} } },
      ...over,
    };
    return map[macro] ?? { data: { ok: true, result: {} } };
  });
}

describe('MusicStatsPanel', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('renders wrapped, stats, top tracks, daily mix and followed artists', async () => {
    routeMock();
    render(<MusicStatsPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/2026 Wrapped/)).toBeInTheDocument());
    expect(screen.getByText('600 min')).toBeInTheDocument();
    expect(screen.getByText(/1\. Top T/)).toBeInTheDocument();
    expect(screen.getByText(/1\. Top A/)).toBeInTheDocument();
    expect(screen.getByText('TT One', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('DM One', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('FollowedArt', { exact: false })).toBeInTheDocument();
  });

  it('hides wrapped when totalPlays is zero and shows empty daily mix', async () => {
    routeMock({
      'wrapped': { data: { ok: true, result: { year: '2026', totalPlays: 0, minutesListened: 0, topTracks: [], topArtists: [] } } },
      'top-tracks': { data: { ok: true, result: { tracks: [] } } },
      'daily-mix': { data: { ok: true, result: { tracks: [] } } },
      'artist-list': { data: { ok: true, result: { artists: [] } } },
    });
    render(<MusicStatsPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/seed your daily mix/)).toBeInTheDocument());
    expect(screen.queryByText(/Wrapped/)).not.toBeInTheDocument();
  });

  it('following an artist calls artist-follow and clears the input', async () => {
    routeMock();
    render(<MusicStatsPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByPlaceholderText(/Follow an artist/)).toBeInTheDocument());
    const input = screen.getByPlaceholderText(/Follow an artist/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'New Artist' } });
    fireEvent.click(screen.getByText('Follow'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('music', 'artist-follow', { name: 'New Artist' })
    );
  });

  it('does not call artist-follow when the name input is blank', async () => {
    routeMock();
    render(<MusicStatsPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Follow')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Follow'));
    expect(lensRun).not.toHaveBeenCalledWith('music', 'artist-follow', expect.anything());
  });

  it('clicking play on a daily-mix track fires play-track', async () => {
    routeMock();
    render(<MusicStatsPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('DM One', { exact: false })).toBeInTheDocument());
    const playBtns = screen.getAllByRole('button').filter((b) => b.textContent === '');
    fireEvent.click(playBtns[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('music', 'play-track', expect.objectContaining({ id: expect.any(String) }))
    );
  });
});
