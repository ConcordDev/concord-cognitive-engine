'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Calendar, Plus, Loader2, X, AlertTriangle } from 'lucide-react';
import { VetAppointment, APPT_TYPES, APPT_STATUSES } from './vet-types';

const STATUS_COLOR: Record<string, string> = {
  scheduled: 'text-blue-400 bg-blue-400/10',
  checked_in: 'text-yellow-400 bg-yellow-400/10',
  in_progress: 'text-green-400 bg-green-400/10',
  completed: 'text-zinc-400 bg-zinc-400/10',
  no_show: 'text-red-400 bg-red-400/10',
  cancelled: 'text-red-300 bg-red-300/10',
};

export function AppointmentsPanel({ onChanged }: { onChanged?: () => void }) {
  const [appts, setAppts] = useState<VetAppointment[]>([]);
  const [noShows, setNoShows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dayFilter, setDayFilter] = useState('');

  const [aPatient, setAPatient] = useState('');
  const [aOwner, setAOwner] = useState('');
  const [aType, setAType] = useState('wellness');
  const [aDate, setADate] = useState('');
  const [aTime, setATime] = useState('09:00');
  const [aDuration, setADuration] = useState('30');
  const [aVet, setAVet] = useState('');
  const [aReason, setAReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('veterinary', 'appointment-list', dayFilter ? { date: dayFilter } : {});
    if (r.data.ok && r.data.result) {
      const res = r.data.result as { appointments: VetAppointment[]; noShows: number };
      setAppts(res.appointments || []);
      setNoShows(res.noShows || 0);
      setError(null);
    } else {
      setError(r.data.error || 'failed to load appointments');
    }
    setLoading(false);
  }, [dayFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const book = async () => {
    if (!aPatient.trim() || !aDate) return;
    setBusy(true);
    const r = await lensRun('veterinary', 'appointment-book', {
      patientName: aPatient,
      owner: aOwner,
      type: aType,
      date: aDate,
      time: aTime,
      durationMin: Number(aDuration) || 30,
      vet: aVet,
      reason: aReason,
    });
    setBusy(false);
    if (r.data.ok) {
      setAPatient('');
      setAOwner('');
      setAReason('');
      await load();
      onChanged?.();
    } else {
      setError(r.data.error || 'failed to book');
    }
  };

  const setStatus = async (id: string, status: string) => {
    await lensRun('veterinary', 'appointment-status', { id, status });
    await load();
    onChanged?.();
  };

  const cancel = async (id: string) => {
    await lensRun('veterinary', 'appointment-cancel', { id });
    await load();
    onChanged?.();
  };

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          book();
        }}
        className="grid grid-cols-2 md:grid-cols-4 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3"
      >
        <input
          value={aPatient}
          onChange={(e) => setAPatient(e.target.value)}
          placeholder="Patient name *"
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <input
          value={aOwner}
          onChange={(e) => setAOwner(e.target.value)}
          placeholder="Owner"
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <select
          value={aType}
          onChange={(e) => setAType(e.target.value)}
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        >
          {APPT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          value={aVet}
          onChange={(e) => setAVet(e.target.value)}
          placeholder="Vet"
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <input
          value={aDate}
          onChange={(e) => setADate(e.target.value)}
          type="date"
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <input
          value={aTime}
          onChange={(e) => setATime(e.target.value)}
          type="time"
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <input
          value={aDuration}
          onChange={(e) => setADuration(e.target.value)}
          type="number"
          placeholder="Mins"
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <input
          value={aReason}
          onChange={(e) => setAReason(e.target.value)}
          placeholder="Reason"
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <button
          type="submit"
          disabled={busy || !aPatient.trim() || !aDate}
          className="col-span-2 md:col-span-4 flex items-center justify-center gap-2 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Book appointment
        </button>
      </form>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <Calendar className="h-4 w-4" /> Filter day
          <input
            value={dayFilter}
            onChange={(e) => setDayFilter(e.target.value)}
            type="date"
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-white"
          />
          {dayFilter && (
            <button onClick={() => setDayFilter('')} className="text-zinc-500 hover:text-white">
              clear
            </button>
          )}
        </label>
        {noShows > 0 && (
          <span className="flex items-center gap-1 rounded bg-red-500/10 px-2 py-1 text-xs text-red-400">
            <AlertTriangle className="h-3.5 w-3.5" /> {noShows} no-show{noShows > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : appts.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-800 py-8 text-center text-sm text-zinc-500">
          <Calendar className="mx-auto mb-2 h-8 w-8 opacity-30" />
          No appointments {dayFilter ? 'on this day' : 'booked'}.
        </div>
      ) : (
        <div className="space-y-2">
          {appts.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3"
            >
              <div>
                <p className="text-sm font-semibold text-white">
                  {a.patientName}{' '}
                  <span className="text-xs font-normal text-zinc-500">
                    {a.date} {a.time} · {a.durationMin}min
                  </span>
                </p>
                <p className="text-xs text-zinc-500">
                  {a.type} · {a.owner || 'no owner'}
                  {a.vet && ` · ${a.vet}`}
                  {a.reason && ` — ${a.reason}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={a.status}
                  onChange={(e) => setStatus(a.id, e.target.value)}
                  className={`rounded px-2 py-1 text-xs ${STATUS_COLOR[a.status] || 'text-zinc-400 bg-zinc-800'}`}
                >
                  {APPT_STATUSES.map((s) => (
                    <option key={s} value={s} className="bg-zinc-900 text-white">
                      {s}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => cancel(a.id)}
                  aria-label="Cancel appointment"
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
