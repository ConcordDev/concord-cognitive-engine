'use client';

// Phase DB6 — Restaurant order dashboard.
// Pending orders with expiry countdowns; serve button calls /api/restaurant/order/:id/serve.
// Revenue + tips ledger at top.

import { useCallback, useEffect, useState } from 'react';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useClientConfig } from '@/hooks/useClientConfig';
import { ChefHat, Clock, AlertTriangle, Loader2 } from 'lucide-react';
import { StationOverlayShell } from './_StationOverlayShell';
import type { OverlayProps } from './StationInteractionRouter';
import { successJuice } from '@/lib/concordia/juice';
import { playActionAtPlayer } from '@/lib/concordia/play-action';

interface Order {
  id: string;
  dish_id: string;
  customer_npc_id: string;
  expires_at: number;
  status: string;
  ordered_at: number;
}
interface Summary {
  id: string;
  name?: string;
  revenue_cc?: number;
  tips_cc?: number;
  orders_served?: number;
  orders_missed?: number;
}

export function RestaurantDashboard({ building, onClose, worldId }: OverlayProps) {
  // E0 — server-tunable backstop cadence (was a hardcoded 2000).
  const POLL_MS = useClientConfig().poll.restaurantMs;
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [combo, setCombo] = useState(0); // E5 — batching-combo flash

  const refresh = useCallback(async () => {
    try {
      const j = await fetch(`/api/restaurant/building/${building.id}`, { credentials: 'include' }).then(r => r.json());
      if (j?.ok) {
        setRestaurantId(j.restaurant?.id || null);
        setSummary(j.summary || null);
        setOrders(j.pending || []);
      }
    } catch { /* swallow */ }
  }, [building.id]);

  // Push: order/tip state on socket events; backstop poll covers gaps.
  useRealtimeRefresh(['restaurant:state'], refresh, { backstopMs: POLL_MS });
  // Local clock for order-timer rendering (not a network poll — kept as-is).
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 500);
    return () => clearInterval(t);
  }, []);

  const serve = useCallback(async (orderId: string) => {
    setPending(true);
    try {
      const r = await fetch(`/api/restaurant/order/${orderId}/serve`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' }, body: '{}',
      });
      const j = await r.json().catch(() => null);
      if (j?.ok !== false) {
        playActionAtPlayer('serve');
        successJuice('ui_dish_serve');
        // E5 — flash the batching combo on a rush.
        if (typeof j?.combo === 'number' && j.combo >= 2) {
          setCombo(j.combo);
          setTimeout(() => setCombo(0), 1500);
        }
      }
      refresh();
    } finally { setPending(false); }
  }, [refresh]);

  if (!restaurantId) {
    return (
      <StationOverlayShell
        title={building.name || 'Restaurant'}
        subtitle={`restaurant · ${worldId}`}
        onClose={onClose}
        accent="amber"
        size="lg"
      >
        <p className="py-6 text-center text-zinc-500 text-sm">Restaurant not open at this building. Only the owner can run service here.</p>
      </StationOverlayShell>
    );
  }

  return (
    <StationOverlayShell
      title={summary?.name || building.name || 'Restaurant'}
      subtitle={`restaurant · ${worldId}`}
      onClose={onClose}
      accent="amber"
      size="lg"
    >
      <div className="space-y-3">
        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="rounded bg-amber-950/30 p-2">
            <div className="text-[9px] uppercase tracking-wider text-amber-300/70">revenue</div>
            <div className="font-mono text-base text-amber-100">{summary?.revenue_cc ?? 0} cc</div>
          </div>
          <div className="rounded bg-amber-950/30 p-2">
            <div className="text-[9px] uppercase tracking-wider text-amber-300/70">tips</div>
            <div className="font-mono text-base text-amber-100">{summary?.tips_cc ?? 0} cc</div>
          </div>
          <div className="rounded bg-amber-950/30 p-2">
            <div className="text-[9px] uppercase tracking-wider text-amber-300/70">served</div>
            <div className="font-mono text-base text-amber-100">{summary?.orders_served ?? 0}</div>
          </div>
          <div className="rounded bg-amber-950/30 p-2">
            <div className="text-[9px] uppercase tracking-wider text-amber-300/70">missed</div>
            <div className="font-mono text-base text-red-300">{summary?.orders_missed ?? 0}</div>
          </div>
        </div>

        {combo >= 2 && (
          <div className="concordia-hud-fade mb-2 rounded-md border border-orange-400/60 bg-orange-900/40 px-3 py-1 text-center text-sm font-bold text-orange-100">
            🔥 ×{combo} combo! bigger tips
          </div>
        )}

        <div className="space-y-1.5">
          {orders.length === 0 && (
            <div className="rounded border border-zinc-800 bg-zinc-900/50 p-4 text-center text-xs text-zinc-500">
              <ChefHat className="mx-auto mb-1 opacity-40" size={20} />
              no pending orders — service is quiet
            </div>
          )}
          {orders.map((o) => {
            const remaining = Math.max(0, o.expires_at - now);
            const orderedAgo = now - (o.ordered_at || now);
            const urgent = remaining < 60;
            const fastTip = orderedAgo <= 30;
            return (
              <div
                key={o.id}
                className={[
                  'flex items-center justify-between rounded border p-2 text-xs',
                  urgent ? 'border-red-500/50 bg-red-950/30' : 'border-amber-500/30 bg-amber-950/20',
                ].join(' ')}
              >
                <div>
                  <div className="font-mono text-sm text-amber-100">{o.dish_id}</div>
                  <div className="text-[10px] text-amber-300/60">
                    customer: {o.customer_npc_id.slice(0, 14)}…
                    {fastTip && <span className="ml-2 text-emerald-300">⚡ fast-tip window</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className={['flex items-center gap-1 font-mono text-sm', urgent ? 'text-red-300' : 'text-amber-200'].join(' ')}>
                    {urgent ? <AlertTriangle size={12} /> : <Clock size={12} />}
                    {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
                  </div>
                  <button
                    onClick={() => serve(o.id)}
                    disabled={pending}
                    className="rounded bg-amber-500/30 px-2 py-1 text-[11px] text-amber-100 hover:bg-amber-500/50 disabled:opacity-50"
                  >
                    {pending ? <Loader2 className="animate-spin" size={11} /> : 'serve'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </StationOverlayShell>
  );
}
