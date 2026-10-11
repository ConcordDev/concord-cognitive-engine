'use client';

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';

export interface SnapshotRow {
  date: string;
  total: number;
}

const money = (v: number) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(v);

/**
 * Real net-worth rows the user recorded. Delete removes that date from
 * finance.net-worth-snapshot storage. An empty list renders nothing —
 * the chart already says there is nothing to show.
 */
export function SnapshotHistory({
  snapshots,
  onDeleted,
}: {
  snapshots: SnapshotRow[];
  onDeleted: () => void;
}) {
  const [busyDate, setBusyDate] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (!snapshots.length) return null;

  async function remove(date: string) {
    if (busyDate) return;
    setBusyDate(date);
    setNote(null);
    try {
      const res = await lensRun<{ deleted?: boolean; date?: string }>('finance', 'net-worth-snapshot-delete', { date });
      if (!res.data?.ok) {
        setNote(res.data?.error || `Snapshot ${date} was not deleted.`);
        return;
      }
      setNote(`Deleted snapshot ${date}.`);
      onDeleted();
    } catch (err) {
      setNote(err instanceof Error ? err.message : `Snapshot ${date} was not deleted.`);
    } finally {
      setBusyDate(null);
    }
  }

  return (
    <ul className="divide-y divide-white/10 rounded-lg border border-white/10" aria-label="Net-worth snapshots">
      {snapshots.map((s) => (
        <li key={s.date} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
          <span className="text-zinc-300">{s.date}</span>
          <span className="tabular-nums text-zinc-100">{money(s.total)}</span>
          <button
            type="button"
            onClick={() => { void remove(s.date); }}
            disabled={busyDate !== null}
            className="text-[12px] text-rose-300 hover:underline disabled:opacity-40"
          >
            {busyDate === s.date ? 'Deleting…' : `Delete ${s.date}`}
          </button>
        </li>
      ))}
      {note && <li className="px-3 py-2 text-[12px] text-zinc-400" role="status">{note}</li>}
    </ul>
  );
}
