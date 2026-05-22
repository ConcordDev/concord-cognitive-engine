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

import { MusicPlayerPanel } from '@/components/music/MusicPlayerPanel';

const npTrack = { id: 'tk1', title: 'Sunrise', artist: 'Aria', durationSec: 200 };

function routeMock(over: Record<string, unknown> = {}) {
  lensRun.mockImplementation(async (_d: string, macro: string) => {
    const map: Record<string, unknown> = {
      'now-playing': { data: { ok: true, result: { nowPlaying: { track: npTrack, positionSec: 30 } } } },
      'queue-list': { data: { ok: true, result: { tracks: [{ id: 'q1', title: 'Q One', artist: 'X', durationSec: 100 }] } } },
      'recently-played': { data: { ok: true, result: { tracks: [{ id: 'r1', title: 'Rec One', artist: 'Y', durationSec: 90 }] } } },
      'track-lyrics-get': { data: { ok: true, result: { lyrics: [{ timeSec: 0, line: 'line a' }, { timeSec: 100, line: 'line b' }], synced: true } } },
      'playback-progress': { data: { ok: true, result: {} } },
      'play-track': { data: { ok: true, result: {} } },
      ...over,
    };
    return map[macro] ?? { data: { ok: true, result: {} } };
  });
}

describe('MusicPlayerPanel', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('renders now-playing track, queue and recently played', async () => {
    routeMock();
    render(<MusicPlayerPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Sunrise')).toBeInTheDocument());
    expect(screen.getByText('Q One')).toBeInTheDocument();
    expect(screen.getByText('Rec One')).toBeInTheDocument();
    expect(screen.getByText('synced')).toBeInTheDocument();
    expect(screen.getByText('line a')).toBeInTheDocument();
  });

  it('shows empty states when nothing playing and queues empty', async () => {
    routeMock({
      'now-playing': { data: { ok: true, result: { nowPlaying: null } } },
      'queue-list': { data: { ok: true, result: { tracks: [] } } },
      'recently-played': { data: { ok: true, result: { tracks: [] } } },
    });
    render(<MusicPlayerPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Nothing playing/)).toBeInTheDocument());
    expect(screen.getByText('Queue is empty.')).toBeInTheDocument();
    expect(screen.getByText('No listening history yet.')).toBeInTheDocument();
  });

  it('omits lyrics section when no lyric lines returned', async () => {
    routeMock({ 'track-lyrics-get': { data: { ok: true, result: { lyrics: [] } } } });
    render(<MusicPlayerPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Sunrise')).toBeInTheDocument());
    expect(screen.queryByText('Lyrics')).not.toBeInTheDocument();
  });

  it('scrubbing the progress range calls playback-progress macro', async () => {
    routeMock();
    render(<MusicPlayerPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Sunrise')).toBeInTheDocument());
    const range = screen.getByRole('slider');
    fireEvent.change(range, { target: { value: '120' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('music', 'playback-progress', { positionSec: 120 })
    );
  });

  it('clicking play on a queued track calls play-track', async () => {
    const onChange = vi.fn();
    routeMock();
    render(<MusicPlayerPanel onChange={onChange} />);
    await waitFor(() => expect(screen.getByText('Q One')).toBeInTheDocument());
    const playBtns = screen.getAllByRole('button');
    fireEvent.click(playBtns[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('music', 'play-track', { id: 'q1' })
    );
  });

  it('handles unsynced lyrics (no active line highlight)', async () => {
    routeMock({
      'track-lyrics-get': { data: { ok: true, result: { lyrics: [{ timeSec: null, line: 'plain' }], synced: false } } },
    });
    render(<MusicPlayerPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('plain')).toBeInTheDocument());
    expect(screen.queryByText('synced')).not.toBeInTheDocument();
  });
});
