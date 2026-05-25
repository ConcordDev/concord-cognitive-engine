'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { BellRing, Loader2, AlertOctagon, CalendarClock } from 'lucide-react';
import { VetReminderEntry } from './vet-types';

export function RemindersPanel() {
  const [overdue, setOverdue] = useState<VetReminderEntry[]>([]);
  const [dueSoon, setDueSoon] = useState<VetReminderEntry[]>([]);
  const [horizon, setHorizon] = useState('30');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('veterinary', 'vaccine-reminders', {
      horizonDays: Number(horizon) || 30,
    });
    if (r.data.ok && r.data.result) {
      const res = r.data.result as { overdue: VetReminderEntry[]; dueSoon: VetReminderEntry[] };
      setOverdue(res.overdue || []);
      setDueSoon(res.dueSoon || []);
      setError(null);
    } else {
      setError(r.data.error || 'failed to load reminders');
    }
    setLoading(false);
  }, [horizon]);

  useEffect(() => {
    load();
  }, [load]);

  const Row = ({ e, danger }: { e: VetReminderEntry; danger: boolean }) => (
    <div
      className={`flex items-center justify-between rounded-lg border p-3 ${
        danger ? 'border-red-500/30 bg-red-500/5' : 'border-zinc-800 bg-zinc-900'
      }`}
    >
      <div>
        <p className="text-sm font-semibold text-white">
          {e.patientName} <span className="text-xs font-normal text-zinc-400">— {e.vaccine}</span>
        </p>
        <p className="text-xs text-zinc-400">
          {e.owner || 'no owner'} · due {e.nextDue}
        </p>
      </div>
      <span
        className={`rounded px-2 py-1 text-xs font-mono ${
          danger ? 'bg-red-400/10 text-red-400' : 'bg-yellow-400/10 text-yellow-400'
        }`}
      >
        {danger ? `${Math.abs(e.daysOut)}d overdue` : `in ${e.daysOut}d`}
      </span>
    </div>
  );

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        <CalendarClock className="h-4 w-4" /> Look-ahead window
        <input
          value={horizon}
          onChange={(e) => setHorizon(e.target.value)}
          type="number"
          className="w-20 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-white"
        />
        days
      </label>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Computing reminders…
        </div>
      ) : (
        <>
          <div>
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-red-400">
              <AlertOctagon className="h-4 w-4" /> Overdue ({overdue.length})
            </p>
            {overdue.length === 0 ? (
              <p className="text-xs text-zinc-400">No overdue vaccinations.</p>
            ) : (
              <div className="space-y-2">
                {overdue.map((e, i) => (
                  <Row key={`${e.patientId}-${e.vaccine}-${i}`} e={e} danger />
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-yellow-400">
              <BellRing className="h-4 w-4" /> Due soon ({dueSoon.length})
            </p>
            {dueSoon.length === 0 ? (
              <p className="text-xs text-zinc-400">Nothing due in the next {horizon} days.</p>
            ) : (
              <div className="space-y-2">
                {dueSoon.map((e, i) => (
                  <Row key={`${e.patientId}-${e.vaccine}-${i}`} e={e} danger={false} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
