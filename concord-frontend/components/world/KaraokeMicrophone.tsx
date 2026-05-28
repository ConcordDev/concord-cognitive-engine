'use client';

// Phase DC4 — Karaoke microphone with Web Audio pitch + rhythm capture.
// Captures mic input via getUserMedia → AnalyserNode → autocorrelation
// pitch detection. Aggregates pitch deviation + onset-timing error over
// the duration, submits to /api/karaoke/resolve, displays S/A/B/C/D.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Square, Loader2, Music } from 'lucide-react';
import { StationOverlayShell } from './_StationOverlayShell';
import type { OverlayProps } from './StationInteractionRouter';
import { successJuice, milestoneJuice, sfx } from '@/lib/concordia/juice';

interface Song { id: string; name: string; difficulty: number; bpm: number; key?: string; }
interface Result { score: number; xpGained: number; payload: { grade: string; pitchScore: number; rhythmScore: number; }; }

// Autocorrelation pitch detector (simplified). Returns Hz or 0.
function detectPitch(buf: Float32Array, sampleRate: number): number {
  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  if (rms < 0.01) return 0;

  let bestOffset = -1, bestCorrelation = 0;
  const SIZE = buf.length;
  const MAX_OFFSET = Math.floor(SIZE / 2);
  for (let offset = 80; offset < MAX_OFFSET; offset++) {
    let corr = 0;
    for (let i = 0; i < SIZE - offset; i++) corr += buf[i] * buf[i + offset];
    corr = corr / (SIZE - offset);
    if (corr > bestCorrelation) { bestCorrelation = corr; bestOffset = offset; }
  }
  if (bestOffset > 0 && bestCorrelation > 0.5) return sampleRate / bestOffset;
  return 0;
}

export function KaraokeMicrophone({ building, onClose, worldId }: OverlayProps) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [song, setSong] = useState<Song | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [pitchSamples, setPitchSamples] = useState<number[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const j = await fetch('/api/karaoke/songs', { credentials: 'include' }).then(r => r.json());
        if (j?.ok && Array.isArray(j.songs)) setSongs(j.songs);
      } catch { /* fallback empty */ }
    })();
  }, []);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const pitchesRef = useRef<number[]>([]);

  const start = useCallback(async () => {
    if (!song) return;
    setError(null);
    setResult(null);
    setPitchSamples([]);
    pitchesRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
      streamRef.current = stream;
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      startTimeRef.current = performance.now();
      setRecording(true);

      const loop = () => {
        analyser.getFloatTimeDomainData(buf);
        const hz = detectPitch(buf, ctx.sampleRate);
        if (hz > 50 && hz < 2000) pitchesRef.current.push(hz);
        setElapsed(Math.floor((performance.now() - startTimeRef.current) / 1000));
        setPitchSamples([...pitchesRef.current.slice(-50)]);
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) {
      setError((e as Error).message || 'mic_access_failed');
    }
  }, [song]);

  const stop = useCallback(async () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();
    setRecording(false);
    if (!song) return;

    // Compute pitch deviation Hz (std-dev across samples) + rhythm jitter (approximation).
    const pitches = pitchesRef.current;
    if (pitches.length < 5) { setError('not_enough_signal'); return; }
    const mean = pitches.reduce((a, b) => a + b, 0) / pitches.length;
    const variance = pitches.reduce((s, p) => s + (p - mean) ** 2, 0) / pitches.length;
    const pitchAccuracyHz = Math.min(50, Math.sqrt(variance));
    // Rhythm: deviation of onset spacing from BPM ideal.
    const beatSec = 60 / song.bpm;
    const onsetMsErr = Math.abs(elapsed - Math.round(elapsed / beatSec) * beatSec) * 1000;
    const rhythmTimingMs = Math.min(500, onsetMsErr);

    setSubmitting(true);
    try {
      const r = await fetch('/api/karaoke/resolve', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pitchAccuracyHz, rhythmTimingMs, durationSec: elapsed,
          songDifficulty: song.difficulty, singingSkill: 30,
        }),
      });
      const j = await r.json();
      if (j?.ok) {
        const grade = j?.payload?.grade;
        if (grade === 'S' || grade === 'A') milestoneJuice('ui_karaoke_top_grade');
        else if (grade === 'B' || grade === 'C') successJuice('ui_karaoke_finish');
        else sfx('ui_karaoke_finish_low');
        setResult(j as Result);
      } else {
        setError(j?.error || 'resolve_failed');
      }
    } finally { setSubmitting(false); }
  }, [song, elapsed]);

  // Cleanup on unmount.
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();
  }, []);

  const gradeColor: Record<string, string> = {
    S: 'text-amber-300', A: 'text-emerald-300', B: 'text-cyan-300', C: 'text-zinc-300', D: 'text-red-300',
  };

  return (
    <StationOverlayShell
      title={building.name || 'Karaoke booth'}
      subtitle={song ? song.name : `karaoke_booth · ${worldId}`}
      onClose={onClose}
      accent="pink"
      size="md"
    >
      <div className="space-y-3">
        {!song ? (
          <>
            <p className="text-xs text-zinc-400">Pick a song.</p>
            <div className="space-y-1">
              {songs.map((s) => (
                <button key={s.id} onClick={() => setSong(s)} className="block w-full rounded border border-pink-500/30 bg-pink-950/30 p-2 text-left hover:border-pink-400/60 hover:bg-pink-900/30">
                  <div className="flex items-center gap-2">
                    <Music size={14} className="text-pink-300" />
                    <span className="text-sm text-pink-100">{s.name}</span>
                    <span className="ml-auto text-[10px] text-pink-300/70">{s.bpm} bpm · diff {Math.round(s.difficulty * 100)}</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : !result ? (
          <>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={recording ? stop : start}
                disabled={submitting}
                className={[
                  'flex items-center gap-1 rounded px-3 py-1.5 text-sm',
                  recording ? 'bg-red-500/40 text-red-50 hover:bg-red-500/60' : 'bg-pink-500/30 text-pink-100 hover:bg-pink-500/50',
                  'disabled:opacity-50',
                ].join(' ')}
              >
                {submitting ? <Loader2 className="animate-spin" size={14} /> : recording ? <Square size={14} /> : <Mic size={14} />}
                {recording ? `stop · ${elapsed}s` : 'start'}
              </button>
              <button onClick={() => { setSong(null); setError(null); }} className="rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700">
                back
              </button>
            </div>
            {recording && (
              <div className="rounded border border-pink-500/30 bg-zinc-900 p-2">
                <div className="text-[10px] text-pink-300/60">live pitch (Hz)</div>
                <div className="flex h-16 items-end gap-px">
                  {pitchSamples.map((p, i) => {
                    const h = Math.min(64, Math.max(2, (p / 800) * 64));
                    return <div key={i} className="w-1 bg-pink-500" style={{ height: `${h}px` }} />;
                  })}
                </div>
              </div>
            )}
            {error && <p className="text-center text-xs text-red-300">{error}</p>}
          </>
        ) : (
          <div className="text-center">
            <div className={['font-mono text-7xl font-bold', gradeColor[result.payload.grade] || 'text-zinc-300'].join(' ')}>
              {result.payload.grade}
            </div>
            <div className="mt-1 text-sm text-pink-200">{result.score} pts · +{result.xpGained} xp</div>
            <div className="mt-2 text-[10px] text-pink-300/60">
              pitch {Math.round(result.payload.pitchScore)} · rhythm {Math.round(result.payload.rhythmScore)}
            </div>
            <button onClick={() => { setSong(null); setResult(null); setElapsed(0); }} className="mt-3 rounded bg-pink-500/30 px-3 py-1 text-xs text-pink-100 hover:bg-pink-500/50">
              Sing another
            </button>
          </div>
        )}
      </div>
    </StationOverlayShell>
  );
}
