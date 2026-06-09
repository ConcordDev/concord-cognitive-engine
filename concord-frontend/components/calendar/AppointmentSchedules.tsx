'use client';

/**
 * AppointmentSchedules — Google Calendar 2026 "appointment schedules"
 * (booking pages). Publish bookable windows, browse open slots for a
 * date, and manage reservations. Wires the calendar.appointment-* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Plus, Trash2, Loader2, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Schedule {
  id: string; title: string; description: string; durationMin: number;
  availability: { weekdays: number[]; startHour: number; endHour: number };
  bookingCount: number;
}
interface Slot { slotStart: string; label: string; available: boolean }
interface Booking { id: string; slotStart: string; bookerName: string; note: string }

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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

  const refresh = useCallback(async () => {
    const r = await lensRun('calendar', 'appointment-schedule-list', {});
    setSchedules((r.data?.result?.schedules as Schedule[]) || []);
    setLoading(false);
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
    if (!confirm('Delete this schedule?')) return;
    await lensRun('calendar', 'appointment-schedule-delete', { id });
    if (active === id) setActive(null);
    await refresh();
  }
  async function book(slotStart: string) {
    if (!active) return;
    const name = prompt('Booking — your name?');
    if (!name?.trim()) return;
    const r = await lensRun('calendar', 'appointment-book', { scheduleId: active, slotStart, bookerName: name.trim() });
    if (!r.data?.ok) alert(r.data?.error || 'Could not book.');
    await loadSlots(active, date);
    await refresh();
  }
  async function cancelBooking(bookingId: string) {
    if (!active) return;
    await lensRun('calendar', 'appointment-cancel-booking', { scheduleId: active, bookingId });
    await loadSlots(active, date);
    await refresh();
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  const activeSchedule = schedules.find(s => s.id === active);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <CalendarClock className="w-4 h-4 text-blue-400" />
        <h3 className="text-sm font-bold text-zinc-100">Appointment Schedules</h3>
        <span className="text-[11px] text-zinc-400">booking pages</span>
        <button onClick={() => setShowNew(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded-lg bg-blue-600 hover:bg-blue-500 text-white inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />New
        </button>
      </div>

      {showNew && (
        <div className="bg-zinc-900/70 border border-blue-800/40 rounded-lg p-3 mb-3 space-y-2">
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Schedule title (e.g. Office hours)"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100" />
          <div className="flex flex-wrap gap-2 items-center text-xs text-zinc-400">
            <label>Slot
              <select value={form.durationMin} onChange={e => setForm({ ...form, durationMin: Number(e.target.value) })}
                className="ml-1 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-zinc-200">
                {[15, 30, 45, 60].map(m => <option key={m} value={m}>{m}m</option>)}
              </select>
            </label>
            <label>From
              <select value={form.startHour} onChange={e => setForm({ ...form, startHour: Number(e.target.value) })}
                className="ml-1 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-zinc-200">
                {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{i}:00</option>)}
              </select>
            </label>
            <label>To
              <select value={form.endHour} onChange={e => setForm({ ...form, endHour: Number(e.target.value) })}
                className="ml-1 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-zinc-200">
                {Array.from({ length: 24 }, (_, i) => i + 1).map(i => <option key={i} value={i}>{i}:00</option>)}
              </select>
            </label>
            <button onClick={create} className="ml-auto px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold">Create</button>
          </div>
        </div>
      )}

      {schedules.length === 0 ? (
        <p className="text-xs text-zinc-400 italic">No appointment schedules yet — create one so others can book time with you.</p>
      ) : (
        <div className="grid sm:grid-cols-[200px_1fr] gap-3">
          <ul className="space-y-1">
            {schedules.map(s => (
              <li key={s.id} className="group flex items-center gap-1">
                <button onClick={() => setActive(s.id)}
                  className={cn('flex-1 text-left rounded-lg px-2.5 py-2 border', active === s.id ? 'bg-blue-600/15 border-blue-700/50' : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700')}>
                  <p className="text-xs font-semibold text-zinc-100 truncate">{s.title}</p>
                  <p className="text-[10px] text-zinc-400">{s.durationMin}m · {s.bookingCount} booked</p>
                </button>
                <button aria-label="Delete" onClick={() => del(s.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>

          {activeSchedule ? (
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <p className="text-xs text-zinc-400">
                  {activeSchedule.availability.weekdays.map(d => WD[d]).join(' ')} · {activeSchedule.availability.startHour}:00–{activeSchedule.availability.endHour}:00
                </p>
                <input type="date" value={date} onChange={e => setDate(e.target.value)}
                  className="ml-auto bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 mb-3">
                {slots.length === 0 && <p className="col-span-full text-[11px] text-zinc-400 italic">No slots on this day.</p>}
                {slots.map(s => (
                  <button key={s.slotStart} disabled={!s.available} onClick={() => book(s.slotStart)}
                    className={cn('px-2 py-1.5 text-xs rounded border',
                      s.available ? 'border-blue-700/50 text-blue-300 hover:bg-blue-600/20' : 'border-zinc-800 text-zinc-600 line-through cursor-not-allowed')}>
                    {s.label}
                  </button>
                ))}
              </div>
              {bookings.length > 0 && (
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-zinc-400 mb-1">Bookings</p>
                  {bookings.map(b => (
                    <div key={b.id} className="group flex items-center gap-2 text-xs text-zinc-300 py-0.5">
                      <Check className="w-3 h-3 text-blue-400" />
                      <span className="font-mono text-zinc-400">{b.slotStart.slice(5, 16).replace('T', ' ')}</span>
                      <span className="truncate flex-1">{b.bookerName}</span>
                      <button onClick={() => cancelBooking(b.id)} className="opacity-0 group-hover:opacity-100 text-rose-400 text-[10px]">cancel</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-zinc-900/30 border border-dashed border-zinc-800 rounded-lg flex items-center justify-center text-xs text-zinc-400 min-h-[120px]">
              Select a schedule to view open slots.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
