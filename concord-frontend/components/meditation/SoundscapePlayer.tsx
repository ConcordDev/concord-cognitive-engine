'use client';

/**
 * SoundscapePlayer — real Web-Audio ambient renderer. Licensed audio is
 * excluded by design; instead meditation.soundscapeConfig returns a
 * deterministic synthesis recipe (noise tint + cutoff + LFO, or a tone
 * bed of drone oscillators) that this component renders locally with the
 * Web Audio API. Includes a sleep timer with an eased fade-out driven by
 * meditation.sleepTimerConfig.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2, Play, Pause, Loader2, Moon } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface NoiseLayer { type: string; gain: number; lfoHz: number; lfoDepth: number }
interface SoundConfig {
  kind: 'soundscape' | 'tone_bed';
  sessionId?: string;
  label?: string;
  category?: string;
  noise?: string;
  cutoffHz?: number;
  layers?: NoiseLayer[];
  drone?: number[];
  gain?: number;
  noiseGain?: number;
}
interface FadePoint { atSeconds: number; volume: number }
interface SleepConfig { minutes: number; totalSeconds: number; fadeStartSeconds: number; fadeCurve: FadePoint[] }

const SCAPES: { id: string; label: string }[] = [
  { id: 'sc-rain', label: 'Rainfall' },
  { id: 'sc-ocean', label: 'Ocean Waves' },
  { id: 'sc-forest', label: 'Forest at Dawn' },
  { id: 'sc-white', label: 'White Noise' },
];
const TIMER_OPTIONS = [0, 10, 20, 30, 45];

function makeNoiseBuffer(ctx: AudioContext, tint: string): AudioBuffer {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (tint === 'brown') {
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.5;
    } else if (tint === 'pink') {
      b0 = 0.99765 * b0 + white * 0.0990460;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      d[i] = (b0 + b1 + b2 + white * 0.1848) * 0.25;
    } else {
      d[i] = white * 0.6;
    }
  }
  return buf;
}

export function SoundscapePlayer() {
  const [scapeId, setScapeId] = useState('sc-rain');
  const [config, setConfig] = useState<SoundConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.6);
  const [timerMin, setTimerMin] = useState(0);
  const [remainSec, setRemainSec] = useState(0);

  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const nodesRef = useRef<AudioNode[]>([]);
  const fadeRef = useRef<FadePoint[] | null>(null);
  const countdownRef = useRef<number | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    const r = await lensRun('meditation', 'soundscapeConfig', { sessionId: id });
    setConfig((r.data?.result as SoundConfig) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void load(scapeId); }, [scapeId, load]);

  const teardown = useCallback(() => {
    nodesRef.current.forEach((n) => { try { (n as OscillatorNode).stop?.(); } catch { /* not a source */ } try { n.disconnect(); } catch { /* already gone */ } });
    nodesRef.current = [];
    if (countdownRef.current) { window.clearInterval(countdownRef.current); countdownRef.current = null; }
  }, []);

  const start = useCallback(() => {
    if (!config) return;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = ctxRef.current || new Ctor();
    ctxRef.current = ctx;
    void ctx.resume();
    const master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    masterRef.current = master;
    const built: AudioNode[] = [];

    if (config.kind === 'soundscape') {
      const buf = makeNoiseBuffer(ctx, config.noise || 'pink');
      for (const layer of config.layers || []) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.value = config.cutoffHz || 2000;
        const g = ctx.createGain();
        g.gain.value = layer.gain;
        src.connect(filt); filt.connect(g); g.connect(master);
        if (layer.lfoHz > 0) {
          const lfo = ctx.createOscillator();
          lfo.frequency.value = layer.lfoHz;
          const lfoGain = ctx.createGain();
          lfoGain.gain.value = layer.gain * layer.lfoDepth;
          lfo.connect(lfoGain); lfoGain.connect(g.gain);
          lfo.start();
          built.push(lfo, lfoGain);
        }
        src.start();
        built.push(src, filt, g);
      }
    } else {
      // tone bed: drone oscillators + soft noise
      for (const freq of config.drone || []) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.value = (config.gain || 0.15) / (config.drone?.length || 1);
        osc.connect(g); g.connect(master);
        osc.start();
        built.push(osc, g);
      }
      if (config.noiseGain) {
        const src = ctx.createBufferSource();
        src.buffer = makeNoiseBuffer(ctx, config.noise || 'pink');
        src.loop = true;
        const g = ctx.createGain();
        g.gain.value = config.noiseGain;
        src.connect(g); g.connect(master);
        src.start();
        built.push(src, g);
      }
    }
    nodesRef.current = built;
    setPlaying(true);
  }, [config, volume]);

  const stop = useCallback(() => {
    teardown();
    setPlaying(false);
    setRemainSec(0);
    fadeRef.current = null;
  }, [teardown]);

  // Sleep timer: fetch the eased fade curve and run a countdown.
  useEffect(() => {
    if (!playing || timerMin <= 0) return;
    let cancelled = false;
    (async () => {
      const r = await lensRun('meditation', 'sleepTimerConfig', { minutes: timerMin, sessionId: scapeId });
      if (cancelled) return;
      const sleep = r.data?.result as SleepConfig | null;
      if (!sleep) return;
      fadeRef.current = sleep.fadeCurve;
      setRemainSec(sleep.totalSeconds);
      const total = sleep.totalSeconds;
      countdownRef.current = window.setInterval(() => {
        setRemainSec((rs) => {
          const next = rs - 1;
          const elapsed = total - next;
          const curve = fadeRef.current;
          const master = masterRef.current;
          if (curve && master && curve.length >= 2) {
            // linear-interpolate the eased curve
            let v = curve[0].volume;
            for (let i = 1; i < curve.length; i++) {
              const a = curve[i - 1], b = curve[i];
              if (elapsed >= a.atSeconds && elapsed <= b.atSeconds) {
                const t = (elapsed - a.atSeconds) / Math.max(1, b.atSeconds - a.atSeconds);
                v = a.volume + (b.volume - a.volume) * t;
                break;
              }
              if (elapsed > b.atSeconds) v = b.volume;
            }
            master.gain.value = volume * v;
          }
          if (next <= 0) { stop(); return 0; }
          return next;
        });
      }, 1000);
    })();
    return () => { cancelled = true; if (countdownRef.current) { window.clearInterval(countdownRef.current); countdownRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, timerMin, scapeId]);

  useEffect(() => {
    if (masterRef.current && (timerMin <= 0 || remainSec === 0)) masterRef.current.gain.value = volume;
  }, [volume, timerMin, remainSec]);

  useEffect(() => () => { teardown(); ctxRef.current?.close().catch(() => {}); }, [teardown]);

  // restart synthesis when the soundscape changes mid-play
  useEffect(() => {
    if (playing) { teardown(); setPlaying(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scapeId]);

  return (
    <div className="rounded-2xl border border-sky-900/40 bg-gradient-to-b from-sky-950/20 to-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Volume2 className="w-4 h-4 text-sky-300" />
        <h3 className="text-sm font-bold text-zinc-100">Soundscape Audio</h3>
        <span className="text-[11px] text-zinc-400">synthesized locally</span>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {SCAPES.map((s) => (
          <button key={s.id} type="button" onClick={() => setScapeId(s.id)}
            className={cn('px-2.5 py-1 text-[11px] rounded', scapeId === s.id ? 'bg-sky-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200')}>
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : config ? (
        <>
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3 text-[11px] text-zinc-400">
            {config.kind === 'soundscape'
              ? <>{config.noise} noise · {config.cutoffHz} Hz cutoff · {config.layers?.length ?? 0} layer(s)</>
              : <>tone bed · {config.drone?.length ?? 0} drone(s)</>}
          </div>

          <div className="flex items-center gap-3 mb-3">
            <button type="button" onClick={() => (playing ? stop() : start())}
              className={cn('w-12 h-12 rounded-full flex items-center justify-center text-white',
                playing ? 'bg-zinc-700 hover:bg-zinc-600' : 'bg-sky-600 hover:bg-sky-500')}
              aria-label={playing ? 'Stop' : 'Play'}>
              {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
            </button>
            <div className="flex-1">
              <label className="text-[10px] text-zinc-400 uppercase tracking-wide block mb-0.5">Volume</label>
              <input type="range" min={0} max={1} step={0.05} value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="w-full accent-sky-500" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Moon className="w-3.5 h-3.5 text-indigo-300" />
            <span className="text-[11px] text-zinc-400">Sleep timer</span>
            <div className="flex gap-1 ml-auto">
              {TIMER_OPTIONS.map((m) => (
                <button key={m} type="button" onClick={() => setTimerMin(m)}
                  className={cn('px-2 py-0.5 text-[10px] rounded', timerMin === m ? 'bg-indigo-600 text-white' : 'bg-zinc-900 text-zinc-400')}>
                  {m === 0 ? 'Off' : `${m}m`}
                </button>
              ))}
            </div>
          </div>
          {playing && timerMin > 0 && remainSec > 0 && (
            <p className="text-[11px] text-indigo-300 mt-2 text-center">
              Fading out in {Math.floor(remainSec / 60)}:{(remainSec % 60).toString().padStart(2, '0')}
            </p>
          )}
        </>
      ) : (
        <p className="text-xs text-zinc-400">Soundscape unavailable.</p>
      )}
    </div>
  );
}
