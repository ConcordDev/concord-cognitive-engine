import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => React.createElement('img', { ...props, alt: String(props.alt || '') }),
}));

const playPlaylist = vi.fn();
let nowPlaying: Record<string, unknown> = { track: null, playbackState: 'stopped' };
vi.mock('@/lib/music/store', () => ({
  useMusicStore: () => ({ nowPlaying, playPlaylist }),
}));

vi.mock('@/components/music/TrackCard', () => ({
  TrackCard: ({ track }: { track: { id: string; title: string } }) =>
    React.createElement('div', { 'data-testid': `track-${track.id}` }, track.title),
}));

import { PlaylistView } from '@/components/music/PlaylistView';
import type { Playlist } from '@/lib/music/types';

function makePlaylist(over: Partial<Playlist> = {}): Playlist {
  return {
    id: 'pl1', name: 'Late Night', description: 'Slow burners', coverArtUrl: null,
    creatorId: 'u1', creatorName: 'DJ Owl', isCollaborative: false, isPublic: true,
    totalDuration: 3700, createdAt: '2026-01-01', updatedAt: '2026-01-01',
    tracks: [
      { trackId: 'tk1', track: { id: 'tk1', title: 'Slow One' } as never, addedAt: '2026-01-01', addedBy: 'u1', position: 0 },
      { trackId: 'tk2', track: { id: 'tk2', title: 'Slow Two' } as never, addedAt: '2026-01-02', addedBy: 'u1', position: 1 },
    ],
    ...over,
  };
}

describe('PlaylistView', () => {
  beforeEach(() => { playPlaylist.mockReset(); nowPlaying = { track: null, playbackState: 'stopped' }; });

  it('renders playlist header, public badge and tracks', () => {
    render(<PlaylistView playlist={makePlaylist()} onArtistClick={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText('Late Night')).toBeInTheDocument();
    expect(screen.getByText('Slow burners')).toBeInTheDocument();
    expect(screen.getByText('Public')).toBeInTheDocument();
    expect(screen.getByText(/DJ Owl/)).toBeInTheDocument();
    expect(screen.getByTestId('track-tk1')).toBeInTheDocument();
  });

  it('shows the Private badge and Collaborative label', () => {
    render(<PlaylistView playlist={makePlaylist({ isPublic: false, isCollaborative: true })} onArtistClick={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText('Private')).toBeInTheDocument();
    expect(screen.getByText('Collaborative')).toBeInTheDocument();
  });

  it('Play All triggers playPlaylist when there are tracks', () => {
    render(<PlaylistView playlist={makePlaylist()} onArtistClick={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(screen.getByText('Play'));
    expect(playPlaylist).toHaveBeenCalledWith(expect.any(Array), 'pl1', 'Late Night', 0);
  });

  it('shows "Pause" when a playlist track is currently playing', () => {
    nowPlaying = { track: { id: 'tk2' }, playbackState: 'playing' };
    render(<PlaylistView playlist={makePlaylist()} onArtistClick={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText('Pause')).toBeInTheDocument();
  });

  it('shows the empty state when the playlist has no tracks', () => {
    render(<PlaylistView playlist={makePlaylist({ tracks: [] })} onArtistClick={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText(/No tracks in this playlist yet/)).toBeInTheDocument();
  });

  it('owner controls: edit toggles the edit form and Save fires onUpdatePlaylist', () => {
    const onUpdatePlaylist = vi.fn();
    render(<PlaylistView playlist={makePlaylist()} onArtistClick={vi.fn()} onBack={vi.fn()} isOwner onUpdatePlaylist={onUpdatePlaylist} />);
    fireEvent.click(screen.getByLabelText('Edit'));
    const nameInput = screen.getByDisplayValue('Late Night');
    fireEvent.change(nameInput, { target: { value: 'Midnight' } });
    fireEvent.click(screen.getByText('Save'));
    expect(onUpdatePlaylist).toHaveBeenCalledWith({ name: 'Midnight', description: 'Slow burners' });
  });

  it('edit form Cancel closes the editor', () => {
    render(<PlaylistView playlist={makePlaylist()} onArtistClick={vi.fn()} onBack={vi.fn()} isOwner />);
    fireEvent.click(screen.getByLabelText('Edit'));
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
  });

  it('owner delete and remove-track callbacks fire', () => {
    const onDeletePlaylist = vi.fn();
    const onRemoveTrack = vi.fn();
    render(
      <PlaylistView
        playlist={makePlaylist()}
        onArtistClick={vi.fn()}
        onBack={vi.fn()}
        isOwner
        onDeletePlaylist={onDeletePlaylist}
        onRemoveTrack={onRemoveTrack}
      />
    );
    // First Delete button = playlist delete in the header action row.
    const deletes = screen.getAllByLabelText('Delete');
    fireEvent.click(deletes[0]);
    expect(onDeletePlaylist).toHaveBeenCalled();
    // Remaining Delete buttons = per-track remove buttons.
    fireEvent.click(deletes[1]);
    expect(onRemoveTrack).toHaveBeenCalledWith('tk1');
  });

  it('share button dispatches a playlist:share event and Back fires onBack', () => {
    const handler = vi.fn();
    const onBack = vi.fn();
    window.addEventListener('playlist:share', handler);
    render(<PlaylistView playlist={makePlaylist()} onArtistClick={vi.fn()} onBack={onBack} />);
    fireEvent.click(screen.getByLabelText('Share playlist'));
    expect(handler).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Back'));
    expect(onBack).toHaveBeenCalled();
    window.removeEventListener('playlist:share', handler);
  });

  it('non-owner does not render edit/delete controls', () => {
    render(<PlaylistView playlist={makePlaylist()} onArtistClick={vi.fn()} onBack={vi.fn()} />);
    expect(screen.queryByLabelText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Delete')).not.toBeInTheDocument();
  });
});
