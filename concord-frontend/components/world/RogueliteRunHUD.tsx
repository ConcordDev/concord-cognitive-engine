'use client';

// Phase DB3 — Roguelite run HUD + unlock shop.
//
// RogueliteRunHUD: top-center banner when /api/roguelite/active returns
// a row. Shows depth + meta_currency_earned + region.
// RogueliteUnlockShop: modal (z-50) listing content/roguelite-unlocks.json
// with purchase buttons. Opened via DA4 hotbar "Roguelite" mode or by
// dispatching concordia:open-roguelite-shop.
//
// Wave 4 gap-closure: purchased meta-unlocks (veteran_vigor's starting HP,
// second_chance's revives, etc.) used to compute a correct modifier bundle
// with zero UI ever reading it — GET /api/roguelite/run-modifiers had zero
// frontend callers. This HUD now shows the real numbers from that endpoint,
// adds the missing in-run draft moment ("Descend" — mirrors horde's "Next
// wave"), and reacts to the roguelite:revived realtime event a purchased
// revive fires when it actually saves the player from a death.

import { useCallback, useEffect, useState } from 'react';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useClientConfig } from '@/hooks/useClientConfig';
import { subscribe } from '@/lib/realtime/socket';
import { Dice5, ShoppingCart, X, Coins, HeartPulse } from 'lucide-react';
import { describeModifierBundle, describeBoonEffect, type BoonEffect } from '@/lib/run-boon-format';

interface ActiveRun {
  id: string;
  world_id: string;
  region_id: string;
  started_at: number;
  depth_reached: number;
  hp_bonus_applied?: number;
  revives_remaining?: number;
  draft_picks_available?: number;
}

interface Unlock {
  id: string;
  name: string;
  cost: number;
  description: string;
}

interface DraftBoon { id: string; name: string; effect: BoonEffect; tags?: string[]; }
interface SynergyHint { id: string; name: string; missingBoonId: string; }
interface RevivedPayload { worldId: string; revivesRemaining: number; reviveHp: number; }

export function RogueliteRunHUD() {
  const POLL_MS = useClientConfig().poll.rogueliteMs; // E0 — server-tunable
  const [run, setRun] = useState<ActiveRun | null>(null);
  const [balance, setBalance] = useState(0);
  const [metaModifiers, setMetaModifiers] = useState<Record<string, number> | null>(null);
  const [draftOffering, setDraftOffering] = useState<DraftBoon[]>([]);
  const [synergyHints, setSynergyHints] = useState<SynergyHint[]>([]);
  const [revivedFlash, setRevivedFlash] = useState<RevivedPayload | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [a, b, m] = await Promise.all([
        fetch('/api/roguelite/active', { credentials: 'include' }).then(r => r.ok ? r.json() : null),
        fetch('/api/roguelite/balance', { credentials: 'include' }).then(r => r.ok ? r.json() : null),
        fetch('/api/roguelite/run-modifiers', { credentials: 'include' }).then(r => r.ok ? r.json() : null),
      ]);
      setRun(a?.ok ? (a.run || null) : null);
      setBalance(b?.ok ? Number(b.balance) || 0 : 0);
      setMetaModifiers(m?.ok ? (m.modifiers || null) : null);
    } catch { /* swallow */ }
  }, []);

  useRealtimeRefresh(['roguelite:run-state'], refresh, { backstopMs: POLL_MS * 2 });

  // Wave 4 — a consumed revive is a real backend event, not a client guess.
  // Flash the real numbers the server sent, then refresh the run state.
  useEffect(() => {
    return subscribe<RevivedPayload>('roguelite:revived', (data) => {
      setRevivedFlash(data);
      refresh();
      setTimeout(() => setRevivedFlash(null), 4000);
    });
  }, [refresh]);

  const descend = useCallback(async () => {
    if (!run) return;
    const r = await fetch(`/api/roguelite/run/${run.id}/advance`, {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const j = await r.json();
    if (j?.ok) {
      setDraftOffering(j.draftOffering || []);
      setSynergyHints(j.synergyHints || []);
    }
    refresh();
  }, [run, refresh]);

  const pickBoon = useCallback(async (pickId: string) => {
    if (!run) return;
    await fetch(`/api/roguelite/run/${run.id}/draft-pick`, {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pickId }),
    });
    // Close only once every offered pick has been spent, so a picksAllowed>1
    // round (extra_pick meta-unlock) lets the player keep choosing.
    setDraftOffering((prev) => prev.filter((b) => b.id !== pickId));
    refresh();
  }, [run, refresh]);

  if (!run) return null;

  const ownedUnlockLines = describeModifierBundle(metaModifiers);
  const picksAvailable = run.draft_picks_available || 0;

  return (
    <>
      <div className="concordia-hud-slide-top pointer-events-auto fixed left-1/2 top-3 z-30 -translate-x-1/2 rounded-full border border-violet-500/50 bg-violet-500/15 px-4 py-1.5 text-sm text-violet-100 shadow-xl backdrop-blur">
        <div className="flex items-center gap-3">
          <Dice5 size={14} />
          <span className="font-medium">Roguelite run</span>
          <span className="text-[10px] text-violet-300/70">depth {run.depth_reached} · region {run.region_id.slice(-6)}</span>
          <span className="flex items-center gap-1 text-[10px] text-amber-200">
            <Coins size={10} />
            {balance.toFixed(0)} souls
          </span>
          {(run.revives_remaining ?? 0) > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-rose-300" title="Second Chance revives left">
              <HeartPulse size={10} />
              {run.revives_remaining} revive{run.revives_remaining === 1 ? '' : 's'}
            </span>
          )}
          <button
            onClick={descend}
            className="rounded-full bg-violet-500/30 px-2 py-0.5 text-[10px] text-violet-100 hover:bg-violet-500/40"
          >
            Descend{picksAvailable > 0 ? ` (${picksAvailable} pick${picksAvailable === 1 ? '' : 's'})` : ''}
          </button>
        </div>
        {/* Wave 4 — real owned-meta-unlock effects, from /api/roguelite/run-modifiers
            (previously wired to nothing). */}
        {ownedUnlockLines.length > 0 && (
          <div className="mt-1 flex flex-wrap justify-center gap-x-2 border-t border-violet-500/20 pt-1">
            {ownedUnlockLines.map((line) => (
              <span key={line} className="text-[9px] text-violet-200/80">{line}</span>
            ))}
          </div>
        )}
      </div>

      {/* Revive flash — the exact revivesRemaining/reviveHp the server sent
          on the roguelite:revived realtime event. */}
      {revivedFlash && (
        <div className="pointer-events-none fixed left-1/2 top-16 z-40 -translate-x-1/2 rounded-lg border border-rose-500/50 bg-rose-500/15 px-4 py-2 text-center text-rose-100 shadow-xl backdrop-blur">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <HeartPulse size={14} />
            Second Chance consumed — revived at {revivedFlash.reviveHp} HP
          </div>
          <div className="text-[10px] text-rose-300/80">{revivedFlash.revivesRemaining} revive{revivedFlash.revivesRemaining === 1 ? '' : 's'} remaining</div>
        </div>
      )}

      {/* Draft picker — the in-run boon moment (mirrors horde's wave-clear picker). */}
      {draftOffering.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur">
          <div className="w-full max-w-lg rounded-xl border border-violet-500/40 bg-zinc-950/95 p-4 shadow-2xl">
            <header className="mb-3 flex items-center justify-between border-b border-violet-500/20 pb-2">
              <h2 className="text-sm font-semibold text-violet-200">
                Depth {run.depth_reached} — pick a boon{picksAvailable > 1 ? ` (${picksAvailable} picks left)` : ''}
              </h2>
              <button aria-label="Close" onClick={() => setDraftOffering([])} className="rounded p-1 text-zinc-400 hover:bg-zinc-800"><X size={12} /></button>
            </header>
            <div className="grid grid-cols-3 gap-2">
              {draftOffering.map((b) => {
                const hint = synergyHints.find((h) => h.missingBoonId === b.id);
                return (
                  <button
                    key={b.id}
                    onClick={() => pickBoon(b.id)}
                    className="relative rounded border border-violet-500/30 bg-violet-500/5 p-3 text-left hover:border-violet-500/60 hover:bg-violet-500/15"
                  >
                    <div className="text-sm font-semibold text-violet-100">{b.name}</div>
                    <div className="mt-1 text-[10px] text-violet-300/80">{describeBoonEffect(b.effect)}</div>
                    {hint && (
                      <div className="mt-1 text-[9px] font-semibold text-emerald-300">completes {hint.name}!</div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
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
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur"
      onClick={(e) => { if (e.currentTarget === e.target) setOpen(false); }}
      onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
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
            <li className="py-4 text-center text-[12px] text-zinc-500">No unlocks loaded.</li>
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
