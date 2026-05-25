'use client';

/**
 * MiniPlayer — Persistent bottom bar shown whenever the global media
 * layer has a current track. Clicking the track info jumps back to
 * the lens that originated playback.
 */

import React from 'react';
import { useRouter } from 'next/navigation';
import { Play, Pause, SkipBack, SkipForward, X } from 'lucide-react';
import { useMediaStore } from '@/store/media';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function MiniPlayer() {
  const router = useRouter();
  const track = useMediaStore((s) => s.currentTrack);
  const isPlaying = useMediaStore((s) => s.isPlaying);
  const currentTime = useMediaStore((s) => s.currentTime);
  const duration = useMediaStore((s) => s.duration);
  const pause = useMediaStore((s) => s.pause);
  const resume = useMediaStore((s) => s.resume);
  const next = useMediaStore((s) => s.next);
  const prev = useMediaStore((s) => s.prev);
  const stop = useMediaStore((s) => s.stop);

  if (!track) return null;

  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 h-14
                 bg-lattice-surface/95 backdrop-blur border-t
                 border-lattice-border flex items-center px-4 z-50"
      role="region"
      aria-label="Global media player"
    >
      {/* Track info — click to return to source lens */}
      <button
        onClick={() => track.lens && router.push(`/lenses/${track.lens}`)}
        className="flex items-center gap-3 min-w-0 flex-1 text-left hover:opacity-80 transition-opacity"
      >
        {track.albumArt ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={track.albumArt} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded bg-gradient-to-br from-neon-cyan/30 to-neon-purple/30 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {track.title[0]?.toUpperCase() || '♪'}
          </div>
        )}
        <div className="min-w-0">
          <div className="text-sm text-white truncate">{track.title}</div>
          <div className="text-xs text-gray-400 truncate">{track.artist}</div>
        </div>
      </button>

      {/* Transport controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={prev}
          aria-label="Previous track"
          className="text-gray-300 hover:text-white transition-colors"
        >
          <SkipBack className="w-4 h-4" />
        </button>
        <button
          onClick={isPlaying ? pause : resume}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="w-8 h-8 rounded-full bg-neon-cyan/20 hover:bg-neon-cyan/30 flex items-center justify-center text-white transition-colors"
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <button
          onClick={next}
          aria-label="Next track"
          className="text-gray-300 hover:text-white transition-colors"
        >
          <SkipForward className="w-4 h-4" />
        </button>
      </div>

      {/* Progress */}
      <div className="ml-4 w-32 h-1 bg-gray-700 rounded overflow-hidden">
        <div
          className="h-full bg-neon-cyan rounded transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>

      <span className="text-xs text-gray-400 ml-2 tabular-nums hidden sm:inline">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>

      <button
        onClick={stop}
        aria-label="Stop and close player"
        className="ml-3 text-gray-400 hover:text-gray-300 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export default MiniPlayer;
