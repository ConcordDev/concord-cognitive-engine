'use client';

/**
 * VoiceprintEnroll — automatic speaker identification. Records a short
 * voice sample, computes a real acoustic feature vector via the Web Audio
 * API (mean pitch / energy / spectral centroid / zero-crossing rate /
 * spectral rolloff), and enrolls it as a voice-print. Later samples are
 * identified by nearest-neighbour match. Wires voice.voiceprint-enroll,
 * voice.voiceprint-list, voice.voiceprint-delete, voice.voiceprint-identify.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Fingerprint, Mic, Trash2, Loader2, UserCheck } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface VoicePrint { id: string; name: string; sampleCount: number; dimensions: number }
interface IdentifyResult { matched: boolean; speaker: string | null; confidence: number; bestDistance: number }

const SAMPLE_MS = 3000;

/** Records ~3 s of mic audio and reduces it to a 5-dim acoustic feature vector. */
async function captureVector(): Promise<number[]> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  src.connect(analyser);
  const freq = new Float32Array(analyser.frequencyBinCount);
  const time = new Float32Array(analyser.fftSize);
  const acc = { pitch: 0, energy: 0, centroid: 0, zcr: 0, rolloff: 0, n: 0 };
  const nyquist = ctx.sampleRate / 2;

  await new Promise<void>((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      analyser.getFloatFrequencyData(freq);
      analyser.getFloatTimeDomainData(time);
      // Energy (RMS) of the time-domain signal.
      let rms = 0;
      for (let i = 0; i < time.length; i++) rms += time[i] * time[i];
      rms = Math.sqrt(rms / time.length);
      // Zero-crossing rate.
      let zc = 0;
      for (let i = 1; i < time.length; i++) if ((time[i - 1] < 0) !== (time[i] < 0)) zc++;
      // Spectral centroid + total magnitude (linear, from dB bins).
      let magSum = 0, weighted = 0, peakMag = 0, peakBin = 0;
      const lin: number[] = new Array(freq.length);
      for (let i = 0; i < freq.length; i++) {
        const m = Math.pow(10, freq[i] / 20);
        lin[i] = m;
        magSum += m;
        weighted += m * i;
        if (m > peakMag) { peakMag = m; peakBin = i; }
      }
      // Spectral rolloff: bin holding 85% of cumulative energy.
      let cum = 0, rollBin = 0;
      const target = magSum * 0.85;
      for (let i = 0; i < lin.length; i++) { cum += lin[i]; if (cum >= target) { rollBin = i; break; } }
      acc.pitch += (peakBin / freq.length) * nyquist;
      acc.energy += rms;
      acc.centroid += magSum > 0 ? (weighted / magSum / freq.length) * nyquist : 0;
      acc.zcr += zc / time.length;
      acc.rolloff += (rollBin / freq.length) * nyquist;
      acc.n++;
      if (Date.now() - t0 < SAMPLE_MS) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });

  stream.getTracks().forEach(t => t.stop());
  await ctx.close();
  const n = Math.max(1, acc.n);
  // Normalise into comparable [0,1]-ish ranges for stable distances.
  return [
    Math.round((acc.pitch / n / 4000) * 1000) / 1000,
    Math.round(Math.min(1, (acc.energy / n) * 10) * 1000) / 1000,
    Math.round((acc.centroid / n / 4000) * 1000) / 1000,
    Math.round((acc.zcr / n) * 1000) / 1000,
    Math.round((acc.rolloff / n / 8000) * 1000) / 1000,
  ];
}

export function VoiceprintEnroll() {
  const [prints, setPrints] = useState<VoicePrint[]>([]);
  const [name, setName] = useState('');
  const [recording, setRecording] = useState<'idle' | 'enroll' | 'identify'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [identified, setIdentified] = useState<IdentifyResult | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const refresh = useCallback(async () => {
    const r = await lensRun('voice', 'voiceprint-list', {});
    if (r.data?.ok) setPrints((r.data.result?.voicePrints as VoicePrint[]) || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const enroll = useCallback(async () => {
    if (!name.trim()) return;
    setError(null);
    setRecording('enroll');
    try {
      const vector = await captureVector();
      const r = await lensRun('voice', 'voiceprint-enroll', { name: name.trim(), vector });
      if (r.data?.ok) { setName(''); await refresh(); }
      else setError(r.data?.error || 'Enroll failed');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Microphone unavailable');
    } finally {
      if (mountedRef.current) setRecording('idle');
    }
  }, [name, refresh]);

  const identify = useCallback(async () => {
    setError(null);
    setIdentified(null);
    setRecording('identify');
    try {
      const vector = await captureVector();
      const r = await lensRun('voice', 'voiceprint-identify', { vector });
      if (r.data?.ok) setIdentified(r.data.result as IdentifyResult);
      else setError(r.data?.error || 'Identify failed');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Microphone unavailable');
    } finally {
      if (mountedRef.current) setRecording('idle');
    }
  }, []);

  const del = useCallback(async (id: string) => {
    await lensRun('voice', 'voiceprint-delete', { id });
    await refresh();
  }, [refresh]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Speaker name to enroll"
          className="flex-1 min-w-[150px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100"
        />
        <button onClick={enroll} disabled={!name.trim() || recording !== 'idle'}
          className="px-3 py-1.5 text-xs font-semibold rounded bg-sky-600 hover:bg-sky-500 text-white inline-flex items-center gap-1 disabled:opacity-40">
          {recording === 'enroll' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mic className="w-3 h-3" />}
          {recording === 'enroll' ? 'Sampling 3s…' : 'Enroll voice'}
        </button>
        <button onClick={identify} disabled={recording !== 'idle' || prints.length === 0}
          className="px-3 py-1.5 text-xs font-semibold rounded bg-violet-600 hover:bg-violet-500 text-white inline-flex items-center gap-1 disabled:opacity-40">
          {recording === 'identify' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Fingerprint className="w-3 h-3" />}
          {recording === 'identify' ? 'Listening 3s…' : 'Identify speaker'}
        </button>
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      {identified && (
        <div className={`rounded-lg p-2.5 text-xs border ${identified.matched ? 'bg-emerald-950/30 border-emerald-900/50' : 'bg-zinc-900/40 border-zinc-800'}`}>
          {identified.matched ? (
            <p className="text-emerald-200 inline-flex items-center gap-1">
              <UserCheck className="w-3.5 h-3.5" />
              Identified <span className="font-bold">{identified.speaker}</span>
              <span className="text-emerald-400/70">· confidence {(identified.confidence * 100).toFixed(0)}%</span>
            </p>
          ) : (
            <p className="text-zinc-400">No confident match (closest distance {identified.bestDistance}). Enroll this speaker first.</p>
          )}
        </div>
      )}

      <div>
        <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Enrolled voice-prints</p>
        {prints.length === 0 ? (
          <p className="text-xs text-zinc-400 italic">No voice-prints yet. Enroll a speaker to enable auto speaker labels.</p>
        ) : (
          <ul className="space-y-1">
            {prints.map(p => (
              <li key={p.id} className="flex items-center gap-2 bg-zinc-900/40 rounded px-2 py-1.5 text-xs">
                <Fingerprint className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span className="flex-1 truncate text-zinc-200 font-medium">{p.name}</span>
                <span className="text-zinc-400">{p.sampleCount} sample{p.sampleCount !== 1 ? 's' : ''} · {p.dimensions}-d</span>
                <button onClick={() => del(p.id)} className="p-0.5 text-rose-400 hover:text-rose-300" aria-label={`Delete ${p.name}`}>
                  <Trash2 className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
