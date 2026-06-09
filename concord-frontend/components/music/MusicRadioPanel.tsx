'use client';

/**
 * MusicRadioPanel — Spotify 2026 discovery surface: AI DJ (smart
 * shuffle), seeded radio stations, sleep timer, Blend, genre browse
 * and audio settings. Every action wires a real `music` macro.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Radio, Sparkles, Moon, Combine as BlendIcon, LayoutGrid, SlidersHorizontal,
  Loader2, Play, Disc3,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Track { id: string; title: string; artist: string; genre: string; durationSec: number }
interface Genre { genre: string; trackCount: number; totalPlays: number; liked: number }
interface AudioSettings {
  crossfadeSec: number; gapless: boolean; normalize: boolean;
  quality: string; monoAudio: boolean;
}

function dur(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
}

export function MusicRadioPanel({ onChange }: { onChange: () => void }) {
  // AI DJ
  const [djTracks, setDjTracks] = useState<Track[]>([]);
  const [djLine, setDjLine] = useState<string>('');
  const [djBusy, setDjBusy] = useState(false);
  // Radio
  const [radioSeed, setRadioSeed] = useState('');
  const [radioBusy, setRadioBusy] = useState(false);
  const [station, setStation] = useState<{ label: string; trackCount: number } | null>(null);
  // Sleep timer
  const [timerMin, setTimerMin] = useState(30);
  const [timer, setTimer] = useState<{ active: boolean; remainingMin?: number } | null>(null);
  // Genres + settings
  const [genres, setGenres] = useState<Genre[]>([]);
  const [settings, setSettings] = useState<AudioSettings | null>(null);
  const [blendBusy, setBlendBusy] = useState(false);
  const [blendMsg, setBlendMsg] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [g, s, st, t] = await Promise.all([
      lensRun('music', 'genre-hub', {}),
      lensRun('music', 'audio-settings-get', {}),
      lensRun('music', 'radio-status', {}),
      lensRun('music', 'sleep-timer-get', {}),
    ]);
    setGenres(g.data?.result?.genres || []);
    setSettings((s.data?.result?.settings as AudioSettings) || null);
    setStation(st.data?.result?.station || null);
    setTimer(t.data?.result || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Live countdown for the sleep timer.
  useEffect(() => {
    if (!timer?.active) return;
    const iv = setInterval(() => {
      void lensRun('music', 'sleep-timer-get', {}).then((r) => setTimer(r.data?.result || null));
    }, 15000);
    return () => clearInterval(iv);
  }, [timer?.active]);

  const runDj = async (playlistId?: string) => {
    setDjBusy(true);
    const r = await lensRun('music', 'smart-shuffle', playlistId ? { playlistId } : {});
    if (r.data?.ok) {
      setDjTracks(r.data.result?.tracks || []);
      setDjLine(r.data.result?.dj || '');
    } else {
      setDjLine(r.data?.error || 'Smart shuffle needs 2+ tracks in your library.');
      setDjTracks([]);
    }
    setDjBusy(false);
    onChange();
  };

  const startRadio = async () => {
    if (!radioSeed.trim()) return;
    setRadioBusy(true);
    const r = await lensRun('music', 'radio-start', { seedGenre: radioSeed.trim().toLowerCase() });
    if (r.data?.ok) setStation(r.data.result?.station || null);
    else setStation(null);
    setRadioBusy(false);
    onChange();
  };

  const startGenreRadio = async (genre: string) => {
    setRadioBusy(true);
    const r = await lensRun('music', 'radio-start', { seedGenre: genre });
    if (r.data?.ok) setStation(r.data.result?.station || null);
    setRadioBusy(false);
    onChange();
  };

  const setTimerNow = async () => {
    await lensRun('music', 'sleep-timer-set', { minutes: timerMin });
    const r = await lensRun('music', 'sleep-timer-get', {});
    setTimer(r.data?.result || null);
  };
  const cancelTimer = async () => {
    await lensRun('music', 'sleep-timer-cancel', {});
    setTimer({ active: false });
  };

  const makeBlend = async () => {
    setBlendBusy(true);
    const r = await lensRun('music', 'blend', { name: 'Your Blend' });
    setBlendMsg(r.data?.ok
      ? `Created "Your Blend" — ${r.data.result?.trackCount || 0} tracks.`
      : (r.data?.error || 'Blend needs liked or played tracks.'));
    setBlendBusy(false);
    onChange();
  };

  const updateSetting = async (patch: Partial<AudioSettings>) => {
    const r = await lensRun('music', 'audio-settings-set', patch as Record<string, unknown>);
    if (r.data?.ok) setSettings(r.data.result?.settings as AudioSettings);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* AI DJ */}
      <section className="bg-gradient-to-br from-violet-900/40 to-zinc-900 border border-violet-800/40 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-violet-300" />
          <h3 className="text-sm font-bold text-zinc-100">AI DJ — Smart Shuffle</h3>
        </div>
        <p className="text-[11px] text-zinc-400 mb-3">
          A weighted mix of your liked songs, familiar tracks and fresh picks — queued and ready.
        </p>
        <button type="button" onClick={() => runDj()} disabled={djBusy}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50">
          {djBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          Start a DJ session
        </button>
        {djLine && <p className="mt-3 text-xs italic text-violet-200 bg-violet-950/40 rounded-lg px-3 py-2">&ldquo;{djLine}&rdquo;</p>}
        {djTracks.length > 0 && (
          <ul className="mt-2 space-y-1 max-h-44 overflow-y-auto">
            {djTracks.map((t, i) => (
              <li key={t.id} className="flex items-center gap-2 text-xs text-zinc-300">
                <span className="text-zinc-600 w-5 text-right">{i + 1}</span>
                <Disc3 className="w-3 h-3 text-violet-400 shrink-0" />
                <span className="truncate flex-1">{t.title} <span className="text-zinc-400">— {t.artist}</span></span>
                <span className="text-[10px] text-zinc-400">{dur(t.durationSec)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Radio */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Radio className="w-4 h-4 text-emerald-300" />
          <h3 className="text-sm font-bold text-zinc-100">Radio</h3>
        </div>
        <div className="flex gap-2">
          <input value={radioSeed} onChange={(e) => setRadioSeed(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void startRadio(); }}
            placeholder="Seed a station by genre (e.g. pop)"
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          <button type="button" onClick={startRadio} disabled={radioBusy || !radioSeed.trim()}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50">
            {radioBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Tune in'}
          </button>
        </div>
        {station && (
          <p className="mt-2 text-[11px] text-emerald-300">
            <Play className="w-3 h-3 inline" /> Now on air: <strong>{station.label}</strong> · {station.trackCount} tracks queued
          </p>
        )}
      </section>

      {/* Sleep timer */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Moon className="w-4 h-4 text-indigo-300" />
          <h3 className="text-sm font-bold text-zinc-100">Sleep Timer</h3>
        </div>
        {timer?.active ? (
          <div className="flex items-center gap-3">
            <span className="text-xs text-indigo-300">Stops in ~{timer.remainingMin} min</span>
            <button type="button" onClick={cancelTimer}
              className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200">Cancel</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <select value={timerMin} onChange={(e) => setTimerMin(Number(e.target.value))}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-200">
              {[5, 10, 15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
            <button type="button" onClick={setTimerNow}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white">Set timer</button>
          </div>
        )}
      </section>

      {/* Blend */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <BlendIcon className="w-4 h-4 text-pink-300" />
          <h3 className="text-sm font-bold text-zinc-100">Blend</h3>
        </div>
        <p className="text-[11px] text-zinc-400 mb-2">Merge your liked songs and most-played tracks into one shared playlist.</p>
        <button type="button" onClick={makeBlend} disabled={blendBusy}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-pink-600 hover:bg-pink-500 text-white disabled:opacity-50">
          {blendBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BlendIcon className="w-3.5 h-3.5" />}
          Create a Blend
        </button>
        {blendMsg && <p className="mt-2 text-[11px] text-pink-200">{blendMsg}</p>}
      </section>

      {/* Genre hub */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <LayoutGrid className="w-4 h-4 text-zinc-300" />
          <h3 className="text-xs font-semibold text-zinc-300">Browse by genre</h3>
        </div>
        {genres.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">Add tracks to your library to populate genres.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {genres.map((g) => (
              <button key={g.genre} type="button" onClick={() => startGenreRadio(g.genre)}
                className="text-left bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2 hover:border-emerald-700 transition-colors">
                <p className="text-xs font-semibold text-zinc-100 capitalize truncate">{g.genre}</p>
                <p className="text-[10px] text-zinc-400">{g.trackCount} tracks · {g.totalPlays} plays</p>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Audio settings */}
      {settings && (
        <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <SlidersHorizontal className="w-4 h-4 text-zinc-300" />
            <h3 className="text-sm font-bold text-zinc-100">Audio</h3>
          </div>
          <label className="block text-[11px] text-zinc-400 mb-2">
            Crossfade: <span className="text-zinc-200">{settings.crossfadeSec}s</span>
            <input type="range" min={0} max={12} value={settings.crossfadeSec}
              onChange={(e) => updateSetting({ crossfadeSec: Number(e.target.value) })}
              className="w-full accent-emerald-500" />
          </label>
          <label className="flex items-center justify-between text-[11px] text-zinc-300 mb-2">
            <span>Audio quality</span>
            <select value={settings.quality}
              onChange={(e) => updateSetting({ quality: e.target.value })}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-zinc-200">
              {['low', 'normal', 'high', 'lossless'].map((q) => <option key={q} value={q}>{q}</option>)}
            </select>
          </label>
          {([
            ['gapless', 'Gapless playback'],
            ['normalize', 'Normalize volume'],
            ['monoAudio', 'Mono audio'],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center justify-between text-[11px] text-zinc-300 py-1">
              <span>{label}</span>
              <button aria-label="Edit" type="button" onClick={() => updateSetting({ [key]: !settings[key] })}
                className={cn('w-9 h-5 rounded-full transition-colors relative',
                  settings[key] ? 'bg-emerald-600' : 'bg-zinc-700')}>
                <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all',
                  settings[key] ? 'left-4' : 'left-0.5')} />
              </button>
            </label>
          ))}
        </section>
      )}
    </div>
  );
}
