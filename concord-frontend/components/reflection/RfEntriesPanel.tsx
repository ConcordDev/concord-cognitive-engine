'use client';

/**
 * RfEntriesPanel — named journals, an entry composer, the entry feed
 * and full-text search.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Search, Trash2, BookMarked, MapPin, CloudSun } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Journal { id: string; name: string; color: string; entryCount: number }
interface Entry {
  id: string; journalId: string | null; title: string | null; text: string;
  mood: string | null; tags: string[]; location: string | null; weather: string | null;
  photoCount: number; date: string; wordCount: number;
}

const MOODS = ['great', 'good', 'okay', 'low', 'rough'];
const WEATHER = ['', 'sunny', 'cloudy', 'rainy', 'snowy', 'stormy', 'clear', 'windy', 'foggy'];
const MOOD_COLOR: Record<string, string> = {
  great: 'text-emerald-400', good: 'text-lime-400', okay: 'text-amber-400',
  low: 'text-orange-400', rough: 'text-rose-400',
};

export function RfEntriesPanel({ onChange }: { onChange: () => void }) {
  const [journals, setJournals] = useState<Journal[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeJournal, setActiveJournal] = useState<string>('');
  const [newJournal, setNewJournal] = useState('');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [form, setForm] = useState({
    title: '', text: '', mood: '', tags: '', location: '', weather: '', photoCount: '',
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [j, e] = await Promise.all([
      lensRun('reflection', 'journal-list', {}),
      lensRun('reflection', 'entry-list', activeJournal ? { journalId: activeJournal } : {}),
    ]);
    setJournals(j.data?.result?.journals || []);
    setEntries(e.data?.result?.entries || []);
    setSearching(false);
    setLoading(false);
    onChange();
  }, [activeJournal, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addJournal = async () => {
    if (!newJournal.trim()) { setError('Journal name is required.'); return; }
    const r = await lensRun('reflection', 'journal-create', { name: newJournal.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setNewJournal('');
    setError(null);
    await refresh();
  };

  const delJournal = async (id: string) => {
    await lensRun('reflection', 'journal-delete', { id });
    if (activeJournal === id) setActiveJournal('');
    await refresh();
  };

  const addEntry = async () => {
    if (!form.text.trim()) { setError('Write something before saving.'); return; }
    const r = await lensRun('reflection', 'entry-create', {
      journalId: activeJournal || undefined,
      title: form.title.trim(),
      text: form.text.trim(),
      mood: form.mood || undefined,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      location: form.location.trim(),
      weather: form.weather || undefined,
      photoCount: Number(form.photoCount) || 0,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', text: '', mood: '', tags: '', location: '', weather: '', photoCount: '' });
    setError(null);
    await refresh();
  };

  const delEntry = async (id: string) => {
    await lensRun('reflection', 'entry-delete', { id });
    await refresh();
  };

  const runSearch = async () => {
    if (!query.trim()) { await refresh(); return; }
    setLoading(true);
    const r = await lensRun('reflection', 'entry-search', { query: query.trim() });
    setEntries(r.data?.result?.entries || []);
    setSearching(true);
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Journals */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <BookMarked className="w-3.5 h-3.5 text-indigo-400" /> Journals
        </h3>
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          <button type="button" onClick={() => setActiveJournal('')}
            className={cn('text-[11px] px-2.5 py-1 rounded-lg',
              activeJournal === '' ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')}>
            All entries
          </button>
          {journals.map((j) => (
            <span key={j.id} className={cn('flex items-center gap-1 text-[11px] pl-2.5 pr-1.5 py-1 rounded-lg',
              activeJournal === j.id ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-300')}>
              <button type="button" onClick={() => setActiveJournal(j.id)}>{j.name} ({j.entryCount})</button>
              <button aria-label="Delete" type="button" onClick={() => delJournal(j.id)} className="text-zinc-400 hover:text-rose-300">
                <Trash2 className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input placeholder="New journal name" value={newJournal} onChange={(e) => setNewJournal(e.target.value)}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addJournal}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Journal
          </button>
        </div>
      </section>

      {/* Composer */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <input placeholder="Title (optional)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <textarea placeholder="What's on your mind?" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })}
          rows={4} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 resize-y" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <select value={form.mood} onChange={(e) => setForm({ ...form, mood: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            <option value="">Mood…</option>
            {MOODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={form.weather} onChange={(e) => setForm({ ...form, weather: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {WEATHER.map((w) => <option key={w} value={w}>{w || 'Weather…'}</option>)}
          </select>
          <input placeholder="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Photos" inputMode="numeric" value={form.photoCount}
            onChange={(e) => setForm({ ...form, photoCount: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        </div>
        <div className="flex items-center gap-2">
          <input placeholder="Tags (comma-separated)" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addEntry}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Save entry
          </button>
        </div>
      </section>

      {/* Search + feed */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <div className="flex items-center gap-1.5 flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2">
            <Search className="w-3.5 h-3.5 text-zinc-400" />
            <input placeholder="Search entries" value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(); }}
              className="flex-1 bg-transparent py-1.5 text-xs text-zinc-100 focus:outline-none" />
          </div>
          <button type="button" onClick={runSearch}
            className="px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">Search</button>
          {searching && (
            <button type="button" onClick={() => { setQuery(''); void refresh(); }}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200">Clear</button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : entries.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic py-6 text-center">
            {searching ? 'No entries match your search.' : 'No entries yet. Write your first one above.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {entries.map((e) => (
              <li key={e.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] text-zinc-400">
                      {e.date}
                      {e.mood && <span className={cn('ml-2 uppercase', MOOD_COLOR[e.mood])}>{e.mood}</span>}
                    </p>
                    {e.title && <p className="text-sm font-semibold text-zinc-100 mt-0.5">{e.title}</p>}
                  </div>
                  <button aria-label="Delete" type="button" onClick={() => delEntry(e.id)} className="text-zinc-600 hover:text-rose-400 shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-xs text-zinc-300 mt-1 whitespace-pre-wrap line-clamp-4">{e.text}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[10px] text-zinc-400">
                  <span>{e.wordCount} words</span>
                  {e.location && <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{e.location}</span>}
                  {e.weather && <span className="flex items-center gap-0.5"><CloudSun className="w-3 h-3" />{e.weather}</span>}
                  {e.photoCount > 0 && <span>{e.photoCount} photo{e.photoCount > 1 ? 's' : ''}</span>}
                  {e.tags.map((t) => <span key={t} className="text-indigo-400">#{t}</span>)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
