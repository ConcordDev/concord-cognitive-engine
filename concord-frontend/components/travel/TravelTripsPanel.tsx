'use client';

/**
 * TravelTripsPanel — trip list + create, and a trip detail view with
 * itinerary, bookings, budget and a packing checklist.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, MapPin, ChevronLeft, Trash2, Check, CalendarDays, Ticket, Wallet, ListChecks } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Trip {
  id: string; name: string; destination: string; startDate: string | null;
  endDate: string | null; travelers: number; durationDays: number | null; status?: string;
}
interface ItineraryItem { id: string; title: string; day: string | null; time: string | null; category: string; location: string | null }
interface Booking { id: string; type: string; provider: string | null; cost: number; date: string | null }
interface ChecklistItem { id: string; item: string; done: boolean }

const STATUS_COLOR: Record<string, string> = {
  draft: 'text-zinc-400', upcoming: 'text-sky-400', active: 'text-emerald-400', past: 'text-zinc-600',
};

export function TravelTripsPanel({ onChange }: { onChange: () => void }) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', destination: '', startDate: '', endDate: '', travelers: '2' });
  const [selected, setSelected] = useState<Trip | null>(null);
  const [itinerary, setItinerary] = useState<ItineraryItem[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [budget, setBudget] = useState<{ planned: number; booked: number; remaining: number; overBudget: boolean } | null>(null);
  const [itinForm, setItinForm] = useState({ title: '', day: '', time: '', category: 'sightseeing' });
  const [bookForm, setBookForm] = useState({ type: 'flight', provider: '', cost: '' });
  const [ckItem, setCkItem] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('travel', 'trip-list', {});
    setTrips(r.data?.result?.trips || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const openTrip = useCallback(async (trip: Trip) => {
    setSelected(trip);
    const [it, bk, ck, bs] = await Promise.all([
      lensRun('travel', 'itinerary-list', { tripId: trip.id }),
      lensRun('travel', 'booking-list', { tripId: trip.id }),
      lensRun('travel', 'checklist-list', { tripId: trip.id }),
      lensRun('travel', 'budget-summary', { tripId: trip.id }),
    ]);
    setItinerary(it.data?.result?.items || []);
    setBookings(bk.data?.result?.bookings || []);
    setChecklist(ck.data?.result?.items || []);
    setBudget(bs.data?.ok === false ? null : (bs.data?.result as typeof budget));
  }, []);

  const addTrip = async () => {
    if (!form.name.trim() || !form.destination.trim()) { setError('Trip name and destination are required.'); return; }
    const r = await lensRun('travel', 'trip-create', {
      name: form.name.trim(), destination: form.destination.trim(),
      startDate: form.startDate, endDate: form.endDate, travelers: Number(form.travelers) || 1,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', destination: '', startDate: '', endDate: '', travelers: '2' });
    setShowAdd(false); setError(null);
    await refresh(); onChange();
  };
  const delTrip = async (id: string) => {
    await lensRun('travel', 'trip-delete', { id });
    if (selected?.id === id) setSelected(null);
    await refresh(); onChange();
  };
  const addItin = async () => {
    if (!selected || !itinForm.title.trim()) { setError('Itinerary title is required.'); return; }
    await lensRun('travel', 'itinerary-add', { tripId: selected.id, ...itinForm, title: itinForm.title.trim() });
    setItinForm({ title: '', day: '', time: '', category: 'sightseeing' });
    setError(null);
    await openTrip(selected);
  };
  const delItin = async (id: string) => { if (selected) { await lensRun('travel', 'itinerary-delete', { tripId: selected.id, id }); await openTrip(selected); } };
  const addBooking = async () => {
    if (!selected) return;
    await lensRun('travel', 'booking-add', {
      tripId: selected.id, type: bookForm.type, provider: bookForm.provider.trim(), cost: Number(bookForm.cost) || 0,
    });
    setBookForm({ type: 'flight', provider: '', cost: '' });
    await openTrip(selected); onChange();
  };
  const delBooking = async (id: string) => { if (selected) { await lensRun('travel', 'booking-delete', { tripId: selected.id, id }); await openTrip(selected); onChange(); } };
  const addCheck = async () => {
    if (!selected || !ckItem.trim()) return;
    await lensRun('travel', 'checklist-add', { tripId: selected.id, item: ckItem.trim() });
    setCkItem('');
    await openTrip(selected);
  };
  const toggleCheck = async (id: string) => { if (selected) { await lensRun('travel', 'checklist-toggle', { tripId: selected.id, id }); await openTrip(selected); } };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  // ── Trip detail ──
  if (selected) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => setSelected(null)}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
          <ChevronLeft className="w-3.5 h-3.5" /> All trips
        </button>
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
          <h3 className="text-base font-bold text-zinc-100">{selected.name}</h3>
          <p className="text-xs text-zinc-400 flex items-center gap-1">
            <MapPin className="w-3 h-3" />{selected.destination}
            {selected.startDate ? ` · ${selected.startDate} → ${selected.endDate}` : ''}
            {selected.durationDays ? ` · ${selected.durationDays} days` : ''} · {selected.travelers} travelers
          </p>
        </div>

        {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

        {/* Itinerary */}
        <section>
          <h4 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <CalendarDays className="w-3.5 h-3.5 text-sky-400" /> Itinerary
          </h4>
          <div className="grid grid-cols-4 gap-2 mb-2">
            <input placeholder="Activity" value={itinForm.title} onChange={(e) => setItinForm({ ...itinForm, title: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input type="date" value={itinForm.day} onChange={(e) => setItinForm({ ...itinForm, day: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="HH:MM" value={itinForm.time} onChange={(e) => setItinForm({ ...itinForm, time: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={addItin}
              className="flex items-center justify-center gap-1 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium rounded-lg">
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>
          {itinerary.length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic">No itinerary items.</p>
          ) : (
            <ul className="space-y-1">
              {itinerary.map((it) => (
                <li key={it.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-xs text-zinc-200">{it.title}</p>
                    <p className="text-[10px] text-zinc-400 capitalize">
                      {[it.day, it.time, it.category].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <button aria-label="Delete" type="button" onClick={() => delItin(it.id)} className="text-zinc-600 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Bookings + budget */}
        <section>
          <h4 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <Ticket className="w-3.5 h-3.5 text-sky-400" /> Bookings
            {budget && (
              <span className={cn('text-[10px]', budget.overBudget ? 'text-rose-400' : 'text-zinc-400')}>
                · ${budget.booked} booked / ${budget.planned} planned
              </span>
            )}
          </h4>
          <div className="grid grid-cols-4 gap-2 mb-2">
            <select value={bookForm.type} onChange={(e) => setBookForm({ ...bookForm, type: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
              {['flight', 'hotel', 'car', 'rail', 'activity', 'cruise'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input placeholder="Provider" value={bookForm.provider} onChange={(e) => setBookForm({ ...bookForm, provider: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Cost ($)" inputMode="decimal" value={bookForm.cost} onChange={(e) => setBookForm({ ...bookForm, cost: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={addBooking}
              className="flex items-center justify-center gap-1 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium rounded-lg">
              <Wallet className="w-3.5 h-3.5" /> Book
            </button>
          </div>
          {bookings.length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic">No bookings.</p>
          ) : (
            <ul className="space-y-1">
              {bookings.map((b) => (
                <li key={b.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                  <span className="text-xs text-zinc-200 capitalize">{b.type}{b.provider ? ` · ${b.provider}` : ''}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-[11px] text-zinc-400 font-mono">${b.cost}</span>
                    <button aria-label="Delete" type="button" onClick={() => delBooking(b.id)} className="text-zinc-600 hover:text-rose-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Checklist */}
        <section>
          <h4 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <ListChecks className="w-3.5 h-3.5 text-sky-400" /> Packing checklist
          </h4>
          <div className="flex gap-1 mb-2">
            <input value={ckItem} onChange={(e) => setCkItem(e.target.value)} placeholder="Add item…"
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={addCheck}
              className="px-2.5 py-1.5 text-xs bg-sky-600 hover:bg-sky-500 text-white rounded-lg">Add</button>
          </div>
          {checklist.length > 0 && (
            <ul className="space-y-1">
              {checklist.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-xs">
                  <button type="button" onClick={() => toggleCheck(c.id)}
                    className={cn('w-4 h-4 rounded border flex items-center justify-center',
                      c.done ? 'bg-sky-600 border-sky-600' : 'border-zinc-600')}>
                    {c.done && <Check className="w-3 h-3 text-white" />}
                  </button>
                  <span className={cn(c.done ? 'text-zinc-400 line-through' : 'text-zinc-200')}>{c.item}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  // ── Trip list ──
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-400"><span className="text-zinc-100 font-semibold">{trips.length}</span> trips</span>
        <button type="button" onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> New trip
        </button>
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {showAdd && (
        <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <input placeholder="Trip name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Destination" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input type="date" title="Start" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input type="date" title="End" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Travelers" inputMode="numeric" value={form.travelers} onChange={(e) => setForm({ ...form, travelers: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addTrip}
            className="bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Create trip</button>
        </div>
      )}

      {trips.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No trips yet. Plan your first one.
        </div>
      ) : (
        <ul className="space-y-2">
          {trips.map((t) => (
            <li key={t.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <button type="button" onClick={() => openTrip(t)} className="text-left">
                <p className="text-sm font-semibold text-zinc-100">
                  {t.name}
                  {t.status && <span className={cn('ml-2 text-[10px] uppercase', STATUS_COLOR[t.status])}>{t.status}</span>}
                </p>
                <p className="text-[11px] text-zinc-400 flex items-center gap-1">
                  <MapPin className="w-3 h-3" />{t.destination}
                  {t.startDate ? ` · ${t.startDate}` : ''}{t.durationDays ? ` · ${t.durationDays}d` : ''}
                </p>
              </button>
              <button aria-label="Delete" type="button" onClick={() => delTrip(t.id)} className="text-zinc-600 hover:text-rose-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
