'use client';

// Phase DB3 — Roguelite run HUD + unlock shop.
//
// RogueliteRunHUD: top-center banner when /api/roguelite/active returns
// a row. Shows depth + meta_currency_earned + region.
// RogueliteUnlockShop: modal (z-50) listing content/roguelite-unlocks.json
// with purchase buttons. Opened via DA4 hotbar "Roguelite" mode or by
// dispatching concordia:open-roguelite-shop.

import { useCallback, useEffect, useState } from 'react';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useClientConfig } from '@/hooks/useClientConfig';
import { Dice5, ShoppingCart, X, Coins } from 'lucide-react';

interface ActiveRun {
  id: string;
  world_id: string;
  region_id: string;
  started_at: number;
  depth_reached: number;
}

interface Unlock {
  id: string;
  name: string;
  cost: number;
  description: string;
}

export function RogueliteRunHUD() {
  const POLL_MS = useClientConfig().poll.rogueliteMs; // E0 — server-tunable
  const [run, setRun] = useState<ActiveRun | null>(null);
  const [balance, setBalance] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        fetch('/api/roguelite/active', { credentials: 'include' }).then(r => r.ok ? r.json() : null),
        fetch('/api/roguelite/balance', { credentials: 'include' }).then(r => r.ok ? r.json() : null),
      ]);
      setRun(a?.ok ? (a.run || null) : null);
      setBalance(b?.ok ? Number(b.balance) || 0 : 0);
    } catch { /* swallow */ }
  }, []);

  useRealtimeRefresh(['roguelite:run-state'], refresh, { backstopMs: POLL_MS * 2 });

  if (!run) return null;

  return (
    <div className="concordia-hud-slide-top pointer-events-auto fixed left-1/2 top-3 z-30 -translate-x-1/2 rounded-full border border-violet-500/50 bg-violet-500/15 px-4 py-1.5 text-sm text-violet-100 shadow-xl backdrop-blur">
      <div className="flex items-center gap-3">
        <Dice5 size={14} />
        <span className="font-medium">Roguelite run</span>
        <span className="text-[10px] text-violet-300/70">depth {run.depth_reached} · region {run.region_id.slice(-6)}</span>
        <span className="flex items-center gap-1 text-[10px] text-amber-200">
          <Coins size={10} />
          {balance.toFixed(0)} souls
        </span>
      </div>
    </div>
  );
}

export function RogueliteUnlockShop() {
  const [open, setOpen] = useState(false);
  const [unlocks, setUnlocks] = useState<Unlock[]>([]);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [balance, setBalance] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    function onOpen() { setOpen(true); }
    window.addEventListener('concordia:open-roguelite-shop', onOpen);
    return () => window.removeEventListener('concordia:open-roguelite-shop', onOpen);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [cat, own, bal] = await Promise.all([
        fetch('/api/roguelite/catalog').then(r => r.ok ? r.json() : null),
        fetch('/api/roguelite/unlocks', { credentials: 'include' }).then(r => r.ok ? r.json() : null),
        fetch('/api/roguelite/balance', { credentials: 'include' }).then(r => r.ok ? r.json() : null),
      ]);
      if (cat?.ok || Array.isArray(cat)) setUnlocks(Array.isArray(cat) ? cat : (cat.unlocks || []));
      if (own?.ok) setOwned(new Set((own.unlocks || []).map((u: { unlock_id: string }) => u.unlock_id)));
      if (bal?.ok) setBalance(Number(bal.balance) || 0);
    } catch { /* swallow */ }
  }, []);

  useEffect(() => { if (open) refresh(); }, [open, refresh]);

  const buy = useCallback(async (u: Unlock) => {
    setBusy(u.id);
    try {
      const r = await fetch('/api/roguelite/unlock', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ unlockId: u.id, costCc: u.cost }),
      });
      const j = await r.json();
      setFlash(j?.ok ? `Unlocked: ${u.name}` : (j?.error || 'purchase failed'));
      setTimeout(() => setFlash(null), 2500);
      if (j?.ok) refresh();
    } finally { setBusy(null); }
  }, [refresh]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur"
      onClick={(e) => { if (e.currentTarget === e.target) setOpen(false); }}
    >
      <div className="w-full max-w-xl rounded-xl border border-violet-500/40 bg-zinc-950/95 p-4 shadow-2xl">
        <header className="mb-3 flex items-center justify-between border-b border-zinc-800 pb-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-violet-200">
            <ShoppingCart size={14} />
            Soul vault — {balance.toFixed(0)} souls
          </h2>
          <button aria-label="Open" onClick={() => setOpen(false)} className="rounded p-1 text-zinc-400 hover:bg-zinc-800"><X size={12} /></button>
        </header>
        {flash && <div className="mb-2 rounded bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200">{flash}</div>}
        <ul className="space-y-2">
          {unlocks.length === 0 && (
            <li className="py-4 text-center text-[12px] text-zinc-400">No unlocks loaded.</li>
          )}
          {unlocks.map((u) => {
            const isOwned = owned.has(u.id);
            const canAfford = balance >= u.cost;
            return (
              <li key={u.id} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/60 p-2">
                <div>
                  <div className={`text-sm font-medium ${isOwned ? 'text-emerald-200' : 'text-violet-100'}`}>{u.name}</div>
                  <div className="text-[11px] text-zinc-400">{u.description}</div>
                </div>
                <button
                  disabled={isOwned || !canAfford || busy === u.id}
                  onClick={() => buy(u)}
                  className={`rounded border px-3 py-1 text-[11px] ${
                    isOwned ? 'border-emerald-500/40 text-emerald-200' :
                    !canAfford ? 'border-zinc-700 text-zinc-500' :
                    'border-violet-500/40 bg-violet-500/20 text-violet-100 hover:bg-violet-500/30'
                  }`}
                >
                  {isOwned ? 'Owned' : `${u.cost} souls`}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
