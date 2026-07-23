import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { SessionClipPicker } from '@/components/music/SessionClipPicker';
import type { MusicTrack } from '@/lib/music/types';

function track(overrides: Partial<MusicTrack>): MusicTrack {
  return {
    id: 't1',
    title: 'Untitled',
    artistId: 'a1',
    artistName: 'Artist',
    albumId: null,
    albumTitle: null,
    coverArtUrl: null,
    audioUrl: '',
    previewUrl: null,
    duration: 180,
    trackNumber: null,
    bpm: 120,
    key: 'C',
    genre: 'electronic',
    subGenre: null,
    tags: [],
    loudnessLUFS: null,
    spectralCentroid: null,
    onsetDensity: null,
    waveformPeaks: [],
    tiers: [],
    playCount: 0,
    purchaseCount: 0,
    remixCount: 0,
    parentTrackId: null,
    parentArtistId: null,
    parentTitle: null,
    lineageDepth: 0,
    stems: [],
    releaseDate: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isExplicit: false,
    lyrics: null,
    credits: [],
    chromaprintHash: null,
    ...overrides,
  } as MusicTrack;
}

const tracks: MusicTrack[] = [
  track({ id: 't1', title: 'Substrate Dreams', artistName: 'Kel', bpm: 128 }),
  track({ id: 't2', title: 'Lattice Pulse', artistName: 'Orin', bpm: 96 }),
];

describe('SessionClipPicker', () => {
  it('lists real tracks from the caller — never fabricated content', () => {
    render(
      <SessionClipPicker tracks={tracks} channelName="Channel 1" sceneName="Scene 1" onSelect={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByText('Substrate Dreams')).toBeInTheDocument();
    expect(screen.getByText('Lattice Pulse')).toBeInTheDocument();
    expect(screen.getByText(/Assign to Channel 1/)).toBeInTheDocument();
  });

  it('calls onSelect with the exact track object when a row is clicked', () => {
    const onSelect = vi.fn();
    render(
      <SessionClipPicker tracks={tracks} channelName="Channel 1" sceneName="Scene 1" onSelect={onSelect} onClose={vi.fn()} />
    );
    fireEvent.click(screen.getByText('Substrate Dreams'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', title: 'Substrate Dreams' }));
  });

  it('filters by search across title, artist, and genre', () => {
    render(
      <SessionClipPicker tracks={tracks} channelName="Channel 1" sceneName="Scene 1" onSelect={vi.fn()} onClose={vi.fn()} />
    );
    fireEvent.change(screen.getByPlaceholderText('Search your tracks…'), { target: { value: 'Orin' } });
    expect(screen.getByText('Lattice Pulse')).toBeInTheDocument();
    expect(screen.queryByText('Substrate Dreams')).not.toBeInTheDocument();
  });

  it('shows an honest empty state when the user has no tracks yet (never invents one)', () => {
    render(
      <SessionClipPicker tracks={[]} channelName="Channel 1" sceneName="Scene 1" onSelect={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByText(/Upload a track first/)).toBeInTheDocument();
  });

  it('calls onClose when the backdrop or close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <SessionClipPicker tracks={tracks} channelName="Channel 1" sceneName="Scene 1" onSelect={vi.fn()} onClose={onClose} />
    );
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});
