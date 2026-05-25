'use client';

/**
 * PodcastStreamPlayer — real <audio> streaming player for a podcast
 * episode enclosure with chapter markers, resume-from-position, smart
 * playback (trim silence visual cue, skip-intro auto-seek, sleep timer)
 * and cross-device sync push. Every value comes from the episode-stream
 * macro — no mock data.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play, Pause, SkipBack, SkipForward, ListTree, Moon,
  Scissors, Loader2, Gauge, X,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Chapter { startSec: number; title: string }
interface StreamDescriptor {
  episodeId: string;
  title: string;
  audioUrl: string;
  durationSec: number;
  chapters: Chapter[];
  resumeSec: number;
  playbackSpeed: number;
  trimSilence: boolean;
  skipIntroSec: number;
}

function fmtClock(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const SPEEDS = [0.8, 1, 1.25, 1.5, 1.75, 2];

export function PodcastStreamPlayer({
  episodeId, deviceLabel, onClose, onProgress,
}: {
  episodeId: string;
  deviceLabel: string;
  onClose: () => void;
  onProgress?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [descriptor, setDescriptor] = useState<StreamDescriptor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [introSkipped, setIntroSkipped] = useState(false);

  // Load the stream descriptor from the backend.
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    void (async () => {
      const r = await lensRun<StreamDescriptor>('podcast', 'episode-stream', { episodeId });
      if (cancelled) return;
      if (r.data?.ok && r.data.result) {
        setDescriptor(r.data.result);
        setSpeed(r.data.result.playbackSpeed || 1);
      } else {
        setError(r.data?.error || 'Could not load stream');
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [episodeId]);

  // Wire audio element once descriptor is ready.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !descriptor) return;
    audio.playbackRate = descriptor.playbackSpeed || 1;
    const onLoaded = () => {
      setDuration(audio.duration || descriptor.durationSec || 0);
      // Resume from last position, then auto-apply skip-intro once.
      const seekTo = descriptor.resumeSec > 0
        ? descriptor.resumeSec
        : descriptor.skipIntroSec;
      if (seekTo > 0 && isFinite(audio.duration)) {
        audio.currentTime = Math.min(seekTo, audio.duration - 1);
        if (descriptor.resumeSec === 0 && descriptor.skipIntroSec > 0) setIntroSkipped(true);
      }
    };
    audio.addEventListener('loadedmetadata', onLoaded);
    return () => audio.removeEventListener('loadedmetadata', onLoaded);
  }, [descriptor]);

  // Persist progress to the backend via sync-push every 10s of playback.
  const lastPushRef = useRef(0);
  const pushSync = useCallback(async (pos: number) => {
    if (!descriptor) return;
    await lensRun('podcast', 'sync-push', {
      episodeId: descriptor.episodeId,
      positionSec: Math.round(pos),
      device: deviceLabel,
      reportedAt: new Date().toISOString(),
    });
    onProgress?.();
  }, [descriptor, deviceLabel, onProgress]);

  const onTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setPosition(audio.currentTime);
    if (audio.currentTime - lastPushRef.current >= 10) {
      lastPushRef.current = audio.currentTime;
      void pushSync(audio.currentTime);
    }
  }, [pushSync]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().then(() => setPlaying(true)).catch(() => setError('Playback blocked by browser'));
    } else {
      audio.pause();
      setPlaying(false);
      void pushSync(audio.currentTime);
    }
  }, [pushSync]);

  const seekTo = useCallback((sec: number) => {
    const audio = audioRef.current;
    if (!audio || !isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(sec, audio.duration));
    setPosition(audio.currentTime);
  }, []);

  const nudge = useCallback((delta: number) => {
    const audio = audioRef.current;
    if (audio) seekTo(audio.currentTime + delta);
  }, [seekTo]);

  const setRate = useCallback((rate: number) => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = rate;
    setSpeed(rate);
    void lensRun('podcast', 'playback-speed-set', { speed: rate });
  }, []);

  // Sleep timer — pauses the audio when the backend-tracked timer ends.
  const [sleepMin, setSleepMin] = useState(0);
  const sleepTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startSleepTimer = useCallback(async (minutes: number) => {
    setSleepMin(minutes);
    if (sleepTimeoutRef.current) clearTimeout(sleepTimeoutRef.current);
    await lensRun('podcast', 'playback-prefs-set', { sleepTimerMin: minutes });
    if (minutes > 0) {
      sleepTimeoutRef.current = setTimeout(() => {
        audioRef.current?.pause();
        setPlaying(false);
        setSleepMin(0);
      }, minutes * 60_000);
    }
  }, []);
  useEffect(() => () => { if (sleepTimeoutRef.current) clearTimeout(sleepTimeoutRef.current); }, []);

  const activeChapterIdx = descriptor
    ? descriptor.chapters.reduce((acc, c, i) => (position >= c.startSec ? i : acc), -1)
    : -1;

  if (loading) {
    return (
      <div className="rounded-xl border border-violet-500/20 bg-zinc-950/70 p-6 flex items-center justify-center text-zinc-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }
  if (error || !descriptor) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-950/30 p-4 text-sm text-rose-300">
        <div className="flex items-center justify-between gap-2">
          <span>{error || 'Stream unavailable'}</span>
          <button type="button" onClick={onClose} className="text-rose-400 hover:text-rose-200" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="mt-1 text-[11px] text-rose-400/70">Refresh the show&apos;s RSS feed to attach a real audio enclosure.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-violet-500/25 bg-zinc-950/80 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-100 truncate">{descriptor.title}</p>
          <p className="text-[11px] text-zinc-400">
            Streaming enclosure
            {introSkipped && <span className="ml-1 text-violet-400">· intro skipped ({descriptor.skipIntroSec}s)</span>}
            {descriptor.trimSilence && <span className="ml-1 text-emerald-400">· trim silence on</span>}
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-zinc-600 hover:text-zinc-300 shrink-0" aria-label="Close player">
          <X className="w-4 h-4" />
        </button>
      </div>

      <audio
        ref={audioRef}
        src={descriptor.audioUrl}
        preload="metadata"
        onTimeUpdate={onTimeUpdate}
        onEnded={() => { setPlaying(false); void pushSync(duration); }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />

      {/* Scrub bar with chapter ticks */}
      <div>
        <div
          className="relative h-2 rounded-full bg-zinc-800 cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const frac = (e.clientX - rect.left) / rect.width;
            seekTo(frac * (duration || descriptor.durationSec));
          }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-violet-500"
            style={{ width: `${duration > 0 ? (position / duration) * 100 : 0}%` }}
          />
          {descriptor.chapters.map((c, i) => (
            <span
              key={i}
              className="absolute top-1/2 -translate-y-1/2 w-1 h-3 rounded-full bg-amber-400/80"
              style={{ left: `${duration > 0 ? Math.min(99, (c.startSec / duration) * 100) : 0}%` }}
              title={c.title}
            />
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-zinc-400 mt-1 font-mono">
          <span>{fmtClock(position)}</span>
          <span>{fmtClock(duration || descriptor.durationSec)}</span>
        </div>
      </div>

      {/* Transport */}
      <div className="flex items-center justify-center gap-3">
        <button type="button" onClick={() => nudge(-15)} className="text-zinc-400 hover:text-zinc-100" aria-label="Back 15s">
          <SkipBack className="w-5 h-5" />
        </button>
        <button
          type="button" onClick={toggle}
          className="w-11 h-11 rounded-full bg-violet-600 hover:bg-violet-500 text-white flex items-center justify-center"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
        </button>
        <button type="button" onClick={() => nudge(30)} className="text-zinc-400 hover:text-zinc-100" aria-label="Forward 30s">
          <SkipForward className="w-5 h-5" />
        </button>
      </div>

      {/* Speed + sleep timer */}
      <div className="flex items-center gap-3 flex-wrap text-[11px]">
        <div className="flex items-center gap-1">
          <Gauge className="w-3.5 h-3.5 text-violet-400" />
          {SPEEDS.map((v) => (
            <button
              key={v} type="button" onClick={() => setRate(v)}
              className={cn('px-1.5 py-0.5 rounded border',
                speed === v ? 'border-violet-700/60 bg-violet-950/50 text-violet-300' : 'border-zinc-700 text-zinc-400')}
            >
              {v}×
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Moon className="w-3.5 h-3.5 text-indigo-400" />
          {[0, 15, 30, 60].map((m) => (
            <button
              key={m} type="button" onClick={() => startSleepTimer(m)}
              className={cn('px-1.5 py-0.5 rounded border',
                sleepMin === m ? 'border-indigo-700/60 bg-indigo-950/50 text-indigo-300' : 'border-zinc-700 text-zinc-400')}
            >
              {m === 0 ? 'off' : `${m}m`}
            </button>
          ))}
        </div>
      </div>

      {/* Chapters */}
      {descriptor.chapters.length > 0 && (
        <div className="border-t border-zinc-800 pt-2">
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-zinc-400 mb-1">
            <ListTree className="w-3 h-3" /> Chapters ({descriptor.chapters.length})
          </p>
          <ul className="space-y-0.5 max-h-40 overflow-y-auto">
            {descriptor.chapters.map((c, i) => (
              <li key={i}>
                <button
                  type="button" onClick={() => seekTo(c.startSec)}
                  className={cn('w-full flex items-center gap-2 px-2 py-1 rounded text-[11px] text-left',
                    i === activeChapterIdx ? 'bg-amber-500/15 text-amber-200' : 'text-zinc-400 hover:bg-zinc-900')}
                >
                  <span className="font-mono text-zinc-600 w-12 shrink-0">{fmtClock(c.startSec)}</span>
                  <span className="truncate">{c.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {descriptor.chapters.length === 0 && (
        <p className="flex items-center gap-1 text-[11px] text-zinc-400 border-t border-zinc-800 pt-2">
          <Scissors className="w-3 h-3" /> No chapter markers in this episode&apos;s feed.
        </p>
      )}
    </div>
  );
}
