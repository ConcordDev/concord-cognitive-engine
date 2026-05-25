'use client';

/**
 * YelpDiscoverPanel — search/filter the restaurant directory, open a
 * business detail with reviews/photos/tips and check-in / reserve /
 * waitlist actions. Adds new businesses to the shared directory.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Search, Plus, Star, Clock, Camera, MessageSquare,
  CheckCircle2, CalendarPlus, Users,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Business {
  id: string;
  name: string;
  cuisine: string;
  priceTier: number;
  neighborhood: string | null;
  rating: number;
  reviewCount: number;
  photoCount: number;
  tipCount: number;
  checkinCount: number;
  openNow: boolean | null;
}
interface Review { id: string; userId: string; rating: number; text: string }
interface Photo { id: string; caption: string }
interface Tip { id: string; text: string; userId: string }

function Stars({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'lg' }) {
  const cls = size === 'lg' ? 'w-4 h-4' : 'w-3 h-3';
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn(cls, n <= Math.round(rating) ? 'text-amber-400 fill-amber-400' : 'text-zinc-700')} />
      ))}
    </span>
  );
}
const priceLabel = (t: number) => '$'.repeat(Math.max(1, Math.min(4, t)));

export function YelpDiscoverPanel() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [facets, setFacets] = useState<{ cuisine: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [cuisine, setCuisine] = useState('');
  const [openNow, setOpenNow] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', cuisine: '', priceTier: '2', neighborhood: '', open: '', close: '' });

  // detail state
  const [selected, setSelected] = useState<Business | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [tips, setTips] = useState<Tip[]>([]);
  const [reviewDraft, setReviewDraft] = useState({ rating: 5, text: '' });
  const [tipDraft, setTipDraft] = useState('');

  const search = useCallback(async () => {
    setLoading(true);
    const [r, f] = await Promise.all([
      lensRun('food', 'biz-search', { query: query.trim(), cuisine, openNow }),
      lensRun('food', 'cuisine-facets', {}),
    ]);
    if (r.data?.ok === false) setError(r.data?.error || 'Search failed');
    else { setBusinesses(r.data?.result?.businesses || []); setError(null); }
    setFacets(f.data?.result?.facets || []);
    setLoading(false);
  }, [query, cuisine, openNow]);

  useEffect(() => { void search(); }, [search]);

  const openDetail = async (b: Business) => {
    setSelected(b);
    const r = await lensRun('food', 'biz-detail', { id: b.id });
    if (r.data?.ok !== false) {
      setSelected((r.data?.result?.business as Business) || b);
      setReviews(r.data?.result?.reviews || []);
      setPhotos(r.data?.result?.photos || []);
      setTips(r.data?.result?.tips || []);
    }
  };

  const addBusiness = async () => {
    if (!addForm.name.trim() || !addForm.cuisine.trim()) { setError('Name and cuisine are required.'); return; }
    const r = await lensRun('food', 'biz-create', {
      name: addForm.name.trim(),
      cuisine: addForm.cuisine.trim(),
      priceTier: Number(addForm.priceTier) || 2,
      neighborhood: addForm.neighborhood.trim(),
      hours: addForm.open && addForm.close ? { open: addForm.open, close: addForm.close } : undefined,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not add business'); return; }
    setAddForm({ name: '', cuisine: '', priceTier: '2', neighborhood: '', open: '', close: '' });
    setShowAdd(false);
    await search();
  };

  const submitReview = async () => {
    if (!selected) return;
    await lensRun('food', 'review-create', { bizId: selected.id, rating: reviewDraft.rating, text: reviewDraft.text.trim() });
    setReviewDraft({ rating: 5, text: '' });
    await openDetail(selected);
    await search();
  };
  const submitTip = async () => {
    if (!selected || !tipDraft.trim()) return;
    await lensRun('food', 'tip-add', { bizId: selected.id, text: tipDraft.trim() });
    setTipDraft('');
    await openDetail(selected);
  };
  const addPhoto = async () => {
    if (!selected) return;
    const caption = window.prompt('Photo caption');
    if (!caption) return;
    await lensRun('food', 'photo-add', { bizId: selected.id, caption });
    await openDetail(selected);
  };
  const checkIn = async () => {
    if (!selected) return;
    await lensRun('food', 'checkin', { bizId: selected.id });
    await openDetail(selected);
  };
  const reserve = async () => {
    if (!selected) return;
    const dateTime = window.prompt('Reservation date/time (e.g. 2026-06-01T19:00)');
    if (!dateTime) return;
    await lensRun('food', 'reservation-create', { bizId: selected.id, partySize: 2, dateTime });
    setError(null);
  };
  const joinWaitlist = async () => {
    if (!selected) return;
    const r = await lensRun('food', 'waitlist-join', { bizId: selected.id, partySize: 2 });
    setError(r.data?.ok === false ? (r.data?.error || null)
      : `Joined waitlist — about ${r.data?.result?.estimatedWaitMin} min wait.`);
  };

  if (loading && businesses.length === 0) {
    return <div className="flex items-center justify-center py-12 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  // ── Detail view ──
  if (selected) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => setSelected(null)} className="text-xs text-zinc-400 hover:text-zinc-200">← Back to results</button>
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-base font-bold text-zinc-100">{selected.name}</h3>
              <p className="text-xs text-zinc-400 capitalize">
                {selected.cuisine} · {priceLabel(selected.priceTier)}
                {selected.neighborhood ? ` · ${selected.neighborhood}` : ''}
              </p>
            </div>
            {selected.openNow != null && (
              <span className={cn('flex items-center gap-1 text-[11px]', selected.openNow ? 'text-emerald-400' : 'text-rose-400')}>
                <Clock className="w-3 h-3" /> {selected.openNow ? 'Open now' : 'Closed'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Stars rating={selected.rating} size="lg" />
            <span className="text-xs text-zinc-400">{selected.rating || '—'} · {selected.reviewCount} reviews</span>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <ActionBtn icon={CheckCircle2} label={`Check in (${selected.checkinCount})`} onClick={checkIn} />
            <ActionBtn icon={Camera} label={`Photo (${selected.photoCount})`} onClick={addPhoto} />
            <ActionBtn icon={CalendarPlus} label="Reserve" onClick={reserve} />
            <ActionBtn icon={Users} label="Join waitlist" onClick={joinWaitlist} />
          </div>
        </div>

        {error && <div className="text-xs text-zinc-300 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">{error}</div>}

        {/* Write a review */}
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <h4 className="text-xs font-semibold text-zinc-300 mb-2">Write a review</h4>
          <div className="flex items-center gap-1 mb-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setReviewDraft({ ...reviewDraft, rating: n })}>
                <Star className={cn('w-5 h-5', n <= reviewDraft.rating ? 'text-amber-400 fill-amber-400' : 'text-zinc-700')} />
              </button>
            ))}
          </div>
          <textarea
            value={reviewDraft.text} onChange={(e) => setReviewDraft({ ...reviewDraft, text: e.target.value })}
            placeholder="Share your experience…" rows={2}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
          />
          <button type="button" onClick={submitReview}
            className="mt-2 px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg">
            Post review
          </button>
        </div>

        {/* Reviews */}
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <h4 className="text-xs font-semibold text-zinc-300 mb-2">Reviews ({reviews.length})</h4>
          {reviews.length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic">No reviews yet — be the first.</p>
          ) : (
            <ul className="space-y-2">
              {reviews.map((rv) => (
                <li key={rv.id} className="border-b border-zinc-800 pb-2 last:border-0">
                  <div className="flex items-center gap-2">
                    <Stars rating={rv.rating} />
                    <span className="text-[10px] text-zinc-400 font-mono">{rv.userId.slice(0, 10)}</span>
                  </div>
                  {rv.text && <p className="text-xs text-zinc-300 mt-0.5">{rv.text}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Tips */}
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <h4 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <MessageSquare className="w-3.5 h-3.5 text-red-400" /> Tips
          </h4>
          {tips.length > 0 && (
            <ul className="space-y-1 mb-2">
              {tips.map((t) => <li key={t.id} className="text-[11px] text-zinc-400">• {t.text}</li>)}
            </ul>
          )}
          <div className="flex gap-1">
            <input value={tipDraft} onChange={(e) => setTipDraft(e.target.value)} placeholder="Add a quick tip…"
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-100" />
            <button type="button" onClick={submitTip} className="px-2.5 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">Add</button>
          </div>
        </div>

        {photos.length > 0 && (
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
            <h4 className="text-xs font-semibold text-zinc-300 mb-2">Photos ({photos.length})</h4>
            <ul className="grid grid-cols-2 gap-2">
              {photos.map((p) => (
                <li key={p.id} className="bg-zinc-950 border border-zinc-800 rounded-lg p-2 text-[11px] text-zinc-400">
                  <Camera className="w-4 h-4 text-zinc-600 mb-1" />{p.caption}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search restaurants or cuisine…"
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg pl-7 pr-2 py-1.5 text-xs text-zinc-100"
          />
        </div>
        <button type="button" onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setCuisine('')}
          className={cn('text-[11px] px-2 py-0.5 rounded-full border', cuisine === '' ? 'border-red-700/50 bg-red-950/40 text-red-300' : 'border-zinc-700 text-zinc-400')}>
          All
        </button>
        {facets.slice(0, 8).map((f) => (
          <button key={f.cuisine} type="button" onClick={() => setCuisine(f.cuisine)}
            className={cn('text-[11px] px-2 py-0.5 rounded-full border capitalize', cuisine === f.cuisine ? 'border-red-700/50 bg-red-950/40 text-red-300' : 'border-zinc-700 text-zinc-400')}>
            {f.cuisine} ({f.count})
          </button>
        ))}
        <button type="button" onClick={() => setOpenNow((v) => !v)}
          className={cn('text-[11px] px-2 py-0.5 rounded-full border', openNow ? 'border-emerald-700/50 bg-emerald-950/40 text-emerald-300' : 'border-zinc-700 text-zinc-400')}>
          Open now
        </button>
      </div>

      {showAdd && (
        <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <input placeholder="Restaurant name" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Cuisine" value={addForm.cuisine} onChange={(e) => setAddForm({ ...addForm, cuisine: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={addForm.priceTier} onChange={(e) => setAddForm({ ...addForm, priceTier: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {[1, 2, 3, 4].map((t) => <option key={t} value={t}>{'$'.repeat(t)}</option>)}
          </select>
          <input placeholder="Neighborhood" value={addForm.neighborhood} onChange={(e) => setAddForm({ ...addForm, neighborhood: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Opens (HH:MM)" value={addForm.open} onChange={(e) => setAddForm({ ...addForm, open: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Closes (HH:MM)" value={addForm.close} onChange={(e) => setAddForm({ ...addForm, close: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addBusiness}
            className="col-span-2 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">
            Add to directory
          </button>
        </div>
      )}

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {businesses.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No restaurants match. Add one to start the directory.
        </div>
      ) : (
        <ul className="space-y-2">
          {businesses.map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => openDetail(b)}
                className="w-full text-left bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 hover:border-zinc-700 transition-colors">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">{b.name}</p>
                    <p className="text-[11px] text-zinc-400 capitalize">
                      {b.cuisine} · {priceLabel(b.priceTier)}{b.neighborhood ? ` · ${b.neighborhood}` : ''}
                    </p>
                  </div>
                  {b.openNow != null && (
                    <span className={cn('text-[10px]', b.openNow ? 'text-emerald-400' : 'text-rose-400')}>
                      {b.openNow ? 'Open' : 'Closed'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <Stars rating={b.rating} />
                  <span className="text-[11px] text-zinc-400">
                    {b.rating || 'New'} · {b.reviewCount} reviews
                    {b.checkinCount > 0 ? ` · ${b.checkinCount} check-ins` : ''}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActionBtn({ icon: Icon, label, onClick }: { icon: typeof Star; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );
}
