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

const playAlbum = vi.fn();
let nowPlaying: Record<string, unknown> = { track: null, playbackState: 'stopped' };
vi.mock('@/lib/music/store', () => ({
  useMusicStore: () => ({ nowPlaying, playAlbum }),
}));

vi.mock('@/components/music/TrackCard', () => ({
  TrackCard: ({ track, onArtistClick, onPurchase }: { track: { id: string; title: string }; onArtistClick?: (a: string) => void; onPurchase?: (t: { id: string }, tier: string) => void }) =>
    React.createElement('div', { 'data-testid': `track-${track.id}` }, [
      React.createElement('span', { key: 't' }, track.title),
      React.createElement('button', { key: 'a', onClick: () => onArtistClick?.('artist-x') }, 'artist'),
      React.createElement('button', { key: 'p', onClick: () => onPurchase?.(track, 'listen') }, 'buy'),
    ]),
}));

import { AlbumView } from '@/components/music/AlbumView';
import type { Album } from '@/lib/music/types';

const baseAlbum: Album = {
  id: 'al1', title: 'Nightfall', artistId: 'ar1', artistName: 'Nova',
  coverArtUrl: null, releaseDate: '2025-06-15T00:00:00Z', type: 'album',
  genre: 'ambient', description: 'A drift through dusk.', totalDuration: 4200, trackCount: 2,
  tracks: [
    { id: 'tk1', title: 'Track One', trackNumber: 1 } as never,
    { id: 'tk2', title: 'Track Two', trackNumber: 0 } as never,
  ],
};

describe('AlbumView', () => {
  beforeEach(() => { playAlbum.mockReset(); nowPlaying = { track: null, playbackState: 'stopped' }; });

  it('renders album metadata, genre, description and track list', () => {
    render(<AlbumView album={baseAlbum} onArtistClick={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText('Nightfall')).toBeInTheDocument();
    expect(screen.getByText('2025')).toBeInTheDocument();
    expect(screen.getByText('ambient')).toBeInTheDocument();
    expect(screen.getByText('A drift through dusk.')).toBeInTheDocument();
    expect(screen.getByText(/2 tracks, 1h 10m/)).toBeInTheDocument();
    expect(screen.getByTestId('track-tk1')).toBeInTheDocument();
  });

  it('Play button shows "Play" when nothing playing and triggers playAlbum', () => {
    render(<AlbumView album={baseAlbum} onArtistClick={vi.fn()} onBack={vi.fn()} />);
    const playBtn = screen.getByText('Play');
    fireEvent.click(playBtn);
    expect(playAlbum).toHaveBeenCalledWith(baseAlbum.tracks, 0);
  });

  it('shows "Pause" when one of the album tracks is the now-playing track', () => {
    nowPlaying = { track: { id: 'tk1' }, playbackState: 'playing' };
    render(<AlbumView album={baseAlbum} onArtistClick={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText('Pause')).toBeInTheDocument();
  });

  it('Play does nothing when the album has no tracks', () => {
    render(<AlbumView album={{ ...baseAlbum, tracks: [] }} onArtistClick={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(screen.getByText('Play'));
    expect(playAlbum).not.toHaveBeenCalled();
  });

  it('artist name click and Back button fire callbacks', () => {
    const onArtistClick = vi.fn();
    const onBack = vi.fn();
    render(<AlbumView album={baseAlbum} onArtistClick={onArtistClick} onBack={onBack} />);
    fireEvent.click(screen.getByText('Nova'));
    expect(onArtistClick).toHaveBeenCalledWith('ar1');
    fireEvent.click(screen.getByText('Back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('forwards purchase from a TrackCard to onPurchase', () => {
    const onPurchase = vi.fn();
    render(<AlbumView album={baseAlbum} onArtistClick={vi.fn()} onBack={vi.fn()} onPurchase={onPurchase} />);
    fireEvent.click(screen.getAllByText('buy')[0]);
    expect(onPurchase).toHaveBeenCalledWith('tk1', 'listen');
  });

  it('renders without optional genre/description and uses a short duration format', () => {
    render(
      <AlbumView
        album={{ ...baseAlbum, genre: '', description: null, totalDuration: 300 }}
        onArtistClick={vi.fn()}
        onBack={vi.fn()}
      />
    );
    expect(screen.getByText(/2 tracks, 5 min/)).toBeInTheDocument();
    expect(screen.queryByText('A drift through dusk.')).not.toBeInTheDocument();
  });
});
