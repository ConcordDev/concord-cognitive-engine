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

import { MusicLibraryPanel } from '@/components/music/MusicLibraryPanel';

const track = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: `Title ${id}`, artist: 'Artist', album: 'Album', genre: 'pop',
  durationSec: 200, liked: false, playCount: 0, ...over,
});

function routeMock(over: Record<string, unknown> = {}) {
  lensRun.mockImplementation(async (_d: string, macro: string) => {
    const map: Record<string, unknown> = {
      'track-list': { data: { ok: true, result: { tracks: [track('t1', { liked: true, playCount: 5 }), track('t2')] } } },
      'playlist-list': { data: { ok: true, result: { playlists: [{ id: 'p1', name: 'Chill', trackCount: 2, durationSec: 400 }] } } },
      'track-add': { data: { ok: true, result: {} } },
      'track-like': { data: { ok: true, result: {} } },
      'play-track': { data: { ok: true, result: {} } },
      'queue-add': { data: { ok: true, result: {} } },
      'track-delete': { data: { ok: true, result: {} } },
      'playlist-create': { data: { ok: true, result: {} } },
      'playlist-detail': { data: { ok: true, result: { tracks: [track('t1', { liked: true })] } } },
      'playlist-add-track': { data: { ok: true, result: {} } },
      ...over,
    };
    return map[macro] ?? { data: { ok: true, result: {} } };
  });
}

describe('MusicLibraryPanel', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('renders tracks and playlists', async () => {
    routeMock();
    render(<MusicLibraryPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Title t1')).toBeInTheDocument());
    expect(screen.getByText('Chill')).toBeInTheDocument();
    expect(screen.getByText(/5 plays/)).toBeInTheDocument();
  });

  it('shows empty state when no tracks', async () => {
    routeMock({ 'track-list': { data: { ok: true, result: { tracks: [] } } } });
    render(<MusicLibraryPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/No tracks. Add music/)).toBeInTheDocument());
  });

  it('toggles the add form and validates a required title', async () => {
    routeMock();
    render(<MusicLibraryPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Add')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Add'));
    fireEvent.click(screen.getByText('Add to library'));
    await waitFor(() => expect(screen.getByText('Track title is required.')).toBeInTheDocument());
  });

  it('adds a track with a valid title', async () => {
    const onChange = vi.fn();
    routeMock();
    render(<MusicLibraryPanel onChange={onChange} />);
    await waitFor(() => expect(screen.getByText('Add')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Add'));
    fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'Brand New' } });
    fireEvent.change(screen.getByPlaceholderText('Mins'), { target: { value: '4' } });
    fireEvent.click(screen.getByText('Add to library'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('music', 'track-add', expect.objectContaining({ title: 'Brand New', durationSec: 240 }))
    );
  });

  it('surfaces the error when track-add fails', async () => {
    routeMock({ 'track-add': { data: { ok: false, error: 'dup track' } } });
    render(<MusicLibraryPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Add')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Add'));
    fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'X' } });
    fireEvent.click(screen.getByText('Add to library'));
    await waitFor(() => expect(screen.getByText('dup track')).toBeInTheDocument());
  });

  it('liking, playing, queueing and deleting a track call macros', async () => {
    routeMock();
    render(<MusicLibraryPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Title t1')).toBeInTheDocument());
    // Each track row has 4 buttons: play, like, queue, delete.
    const t1Row = screen.getByText('Title t1').closest('li')!;
    const rowBtns = Array.from(t1Row.querySelectorAll('button'));
    fireEvent.click(rowBtns[0]); // play
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('music', 'play-track', { id: 't1' }));
    fireEvent.click(rowBtns[1]); // like
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('music', 'track-like', { id: 't1' }));
    fireEvent.click(rowBtns[2]); // queue
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('music', 'queue-add', { trackId: 't1' }));
    fireEvent.click(rowBtns[3]); // delete
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('music', 'track-delete', { id: 't1' }));
  });

  it('searching filters via query param', async () => {
    routeMock();
    render(<MusicLibraryPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Title t1')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Search tracks/), { target: { value: 'lofi' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('music', 'track-list', { query: 'lofi' })
    );
  });

  it('creating a playlist requires a name then calls playlist-create', async () => {
    routeMock();
    render(<MusicLibraryPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Create')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() => expect(screen.getByText('Playlist name is required.')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('New playlist name'), { target: { value: 'Focus' } });
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('music', 'playlist-create', { name: 'Focus' })
    );
  });

  it('opening a playlist loads detail then toggles closed', async () => {
    routeMock();
    render(<MusicLibraryPanel onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Chill')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Chill'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('music', 'playlist-detail', { id: 'p1' }));
    // toggle closed
    fireEvent.click(screen.getByText('Chill'));
  });
});
