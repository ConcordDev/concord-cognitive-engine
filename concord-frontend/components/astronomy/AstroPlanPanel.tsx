'use client';

/**
 * AstroPlanPanel — observing wishlist and astronomical events.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, ListChecks, CalendarClock, Trash2, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface WishItem { id: string; name: string; type: string; priority: string; observed: boolean }
interface AstroEvent { id: string; name: string; kind: string; date: string; upcoming: boolean }

const PRIORITY_COLOR: Record<string, string> = {
  high: 'text-rose-400', medium: 'text-amber-400', low: 'text-zinc-400',
};

export function AstroPlanPanel({ onChange }: { onChange: () => void }) {
  const [wishlist, setWishlist] = useState<WishItem[]>([]);
  const [events, setEvents] = useState<AstroEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wishForm, setWishForm] = useState({ name: '', type: 'galaxy', priority: 'medium' });
  const [eventForm, setEventForm] = useState({ name: '', kind: 'meteor_shower', date: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [w, e] = await Promise.all([
      lensRun('astronomy', 'wishlist-list', {}),
      lensRun('astronomy', 'event-list', {}),
    ]);
    setWishlist(w.data?.result?.items || []);
    setEvents(e.data?.result?.events || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addWish = async () => {
    if (!wishForm.name.trim()) { setError('Object name is required.'); return; }
    const r = await lensRun('astronomy', 'wishlist-add', {
      name: wishForm.name.trim(), type: wishForm.type, priority: wishForm.priority,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setWishForm({ name: '', type: 'galaxy', priority: 'medium' }); setError(null);
    await refresh();
  };
  const removeWish = async (id: string) => { await lensRun('astronomy', 'wishlist-remove', { id }); await refresh(); };
  const addEvent = async () => {
    if (!eventForm.name.trim() || !eventForm.date) { setError('Event name and date are required.'); return; }
    const r = await lensRun('astronomy', 'event-add', {
      name: eventForm.name.trim(), kind: eventForm.kind, date: eventForm.date,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setEventForm({ name: '', kind: 'meteor_shower', date: '' }); setError(null);
    await refresh();
  };
  const removeEvent = async (id: string) => { await lensRun('astronomy', 'event-delete', { id }); await refresh(); };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Wishlist */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <ListChecks className="w-3.5 h-3.5 text-indigo-400" /> Observing wishlist
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input placeholder="Object name" value={wishForm.name} onChange={(e) => setWishForm({ ...wishForm, name: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={wishForm.priority} onChange={(e) => setWishForm({ ...wishForm, priority: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {['high', 'medium', 'low'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <button type="button" onClick={addWish}
            className="flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        {wishlist.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">Wishlist is empty.</p>
        ) : (
          <ul className="space-y-1">
            {wishlist.map((w) => (
              <li key={w.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <span className={cn('text-xs', w.observed ? 'text-zinc-400 line-through' : 'text-zinc-200')}>
                  {w.observed && <Check className="inline w-3 h-3 text-emerald-400 mr-1" />}
                  {w.name} <span className="text-zinc-600 capitalize">· {w.type}</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className={cn('text-[10px] uppercase', PRIORITY_COLOR[w.priority])}>{w.priority}</span>
                  <button aria-label="Delete" type="button" onClick={() => removeWish(w.id)} className="text-zinc-600 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Events */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <CalendarClock className="w-3.5 h-3.5 text-indigo-400" /> Astronomical events
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input placeholder="Event name" value={eventForm.name} onChange={(e) => setEventForm({ ...eventForm, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={eventForm.kind} onChange={(e) => setEventForm({ ...eventForm, kind: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {['eclipse', 'meteor_shower', 'conjunction', 'opposition', 'transit', 'comet'].map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
          </select>
          <input type="date" value={eventForm.date} onChange={(e) => setEventForm({ ...eventForm, date: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addEvent}
            className="flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        {events.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No events tracked.</p>
        ) : (
          <ul className="space-y-1">
            {events.map((e) => (
              <li key={e.id} className={cn('flex items-center justify-between bg-zinc-900/70 border rounded-lg px-3 py-2',
                e.upcoming ? 'border-indigo-900/50' : 'border-zinc-800 opacity-60')}>
                <div>
                  <p className="text-xs text-zinc-200">{e.name}</p>
                  <p className="text-[10px] text-zinc-400 capitalize">{e.kind.replace(/_/g, ' ')} · {e.date}</p>
                </div>
                <div className="flex items-center gap-2">
                  {e.upcoming && <span className="text-[10px] text-indigo-400 uppercase">upcoming</span>}
                  <button aria-label="Delete" type="button" onClick={() => removeEvent(e.id)} className="text-zinc-600 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
