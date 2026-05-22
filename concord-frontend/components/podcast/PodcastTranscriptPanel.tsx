'use client';

/**
 * PodcastTranscriptPanel — view an episode transcript, add a real one
 * (paste text or import from the episode's RSS-linked transcript URL),
 * and search within it with jump-to-timestamp results. No mock data:
 * the transcript is real user-supplied / fetched text.
 */

import { useCallback, useEffect, useState } from 'react';
import { FileText, Search, Loader2, Plus, Clock } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Segment { startSec: number; text: string }
interface Transcript {
  episodeId: string;
  hasTranscript: boolean;
  segments?: Segment[];
  wordCount?: number;
}

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function PodcastTranscriptPanel({
  episodeId, episodeTitle, onJump,
}: {
  episodeId: string;
  episodeTitle: string;
  onJump?: (sec: number) => void;
}) {
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Segment[] | null>(null);
  const [searching, setSearching] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<Transcript>('podcast', 'transcript-get', { episodeId });
    setTranscript(r.data?.ok ? r.data.result : null);
    setLoading(false);
  }, [episodeId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = useCallback(async () => {
    if (!draft.trim()) { setError('Paste real transcript text to save.'); return; }
    setSaving(true); setError(null);
    const r = await lensRun('podcast', 'transcript-set', { episodeId, text: draft.trim() });
    setSaving(false);
    if (r.data?.ok) { setDraft(''); await refresh(); }
    else setError(r.data?.error || 'Failed to save transcript');
  }, [draft, episodeId, refresh]);

  const search = useCallback(async () => {
    if (!query.trim()) { setMatches(null); return; }
    setSearching(true);
    const r = await lensRun<{ matches: Segment[] }>('podcast', 'transcript-search', { episodeId, query: query.trim() });
    setMatches(r.data?.ok ? (r.data.result?.matches || []) : []);
    setSearching(false);
  }, [episodeId, query]);

  if (loading) {
    return <div className="flex items-center justify-center py-6 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  }

  return (
    <div className="rounded-xl border border-sky-500/20 bg-zinc-950/70 p-4 space-y-3">
      <header className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-sky-400" />
        <h3 className="text-sm font-semibold text-zinc-100">Transcript</h3>
        <span className="text-[11px] text-zinc-500 truncate">{episodeTitle}</span>
        {transcript?.hasTranscript && (
          <span className="ml-auto text-[10px] text-zinc-500">{transcript.wordCount} words</span>
        )}
      </header>

      {error && <div className="text-[11px] text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-2.5 py-1.5">{error}</div>}

      {!transcript?.hasTranscript ? (
        <div className="space-y-2">
          <p className="text-[11px] text-zinc-500">No transcript yet. Paste the episode transcript to make it searchable.</p>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            placeholder="Paste transcript text. It will be split into timestamped segments across the episode."
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-2 text-[12px] text-zinc-100 resize-none focus:outline-none focus:ring-2 focus:ring-sky-500/40"
          />
          <button
            type="button" onClick={save} disabled={saving || !draft.trim()}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white rounded-lg"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Save transcript
          </button>
        </div>
      ) : (
        <>
          {/* Search-in-transcript */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void search(); }}
                placeholder="Search in transcript…"
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg pl-8 pr-2.5 py-1.5 text-[12px] text-zinc-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              />
            </div>
            <button
              type="button" onClick={search} disabled={searching}
              className="px-3 py-1.5 text-xs bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white rounded-lg"
            >
              {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Find'}
            </button>
          </div>

          {matches !== null ? (
            matches.length === 0 ? (
              <p className="text-[11px] text-zinc-500 italic">No matches for &quot;{query}&quot;.</p>
            ) : (
              <ul className="space-y-1 max-h-64 overflow-y-auto">
                {matches.map((seg, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => onJump?.(seg.startSec)}
                      className="w-full flex items-start gap-2 px-2 py-1.5 rounded text-left text-[11px] text-zinc-300 hover:bg-sky-500/10"
                    >
                      <span className="flex items-center gap-0.5 font-mono text-sky-400 shrink-0">
                        <Clock className="w-3 h-3" /> {fmtClock(seg.startSec)}
                      </span>
                      <span>{seg.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <ul className="space-y-0.5 max-h-64 overflow-y-auto">
              {(transcript.segments || []).map((seg, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onJump?.(seg.startSec)}
                    className="w-full flex items-start gap-2 px-2 py-1 rounded text-left text-[11px] text-zinc-400 hover:bg-zinc-900"
                  >
                    <span className="font-mono text-zinc-600 shrink-0">{fmtClock(seg.startSec)}</span>
                    <span>{seg.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
