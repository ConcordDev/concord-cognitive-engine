import { describe, it, expect, vi } from 'vitest';
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

vi.mock('@/components/music/TrackCard', () => ({
  TrackCard: ({ track }: { track: { id: string; title: string } }) =>
    React.createElement('div', { 'data-testid': `track-${track.id}` }, track.title),
}));

import { ArtistProfile } from '@/components/music/ArtistProfile';
import type { Artist, MusicTrack, Album } from '@/lib/music/types';

const artist: Artist = {
  id: 'ar1', name: 'Nova', avatarUrl: null, bannerUrl: 'http://x/b.jpg',
  bio: 'A producer of dusk-coded ambient.', verified: true,
  genres: ['ambient', 'downtempo', 'idm', 'extra'],
  links: [{ platform: 'web', url: 'https://nova.fm', label: 'Website' }],
  associatedLenses: ['studio'],
  stats: {
    totalTracks: 12, totalAlbums: 3, totalPlays: 99000, totalPurchases: 50,
    totalRevenue: 1234.5, citationRoyaltyIncome: 88.2, remixRoyaltyIncome: 12.1, remixesOfWork: 7,
  },
  joinedAt: '2024-03-01T00:00:00Z',
};

const tracks = [{ id: 'tk1', title: 'Dawn' } as MusicTrack];
const albums = [{ id: 'al1', title: 'Dusk', type: 'ep', trackCount: 4, releaseDate: '2025-09-01', coverArtUrl: null } as Album];

describe('ArtistProfile', () => {
  it('renders artist name, verified badge, genres and stats', () => {
    render(<ArtistProfile artist={artist} tracks={tracks} albums={albums} onAlbumClick={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText('Nova')).toBeInTheDocument();
    expect(screen.getByText('ambient')).toBeInTheDocument();
    expect(screen.getByText('99,000')).toBeInTheDocument();
    expect(screen.getByText('$1234.50')).toBeInTheDocument();
  });

  it('defaults to the tracks tab and renders track cards', () => {
    render(<ArtistProfile artist={artist} tracks={tracks} albums={albums} onAlbumClick={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByTestId('track-tk1')).toBeInTheDocument();
  });

  it('shows empty-tracks state when no tracks', () => {
    render(<ArtistProfile artist={artist} tracks={[]} albums={albums} onAlbumClick={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText('No tracks published yet')).toBeInTheDocument();
  });

  it('switches to the albums tab and clicking an album fires onAlbumClick', () => {
    const onAlbumClick = vi.fn();
    render(<ArtistProfile artist={artist} tracks={tracks} albums={albums} onAlbumClick={onAlbumClick} onBack={vi.fn()} />);
    fireEvent.click(screen.getByText('albums'));
    expect(screen.getByText('Dusk')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Dusk').closest('button')!);
    expect(onAlbumClick).toHaveBeenCalledWith('al1');
  });

  it('shows empty-albums state when no albums', () => {
    render(<ArtistProfile artist={artist} tracks={tracks} albums={[]} onAlbumClick={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(screen.getByText('albums'));
    expect(screen.getByText('No albums yet')).toBeInTheDocument();
  });

  it('switches to the about tab showing bio, links, lenses and revenue', () => {
    render(<ArtistProfile artist={artist} tracks={tracks} albums={albums} onAlbumClick={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(screen.getByText('about'));
    expect(screen.getByText(/dusk-coded ambient/)).toBeInTheDocument();
    expect(screen.getByText('Website')).toBeInTheDocument();
    expect(screen.getByText('studio')).toBeInTheDocument();
    expect(screen.getByText('Citation Royalties')).toBeInTheDocument();
  });

  it('about tab handles missing bio, links and lenses gracefully', () => {
    const sparse: Artist = { ...artist, bio: null, links: [], associatedLenses: [] };
    render(<ArtistProfile artist={sparse} tracks={tracks} albums={albums} onAlbumClick={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(screen.getByText('about'));
    expect(screen.queryByText('Links')).not.toBeInTheDocument();
    expect(screen.queryByText('Lenses')).not.toBeInTheDocument();
    // "Direct Sales" is the about-tab revenue breakdown — confirms section rendered
    expect(screen.getByText('Direct Sales')).toBeInTheDocument();
  });

  it('Back button fires onBack and unverified artist hides the badge', () => {
    const onBack = vi.fn();
    render(<ArtistProfile artist={{ ...artist, verified: false }} tracks={tracks} albums={albums} onAlbumClick={vi.fn()} onBack={onBack} />);
    fireEvent.click(screen.getByText('Back'));
    expect(onBack).toHaveBeenCalled();
    expect(screen.queryByTestId('icon-CheckCircle2')).not.toBeInTheDocument();
  });
});
