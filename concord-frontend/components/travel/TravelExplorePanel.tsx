'use client';

/**
 * TravelExplorePanel — TripAdvisor-shape place directory: add hotels,
 * attractions and restaurants, rate them and save to a wishlist.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Star, Bookmark, ChevronLeft } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Place {
  id: string; name: string; kind: string; destination: string | null;
  priceLevel: number; rating: number; reviewCount: number; saved: boolean;
}
interface Review { id: string; userId: string; rating: number; text: string }

const KINDS = ['hotel', 'attraction', 'restaurant', 'beach', 'museum', 'tour'];
function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn('w-3 h-3', n <= Math.round(rating) ? 'text-amber-400 fill-amber-400' : 'text-zinc-700')} />
      ))}
    </span>
  );
}

export function TravelExplorePanel() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', kind: 'hotel', destination: '', priceLevel: '2' });
  const [selected, setSelected] = useState<Place | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [myRating, setMyRating] = useState(5);
  const [reviewText, setReviewText] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('travel', 'place-list', kindFilter ? { kind: kindFilter } : {});
    setPlaces(r.data?.result?.places || []);
    setLoading(false);
  }, [kindFilter]);

  useEffect(() => { void refresh(); }, [refresh]);

  const open = async (p: Place) => {
    setSelected(p);
    const r = await lensRun('travel', 'place-detail', { id: p.id });
    if (r.data?.ok !== false) {
      setSelected((r.data?.result?.place as Place) || p);
      setReviews(r.data?.result?.reviews || []);
    }
  };
  const addPlace = async () => {
    if (!form.name.trim()) { setError('Place name is required.'); return; }
    const r = await lensRun('travel', 'place-add', {
      name: form.name.trim(), kind: form.kind, destination: form.destination.trim(),
      priceLevel: Number(form.priceLevel) || 0,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', kind: 'hotel', destination: '', priceLevel: '2' });
    setShowAdd(false); setError(null);
    await refresh();
  };
  const save = async (p: Place) => {
    await lensRun('travel', 'place-save', { id: p.id, unsave: p.saved });
    await refresh();
    if (selected?.id === p.id) await open(p);
  };
  const submitReview = async () => {
    if (!selected) return;
    await lensRun('travel', 'place-review', { placeId: selected.id, rating: myRating, text: reviewText.trim() });
    setReviewText('');
    await open(selected);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (selected) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => setSelected(null)}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
          <ChevronLeft className="w-3.5 h-3.5" /> All places
        </button>
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-base font-bold text-zinc-100">{selected.name}</h3>
              <p className="text-xs text-zinc-400 capitalize">
                {selected.kind}{selected.destination ? ` · ${selected.destination}` : ''}
                {selected.priceLevel > 0 ? ` · ${'$'.repeat(selected.priceLevel)}` : ''}
              </p>
            </div>
            <button aria-label="Save" type="button" onClick={() => save(selected)}
              className={cn('p-1.5 rounded-lg', selected.saved ? 'text-sky-400' : 'text-zinc-600 hover:text-sky-400')}>
              <Bookmark className={cn('w-4 h-4', selected.saved && 'fill-sky-400')} />
            </button>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Stars rating={selected.rating} />
            <span className="text-[11px] text-zinc-400">{selected.rating || 'unrated'} · {selected.reviewCount} reviews</span>
          </div>
        </div>

        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <p className="text-xs font-semibold text-zinc-300 mb-1">Write a review</p>
          <div className="flex items-center gap-1 mb-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button aria-label="Favorite" key={n} type="button" onClick={() => setMyRating(n)}>
                <Star className={cn('w-5 h-5', n <= myRating ? 'text-amber-400 fill-amber-400' : 'text-zinc-700')} />
              </button>
            ))}
          </div>
          <textarea value={reviewText} onChange={(e) => setReviewText(e.target.value)} rows={2}
            placeholder="Share your experience…"
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={submitReview}
            className="mt-1.5 px-3 py-1 text-xs bg-sky-600 hover:bg-sky-500 text-white rounded-lg">Post review</button>
        </div>

        {reviews.length > 0 && (
          <ul className="space-y-1">
            {reviews.map((rv) => (
              <li key={rv.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <Stars rating={rv.rating} />
                {rv.text && <p className="text-xs text-zinc-300 mt-0.5">{rv.text}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          <button type="button" onClick={() => setKindFilter('')}
            className={cn('text-[11px] px-2 py-0.5 rounded-full border', kindFilter === '' ? 'border-sky-700/50 bg-sky-950/40 text-sky-300' : 'border-zinc-700 text-zinc-400')}>
            All
          </button>
          {KINDS.map((k) => (
            <button key={k} type="button" onClick={() => setKindFilter(k)}
              className={cn('text-[11px] px-2 py-0.5 rounded-full border capitalize', kindFilter === k ? 'border-sky-700/50 bg-sky-950/40 text-sky-300' : 'border-zinc-700 text-zinc-400')}>
              {k}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded-lg shrink-0">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {showAdd && (
        <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <input placeholder="Place name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input placeholder="Destination" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.priceLevel} onChange={(e) => setForm({ ...form, priceLevel: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n === 0 ? 'No price' : '$'.repeat(n)}</option>)}
          </select>
          <button type="button" onClick={addPlace}
            className="col-span-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Add place</button>
        </div>
      )}

      {places.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No places yet. Add hotels, attractions and restaurants to explore.
        </div>
      ) : (
        <ul className="space-y-2">
          {places.map((p) => (
            <li key={p.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <button type="button" onClick={() => open(p)} className="text-left">
                <p className="text-sm font-semibold text-zinc-100">{p.name}</p>
                <p className="text-[11px] text-zinc-400 capitalize">
                  {p.kind}{p.destination ? ` · ${p.destination}` : ''}
                  {p.priceLevel > 0 ? ` · ${'$'.repeat(p.priceLevel)}` : ''}
                </p>
                <div className="flex items-center gap-1 mt-0.5">
                  <Stars rating={p.rating} />
                  <span className="text-[10px] text-zinc-400">{p.reviewCount} reviews</span>
                </div>
              </button>
              <button aria-label="Save" type="button" onClick={() => save(p)}
                className={cn('p-1.5 rounded-lg', p.saved ? 'text-sky-400' : 'text-zinc-600 hover:text-sky-400')}>
                <Bookmark className={cn('w-4 h-4', p.saved && 'fill-sky-400')} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
