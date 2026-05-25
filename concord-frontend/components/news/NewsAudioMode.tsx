'use client';

/**
 * NewsAudioMode — read-aloud player. Picks an article, fetches a
 * sentence-segmented script via `news.article-audio`, and drives the
 * browser Web Speech API. No audio files; speech is synthesised client-side.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Headphones, Play, Pause, Square } from 'lucide-react';

import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface DirArticle {
  id: string;
  title: string;
  source: string;
}

interface AudioScript {
  articleId: string;
  title: string;
  source: string;
  segments: string[];
  wordCount: number;
  estimatedSeconds: number;
}

export function NewsAudioMode() {
  const [articles, setArticles] = useState<DirArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [script, setScript] = useState<AudioScript | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [segmentIdx, setSegmentIdx] = useState(-1);
  const [supported, setSupported] = useState(true);
  const utterRef = useRef<SpeechSynthesisUtterance[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) setSupported(false);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('news', 'article-list', {});
    if (r.data?.ok) setArticles((r.data.result?.articles as DirArticle[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const stop = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    utterRef.current = [];
    setPlaying(false);
    setPaused(false);
    setSegmentIdx(-1);
  }, []);

  useEffect(() => () => stop(), [stop]);

  const loadAndPlay = useCallback(async (id: string) => {
    stop();
    setActiveId(id);
    const r = await lensRun('news', 'article-audio', { id });
    if (!r.data?.ok) return;
    const s = r.data.result as AudioScript;
    setScript(s);
    if (!supported || s.segments.length === 0) return;
    const synth = window.speechSynthesis;
    const utterances = s.segments.map((seg, i) => {
      const u = new SpeechSynthesisUtterance(seg);
      u.rate = 1;
      u.onstart = () => setSegmentIdx(i);
      u.onend = () => {
        if (i === s.segments.length - 1) {
          setPlaying(false);
          setSegmentIdx(-1);
        }
      };
      return u;
    });
    utterRef.current = utterances;
    setPlaying(true);
    setPaused(false);
    for (const u of utterances) synth.speak(u);
  }, [stop, supported]);

  const togglePause = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    if (paused) { synth.resume(); setPaused(false); }
    else { synth.pause(); setPaused(true); }
  }, [paused]);

  const fmtDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-emerald-600/15 to-transparent">
        <Headphones className="w-5 h-5 text-emerald-400" />
        <h2 className="text-sm font-bold text-zinc-100">Audio Mode</h2>
        <span className="text-[11px] text-zinc-400">Listen to any article hands-free</span>
      </header>

      {!supported && (
        <p className="px-4 py-2 text-[11px] text-amber-300 bg-amber-500/10 border-b border-amber-500/20">
          Read-aloud needs the browser Speech Synthesis API — your browser does not support it.
        </p>
      )}

      {/* Active player */}
      {script && (
        <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/40">
          <p className="text-sm font-semibold text-zinc-100">{script.title}</p>
          <p className="text-[10px] text-zinc-400">
            {script.source} · {script.wordCount} words · ~{fmtDuration(script.estimatedSeconds)}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              disabled={!supported}
              onClick={() => (playing ? togglePause() : void loadAndPlay(script.articleId))}
              className="flex items-center gap-1 px-3 py-1.5 text-[11px] rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40"
            >
              {playing && !paused ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              {playing ? (paused ? 'Resume' : 'Pause') : 'Play'}
            </button>
            <button
              type="button"
              disabled={!playing}
              onClick={stop}
              className="flex items-center gap-1 px-3 py-1.5 text-[11px] rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40"
            >
              <Square className="w-3 h-3" /> Stop
            </button>
          </div>
          <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
            {script.segments.map((seg, i) => (
              <p
                key={i}
                className={cn(
                  'text-[11px] leading-snug px-2 py-0.5 rounded',
                  i === segmentIdx ? 'bg-emerald-500/15 text-emerald-200' : 'text-zinc-400',
                )}
              >
                {seg}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Article picker */}
      {loading ? (
        <div className="flex items-center justify-center py-10 text-zinc-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : articles.length === 0 ? (
        <div className="px-4 py-10 text-center text-zinc-400 text-sm italic">
          No data yet — add articles to the news directory to listen to them.
        </div>
      ) : (
        <ul className="divide-y divide-zinc-800 max-h-72 overflow-y-auto">
          {articles.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => void loadAndPlay(a.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-zinc-900/60 focus:outline-none focus:ring-2 focus:ring-emerald-500',
                  activeId === a.id && 'bg-emerald-500/5',
                )}
              >
                <Play className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-zinc-100 truncate">{a.title}</p>
                  <p className="text-[10px] text-zinc-400">{a.source}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
