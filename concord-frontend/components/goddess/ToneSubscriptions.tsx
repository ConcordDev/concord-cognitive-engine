'use client';

/**
 * ToneSubscriptions — subscribe to a goddess tone so a tone change in a
 * world surfaces as a notification. Polls goddess.subscriptions, which
 * marks dispatches seen so each notification fires exactly once.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Bell, BellRing, Loader2, X } from 'lucide-react';
import {
  TONE_COLOR, KNOWN_TONES,
  type Subscription, type SubscriptionNotification,
} from './types';

interface SubsResult {
  subscriptions: Subscription[];
  count: number;
  notifications: SubscriptionNotification[];
  unseenCount: number;
}

export function ToneSubscriptions({
  worldId,
  onOpenDispatch,
}: {
  worldId: string;
  onOpenDispatch: (id: number) => void;
}) {
  const [data, setData] = useState<SubsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickTone, setPickTone] = useState<string>(KNOWN_TONES[0]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun('goddess', 'subscriptions', {});
    if (r.data?.ok) setData(r.data.result as SubsResult);
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => { if (alive) await refresh(); })();
    const interval = window.setInterval(() => { void refresh(); }, 60_000);
    return () => { alive = false; window.clearInterval(interval); };
  }, [refresh]);

  const subscribe = async () => {
    setError(null);
    const r = await lensRun('goddess', 'subscribe', { tone: pickTone, worldId });
    if (r.data?.ok) await refresh();
    else setError(r.data?.error || 'Could not subscribe.');
  };

  const unsubscribe = async (id: string) => {
    const r = await lensRun('goddess', 'unsubscribe', { subscriptionId: id });
    if (r.data?.ok) await refresh();
  };

  return (
    <div className="space-y-3">
      <header className="flex items-center gap-2">
        {data && data.unseenCount > 0
          ? <BellRing className="h-4 w-4 text-amber-400" />
          : <Bell className="h-4 w-4 text-zinc-400" />}
        <h2 className="text-sm font-semibold text-zinc-100">Tone alerts</h2>
        {data && data.unseenCount > 0 && (
          <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
            {data.unseenCount} new
          </span>
        )}
      </header>

      <div className="flex items-center gap-2">
        <select
          value={pickTone} onChange={(e) => setPickTone(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200"
        >
          {KNOWN_TONES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button
          type="button" onClick={subscribe}
          className="rounded bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/30"
        >
          Notify me on {pickTone}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading subscriptions…
        </div>
      ) : (
        <>
          {data && data.subscriptions.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {data.subscriptions.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-[11px] text-zinc-300"
                >
                  <span className="capitalize">{s.tone}</span>
                  <span className="font-mono text-[9px] text-zinc-500">{s.worldId}</span>
                  <button
                    type="button" onClick={() => unsubscribe(s.id)}
                    aria-label={`Unsubscribe from ${s.tone}`}
                    className="text-zinc-500 hover:text-red-400"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-zinc-600 italic">
              No tone alerts set. Subscribe above to be notified when the goddess shifts tone.
            </p>
          )}

          {data && data.notifications.length > 0 && (
            <div className="space-y-1.5 border-t border-zinc-800 pt-2">
              <p className="text-[11px] uppercase tracking-wider text-amber-400">New since last visit</p>
              {data.notifications.map((n) => (
                <button
                  key={n.id} type="button" onClick={() => onOpenDispatch(n.id)}
                  className={`block w-full border-l-4 rounded-r-lg px-3 py-1.5 text-left ${
                    TONE_COLOR[n.tone] || TONE_COLOR.neutral
                  }`}
                >
                  <p className="text-xs italic leading-snug">{n.body}</p>
                  <p className="mt-0.5 font-mono text-[10px] opacity-70">
                    {n.tone} · {new Date(n.composed_at * 1000).toLocaleString()}
                  </p>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
