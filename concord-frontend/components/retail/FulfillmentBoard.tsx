'use client';

import { useCallback, useEffect, useState } from 'react';
import { PackageCheck, Loader2, ArrowRight, Bell } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface QueueOrder {
  id: string; number: string; total: number; itemCount: number;
  channel: string; buyerName: string | null; fulfillmentStatus: string;
  trackingNumber: string | null; completedAt: string;
}
interface FulfillmentNotification {
  id: string; orderNumber: string; to: string; kind: string; message: string; sentAt: string;
}

const STAGE_COLORS: Record<string, string> = {
  unfulfilled: 'text-gray-400 bg-gray-500/10',
  picking: 'text-amber-300 bg-amber-500/10',
  packed: 'text-cyan-300 bg-cyan-500/10',
  shipped: 'text-blue-300 bg-blue-500/10',
  delivered: 'text-emerald-300 bg-emerald-500/10',
};

/**
 * FulfillmentBoard — order pick/pack/ship workflow. Lists every order
 * not yet delivered, advances each through the fulfillment pipeline,
 * and surfaces buyer notifications recorded on ship/deliver.
 */
export function FulfillmentBoard() {
  const [queue, setQueue] = useState<QueueOrder[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [stages, setStages] = useState<string[]>([]);
  const [notifications, setNotifications] = useState<FulfillmentNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [qRes, nRes] = await Promise.all([
        lensRun('retail', 'fulfillment-queue', {}),
        lensRun('retail', 'fulfillment-notifications', {}),
      ]);
      setQueue((qRes.data?.result?.queue || []) as QueueOrder[]);
      setCounts((qRes.data?.result?.counts || {}) as Record<string, number>);
      setStages((qRes.data?.result?.stages || []) as string[]);
      setNotifications((nRes.data?.result?.notifications || []) as FulfillmentNotification[]);
    } catch (e) { console.error('[Fulfillment] refresh failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function advance(orderId: string) {
    setBusyId(orderId);
    try {
      const r = await lensRun('retail', 'fulfillment-advance', { orderId });
      if (r.data?.ok === false) console.warn('[Fulfillment] advance', r.data.error);
      await refresh();
    } catch (e) { console.error('[Fulfillment] advance failed', e); }
    finally { setBusyId(null); }
  }

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <PackageCheck className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Order fulfillment</span>
        <span className="ml-auto text-[10px] text-gray-400">{queue.length} in queue</span>
      </header>

      {/* Stage counts */}
      {stages.length > 0 && (
        <div className="px-3 py-2 border-b border-white/10 flex flex-wrap gap-2">
          {stages.map(st => (
            <span key={st} className={cn('px-2 py-0.5 text-[10px] rounded font-mono', STAGE_COLORS[st] || 'text-gray-400 bg-gray-500/10')}>
              {st} {counts[st] || 0}
            </span>
          ))}
        </div>
      )}

      <div className="max-h-72 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : queue.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><PackageCheck className="w-6 h-6 mx-auto mb-2 opacity-30" />No orders awaiting fulfillment.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {queue.map(o => (
              <li key={o.id} className="px-3 py-2 hover:bg-white/[0.03] flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-mono">{o.number}</p>
                  <p className="text-[10px] text-gray-400">
                    {o.buyerName || o.channel} · {o.itemCount} items · ${o.total.toFixed(2)}
                    {o.trackingNumber && ` · ${o.trackingNumber}`}
                  </p>
                </div>
                <span className={cn('px-2 py-0.5 text-[10px] rounded font-mono', STAGE_COLORS[o.fulfillmentStatus] || 'text-gray-400 bg-gray-500/10')}>
                  {o.fulfillmentStatus}
                </span>
                {o.fulfillmentStatus !== 'delivered' && (
                  <button onClick={() => advance(o.id)} disabled={busyId === o.id} className="px-2 py-1 text-[10px] rounded bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 inline-flex items-center gap-1 disabled:opacity-40">
                    {busyId === o.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />} Advance
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Notifications */}
      {notifications.length > 0 && (
        <div className="border-t border-white/10 px-3 py-2">
          <p className="text-[10px] uppercase text-gray-400 mb-1 flex items-center gap-1"><Bell className="w-3 h-3" /> Buyer notifications</p>
          <ul className="space-y-1 max-h-28 overflow-y-auto">
            {notifications.slice(0, 8).map(n => (
              <li key={n.id} className="text-[11px] text-gray-400">
                <span className="text-emerald-300">{n.orderNumber}</span> → {n.to}: {n.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default FulfillmentBoard;
