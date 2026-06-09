'use client';

/**
 * PodcastBrowsePanel — show directory: add shows, subscribe, drill into
 * episodes, rate and review.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Star, Check, ListPlus, Download, ChevronLeft } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Show {
  id: string; title: string; author: string | null; category: string;
  description: string | null; episodeCount: number; subscribed: boolean;
  rating: number; reviewCount: number;
}
interface Episode {
  id: string; title: string; durationSec: number; publishDate: string;
  played: boolean; progressPct: number; inQueue: boolean; downloaded: boolean;
}
interface Review { id: string; userId: string; rating: number; text: string }

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn('w-3 h-3', n <= Math.round(rating) ? 'text-amber-400 fill-amber-400' : 'text-zinc-700')} />
      ))}
    </span>
  );
}
function fmt(sec: number): string { const m = Math.floor(sec / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; }

export function PodcastBrowsePanel({ onChange }: { onChange: () => void }) {
  const [shows, setShows] = useState<Show[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: '', author: '', category: 'general', description: '' });
  const [selected, setSelected] = useState<Show | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [epForm, setEpForm] = useState({ title: '', durationMin: '', publishDate: '' });
  const [myRating, setMyRating] = useState(5);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('podcast', 'show-list', {});
    setShows(r.data?.result?.shows || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const openShow = async (sh: Show) => {
    setSelected(sh);
    const [e, d] = await Promise.all([
      lensRun('podcast', 'episode-list', { showId: sh.id }),
      lensRun('podcast', 'show-detail', { id: sh.id }),
    ]);
    setEpisodes(e.data?.result?.episodes || []);
    setReviews(d.data?.result?.reviews || []);
    setSelected((d.data?.result?.show as Show) || sh);
  };

  const addShow = async () => {
    if (!form.title.trim()) { setError('Show title is required.'); return; }
    const r = await lensRun('podcast', 'show-add', {
      title: form.title.trim(), author: form.author.trim(),
      category: form.category, description: form.description.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', author: '', category: 'general', description: '' });
    setShowAdd(false); setError(null);
    await refresh();
  };
  const subscribe = async (sh: Show) => {
    await lensRun('podcast', 'show-subscribe', { id: sh.id });
    await refresh();
    if (selected?.id === sh.id) await openShow(sh);
    onChange();
  };
  const addEpisode = async () => {
    if (!selected || !epForm.title.trim()) { setError('Episode title is required.'); return; }
    const r = await lensRun('podcast', 'episode-add', {
      showId: selected.id, title: epForm.title.trim(),
      durationSec: Math.round((Number(epForm.durationMin) || 0) * 60),
      publishDate: epForm.publishDate,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setEpForm({ title: '', durationMin: '', publishDate: '' });
    setError(null);
    await openShow(selected);
  };
  const queueEp = async (epId: string) => { await lensRun('podcast', 'queue-add', { episodeId: epId }); if (selected) await openShow(selected); onChange(); };
  const downloadEp = async (epId: string) => { await lensRun('podcast', 'download-episode', { episodeId: epId }); if (selected) await openShow(selected); onChange(); };
  const rate = async () => {
    if (!selected) return;
    await lensRun('podcast', 'show-rate', { showId: selected.id, rating: myRating });
    await openShow(selected);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  // ── Show detail ──
  if (selected) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => setSelected(null)}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
          <ChevronLeft className="w-3.5 h-3.5" /> All shows
        </button>
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
          <h3 className="text-base font-bold text-zinc-100">{selected.title}</h3>
          <p className="text-xs text-zinc-400">{selected.author} · {selected.category}</p>
          {selected.description && <p className="text-[11px] text-zinc-400 mt-1">{selected.description}</p>}
          <div className="flex items-center gap-2 mt-2">
            <Stars rating={selected.rating} />
            <span className="text-[11px] text-zinc-400">{selected.rating || 'unrated'} · {selected.reviewCount} reviews</span>
            <button type="button" onClick={() => subscribe(selected)}
              className={cn('ml-auto text-[11px] px-2.5 py-1 rounded-lg border',
                selected.subscribed ? 'border-zinc-700 text-zinc-400' : 'border-violet-700/50 bg-violet-950/40 text-violet-300')}>
              {selected.subscribed ? 'Subscribed' : 'Subscribe'}
            </button>
          </div>
        </div>

        {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

        {/* Add episode */}
        <div className="grid grid-cols-4 gap-2">
          <input placeholder="Episode title" value={epForm.title} onChange={(e) => setEpForm({ ...epForm, title: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Mins" inputMode="numeric" value={epForm.durationMin} onChange={(e) => setEpForm({ ...epForm, durationMin: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addEpisode}
            className="flex items-center justify-center gap-1 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>

        {/* Episodes */}
        {episodes.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No episodes yet.</p>
        ) : (
          <ul className="space-y-1">
            {episodes.map((e) => (
              <li key={e.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs text-zinc-200 truncate">{e.title}</p>
                  <p className="text-[10px] text-zinc-400">{fmt(e.durationSec)} · {e.publishDate}{e.played ? ' · played' : ''}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button aria-label="Add to queue" type="button" onClick={() => queueEp(e.id)}
                    className={cn('p-1 rounded', e.inQueue ? 'text-violet-400' : 'text-zinc-600 hover:text-violet-400')}>
                    <ListPlus className="w-3.5 h-3.5" />
                  </button>
                  <button aria-label="Download" type="button" onClick={() => downloadEp(e.id)}
                    className={cn('p-1 rounded', e.downloaded ? 'text-emerald-400' : 'text-zinc-600 hover:text-emerald-400')}>
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Rate */}
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <p className="text-xs font-semibold text-zinc-300 mb-1">Rate this show</p>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button aria-label="Favorite" key={n} type="button" onClick={() => setMyRating(n)}>
                <Star className={cn('w-5 h-5', n <= myRating ? 'text-amber-400 fill-amber-400' : 'text-zinc-700')} />
              </button>
            ))}
            <button type="button" onClick={rate}
              className="ml-2 px-2.5 py-1 text-[11px] bg-violet-600 hover:bg-violet-500 text-white rounded-lg">Submit</button>
          </div>
          {reviews.length > 0 && (
            <ul className="mt-2 space-y-1">
              {reviews.map((rv) => (
                <li key={rv.id} className="flex items-center gap-2 text-[11px]">
                  <Stars rating={rv.rating} />
                  {rv.text && <span className="text-zinc-400 truncate">{rv.text}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // ── Directory ──
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-400"><span className="text-zinc-100 font-semibold">{shows.length}</span> shows</span>
        <button type="button" onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Add show
        </button>
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {showAdd && (
        <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <input placeholder="Show title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Author / network" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {['general', 'news', 'comedy', 'true crime', 'technology', 'business', 'health', 'sports', 'history'].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addShow}
            className="col-span-2 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Add to directory</button>
        </div>
      )}

      {shows.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No shows yet. Add a podcast to the directory.
        </div>
      ) : (
        <ul className="space-y-2">
          {shows.map((sh) => (
            <li key={sh.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <button type="button" onClick={() => openShow(sh)} className="text-left min-w-0">
                <p className="text-sm font-semibold text-zinc-100 truncate">{sh.title}</p>
                <p className="text-[11px] text-zinc-400 truncate">
                  {sh.author} · {sh.category} · {sh.episodeCount} episodes
                </p>
              </button>
              <button type="button" onClick={() => subscribe(sh)}
                className={cn('text-[11px] px-2.5 py-1 rounded-lg border shrink-0',
                  sh.subscribed ? 'border-emerald-700/50 bg-emerald-950/40 text-emerald-300' : 'border-zinc-700 text-zinc-400')}>
                {sh.subscribed ? <Check className="w-3.5 h-3.5" /> : 'Subscribe'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
