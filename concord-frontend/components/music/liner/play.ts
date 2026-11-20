'use client';

/**
 * Liner Notes plays through the platform's one music player (lib/music/store +
 * lib/music/player, surfaced by the global Now Playing bar), so a song keeps
 * playing while you move to another lens. Starts happen inside the click so
 * the browser allows audio; each start of a release track is counted once by
 * the server (music.release-play, 30 s per listener).
 */

import { useEffect, useRef } from 'react';
import { useMusicStore } from '@/lib/music/store';
import { getPlayer } from '@/lib/music/player';
import type { MusicTrack } from '@/lib/music/types';
import { music, releaseRefOf, toPlayerTrack, type Release } from './linerApi';

export function playQueue(tracks: MusicTrack[], index: number) {
  const list = tracks.filter((t) => !!t.audioUrl);
  if (!list.length) return;
  const i = Math.max(0, Math.min(list.length - 1, index));
  useMusicStore.getState().playAlbum(list, i);
  void getPlayer().primeAndPlay(list[i]).catch(() => { /* the bar shows the stopped state */ });
}

export function playRelease(release: Release, index = 0) {
  playQueue(release.tracks.map((t, i) => toPlayerTrack(release, t, i)), index);
}

export function togglePause() {
  const p = getPlayer();
  if (p.getPlaybackState() === 'playing') p.pause();
  else void p.play().catch(() => {});
}

/** Counts each newly started release track once, wherever playback was started from. */
export function usePlayCounter(onCounted?: (releaseId: string, mediaId: string, plays: number) => void) {
  const trackId = useMusicStore((s) => s.nowPlaying.track?.id);
  const state = useMusicStore((s) => s.nowPlaying.playbackState);
  const counted = useRef<string | null>(null);
  const cb = useRef(onCounted);
  // eslint-disable-next-line react-hooks/refs
  cb.current = onCounted;
  useEffect(() => {
    if (state !== 'playing' || !trackId || counted.current === trackId) return;
    const ref = releaseRefOf(trackId);
    counted.current = trackId;
    if (!ref) return;
    void music<{ counted: boolean; plays: number }>('release-play', { id: ref.releaseId, mediaId: ref.mediaId }).then((r) => {
      if (r.ok && r.result?.counted) cb.current?.(ref.releaseId, ref.mediaId, r.result.plays);
    });
  }, [state, trackId]);
}

export function useNowPlaying(): { trackId: string | null; playing: boolean } {
  const trackId = useMusicStore((s) => s.nowPlaying.track?.id ?? null);
  const playing = useMusicStore((s) => s.nowPlaying.playbackState === 'playing');
  return { trackId, playing };
}
