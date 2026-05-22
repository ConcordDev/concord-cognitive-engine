'use client';

import { useState } from 'react';
import { Bell, BellRing, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import type { PsyopsNotification } from './types';

/**
 * NotificationBell — surfaces critical-severity alert pages. The backend
 * files a notification whenever a scan produces a critical anomaly; the
 * operator acknowledges them here.
 */
export function NotificationBell({
  notifications,
  unacknowledged,
  onChange,
}: {
  notifications: PsyopsNotification[];
  unacknowledged: number;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const ack = async (notificationId: string) => {
    setBusy(true);
    const r = await lensRun('psyops', 'notification_ack', { notificationId });
    setBusy(false);
    if (r.data?.ok) onChange();
  };

  const ackAll = async () => {
    setBusy(true);
    const r = await lensRun('psyops', 'notification_ack', { all: true });
    setBusy(false);
    if (r.data?.ok) onChange();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 hover:border-zinc-600"
        aria-label="critical alert notifications"
      >
        {unacknowledged > 0 ? <BellRing className="h-4 w-4 text-rose-400" /> : <Bell className="h-4 w-4 text-zinc-400" />}
        Alerts
        {unacknowledged > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-bold text-white">
            {unacknowledged}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-zinc-700 bg-zinc-950 p-3 shadow-xl">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-zinc-100">Critical-alert pages</p>
            {unacknowledged > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void ackAll()}
                className="text-[10px] text-rose-300 hover:text-rose-200 disabled:opacity-50"
              >
                Acknowledge all
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="py-4 text-center text-[11px] italic text-zinc-600">No critical alerts paged.</p>
          ) : (
            <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto">
              {notifications.map((n) => (
                <li
                  key={n.id}
                  className={`rounded-lg border p-2 ${n.acknowledged ? 'border-zinc-800 bg-zinc-900/30 opacity-60' : 'border-rose-700/50 bg-rose-950/30'}`}
                >
                  <p className="text-[11px] text-zinc-200">{n.message}</p>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="font-mono text-[9px] text-zinc-500">{new Date(n.createdAt).toLocaleString()}</span>
                    {!n.acknowledged && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void ack(n.id)}
                        className="flex items-center gap-0.5 rounded bg-rose-800 px-1.5 py-0.5 text-[9px] text-white hover:bg-rose-700 disabled:opacity-50"
                      >
                        <Check className="h-2.5 w-2.5" /> Ack
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
