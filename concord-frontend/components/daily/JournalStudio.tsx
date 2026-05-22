'use client';

/**
 * JournalStudio — the full Day One + Reflectly journaling surface.
 * A rich-entry composer (templates, photo/media attachments, mood, tags),
 * a tag-filterable timeline, on-this-day memories, search, a streak grid,
 * the habit builder, a passcode lock and a Markdown export.
 *
 * Wires: daily.templates-list, entry-create/list/detail/update/delete,
 * tags-list, entry-search, on-this-day, daily-dashboard, prompt-today,
 * mood-trend, entry-heatmap, export-archive, plus the habit-* / lock-* macros.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookHeart, Sparkles, Search, Trash2, Loader2, CalendarHeart, Flame,
  ImagePlus, X, FileText, Tag as TagIcon, Download, LayoutTemplate,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { EntryHeatmap } from './EntryHeatmap';
import { HabitBuilder } from './HabitBuilder';
import { JournalLock } from './JournalLock';

interface MediaItem { id?: string; kind: 'image' | 'audio' | 'video' | 'link'; url: string; caption: string }
interface Entry {
  id: string; title: string; body: string; mood: number | null;
  tags: string[]; date: string; media: MediaItem[]; template: string | null;
}
interface Template { id: string; name: string; icon: string; description: string; tags: string[]; body: string }
interface Dash { totalEntries: number; daysJournaled: number; currentStreak: number; entriesThisMonth: number; wroteToday: boolean }
interface TagCount { tag: string; count: number }

const MOODS = ['😞', '😕', '😐', '🙂', '😄'];
const MAX_IMG_BYTES = 2_000_000;

type Tab = 'write' | 'streaks' | 'habits' | 'settings';

export function JournalStudio() {
  const [unlocked, setUnlocked] = useState(true);
  const [tab, setTab] = useState<Tab>('write');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [onThisDay, setOnThisDay] = useState<Entry[]>([]);
  const [dash, setDash] = useState<Dash | null>(null);
  const [prompt, setPrompt] = useState('');
  const [moodAvg, setMoodAvg] = useState<number | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tagCounts, setTagCounts] = useState<TagCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const [draft, setDraft] = useState({ title: '', body: '', mood: 4, tags: '' });
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Entry[] | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    const [el, otd, d, p, mt, tpl, tags] = await Promise.all([
      lensRun<{ entries: Entry[] }>('daily', 'entry-list', tagFilter ? { tag: tagFilter } : {}),
      lensRun<{ entries: Entry[] }>('daily', 'on-this-day', {}),
      lensRun<Dash>('daily', 'daily-dashboard', {}),
      lensRun<{ prompt: string }>('daily', 'prompt-today', {}),
      lensRun<{ averageMood: number | null }>('daily', 'mood-trend', {}),
      lensRun<{ templates: Template[] }>('daily', 'templates-list', {}),
      lensRun<{ tags: TagCount[] }>('daily', 'tags-list', {}),
    ]);
    setEntries(el.data?.result?.entries || []);
    setOnThisDay(otd.data?.result?.entries || []);
    setDash(d.data?.result || null);
    setPrompt(p.data?.result?.prompt || '');
    setMoodAvg(mt.data?.result?.averageMood ?? null);
    setTemplates(tpl.data?.result?.templates || []);
    setTagCounts(tags.data?.result?.tags || []);
    setLoading(false);
  }, [tagFilter]);

  useEffect(() => { if (unlocked) void refresh(); }, [refresh, unlocked, refreshKey]);

  const bumpAll = useCallback(() => setRefreshKey((k) => k + 1), []);

  const applyTemplate = useCallback((tpl: Template) => {
    setActiveTemplate(tpl.id);
    setDraft((d) => ({
      ...d,
      body: tpl.body,
      tags: tpl.tags.join(', '),
    }));
  }, []);

  const onPickFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    Array.from(files).slice(0, 12 - media.length).forEach((file) => {
      if (file.size > MAX_IMG_BYTES) return;
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result || '');
        if (url) {
          const item: MediaItem = { kind: 'image', url, caption: file.name.slice(0, 60) };
          setMedia((m) => [...m, item].slice(0, 12));
        }
      };
      reader.readAsDataURL(file);
    });
  }, [media.length]);

  const addLink = useCallback(() => {
    const u = linkUrl.trim();
    if (!u) return;
    const item: MediaItem = { kind: 'link', url: u, caption: '' };
    setMedia((m) => [...m, item].slice(0, 12));
    setLinkUrl('');
  }, [linkUrl]);

  const saveEntry = useCallback(async () => {
    if (!draft.body.trim()) return;
    setSaving(true);
    const r = await lensRun('daily', 'entry-create', {
      title: draft.title.trim() || undefined,
      body: draft.body.trim(),
      mood: draft.mood,
      tags: draft.tags.split(',').map((t) => t.trim()).filter(Boolean),
      media: media.map((m) => ({ kind: m.kind, url: m.url, caption: m.caption })),
      template: activeTemplate || undefined,
    });
    setSaving(false);
    if (r.data?.ok) {
      setDraft({ title: '', body: '', mood: 4, tags: '' });
      setMedia([]);
      setActiveTemplate(null);
      bumpAll();
    }
  }, [draft, media, activeTemplate, bumpAll]);

  const del = useCallback(async (id: string) => {
    await lensRun('daily', 'entry-delete', { id });
    bumpAll();
  }, [bumpAll]);

  const runSearch = useCallback(async () => {
    if (!search.trim()) { setResults(null); return; }
    const r = await lensRun<{ entries: Entry[] }>('daily', 'entry-search', { query: search.trim() });
    setResults(r.data?.result?.entries || []);
  }, [search]);

  const exportArchive = useCallback(async () => {
    setExporting(true);
    const r = await lensRun<{ markdown: string; filename: string }>('daily', 'export-archive',
      tagFilter ? { tag: tagFilter } : {});
    setExporting(false);
    if (r.data?.ok && r.data.result?.markdown) {
      const blob = new Blob([r.data.result.markdown], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = r.data.result.filename || 'journal-archive.md';
      a.click();
      URL.revokeObjectURL(a.href);
    }
  }, [tagFilter]);

  const shown = results ?? entries;
  const tabs: { id: Tab; label: string }[] = useMemo(() => [
    { id: 'write', label: 'Write' },
    { id: 'streaks', label: 'Streaks' },
    { id: 'habits', label: 'Habits' },
    { id: 'settings', label: 'Lock' },
  ], []);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <BookHeart className="w-4 h-4 text-rose-400" />
        <h3 className="text-sm font-bold text-zinc-100">Journal studio</h3>
        <span className="text-[11px] text-zinc-500">Day One + Reflectly shape</span>
        {unlocked && (
          <div className="ml-auto flex gap-1">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={cn('px-2.5 py-1 text-[11px] rounded',
                  tab === t.id ? 'bg-rose-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200')}>
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Lock gate — when locked, this blocks every tab. */}
      {(!unlocked || tab === 'settings') && (
        <div className="mb-3">
          <JournalLock unlocked={unlocked} onUnlock={setUnlocked} />
        </div>
      )}

      {unlocked && loading && (
        <div className="flex items-center justify-center py-6 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>
      )}

      {unlocked && !loading && tab === 'streaks' && <EntryHeatmap refreshKey={refreshKey} />}
      {unlocked && !loading && tab === 'habits' && <HabitBuilder onChange={bumpAll} />}

      {unlocked && !loading && tab === 'write' && (
        <>
          {dash && (
            <div className="grid grid-cols-4 gap-2 mb-3">
              {([['Entries', dash.totalEntries], ['Days', dash.daysJournaled],
                 ['Streak', dash.currentStreak], ['This month', dash.entriesThisMonth]] as const).map(([l, v], i) => (
                <div key={l} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-center">
                  <p className="text-sm font-bold text-zinc-100 inline-flex items-center gap-1">
                    {i === 2 && v > 0 && <Flame className="w-3 h-3 text-orange-400" />}{v}
                  </p>
                  <p className="text-[9px] text-zinc-500 uppercase tracking-wide">{l}</p>
                </div>
              ))}
            </div>
          )}

          {/* Templates */}
          {templates.length > 0 && (
            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              <LayoutTemplate className="w-3.5 h-3.5 text-zinc-500" />
              {templates.map((tpl) => (
                <button key={tpl.id} onClick={() => applyTemplate(tpl)} title={tpl.description}
                  className={cn('px-2 py-0.5 text-[11px] rounded border',
                    activeTemplate === tpl.id
                      ? 'bg-rose-600 border-rose-500 text-white'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-rose-500')}>
                  {tpl.name}
                </button>
              ))}
              {activeTemplate && (
                <button onClick={() => { setActiveTemplate(null); setDraft((d) => ({ ...d, body: '', tags: '' })); }}
                  className="text-[11px] text-zinc-500 hover:text-zinc-300">clear</button>
              )}
            </div>
          )}

          {/* Composer */}
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 mb-3">
            {prompt && (
              <p className="text-[11px] text-rose-300/80 italic mb-2 inline-flex items-center gap-1">
                <Sparkles className="w-3 h-3" />{prompt}
              </p>
            )}
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Title (optional)" maxLength={160}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100 mb-2 focus:outline-none focus:ring-2 focus:ring-rose-500" />
            <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={4}
              placeholder="What happened today?"
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-rose-500" />

            {/* Media attachments */}
            {media.length > 0 && (
              <div className="flex gap-2 flex-wrap mt-2">
                {media.map((m, i) => (
                  <div key={i} className="relative group">
                    {m.kind === 'image' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.url} alt={m.caption || 'attachment'} className="w-16 h-16 object-cover rounded border border-zinc-700" />
                    ) : (
                      <div className="w-16 h-16 rounded border border-zinc-700 bg-zinc-950 flex items-center justify-center p-1">
                        <FileText className="w-5 h-5 text-zinc-500" />
                      </div>
                    )}
                    <button onClick={() => setMedia((arr) => arr.filter((_, j) => j !== i))}
                      aria-label="Remove attachment"
                      className="absolute -top-1.5 -right-1.5 bg-rose-600 text-white rounded-full p-0.5">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <div className="flex gap-0.5">
                {MOODS.map((m, i) => (
                  <button key={i} onClick={() => setDraft({ ...draft, mood: i + 1 })}
                    className={cn('text-lg rounded px-1', draft.mood === i + 1 ? 'bg-rose-600/30' : 'opacity-50 hover:opacity-100')}>{m}</button>
                ))}
              </div>
              <input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} placeholder="tags, comma separated"
                className="flex-1 min-w-[8rem] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
                onChange={(e) => { onPickFiles(e.target.files); e.target.value = ''; }} />
              <button onClick={() => fileRef.current?.click()} disabled={media.length >= 12}
                className="px-2 py-1.5 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 inline-flex items-center gap-1 disabled:opacity-40">
                <ImagePlus className="w-3.5 h-3.5" />Photo
              </button>
              <button onClick={saveEntry} disabled={!draft.body.trim() || saving}
                className="px-3 py-1.5 text-xs font-semibold rounded bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-40 inline-flex items-center gap-1">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}Save entry
              </button>
            </div>
            <div className="flex gap-1 mt-2">
              <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addLink(); }}
                placeholder="Attach a link (https://…)"
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
              <button onClick={addLink} disabled={!linkUrl.trim() || media.length >= 12}
                className="px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40">Add link</button>
            </div>
          </div>

          {/* On this day */}
          {onThisDay.length > 0 && (
            <div className="bg-amber-950/20 border border-amber-900/40 rounded-lg p-2 mb-3">
              <p className="text-[11px] font-semibold text-amber-300 mb-1 inline-flex items-center gap-1">
                <CalendarHeart className="w-3 h-3" />On this day
              </p>
              {onThisDay.map((e) => (
                <p key={e.id} className="text-xs text-amber-100/80"><span className="text-amber-500/70">{e.date}</span> — {e.body.slice(0, 100)}</p>
              ))}
            </div>
          )}

          {/* Tag filter chips */}
          {tagCounts.length > 0 && (
            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              <TagIcon className="w-3.5 h-3.5 text-zinc-500" />
              {tagCounts.slice(0, 16).map((t) => (
                <button key={t.tag} onClick={() => setTagFilter((cur) => (cur === t.tag ? null : t.tag))}
                  className={cn('px-1.5 py-0.5 text-[10px] rounded',
                    tagFilter === t.tag ? 'bg-rose-600 text-white' : 'bg-rose-900/40 text-rose-300 hover:bg-rose-800/50')}>
                  {t.tag} <span className="opacity-60">{t.count}</span>
                </button>
              ))}
              {tagFilter && <button onClick={() => setTagFilter(null)} className="text-[10px] text-zinc-500 hover:text-zinc-300">clear filter</button>}
            </div>
          )}

          {/* Search + export */}
          <div className="flex gap-1 mb-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(); }}
                placeholder="Search entries" className="w-full bg-zinc-950 border border-zinc-800 rounded pl-7 pr-2 py-1.5 text-xs text-zinc-200" />
            </div>
            {results && <button onClick={() => { setSearch(''); setResults(null); }} className="px-2 py-1 text-xs text-zinc-400">clear</button>}
            {moodAvg != null && <span className="text-[11px] text-zinc-500 self-center">avg mood {MOODS[Math.round(moodAvg) - 1] || '–'}</span>}
            <button onClick={exportArchive} disabled={exporting || entries.length === 0}
              className="px-2 py-1.5 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 inline-flex items-center gap-1 disabled:opacity-40">
              {exporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3.5 h-3.5" />}Export
            </button>
          </div>

          {/* Timeline */}
          <div className="space-y-2 max-h-[28rem] overflow-y-auto">
            {shown.length === 0 ? (
              <p className="text-xs text-zinc-500 italic text-center py-6">
                {results ? 'No matches.' : tagFilter ? `No entries tagged "${tagFilter}".` : 'No entries yet — write your first above.'}
              </p>
            ) : shown.map((e) => (
              <div key={e.id} className="group bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
                <div className="flex items-center gap-2 mb-1">
                  {e.mood != null && <span className="text-base">{MOODS[e.mood - 1]}</span>}
                  <span className="text-[11px] font-mono text-zinc-500">{e.date}</span>
                  {e.template && <span className="text-[9px] px-1 rounded bg-zinc-800 text-zinc-400">{e.template}</span>}
                  <div className="ml-auto flex items-center gap-1">
                    {(e.tags || []).map((t) => <span key={t} className="text-[9px] px-1 rounded bg-rose-900/40 text-rose-300">{t}</span>)}
                    <button onClick={() => del(e.id)} aria-label="Delete entry" className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
                  </div>
                </div>
                {e.title && <p className="text-sm font-semibold text-zinc-100">{e.title}</p>}
                <p className="text-sm text-zinc-200 whitespace-pre-wrap">{e.body}</p>
                {(e.media || []).length > 0 && (
                  <div className="flex gap-2 flex-wrap mt-2">
                    {e.media.map((m, i) => m.kind === 'image' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={m.url} alt={m.caption || 'attachment'} className="w-20 h-20 object-cover rounded border border-zinc-700" />
                    ) : (
                      <a key={i} href={m.url} target="_blank" rel="noreferrer"
                        className="text-[11px] text-sky-400 inline-flex items-center gap-1 underline">
                        <FileText className="w-3 h-3" />{m.caption || m.url.slice(0, 40)}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
