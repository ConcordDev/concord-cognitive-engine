'use client';

/**
 * PactNotifications — surfaces expiry / fire / premium-due / handshake
 * notifications from the `insurance.pact-notifications` macro.
 */

import { Bell, AlertTriangle, Clock } from 'lucide-react';
import type { PactNotification } from './types';

interface PactNotificationsProps {
  notifications: PactNotification[];
  unreadHigh: number;
}

const SEVERITY_TONE: Record<PactNotification['severity'], string> = {
  high: 'border-rose-700/40 bg-rose-950/30 text-rose-200',
  medium: 'border-amber-700/40 bg-amber-950/30 text-amber-200',
  low: 'border-zinc-700/40 bg-zinc-900/60 text-zinc-300',
};

function fmt(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString();
}

export function PactNotifications({ notifications, unreadHigh }: PactNotificationsProps) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Bell className="h-4 w-4 text-cyan-400" />
        <h2 className="text-sm font-bold text-zinc-200">Notifications</h2>
        {unreadHigh > 0 && (
          <span className="rounded-full bg-rose-700/70 px-2 py-0.5 text-[10px] font-bold text-white">
            {unreadHigh} urgent
          </span>
        )}
      </div>
      {notifications.length === 0 ? (
        <p className="text-xs italic text-zinc-400">No notifications — nothing expiring or due.</p>
      ) : (
        <ul className="space-y-1.5">
          {notifications.map((n, i) => (
            <li
              key={`${n.pactId}-${n.kind}-${i}`}
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${SEVERITY_TONE[n.severity]}`}
            >
              {n.severity === 'high' ? (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : (
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              )}
              <div className="min-w-0">
                <p>{n.message}</p>
                <p className="mt-0.5 font-mono text-[10px] opacity-70">
                  {n.kind} · {fmt(n.at)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
