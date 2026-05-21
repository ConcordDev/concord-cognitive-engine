'use client';

/**
 * WordTools — pronunciation, contextual usage, and etymology lookup
 * for a single word. All data is real: pronunciation audio + IPA,
 * usage sentences, and word-history origins come from the Free
 * Dictionary API via the linguistics.pronounce / word-context /
 * etymology macros. Nothing is fabricated; empty fields say so.
 */

import { useCallback, useRef, useState } from 'react';
import { Volume2, Quote, ScrollText, Loader2, Search } from 'lucide-react';

import { lensRun } from '@/lib/api/client';

interface Phonetic { ipa: string | null; audio: string | null }
interface PronounceResult { word: string; ipa: string | null; audio: string | null; phonetics: Phonetic[] }
interface ContextExample { sentence: string; partOfSpeech: string; sense: string }
interface ContextResult { word: string; examples: ContextExample[]; count: number }
interface EtymologyResult { word: string; origin: string | null; allOrigins: string[]; hasEtymology: boolean }

export function WordTools() {
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pron, setPron] = useState<PronounceResult | null>(null);
  const [context, setContext] = useState<ContextResult | null>(null);
  const [etym, setEtym] = useState<EtymologyResult | null>(null);
  const [queried, setQueried] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const lookup = useCallback(async () => {
    const w = word.trim();
    if (!w) return;
    setBusy(true);
    setErr(null);
    setPron(null);
    setContext(null);
    setEtym(null);
    setQueried(true);
    const [p, c, e] = await Promise.all([
      lensRun<PronounceResult>('linguistics', 'pronounce', { word: w }),
      lensRun<ContextResult>('linguistics', 'word-context', { word: w }),
      lensRun<EtymologyResult>('linguistics', 'etymology', { word: w }),
    ]);
    setBusy(false);
    if (p.data?.ok && p.data.result) setPron(p.data.result);
    if (c.data?.ok && c.data.result) setContext(c.data.result);
    if (e.data?.ok && e.data.result) setEtym(e.data.result);
    if (!p.data?.ok && !c.data?.ok && !e.data?.ok) {
      setErr(p.data?.error || `No data found for "${w}".`);
    }
  }, [word]);

  const playAudio = useCallback((url: string) => {
    if (!audioRef.current) audioRef.current = new Audio();
    audioRef.current.src = url;
    void audioRef.current.play().catch(() => { /* user-gesture / network — ignore */ });
  }, []);

  // Browser speech synthesis fallback when the dictionary has no audio clip.
  const speak = useCallback((w: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(w);
    u.lang = 'en-US';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }, []);

  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <ScrollText className="w-4 h-4 text-violet-400" />
        <h3 className="text-sm font-bold text-zinc-100">Word Tools</h3>
        <span className="text-[10px] text-zinc-500">pronunciation · usage · etymology</span>
      </div>

      <div className="flex gap-1.5 mb-3">
        <input
          value={word}
          onChange={(e) => setWord(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void lookup(); }}
          placeholder="Enter a word..."
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-200"
        />
        <button
          onClick={lookup}
          disabled={busy || !word.trim()}
          className="px-3 py-1.5 text-xs font-semibold rounded bg-violet-600 hover:bg-violet-500 text-white inline-flex items-center gap-1.5 disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
          Look up
        </button>
      </div>

      {err && <p className="text-xs text-rose-400 mb-2">{err}</p>}

      {/* Pronunciation */}
      {pron && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2.5 mb-2">
          <p className="text-[11px] text-zinc-400 mb-1 inline-flex items-center gap-1">
            <Volume2 className="w-3 h-3" />Pronunciation
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {pron.ipa
              ? <span className="text-sm font-mono text-cyan-300">{pron.ipa}</span>
              : <span className="text-xs text-zinc-500 italic">no IPA available</span>}
            {pron.audio ? (
              <button
                onClick={() => playAudio(pron.audio!)}
                className="px-2 py-0.5 text-[11px] rounded bg-violet-600 hover:bg-violet-500 text-white inline-flex items-center gap-1"
              >
                <Volume2 className="w-3 h-3" />Play audio
              </button>
            ) : canSpeak ? (
              <button
                onClick={() => speak(pron.word)}
                className="px-2 py-0.5 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 inline-flex items-center gap-1"
              >
                <Volume2 className="w-3 h-3" />Speak (TTS)
              </button>
            ) : null}
          </div>
          {pron.phonetics.filter((p) => p.audio && p.audio !== pron.audio).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {pron.phonetics
                .filter((p) => p.audio && p.audio !== pron.audio)
                .map((p, i) => (
                  <button
                    key={i}
                    onClick={() => playAudio(p.audio!)}
                    className="px-1.5 py-0.5 text-[10px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                  >
                    {p.ipa || `variant ${i + 1}`}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Usage in context */}
      {context && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2.5 mb-2">
          <p className="text-[11px] text-zinc-400 mb-1 inline-flex items-center gap-1">
            <Quote className="w-3 h-3" />In context ({context.count})
          </p>
          {context.examples.length === 0 ? (
            <p className="text-xs text-zinc-500 italic">No usage examples available for this word.</p>
          ) : (
            <ul className="space-y-1.5">
              {context.examples.map((ex, i) => (
                <li key={i} className="text-xs text-zinc-300 pl-2 border-l-2 border-violet-500/40">
                  <span className="italic">&ldquo;{ex.sentence}&rdquo;</span>
                  <span className="block text-[10px] text-zinc-500 mt-0.5">
                    {ex.partOfSpeech} · {ex.sense}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Etymology */}
      {etym && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2.5">
          <p className="text-[11px] text-zinc-400 mb-1 inline-flex items-center gap-1">
            <ScrollText className="w-3 h-3" />Etymology
          </p>
          {etym.hasEtymology ? (
            <div className="space-y-1">
              {etym.allOrigins.map((o, i) => (
                <p key={i} className="text-xs text-amber-200/90">{o}</p>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-500 italic">No recorded etymology for this word.</p>
          )}
        </div>
      )}

      {queried && !busy && !pron && !context && !etym && !err && (
        <p className="text-xs text-zinc-500 italic">No data yet.</p>
      )}
    </div>
  );
}
