'use client';

/**
 * YelpBookingsPanel — reservations and active waitlist entries.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, CalendarClock, Users, X, CheckCircle2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Reservation { id: string; bizName: string; partySize: number; dateTime: string; status: string }
interface WaitEntry { id: string; bizId: string; bizName: string; partySize: number; position: number; estimatedWaitMin: number }

export function YelpBookingsPanel() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [waitlist, setWaitlist] = useState<WaitEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [r, w] = await Promise.all([
      lensRun('food', 'reservation-list', {}),
      lensRun('food', 'waitlist-status', {}),
    ]);
    setReservations(r.data?.result?.reservations || []);
    setWaitlist(w.data?.result?.entries || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const cancel = async (id: string) => { await lensRun('food', 'reservation-cancel', { id }); await refresh(); };
  const leave = async (e: WaitEntry, seated: boolean) => {
    await lensRun('food', 'waitlist-leave', { bizId: e.bizId, id: e.id, seated });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Users className="w-3.5 h-3.5 text-red-400" /> Active waitlists
        </h3>
        {waitlist.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">Not on any waitlist. Join one from a restaurant&apos;s page.</p>
        ) : (
          <ul className="space-y-2">
            {waitlist.map((e) => (
              <li key={e.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">{e.bizName}</p>
                    <p className="text-[11px] text-zinc-500">Party of {e.partySize}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-red-300">#{e.position}</p>
                    <p className="text-[10px] text-zinc-500">~{e.estimatedWaitMin} min</p>
                  </div>
                </div>
                <div className="flex gap-1 mt-2">
                  <button type="button" onClick={() => leave(e, true)}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] bg-emerald-700/30 text-emerald-300 rounded-lg">
                    <CheckCircle2 className="w-3 h-3" /> Seated
                  </button>
                  <button type="button" onClick={() => leave(e, false)}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] bg-zinc-800 text-zinc-400 rounded-lg">
                    <X className="w-3 h-3" /> Leave
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <CalendarClock className="w-3.5 h-3.5 text-red-400" /> Reservations
        </h3>
        {reservations.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">No reservations. Book a table from a restaurant&apos;s page.</p>
        ) : (
          <ul className="space-y-2">
            {reservations.map((r) => (
              <li key={r.id} className={cn('flex items-center justify-between bg-zinc-900/70 border rounded-xl p-3',
                r.status === 'cancelled' ? 'border-zinc-800 opacity-60' : 'border-zinc-800')}>
                <div>
                  <p className={cn('text-sm font-semibold', r.status === 'cancelled' ? 'text-zinc-500 line-through' : 'text-zinc-100')}>
                    {r.bizName}
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    Party of {r.partySize} · {r.dateTime} · {r.status}
                  </p>
                </div>
                {r.status === 'confirmed' && (
                  <button type="button" onClick={() => cancel(r.id)}
                    className="text-[11px] text-zinc-500 hover:text-rose-400">Cancel</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
