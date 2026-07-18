'use client';

/**
 * VoiceLiveTranscribe — Otter.ai's signature live-streaming transcription.
 * Uses the browser SpeechRecognition API to stream interim + final words,
 * pushes each chunk to voice.live-append, and finalizes into a recording.
 * Wires voice.live-start, voice.live-append, voice.live-detail,
 * voice.live-list, voice.live-finalize.
 *
 * Alongside SpeechRecognition (which manages its own internal audio path
 * with no raw-signal access), this opens a SEPARATE, parallel mic tap via
 * getUserMedia + AnalyserNode purely to compute a real per-final-segment
 * acoustic feature vector — the same 5-dim extraction VoiceprintEnroll.tsx
 * uses (lib/voice/audio-features.ts), continuously accumulated while
 * listening and folded into a vector each time a final SpeechRecognition
 * result lands, then reset for the next segment. That vector rides along
 * on voice.live-append so a finalized recording's segments carry a real
 * `.vector`, which is what makes voice.recording-auto-label-speakers
 * reachable on live/meeting transcripts.
 *
 * Honest fallback: if the browser has no mic/Web-Audio API, or the tap's
 * getUserMedia call is denied/fails (including when SpeechRecognition has
 * already claimed exclusive mic access on some browsers), the tap simply
 * never starts — live transcription still works via SpeechRecognition
 * alone, segments are appended with no `.vector`, and nothing is fabricated.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Radio, Square, Loader2, FileCheck2, Languages } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { accumulateFrame, emptyAccumulator, finalizeVector, type FrameAccumulator } from '@/lib/voice/audio-features';

interface LiveWord { id: string; text: string; isFinal: boolean; speaker: string; atSec: number }
interface LiveSession { id: string; title: string; language: string; status: string; words: LiveWord[] }
interface SessionMeta { id: string; title: string; language: string; status: string; wordCount: number; recordingId: string | null }

const LANGS = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'es-ES', label: 'Spanish' },
  { code: 'fr-FR', label: 'French' },
  { code: 'de-DE', label: 'German' },
  { code: 'ja-JP', label: 'Japanese' },
  { code: 'pt-BR', label: 'Portuguese' },
];

// Minimal typing for the non-standard SpeechRecognition API.
interface SRResultItem { transcript: string }
interface SRResult { isFinal: boolean; 0: SRResultItem; length: number }
interface SREvent { resultIndex: number; results: { length: number; [i: number]: SRResult } }
interface SpeechRecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

export function VoiceLiveTranscribe({ onFinalized }: { onFinalized?: () => void }) {
  const [supported, setSupported] = useState(true);
  const [lang, setLang] = useState('en-US');
  const [title, setTitle] = useState('');
  const [session, setSession] = useState<LiveSession | null>(null);
  const [recent, setRecent] = useState<SessionMeta[]>([]);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const startTsRef = useRef<number>(0);
  const sessionIdRef = useRef<string | null>(null);

  // Parallel raw-audio tap for per-segment acoustic vectors (see file header).
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioRafRef = useRef<number | null>(null);
  const nyquistRef = useRef<number>(0);
  const accRef = useRef<FrameAccumulator>(emptyAccumulator());
  const [vectorTapAvailable, setVectorTapAvailable] = useState(true);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    if (!w.SpeechRecognition && !w.webkitSpeechRecognition) setSupported(false);
  }, []);

  /** Best-effort start of the parallel raw-audio tap. Never throws; a failure
   *  just means no per-segment vector will be attached (honest no-op). */
  const startVectorTap = useCallback(async () => {
    try {
      const AudioCtx = window.AudioContext
        || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!navigator.mediaDevices?.getUserMedia || !AudioCtx) { setVectorTapAvailable(false); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      analyserRef.current = analyser;
      // Kept as closure-local consts (not refs) — a typed array read back out
      // of a `useRef<Float32Array | null>` widens to `Float32Array<ArrayBufferLike>`
      // under the current TS/dom lib, which `getFloat*Data` rejects. A local
      // const retains the concrete `Float32Array<ArrayBuffer>` type inferred
      // by `new Float32Array(n)`. Same pattern as KaraokeMicrophone.tsx's `buf`.
      const freq = new Float32Array(analyser.frequencyBinCount);
      const time = new Float32Array(analyser.fftSize);
      nyquistRef.current = ctx.sampleRate / 2;
      accRef.current = emptyAccumulator();
      setVectorTapAvailable(true);
      const loop = () => {
        const an = analyserRef.current;
        if (an) {
          an.getFloatFrequencyData(freq);
          an.getFloatTimeDomainData(time);
          accumulateFrame(accRef.current, freq, time, nyquistRef.current);
        }
        audioRafRef.current = requestAnimationFrame(loop);
      };
      audioRafRef.current = requestAnimationFrame(loop);
    } catch {
      // Denied / unavailable / mic already claimed exclusively elsewhere —
      // honest no-op, live transcription proceeds without per-segment vectors.
      setVectorTapAvailable(false);
    }
  }, []);

  const stopVectorTap = useCallback(() => {
    if (audioRafRef.current != null) { cancelAnimationFrame(audioRafRef.current); audioRafRef.current = null; }
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
    analyserRef.current = null;
    if (audioCtxRef.current) { void audioCtxRef.current.close(); audioCtxRef.current = null; }
  }, []);

  /** Snapshot + reset the accumulator into a finalized vector, or undefined
   *  if the tap never produced any frames for this segment (honest no-op). */
  const takeSegmentVector = useCallback((): number[] | undefined => {
    if (accRef.current.n === 0) return undefined;
    const vector = finalizeVector(accRef.current);
    accRef.current = emptyAccumulator();
    return vector;
  }, []);

  useEffect(() => () => stopVectorTap(), [stopVectorTap]);

  const refreshSessions = useCallback(async () => {
    const r = await lensRun('voice', 'live-list', {});
    if (r.data?.ok) setRecent(((r.data.result?.sessions as SessionMeta[]) || []).slice(0, 6));
  }, []);
  useEffect(() => { void refreshSessions(); }, [refreshSessions]);

  const reloadSession = useCallback(async (id: string) => {
    const r = await lensRun('voice', 'live-detail', { sessionId: id });
    if (r.data?.ok) setSession(r.data.result?.session as LiveSession);
  }, []);

  const stop = useCallback(() => {
    recRef.current?.stop();
    recRef.current = null;
    stopVectorTap();
    setListening(false);
  }, [stopVectorTap]);

  const start = useCallback(async () => {
    setError(null);
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) { setSupported(false); return; }
    setBusy(true);
    const startRes = await lensRun('voice', 'live-start', { title: title.trim() || undefined, language: lang });
    setBusy(false);
    if (!startRes.data?.ok) { setError('Could not start session'); return; }
    const sess = startRes.data.result?.session as LiveSession;
    sessionIdRef.current = sess.id;
    setSession(sess);
    startTsRef.current = Date.now();
    void startVectorTap();

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: SREvent) => {
      const atSec = Math.round((Date.now() - startTsRef.current) / 1000);
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res[0]?.transcript?.trim();
        if (!text) continue;
        const sid = sessionIdRef.current;
        if (!sid) continue;
        // A final result closes out whatever the tap has accumulated since
        // the last final; interim results never consume/reset the tap.
        const vector = res.isFinal ? takeSegmentVector() : undefined;
        void lensRun('voice', 'live-append', { sessionId: sid, text, isFinal: res.isFinal, atSec, ...(vector ? { vector } : {}) })
          .then(() => reloadSession(sid));
      }
    };
    rec.onerror = (ev: { error: string }) => {
      if (ev.error !== 'no-speech' && ev.error !== 'aborted') setError(`Speech error: ${ev.error}`);
    };
    rec.onend = () => { if (recRef.current) { try { rec.start(); } catch { /* restart race */ } } };
    recRef.current = rec;
    try { rec.start(); setListening(true); } catch { setError('Microphone unavailable'); }
  }, [lang, title, reloadSession, startVectorTap, takeSegmentVector]);

  useEffect(() => () => { recRef.current?.stop(); recRef.current = null; }, []);

  const finalize = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    stop();
    setBusy(true);
    const r = await lensRun('voice', 'live-finalize', { sessionId: sid });
    setBusy(false);
    if (r.data?.ok) {
      setSession(null);
      sessionIdRef.current = null;
      setTitle('');
      await refreshSessions();
      onFinalized?.();
    } else {
      setError(r.data?.error || 'Finalize failed');
    }
  }, [stop, refreshSessions, onFinalized]);

  if (!supported) {
    return (
      <div className="bg-zinc-900/40 border border-dashed border-zinc-800 rounded-lg p-4 text-xs text-zinc-400">
        Live transcription needs the browser SpeechRecognition API (Chrome / Edge). Your browser does not support it.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          disabled={listening}
          placeholder="Live session title (optional)"
          className="flex-1 min-w-[160px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100 disabled:opacity-50"
        />
        <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400"><Languages className="w-3 h-3" /></span>
        <select
          value={lang}
          onChange={e => setLang(e.target.value)}
          disabled={listening}
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200 disabled:opacity-50"
        >
          {LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        {!listening ? (
          <button onClick={start} disabled={busy}
            className="px-3 py-1.5 text-xs font-semibold rounded bg-rose-600 hover:bg-rose-500 text-white inline-flex items-center gap-1 disabled:opacity-40">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Radio className="w-3 h-3" />}Go live
          </button>
        ) : (
          <button onClick={stop}
            className="px-3 py-1.5 text-xs font-semibold rounded bg-zinc-700 hover:bg-zinc-600 text-white inline-flex items-center gap-1">
            <Square className="w-3 h-3" />Pause
          </button>
        )}
        {session && (
          <button onClick={finalize} disabled={busy}
            className="px-3 py-1.5 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center gap-1 disabled:opacity-40">
            <FileCheck2 className="w-3 h-3" />Save recording
          </button>
        )}
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      {session ? (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 min-h-[110px]">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1.5 inline-flex items-center gap-1">
            {listening && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />}
            {session.title} · {session.language}
            {listening && !vectorTapAvailable && (
              <span className="ml-1.5 text-amber-500/80 normal-case tracking-normal">
                · no mic tap (speaker vectors unavailable this session)
              </span>
            )}
          </p>
          <p className="text-sm text-zinc-200 leading-relaxed">
            {session.words.length === 0 && <span className="text-zinc-600 italic">no data yet — start speaking</span>}
            {session.words.map(w => (
              <span key={w.id} className={cn(w.isFinal ? 'text-zinc-100' : 'text-zinc-400 italic')}>{w.text} </span>
            ))}
          </p>
        </div>
      ) : (
        <div className="bg-zinc-900/20 border border-dashed border-zinc-800 rounded-lg p-4 text-xs text-zinc-400">
          No live session running. Press &ldquo;Go live&rdquo; to stream words as you speak.
        </div>
      )}

      {recent.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Recent live sessions</p>
          <ul className="space-y-1">
            {recent.map(s => (
              <li key={s.id} className="flex items-center gap-2 bg-zinc-900/40 rounded px-2 py-1 text-xs">
                <span className="flex-1 truncate text-zinc-300">{s.title}</span>
                <span className="text-zinc-400">{s.wordCount} words</span>
                <span className={cn('px-1.5 rounded text-[10px]', s.status === 'finalized' ? 'bg-emerald-900/40 text-emerald-300' : 'bg-rose-900/40 text-rose-300')}>
                  {s.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
