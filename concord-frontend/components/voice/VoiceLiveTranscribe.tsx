'use client';

/**
 * VoiceLiveTranscribe — Otter.ai's signature live-streaming transcription.
 * Uses the browser SpeechRecognition API to stream interim + final words,
 * pushes each chunk to voice.live-append, and finalizes into a recording.
 * Wires voice.live-start, voice.live-append, voice.live-detail,
 * voice.live-list, voice.live-finalize.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Radio, Square, Loader2, FileCheck2, Languages } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

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

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    if (!w.SpeechRecognition && !w.webkitSpeechRecognition) setSupported(false);
  }, []);

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
    setListening(false);
  }, []);

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
        void lensRun('voice', 'live-append', { sessionId: sid, text, isFinal: res.isFinal, atSec })
          .then(() => reloadSession(sid));
      }
    };
    rec.onerror = (ev: { error: string }) => {
      if (ev.error !== 'no-speech' && ev.error !== 'aborted') setError(`Speech error: ${ev.error}`);
    };
    rec.onend = () => { if (recRef.current) { try { rec.start(); } catch { /* restart race */ } } };
    recRef.current = rec;
    try { rec.start(); setListening(true); } catch { setError('Microphone unavailable'); }
  }, [lang, title, reloadSession]);

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
