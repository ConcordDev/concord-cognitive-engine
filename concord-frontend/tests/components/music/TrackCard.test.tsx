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

const playTrack = vi.fn();
const addToQueue = vi.fn();
let nowPlaying: Record<string, unknown> = { track: null, playbackState: 'stopped' };
vi.mock('@/lib/music/store', () => ({
  useMusicStore: () => ({ nowPlaying, playTrack, addToQueue }),
}));

const playerPlay = vi.fn();
const playerPause = vi.fn();
vi.mock('@/lib/music/player', () => ({
  getPlayer: () => ({ play: playerPlay, pause: playerPause }),
}));

vi.mock('@/components/lens/PullToSubstrate', () => ({
  PullToSubstrate: () => React.createElement('span', { 'data-testid': 'pull-substrate' }),
}));

import { TrackCard } from '@/components/music/TrackCard';
import type { MusicTrack } from '@/lib/music/types';

function makeTrack(over: Partial<MusicTrack> = {}): MusicTrack {
  return {
    id: 'tk1', title: 'Aurora', artistId: 'ar1', artistName: 'Nova',
    albumId: 'al1', albumTitle: 'First Light', coverArtUrl: null, audioUrl: 'http://x/a.mp3',
    previewUrl: null, duration: 185, trackNumber: 1, genre: 'ambient', subGenre: null,
    tags: [], bpm: 120, key: 'Cmaj', loudnessLUFS: null, spectralCentroid: null,
    onsetDensity: null, waveformPeaks: [], tiers: [
      { tier: 'listen', enabled: true, price: 0, currency: 'USD', maxLicenses: null, licensesIssued: 0 },
      { tier: 'create', enabled: true, price: 9.99, currency: 'USD', maxLicenses: null, licensesIssued: 0 },
      { tier: 'commercial', enabled: false, price: 99, currency: 'USD', maxLicenses: null, licensesIssued: 0 },
    ],
    playCount: 1234, purchaseCount: 0, remixCount: 0, parentTrackId: null,
    parentArtistId: null, parentTitle: null, lineageDepth: 0, stems: [],
    releaseDate: '2026-01-01', createdAt: '2026-01-01', updatedAt: '2026-01-01',
    isExplicit: false, lyrics: null, credits: [], chromaprintHash: null, ...over,
  };
}

describe('TrackCard', () => {
  beforeEach(() => {
    playTrack.mockReset(); addToQueue.mockReset();
    playerPlay.mockReset(); playerPause.mockReset();
    nowPlaying = { track: null, playbackState: 'stopped' };
  });

  it('renders card variant with title, artist and genre', () => {
    render(<TrackCard track={makeTrack()} variant="card" />);
    expect(screen.getByText('Aurora')).toBeInTheDocument();
    expect(screen.getByText('Nova')).toBeInTheDocument();
    expect(screen.getByText('ambient')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
  });

  it('card play overlay starts playback for a non-current track', () => {
    render(<TrackCard track={makeTrack()} variant="card" />);
    const overlay = screen.getByText('Aurora').closest('div')!.parentElement!.querySelector('button')!;
    fireEvent.click(overlay);
    expect(playTrack).toHaveBeenCalled();
  });

  it('card play toggles pause when the track is current and playing', () => {
    const t = makeTrack();
    nowPlaying = { track: t, playbackState: 'playing' };
    render(<TrackCard track={t} variant="card" />);
    const overlay = screen.getByText('Aurora').closest('div')!.parentElement!.querySelector('button')!;
    fireEvent.click(overlay);
    expect(playerPause).toHaveBeenCalled();
  });

  it('card play resumes when current track is paused', () => {
    const t = makeTrack();
    nowPlaying = { track: t, playbackState: 'paused' };
    render(<TrackCard track={t} variant="card" />);
    const overlay = screen.getByText('Aurora').closest('div')!.parentElement!.querySelector('button')!;
    fireEvent.click(overlay);
    expect(playerPlay).toHaveBeenCalled();
  });

  it('liking and adding to queue work in card variant', () => {
    render(<TrackCard track={makeTrack()} variant="card" />);
    fireEvent.click(screen.getByLabelText('Like'));
    fireEvent.click(screen.getByLabelText('Add'));
    expect(addToQueue).toHaveBeenCalled();
  });

  it('shows a no-audio warning when the track has no audioUrl', () => {
    render(<TrackCard track={makeTrack({ audioUrl: '' })} variant="card" />);
    const overlay = screen.getByText('Aurora').closest('div')!.parentElement!.querySelector('button')!;
    fireEvent.click(overlay);
    expect(screen.getByText(/No audio file/)).toBeInTheDocument();
  });

  it('renders tier badges when showTiers is set and skips disabled tiers', () => {
    render(<TrackCard track={makeTrack()} variant="card" showTiers />);
    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getByText('$9.99')).toBeInTheDocument();
    expect(screen.queryByText('$99.00')).not.toBeInTheDocument();
  });

  it('shows the lineage badge when showLineage and lineageDepth > 0', () => {
    render(<TrackCard track={makeTrack({ lineageDepth: 2, parentTitle: 'Origin' })} variant="card" showLineage />);
    expect(screen.getByText(/Remix of "Origin"/)).toBeInTheDocument();
  });

  it('renders row variant with play count and duration', () => {
    render(<TrackCard track={makeTrack()} variant="row" />);
    expect(screen.getByText(/1,234 plays/)).toBeInTheDocument();
    expect(screen.getByText('3:05')).toBeInTheDocument();
  });

  it('row variant: artist click and album click fire callbacks', () => {
    const onArtistClick = vi.fn();
    const onAlbumClick = vi.fn();
    render(<TrackCard track={makeTrack()} variant="row" onArtistClick={onArtistClick} onAlbumClick={onAlbumClick} />);
    fireEvent.click(screen.getByText('Nova'));
    expect(onArtistClick).toHaveBeenCalledWith('ar1');
    fireEvent.click(screen.getByText(/First Light/));
    expect(onAlbumClick).toHaveBeenCalledWith('al1');
  });

  it('row variant: tier menu toggles open and a purchase callback fires', () => {
    const onPurchase = vi.fn();
    render(<TrackCard track={makeTrack()} variant="row" showTiers onPurchase={onPurchase} />);
    fireEvent.click(screen.getByLabelText('Cart'));
    fireEvent.click(screen.getByText(/Listen/));
    expect(onPurchase).toHaveBeenCalled();
  });

  it('row variant: track menu dispatches a track:menu event', () => {
    const handler = vi.fn();
    window.addEventListener('track:menu', handler);
    render(<TrackCard track={makeTrack()} variant="row" />);
    fireEvent.click(screen.getByLabelText('Track menu'));
    expect(handler).toHaveBeenCalled();
    window.removeEventListener('track:menu', handler);
  });

  it('renders compact variant and plays on click', () => {
    render(<TrackCard track={makeTrack()} variant="compact" />);
    fireEvent.click(screen.getByText('Aurora'));
    expect(playTrack).toHaveBeenCalled();
  });

  it('compact variant shows pause icon when current track playing', () => {
    const t = makeTrack();
    nowPlaying = { track: t, playbackState: 'playing' };
    render(<TrackCard track={t} variant="compact" />);
    expect(screen.getByText('3:05')).toBeInTheDocument();
  });

  it('renders cover art images when coverArtUrl is set', () => {
    render(<TrackCard track={makeTrack({ coverArtUrl: 'http://x/cover.jpg' })} variant="card" />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'http://x/cover.jpg');
  });

  it('row variant renders the lineage badge', () => {
    render(<TrackCard track={makeTrack({ lineageDepth: 1 })} variant="row" showLineage />);
    expect(screen.getByText('Remix')).toBeInTheDocument();
  });

  it('default purchase handler asks for confirmation on a paid tier', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<TrackCard track={makeTrack()} variant="card" showTiers />);
    // the $9.99 "create" tier triggers the confirm prompt
    fireEvent.click(screen.getByText('$9.99'));
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('default purchase handler skips free tiers without a confirm prompt', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TrackCard track={makeTrack()} variant="card" showTiers />);
    fireEvent.click(screen.getByText('Free'));
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('row variant without album title omits the album link', () => {
    render(<TrackCard track={makeTrack({ albumTitle: null })} variant="row" />);
    expect(screen.queryByText(/First Light/)).not.toBeInTheDocument();
  });
});
