'use client';

/**
 * YelpBookingsPanel — reservations, active waitlist entries, and check-in
 * history (food.checkin-history).
 */

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Users, X, CheckCircle2, History } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { SkeletonTableRows } from '@/components/ui';

interface Reservation { id: string; bizName: string; partySize: number; dateTime: string; status: string }
interface WaitEntry { id: string; bizId: string; bizName: string; partySize: number; position: number; estimatedWaitMin: number }
interface CheckinRecord { id: string; bizId: string; bizName: string; note: string; at: string }

export function YelpBookingsPanel() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [waitlist, setWaitlist] = useState<WaitEntry[]>([]);
  const [checkins, setCheckins] = useState<CheckinRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAllCheckins, setShowAllCheckins] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [r, w, c] = await Promise.all([
      lensRun('food', 'reservation-list', {}),
      lensRun('food', 'waitlist-status', {}),
      lensRun('food', 'checkin-history', {}),
    ]);
    setReservations(r.data?.result?.reservations || []);
    setWaitlist(w.data?.result?.entries || []);
    setCheckins(c.data?.result?.checkins || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const cancel = async (id: string) => { await lensRun('food', 'reservation-cancel', { id }); await refresh(); };
  const leave = async (e: WaitEntry, seated: boolean) => {
    await lensRun('food', 'waitlist-leave', { bizId: e.bizId, id: e.id, seated });
    await refresh();
  };

  if (loading) {
    return <SkeletonTableRows rows={4} columns={3} />;
  }

  return (
    <div className="space-y-4">
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-gray-300 mb-2">
          <Users className="w-3.5 h-3.5 text-red-400" /> Active waitlists
        </h3>
        {waitlist.length === 0 ? (
          <p className="text-[11px] text-gray-400 italic">Not on any waitlist. Join one from a restaurant&apos;s page.</p>
        ) : (
          <ul className="space-y-2">
            {waitlist.map((e) => (
              <li key={e.id} className="bg-lattice-surface/70 border border-lattice-border rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">{e.bizName}</p>
                    <p className="text-[11px] text-gray-400 tabular-nums">Party of {e.partySize}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-red-300 tabular-nums">#{e.position}</p>
                    <p className="text-[10px] text-gray-400 tabular-nums">~{e.estimatedWaitMin} min</p>
                  </div>
                </div>
                <div className="flex gap-1 mt-2">
                  <button type="button" onClick={() => leave(e, true)}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] bg-emerald-700/30 text-emerald-300 rounded-lg">
                    <CheckCircle2 className="w-3 h-3" /> Seated
                  </button>
                  <button type="button" onClick={() => leave(e, false)}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] bg-lattice-elevated text-gray-400 rounded-lg">
                    <X className="w-3 h-3" /> Leave
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-gray-300 mb-2">
          <CalendarClock className="w-3.5 h-3.5 text-red-400" /> Reservations
        </h3>
        {reservations.length === 0 ? (
          <p className="text-[11px] text-gray-400 italic">No reservations. Book a table from a restaurant&apos;s page.</p>
        ) : (
          <ul className="space-y-2">
            {reservations.map((r) => (
              <li key={r.id} className={cn('flex items-center justify-between bg-lattice-surface/70 border rounded-xl p-3',
                r.status === 'cancelled' ? 'border-lattice-border opacity-60' : 'border-lattice-border')}>
                <div>
                  <p className={cn('text-sm font-semibold', r.status === 'cancelled' ? 'text-gray-400 line-through' : 'text-white')}>
                    {r.bizName}
                  </p>
                  <p className="text-[11px] text-gray-400 tabular-nums">
                    Party of {r.partySize} · {r.dateTime} · {r.status}
                  </p>
                </div>
                {r.status === 'confirmed' && (
                  <button type="button" onClick={() => cancel(r.id)}
                    className="text-[11px] text-gray-400 hover:text-rose-400">Cancel</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-gray-300 mb-2">
          <History className="w-3.5 h-3.5 text-red-400" /> Check-in history
        </h3>
        {checkins.length === 0 ? (
          <p className="text-[11px] text-gray-400 italic">No check-ins yet. Check in from a restaurant&apos;s page.</p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {(showAllCheckins ? checkins : checkins.slice(0, 5)).map((c) => (
                <li key={c.id} className="flex items-center justify-between text-xs bg-lattice-surface/70 border border-lattice-border rounded-lg px-3 py-1.5">
                  <span className="text-gray-200">{c.bizName}</span>
                  <span className="text-[10px] text-gray-500">{new Date(c.at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
            {checkins.length > 5 && (
              <button type="button" onClick={() => setShowAllCheckins((v) => !v)}
                className="text-[11px] text-gray-400 hover:text-gray-200 mt-1.5">
                {showAllCheckins ? 'Show less' : `Show all ${checkins.length} check-ins`}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
