'use client';

/**
 * DailyJournal — Day One 2026-shape journaling: a dated-entry composer
 * with mood + tags, a timeline, on-this-day memories, search and a
 * mood trend. Wires the daily.journal-*, daily.entry-*, daily.on-this-day,
 * daily.entry-search, daily.mood-trend, daily.daily-dashboard macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { BookHeart, Sparkles, Search, Trash2, Loader2, CalendarHeart, Flame } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Entry {
  id: string; title: string; body: string; mood: number | null;
  tags: string[]; date: string;
}
interface Dash { totalEntries: number; daysJournaled: number; currentStreak: number; entriesThisMonth: number; wroteToday: boolean }

const MOODS = ['😞', '😕', '😐', '🙂', '😄'];

export function DailyJournal() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [onThisDay, setOnThisDay] = useState<Entry[]>([]);
  const [dash, setDash] = useState<Dash | null>(null);
  const [prompt, setPrompt] = useState('');
  const [moodAvg, setMoodAvg] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ body: '', mood: 4, tags: '' });
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Entry[] | null>(null);

  const refresh = useCallback(async () => {
    const [el, otd, d, p, mt] = await Promise.all([
      lensRun('daily', 'entry-list', {}),
      lensRun('daily', 'on-this-day', {}),
      lensRun('daily', 'daily-dashboard', {}),
      lensRun('daily', 'prompt-today', {}),
      lensRun('daily', 'mood-trend', {}),
    ]);
    setEntries((el.data?.result?.entries as Entry[]) || []);
    setOnThisDay((otd.data?.result?.entries as Entry[]) || []);
    setDash((d.data?.result as Dash) || null);
    setPrompt(p.data?.result?.prompt || '');
    setMoodAvg((mt.data?.result?.averageMood as number) ?? null);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function saveEntry() {
    if (!draft.body.trim()) return;
    await lensRun('daily', 'entry-create', {
      body: draft.body.trim(), mood: draft.mood,
      tags: draft.tags.split(',').map(t => t.trim()).filter(Boolean),
    });
    setDraft({ body: '', mood: 4, tags: '' });
    await refresh();
  }
  async function del(id: string) {
    await lensRun('daily', 'entry-delete', { id });
    await refresh();
  }
  async function runSearch() {
    if (!search.trim()) { setResults(null); return; }
    const r = await lensRun('daily', 'entry-search', { query: search.trim() });
    setResults((r.data?.result?.entries as Entry[]) || []);
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  const shown = results ?? entries;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <BookHeart className="w-4 h-4 text-rose-400" />
        <h3 className="text-sm font-bold text-zinc-100">Journal</h3>
        <span className="text-[11px] text-zinc-400">Day One shape</span>
      </div>

      {dash && (
        <div className="grid grid-cols-4 gap-2 mb-3">
          {([['Entries', dash.totalEntries], ['Days', dash.daysJournaled],
             ['Streak', dash.currentStreak], ['This month', dash.entriesThisMonth]] as const).map(([l, v], i) => (
            <div key={l} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold text-zinc-100 inline-flex items-center gap-1">
                {i === 2 && v > 0 && <Flame className="w-3 h-3 text-orange-400" />}{v}
              </p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{l}</p>
            </div>
          ))}
        </div>
      )}

      {/* Composer */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 mb-3">
        {prompt && (
          <p className="text-[11px] text-rose-300/80 italic mb-2 inline-flex items-center gap-1">
            <Sparkles className="w-3 h-3" />{prompt}
          </p>
        )}
        <textarea value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} rows={3}
          placeholder="What happened today?"
          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-rose-500" />
        <div className="flex items-center gap-2 mt-2">
          <div className="flex gap-0.5">
            {MOODS.map((m, i) => (
              <button key={i} onClick={() => setDraft({ ...draft, mood: i + 1 })}
                className={cn('text-lg rounded px-1', draft.mood === i + 1 ? 'bg-rose-600/30' : 'opacity-50 hover:opacity-100')}>{m}</button>
            ))}
          </div>
          <input value={draft.tags} onChange={e => setDraft({ ...draft, tags: e.target.value })} placeholder="tags"
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
          <button onClick={saveEntry} disabled={!draft.body.trim()}
            className="px-3 py-1.5 text-xs font-semibold rounded bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-40">Save entry</button>
        </div>
      </div>

      {/* On this day */}
      {onThisDay.length > 0 && (
        <div className="bg-amber-950/20 border border-amber-900/40 rounded-lg p-2 mb-3">
          <p className="text-[11px] font-semibold text-amber-300 mb-1 inline-flex items-center gap-1">
            <CalendarHeart className="w-3 h-3" />On this day
          </p>
          {onThisDay.map(e => (
            <p key={e.id} className="text-xs text-amber-100/80"><span className="text-amber-500/70">{e.date}</span> — {e.body.slice(0, 100)}</p>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="flex gap-1 mb-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void runSearch(); }}
            placeholder="Search entries" className="w-full bg-zinc-950 border border-zinc-800 rounded pl-7 pr-2 py-1.5 text-xs text-zinc-200" />
        </div>
        {results && <button onClick={() => { setSearch(''); setResults(null); }} className="px-2 py-1 text-xs text-zinc-400">clear</button>}
        {moodAvg != null && <span className="text-[11px] text-zinc-400 self-center">avg mood {MOODS[Math.round(moodAvg) - 1] || '–'}</span>}
      </div>

      {/* Timeline */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="text-xs text-zinc-400 italic text-center py-6">{results ? 'No matches.' : 'No entries yet — write your first above.'}</p>
        ) : shown.map(e => (
          <div key={e.id} className="group bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
            <div className="flex items-center gap-2 mb-1">
              {e.mood != null && <span className="text-base">{MOODS[e.mood - 1]}</span>}
              <span className="text-[11px] font-mono text-zinc-400">{e.date}</span>
              <div className="ml-auto flex items-center gap-1">
                {e.tags.map(t => <span key={t} className="text-[9px] px-1 rounded bg-rose-900/40 text-rose-300">{t}</span>)}
                <button aria-label="Delete" onClick={() => del(e.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>
            <p className="text-sm text-zinc-200 whitespace-pre-wrap">{e.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
