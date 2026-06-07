'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  Repeat, Repeat1, Shuffle, ListMusic, ChevronUp, ChevronDown, Heart,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMusicStore } from '@/lib/music/store';
import { getPlayer } from '@/lib/music/player';
import type { RepeatMode, MusicTrack } from '@/lib/music/types';

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function NowPlayingBar() {
  const {
    nowPlaying,
    setPlaybackState,
    setCurrentTime,
    setDuration,
    setVolume,
    toggleMute,
    setRepeat,
    toggleShuffle,
    nextTrack,
    previousTrack,
    hasNext,
    hasPrevious,
    queue,
    queueIndex,
  } = useMusicStore();

  const [expanded, setExpanded] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);
  const [showVolume, setShowVolume] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);
  const frequencyRef = useRef<Uint8Array | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number | null>(null);
  // True once the pre-end crossfade has been kicked off for the current track,
  // so the timeupdate watcher fires it exactly once. Reset on each track change.
  const crossfadeArmedRef = useRef(false);

  const { track, playbackState, currentTime, duration, volume, muted, repeat, shuffle } = nowPlaying;

  // Advance to a track with a TRUE equal-power crossfade when one is configured
  // AND something is already playing to fade FROM; otherwise a plain load+play.
  // Centralised so next/prev/ended/auto-advance all behave identically.
  const advance = useCallback((next: MusicTrack) => {
    const player = getPlayer();
    const cf = player.getCrossfadeSeconds();
    if (cf > 0 && player.hasActiveTrack()) void player.crossfadeTo(next, cf);
    else player.loadTrack(next).then(() => player.play());
  }, []);

  // ---- Player Event Sync ----

  useEffect(() => {
    const player = getPlayer();

    const unsubs = [
      player.on('play', () => setPlaybackState('playing')),
      player.on('pause', () => setPlaybackState('paused')),
      player.on('stop', () => setPlaybackState('stopped')),
      player.on('loading', () => setPlaybackState('loading')),
      player.on('buffering', () => setPlaybackState('buffering')),
      player.on('timeupdate', (data) => {
        const ct = (data?.currentTime as number) || 0;
        const dur = (data?.duration as number) || 0;
        if (!seeking) { setCurrentTime(ct); setDuration(dur); }
        // True overlapping crossfade: start the next track `cf` seconds before
        // this one ends, so both play at once through the equal-power curve.
        const cf = player.getCrossfadeSeconds();
        if (cf > 0 && dur > 0 && !crossfadeArmedRef.current && !player.isCrossfading()
            && repeat !== 'one' && hasNext() && ct >= dur - cf) {
          crossfadeArmedRef.current = true;
          const next = nextTrack();
          if (next) advance(next);
        }
      }),
      player.on('ended', () => {
        // If the pre-end crossfade already fired, the queue has advanced — don't
        // double-advance. Otherwise (cf off, or track too short to pre-arm) advance now.
        if (crossfadeArmedRef.current) { crossfadeArmedRef.current = false; return; }
        const next = nextTrack();
        if (next) advance(next);
      }),
      player.on('error', (data) => {
        console.error('Playback error:', data?.message);
        setPlaybackState('stopped');
      }),
    ];

    return () => unsubs.forEach(u => u());
  }, [seeking, setPlaybackState, setCurrentTime, setDuration, nextTrack, advance, repeat, hasNext]);

  // ---- Load track into player when it changes ----

  useEffect(() => {
    // New track in the spotlight → re-arm the pre-end crossfade watcher.
    crossfadeArmedRef.current = false;
    // A crossfade already loaded + is playing the incoming track on the idle
    // deck, so skip the hard load here (it would re-cut the track from the start
    // and kill the fade-in). The crossfade path drives playback itself.
    if (track && playbackState === 'loading' && !getPlayer().isCrossfading()) {
      const player = getPlayer();
      player.loadTrack(track).then(() => player.play());
    }
  }, [track?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Mini Spectrum Visualizer ----

  useEffect(() => {
    if (playbackState !== 'playing' || !canvasRef.current) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const player = getPlayer();
      frequencyRef.current = player.getFrequencyData();
      const data = frequencyRef.current;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (data) {
        const barCount = 24;
        const barWidth = canvas.width / barCount;
        const step = Math.floor(data.length / barCount);

        for (let i = 0; i < barCount; i++) {
          const val = data[i * step] / 255;
          const barHeight = val * canvas.height;
          const hue = 180 + i * 3; // cyan-to-purple gradient
          ctx.fillStyle = `hsla(${hue}, 100%, 65%, 0.7)`;
          ctx.fillRect(
            i * barWidth + 1,
            canvas.height - barHeight,
            barWidth - 2,
            barHeight,
          );
        }
      }

      animRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [playbackState]);

  // ---- Playback Controls ----

  const handlePlayPause = useCallback(() => {
    const player = getPlayer();
    if (playbackState === 'playing') {
      player.pause();
    } else if (track) {
      player.play();
    }
  }, [playbackState, track]);

  const handlePrevious = useCallback(() => {
    const prev = previousTrack();
    if (prev) advance(prev);
  }, [previousTrack, advance]);

  const handleNext = useCallback(() => {
    const next = nextTrack();
    if (next) advance(next);
  }, [nextTrack, advance]);

  const handleSeekStart = useCallback((e: React.MouseEvent) => {
    setSeeking(true);
    const rect = progressRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setSeekValue(pct * duration);
  }, [duration]);

  const handleSeekEnd = useCallback(() => {
    if (seeking) {
      getPlayer().seek(seekValue);
      setCurrentTime(seekValue);
      setSeeking(false);
    }
  }, [seeking, seekValue, setCurrentTime]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    getPlayer().setVolume(v);
  }, [setVolume]);

  const handleMuteToggle = useCallback(() => {
    toggleMute();
    getPlayer().setMuted(!muted);
  }, [toggleMute, muted]);

  const cycleRepeat = useCallback(() => {
    const modes: RepeatMode[] = ['off', 'all', 'one'];
    const next = modes[(modes.indexOf(repeat) + 1) % modes.length];
    setRepeat(next);
  }, [repeat, setRepeat]);

  // Don't render if no track
  if (!track) return null;

  const progress = duration > 0 ? (seeking ? seekValue : currentTime) / duration : 0;
  const isPlaying = playbackState === 'playing';

  return (
    <div className={cn(
      'fixed bottom-0 left-0 right-0 z-50 transition-all duration-300',
      expanded ? 'h-80' : 'h-18',
    )}>
      {/* Background blur */}
      <div className="absolute inset-0 bg-lattice-void/95 backdrop-blur-xl border-t border-white/10" />

      <div className="relative h-full flex flex-col">
        {/* Progress bar (thin line at top) */}
        <div
          ref={progressRef}
          className="h-1 w-full bg-white/5 cursor-pointer group relative flex-shrink-0"
          onMouseDown={handleSeekStart}
          onMouseUp={handleSeekEnd}
          onMouseLeave={handleSeekEnd}
          onMouseMove={(e) => {
            if (seeking && progressRef.current) {
              const rect = progressRef.current.getBoundingClientRect();
              const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              setSeekValue(pct * duration);
            }
          }}
        >
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-neon-cyan to-neon-purple transition-all"
            style={{ width: `${progress * 100}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-neon-cyan opacity-0 group-hover:opacity-100 transition-opacity shadow-lg shadow-neon-cyan/50"
            style={{ left: `${progress * 100}%`, transform: `translate(-50%, -50%)` }}
          />
        </div>

        {/* Main controls row */}
        <div className="flex-1 flex items-center px-4 gap-4 min-h-0">
          {/* Track info (left) */}
          <div className="flex items-center gap-3 w-72 flex-shrink-0 min-w-0">
            {/* Cover art */}
            <div className="w-12 h-12 rounded-lg bg-white/5 overflow-hidden flex-shrink-0 relative">
              {track.coverArtUrl ? (
                <Image src={track.coverArtUrl} alt={track.title || 'Now playing cover'} fill className="object-cover" unoptimized />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-600">
                  <ListMusic className="w-5 h-5" />
                </div>
              )}
              {/* Mini visualizer overlay */}
              {isPlaying && (
                <canvas
                  ref={canvasRef}
                  width={48}
                  height={48}
                  className="absolute inset-0 opacity-40"
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{track.title}</p>
              <p className="text-xs text-gray-400 truncate">{track.artistName}</p>
            </div>
            <button
              onClick={() => { window.dispatchEvent(new CustomEvent('music:like-track', { detail: { trackId: track.id } })); }}
              className="text-gray-400 hover:text-neon-pink transition-colors flex-shrink-0"
              aria-label="Like track"
            >
              <Heart className="w-4 h-4" />
            </button>
          </div>

          {/* Transport controls (center) */}
          <div className="flex-1 flex flex-col items-center gap-1">
            <div className="flex items-center gap-4">
              <button
                onClick={toggleShuffle}
                className={cn('p-1 transition-colors', shuffle ? 'text-neon-cyan' : 'text-gray-400 hover:text-white')}
                aria-label={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
              >
                <Shuffle className="w-4 h-4" />
              </button>
              <button
                onClick={handlePrevious}
                disabled={!hasPrevious()}
                className="p-1 text-gray-300 hover:text-white disabled:text-gray-600 transition-colors"
                aria-label="Previous track"
              >
                <SkipBack className="w-5 h-5" />
              </button>
              <button
                onClick={handlePlayPause}
                className="w-9 h-9 rounded-full bg-white flex items-center justify-center hover:scale-105 transition-transform"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5 text-black" />
                ) : (
                  <Play className="w-5 h-5 text-black ml-0.5" />
                )}
              </button>
              <button
                onClick={handleNext}
                disabled={!hasNext()}
                className="p-1 text-gray-300 hover:text-white disabled:text-gray-600 transition-colors"
                aria-label="Next track"
              >
                <SkipForward className="w-5 h-5" />
              </button>
              <button
                onClick={cycleRepeat}
                className={cn('p-1 transition-colors', repeat !== 'off' ? 'text-neon-cyan' : 'text-gray-400 hover:text-white')}
                aria-label={repeat === 'off' ? 'Enable repeat' : repeat === 'one' ? 'Repeat all' : 'Disable repeat'}
              >
                {repeat === 'one' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
              </button>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-gray-400 font-mono">
              <span>{formatTime(seeking ? seekValue : currentTime)}</span>
              <span>/</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-3 w-72 justify-end flex-shrink-0">
            {/* Volume */}
            <div
              className="relative flex items-center gap-1"
              onMouseEnter={() => setShowVolume(true)}
              onMouseLeave={() => setShowVolume(false)}
            >
              <button onClick={handleMuteToggle} className="text-gray-400 hover:text-white transition-colors" aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'}>
                {muted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              {showVolume && (
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={muted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-20 h-1 accent-neon-cyan"
                />
              )}
            </div>

            {/* Queue toggle */}
            <button
              onClick={() => setShowQueue(!showQueue)}
              className={cn('p-1 transition-colors', showQueue ? 'text-neon-cyan' : 'text-gray-400 hover:text-white')}
              aria-label={showQueue ? 'Hide queue' : 'Show queue'}
            >
              <ListMusic className="w-4 h-4" />
            </button>

            {/* Expand toggle */}
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-gray-400 hover:text-white transition-colors"
              aria-label={expanded ? 'Collapse player' : 'Expand player'}
            >
              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Expanded view — queue panel */}
        {expanded && (
          <div className="flex-1 border-t border-white/5 overflow-hidden flex">
            {/* Waveform / visualization */}
            <div className="flex-1 p-4 flex items-center justify-center">
              <div className="text-center space-y-2">
                <div className="w-64 h-32 bg-white/5 rounded-xl overflow-hidden relative">
                  {track.waveformPeaks.length > 0 ? (
                    <svg viewBox="0 0 200 60" className="w-full h-full" preserveAspectRatio="none">
                      {track.waveformPeaks.slice(0, 200).map((peak, i) => (
                        <rect
                          key={i}
                          x={i}
                          y={30 - Math.abs(peak) * 30}
                          width={0.8}
                          height={Math.abs(peak) * 60}
                          fill={i / 200 < progress ? 'var(--neon-cyan)' : 'rgba(255,255,255,0.15)'}
                        />
                      ))}
                    </svg>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">
                      No waveform data
                    </div>
                  )}
                </div>
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold">{track.title}</p>
                  <p className="text-xs text-gray-400">{track.artistName}{track.albumTitle ? ` — ${track.albumTitle}` : ''}</p>
                  <div className="flex items-center gap-2 justify-center text-[10px] text-gray-400">
                    {track.bpm && <span>{track.bpm} BPM</span>}
                    {track.key && <span>{track.key}</span>}
                    <span>{track.genre}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Queue list */}
            {showQueue && (
              <div className="w-80 border-l border-white/5 overflow-y-auto p-3">
                <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Queue ({queue.length})</h3>
                <div className="space-y-1">
                  {queue.map((item, i) => (
                    <div
                      key={item.id}
                      className={cn(
                        'flex items-center gap-2 p-1.5 rounded text-xs cursor-pointer hover:bg-white/5',
                        i === queueIndex && 'bg-white/5 text-neon-cyan',
                      )}
                    >
                      <span className="text-gray-600 w-5 text-right font-mono">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className={cn('truncate', i === queueIndex && 'text-neon-cyan')}>{item.track.title}</p>
                        <p className="text-gray-400 truncate">{item.track.artistName}</p>
                      </div>
                      <span className="text-gray-600">{formatTime(item.track.duration)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
