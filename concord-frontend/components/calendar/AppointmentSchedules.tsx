'use client';

/**
 * AppointmentSchedules — Google Calendar 2026 "appointment schedules"
 * (booking pages). Publish bookable windows, browse open slots for a
 * date, and manage reservations. Wires the calendar.appointment-* macros.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarClock, Plus, Trash2, Check, Link2, Copy, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { calendarDateKey, shiftDateKey } from '@/lib/calendar-date';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui';

interface Schedule {
  id: string; title: string; description: string; durationMin: number;
  availability: { weekdays: number[]; startHour: number; endHour: number };
  bookingCount: number;
}
interface Slot { slotStart: string; label: string; available: boolean; conflictTitle?: string }
interface Booking { id: string; slotStart: string; bookerName: string; note: string }

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function todayPlus(days: number): string {
  return shiftDateKey(calendarDateKey(), days);
}

export function AppointmentSchedules() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [date, setDate] = useState(todayPlus(1));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ title: '', durationMin: 30, startHour: 9, endHour: 17 });
  // F5: booking used native prompt()/confirm(), which never surface in
  // embedded browsers — slots and delete looked dead. Inline state now.
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [bookForm, setBookForm] = useState({ name: '', note: '' });
  const [bookError, setBookError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [firstBooking, setFirstBooking] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const deepLinkDone = useRef(false);

  useEffect(() => {
    setBaseUrl(`${window.location.origin}${window.location.pathname}`);
  }, []);

  const refresh = useCallback(async () => {
    const r = await lensRun('calendar', 'appointment-schedule-list', {});
    const list = (r.data?.result?.schedules as Schedule[]) || [];
    setSchedules(list);
    setLoading(false);
    // The booking link (?book=<id>) opens this page on that schedule.
    if (!deepLinkDone.current) {
      deepLinkDone.current = true;
      const wanted = new URLSearchParams(window.location.search).get('book');
      if (wanted && list.some(s => s.id === wanted)) setActive(wanted);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const loadSlots = useCallback(async (scheduleId: string, d: string) => {
    const [s, b] = await Promise.all([
      lensRun('calendar', 'appointment-slots', { scheduleId, date: d }),
      lensRun('calendar', 'appointment-bookings', { scheduleId }),
    ]);
    setSlots((s.data?.result?.slots as Slot[]) || []);
    setBookings((b.data?.result?.bookings as Booking[]) || []);
  }, []);

  useEffect(() => { if (active) void loadSlots(active, date); }, [active, date, loadSlots]);

  async function create() {
    if (!form.title.trim()) return;
    const r = await lensRun('calendar', 'appointment-schedule-create', form);
    if (r.data?.ok) {
      setShowNew(false); setForm({ title: '', durationMin: 30, startHour: 9, endHour: 17 });
      await refresh();
      setActive(r.data.result?.schedule.id);
    }
  }
  async function del(id: string) {
    if (confirmDeleteId !== id) { setConfirmDeleteId(id); return; }
    setConfirmDeleteId(null);
    await lensRun('calendar', 'appointment-schedule-delete', { id });
    if (active === id) setActive(null);
    await refresh();
  }
  function bookingLink(id: string) { return baseUrl ? `${baseUrl}?book=${id}` : ''; }
  async function copyLink(id: string) {
    const link = bookingLink(id);
    if (!link) return;
    try { await navigator.clipboard.writeText(link); } catch { /* link is visible in the panel */ }
    setCopiedId(id);
    setTimeout(() => setCopiedId(cur => (cur === id ? null : cur)), 2000);
  }
  function book(slotStart: string) {
    if (!active) return;
    setSelectedSlot(slotStart);
    setBookForm({ name: '', note: '' });
    setBookError('');
  }
  async function submitBooking() {
    if (!active || !selectedSlot) return;
    if (!bookForm.name.trim()) { setBookError('Your name is required.'); return; }
    const wasFirst = bookings.length === 0;
    const r = await lensRun('calendar', 'appointment-book', {
      scheduleId: active, slotStart: selectedSlot,
      bookerName: bookForm.name.trim(), note: bookForm.note.trim() || undefined,
    });
    if (!r.data?.ok) { setBookError(r.data?.error || 'Could not book that slot.'); return; }
    setSelectedSlot(null);
    if (wasFirst) setFirstBooking(true);
    await loadSlots(active, date);
    await refresh();
  }
  async function cancelBooking(bookingId: string) {
    if (!active) return;
    await lensRun('calendar', 'appointment-cancel-booking', { scheduleId: active, bookingId });
    await loadSlots(active, date);
    await refresh();
  }

  if (loading) {
    return (
      <div role="status" aria-live="polite" aria-busy="true">
        <span className="sr-only">Loading appointment schedules</span>
        <div className="flex items-center gap-2 mb-3">
          <Skeleton variant="avatar" width={16} height={16} />
          <Skeleton variant="line" width="9rem" />
        </div>
        <div className="grid sm:grid-cols-[200px_1fr] gap-3">
          <div className="space-y-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-lattice-border bg-lattice-elevated/60 px-2.5 py-2">
                <Skeleton variant="line" width="70%" className="mb-1.5" />
                <Skeleton variant="line" width="40%" height="0.625rem" />
              </div>
            ))}
          </div>
          <Skeleton variant="block" height="7.5rem" />
        </div>
      </div>
    );
  }

  const activeSchedule = schedules.find(s => s.id === active);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <CalendarClock className="w-4 h-4 text-blue-400" />
        <h3 className="text-sm font-bold text-white">Appointment Schedules</h3>
        <span className="text-[11px] text-gray-400">booking pages</span>
        <button onClick={() => setShowNew(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded-lg bg-blue-600 hover:bg-blue-500 text-white inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />New
        </button>
      </div>

      {showNew && (
        <div className="bg-lattice-elevated/70 border border-blue-800/40 rounded-lg p-3 mb-3 space-y-2">
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Schedule title (e.g. Office hours)"
            className="w-full bg-lattice-deep border border-lattice-border rounded px-2 py-1.5 text-sm text-white" />
          <div className="flex flex-wrap gap-2 items-center text-xs text-gray-400">
            <label>Slot
              <select value={form.durationMin} onChange={e => setForm({ ...form, durationMin: Number(e.target.value) })}
                className="ml-1 bg-lattice-deep border border-lattice-border rounded px-1.5 py-1 text-gray-200">
                {[15, 30, 45, 60].map(m => <option key={m} value={m}>{m}m</option>)}
              </select>
            </label>
            <label>From
              <select value={form.startHour} onChange={e => setForm({ ...form, startHour: Number(e.target.value) })}
                className="ml-1 bg-lattice-deep border border-lattice-border rounded px-1.5 py-1 text-gray-200">
                {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{i}:00</option>)}
              </select>
            </label>
            <label>To
              <select value={form.endHour} onChange={e => setForm({ ...form, endHour: Number(e.target.value) })}
                className="ml-1 bg-lattice-deep border border-lattice-border rounded px-1.5 py-1 text-gray-200">
                {Array.from({ length: 24 }, (_, i) => i + 1).map(i => <option key={i} value={i}>{i}:00</option>)}
              </select>
            </label>
            <button onClick={create} className="ml-auto px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold">Create</button>
          </div>
        </div>
      )}

      {schedules.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No appointment schedules yet — create one so others can book time with you.</p>
      ) : (
        <div className="grid sm:grid-cols-[200px_1fr] gap-3">
          <ul className="space-y-1">
            {schedules.map(s => (
              <li key={s.id} className="group flex items-center gap-1">
                <button onClick={() => setActive(s.id)}
                  className={cn('flex-1 text-left rounded-lg px-2.5 py-2 border', active === s.id ? 'bg-blue-600/15 border-blue-700/50' : 'bg-lattice-elevated/60 border-lattice-border hover:border-white/20')}>
                  <p className="text-xs font-semibold text-white truncate">{s.title}</p>
                  <p className="text-[10px] text-gray-400 tabular-nums">{s.durationMin}m · {s.bookingCount} booked</p>
                </button>
                <button aria-label="Copy booking link" title="Copy booking link" onClick={() => void copyLink(s.id)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-blue-300">
                  {copiedId === s.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Link2 className="w-3 h-3" />}
                </button>
                {confirmDeleteId === s.id ? (
                  <button onClick={() => void del(s.id)} className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-rose-600 text-white">Delete?</button>
                ) : (
                  <button aria-label="Delete" onClick={() => void del(s.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
                )}
              </li>
            ))}
          </ul>

          {activeSchedule ? (
            <div className="bg-lattice-elevated/60 border border-lattice-border rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <p className="text-xs text-gray-400 tabular-nums">
                  {activeSchedule.availability.weekdays.map(d => WD[d]).join(' ')} · {activeSchedule.availability.startHour}:00–{activeSchedule.availability.endHour}:00
                </p>
                <input type="date" value={date} onChange={e => setDate(e.target.value)}
                  className="ml-auto bg-lattice-deep border border-lattice-border rounded px-2 py-1 text-xs text-gray-200" />
              </div>
              <div className="flex items-center gap-2 mb-2 rounded border border-lattice-border bg-lattice-deep px-2 py-1.5">
                <Link2 className="w-3 h-3 text-blue-400 shrink-0" />
                <span className="text-[11px] text-gray-400 truncate flex-1">{bookingLink(activeSchedule.id) || 'Booking link'}</span>
                <button onClick={() => void copyLink(activeSchedule.id)} className="text-[11px] text-blue-300 hover:text-blue-200 inline-flex items-center gap-1 shrink-0">
                  {copiedId === activeSchedule.id ? <><Check className="w-3 h-3 text-emerald-400" />Copied</> : <><Copy className="w-3 h-3" />Copy link</>}
                </button>
              </div>
              {firstBooking && (
                <div className="flex items-center gap-2 mb-2 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[11px] text-emerald-200">
                  <Check className="w-3 h-3 shrink-0" />
                  <span className="flex-1">That's the first booking on this page — it's on your calendar now.</span>
                  <button aria-label="Dismiss" onClick={() => setFirstBooking(false)} className="text-emerald-300/70 hover:text-emerald-200"><X className="w-3 h-3" /></button>
                </div>
              )}
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 mb-3">
                {slots.length === 0 && <p className="col-span-full text-[11px] text-gray-400 italic">No slots on this day.</p>}
                {slots.map(s => (
                  <button key={s.slotStart} disabled={!s.available} onClick={() => book(s.slotStart)}
                    title={!s.available && s.conflictTitle ? `Busy — ${s.conflictTitle}` : undefined}
                    className={cn('px-2 py-1.5 text-xs rounded border tabular-nums',
                      selectedSlot === s.slotStart ? 'border-blue-400 bg-blue-600/30 text-white'
                      : s.available ? 'border-blue-700/50 text-blue-300 hover:bg-blue-600/20' : 'border-lattice-border text-gray-600 line-through cursor-not-allowed')}>
                    {s.label}
                  </button>
                ))}
              </div>
              {selectedSlot && (
                <div className="mb-3 rounded border border-blue-700/40 bg-blue-600/5 p-2.5 space-y-2">
                  <p className="text-[11px] text-gray-300">
                    Book <span className="text-white font-semibold tabular-nums">{selectedSlot.slice(0, 10)} · {selectedSlot.slice(11, 16)}</span> — {activeSchedule.durationMin} min
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <input value={bookForm.name} onChange={e => setBookForm({ ...bookForm, name: e.target.value })} placeholder="Your name"
                      className="flex-1 min-w-[140px] bg-lattice-deep border border-lattice-border rounded px-2 py-1.5 text-xs text-white" />
                    <input value={bookForm.note} onChange={e => setBookForm({ ...bookForm, note: e.target.value })} placeholder="Note (optional)"
                      className="flex-1 min-w-[140px] bg-lattice-deep border border-lattice-border rounded px-2 py-1.5 text-xs text-white" />
                  </div>
                  {bookError && <p className="text-[11px] text-rose-300">{bookError}</p>}
                  <div className="flex gap-2">
                    <button onClick={() => void submitBooking()} className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold">Book</button>
                    <button onClick={() => setSelectedSlot(null)} className="px-3 py-1 rounded border border-lattice-border text-gray-300 text-xs">Cancel</button>
                  </div>
                </div>
              )}
              {bookings.length > 0 && (
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Bookings</p>
                  {bookings.map(b => (
                    <div key={b.id} className="group flex items-center gap-2 text-xs text-gray-300 py-0.5">
                      <Check className="w-3 h-3 text-blue-400" />
                      <span className="font-mono tabular-nums text-gray-400">{b.slotStart.slice(5, 16).replace('T', ' ')}</span>
                      <span className="truncate flex-1">{b.bookerName}</span>
                      <button onClick={() => cancelBooking(b.id)} className="opacity-0 group-hover:opacity-100 text-rose-400 text-[10px]">cancel</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-lattice-elevated/30 border border-dashed border-lattice-border rounded-lg flex items-center justify-center text-xs text-gray-400 min-h-[120px]">
              Select a schedule to view open slots.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
