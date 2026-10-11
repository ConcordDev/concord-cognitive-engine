import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TrackCard } from '@/components/music/TrackCard';
import { getPlayer } from '@/lib/music/player';
import type { MusicTrack } from '@/lib/music/types';

vi.mock('@/components/lens/PullToSubstrate', () => ({
  PullToSubstrate: () => null,
}));

function track(partial: Partial<MusicTrack> = {}): MusicTrack {
  return {
    id: 'media-1',
    title: 'Test Tone',
    artistId: 'user-a',
    artistName: 'Ada',
    albumId: null,
    albumTitle: null,
    coverArtUrl: null,
    audioUrl: '/api/media/media-1/stream',
    previewUrl: null,
    duration: 3,
    trackNumber: null,
    genre: 'electronic',
    subGenre: null,
    tags: [],
    bpm: null,
    key: null,
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
    releaseDate: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isExplicit: false,
    lyrics: null,
    credits: [],
    chromaprintHash: null,
    ...partial,
  };
}

describe('TrackCard playback', () => {
  afterEach(() => {
    cleanup();
    getPlayer().destroy();
  });

  it('mounts an audio element and advances currentTime when Play is clicked', async () => {
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
      Object.defineProperty(this, 'currentTime', { configurable: true, writable: true, value: 0.5 });
      Object.defineProperty(this, 'duration', { configurable: true, writable: true, value: 3 });
      Object.defineProperty(this, 'paused', { configurable: true, writable: true, value: false });
      Object.defineProperty(this, 'readyState', { configurable: true, writable: true, value: 4 });
      this.dispatchEvent(new Event('play'));
      this.dispatchEvent(new Event('timeupdate'));
      return Promise.resolve();
    };
    try {
      render(<TrackCard track={track()} variant="card" />);
      fireEvent.click(screen.getByRole('button', { name: 'Play Test Tone' }));
      const audio = document.querySelector('audio');
      expect(audio).toBeTruthy();
      expect(audio?.getAttribute('src') || audio?.src || '').toContain('/api/media/media-1/stream');
      expect(audio!.currentTime).toBeGreaterThan(0);
    } finally {
      HTMLMediaElement.prototype.play = original;
    }
  });

  it('labels the row play button with the track title', () => {
    render(<TrackCard track={track({ title: 'Row Tone' })} variant="row" />);
    expect(screen.getByRole('button', { name: 'Play Row Tone' })).toBeTruthy();
  });
});
