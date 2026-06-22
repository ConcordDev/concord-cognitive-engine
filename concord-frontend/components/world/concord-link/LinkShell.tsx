'use client';

// Concord Link — Summon shell (B2 Phase 2).
//
// The unified, diegetic "menu" surface: one overlay with a mode state machine
// (Status / Inventory / Effects) reading the real per-world substrate
// (resource-bars, player-inventory, active-effects). Gated by the
// CONCORD_LINK_SYSTEM flag (via useClientConfig) — OFF → renders nothing, so
// today's scattered HUD is untouched, byte-identical. The world keeps ticking
// behind it (no global pause — the Dead-Space rule); safety is where you stand,
// not a freeze.
//
// Opened by the `concordia:concord-link-summon` window event or the `open` prop.

import { useCallback, useEffect, useState } from 'react';
import { useClientConfig } from '@/hooks/useClientConfig';
import { api } from '@/lib/api/client';
import { Activity, Package, Sparkles, X } from 'lucide-react';

type Mode = 'status' | 'inventory' | 'effects';

interface Bars { hp: number; max_hp: number; mana: number; max_mana: number; stamina: number; max_stamina: number; bio_power: number; max_bio_power: number; perception: number; max_perception: number; }
interface InvItem { id: string; item_name: string; quantity: number; quality: number; item_type: string; }
interface Effect { effect_id: string; kind: string; magnitude: number; expires_at: number; }

function Bar({ label, cur, max }: { label: string; cur: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[11px] text-zinc-400"><span>{label}</span><span className="tabular-nums">{Math.round(cur)}/{Math.round(max)}</span></div>
      <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden"><div className="h-full bg-cyan-500/70" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export function LinkShell({ worldId = 'concordia-hub', open: openProp }: { worldId?: string; open?: boolean }) {
  const config = useClientConfig();
  const enabled = !!config.flags.concordLinkSystem;
  const [open, setOpen] = useState(!!openProp);
  const [mode, setMode] = useState<Mode>('status');
  const [bars, setBars] = useState<Bars | null>(null);
  const [items, setItems] = useState<InvItem[]>([]);
  const [effects, setEffects] = useState<Effect[]>([]);

  useEffect(() => { if (openProp !== undefined) setOpen(openProp); }, [openProp]);
  useEffect(() => {
    const onSummon = () => setOpen((o) => !o);
    window.addEventListener('concordia:concord-link-summon', onSummon);
    return () => window.removeEventListener('concordia:concord-link-summon', onSummon);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [rb, inv, eff] = await Promise.all([
        api.get(`/api/worlds/${worldId}/resource-bars`).then((r) => r.data).catch(() => null),
        api.get(`/api/player-inventory`, { params: { worldId } }).then((r) => r.data).catch(() => null),
        api.get(`/api/world/effects/me`).then((r) => r.data).catch(() => null),
      ]);
      if (rb?.ok) setBars(rb.bars || null);
      if (inv?.ok) setItems(inv.items || []);
      if (eff?.ok) setEffects(eff.effects || []);
    } catch { /* best-effort — the shell degrades to whatever loaded */ }
  }, [worldId]);

  useEffect(() => { if (enabled && open) refresh(); }, [enabled, open, refresh]);

  if (!enabled || !open) return null;

  const TABS: { id: Mode; label: string; icon: React.ReactNode }[] = [
    { id: 'status', label: 'Status', icon: <Activity className="w-3.5 h-3.5" /> },
    { id: 'inventory', label: 'Inventory', icon: <Package className="w-3.5 h-3.5" /> },
    { id: 'effects', label: 'Effects', icon: <Sparkles className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-80 max-w-[90vw] bg-zinc-950/95 border-l border-cyan-500/30 backdrop-blur p-4 overflow-y-auto" data-testid="link-shell">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-cyan-300">The Link</h2>
        <button onClick={() => setOpen(false)} aria-label="Close" className="p-1 rounded hover:bg-zinc-800 text-zinc-400"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex gap-1 mb-3">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setMode(t.id)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${mode === t.id ? 'bg-cyan-500/20 text-cyan-300' : 'text-zinc-400 hover:bg-zinc-800'}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {mode === 'status' && (
        <div className="space-y-2" data-testid="link-status">
          {bars ? (
            <>
              <Bar label="Health" cur={bars.hp} max={bars.max_hp} />
              <Bar label="Mana" cur={bars.mana} max={bars.max_mana} />
              <Bar label="Stamina" cur={bars.stamina} max={bars.max_stamina} />
              <Bar label="Bio-power" cur={bars.bio_power} max={bars.max_bio_power} />
              <Bar label="Perception" cur={bars.perception} max={bars.max_perception} />
            </>
          ) : <p className="text-xs text-zinc-400">No vitals yet.</p>}
        </div>
      )}
      {mode === 'inventory' && (
        <ul className="space-y-1" data-testid="link-inventory">
          {items.length ? items.map((it) => (
            <li key={it.id} className="flex justify-between rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1 text-xs">
              <span className="text-zinc-200 truncate">{it.item_name}</span><span className="text-zinc-500">×{it.quantity}</span>
            </li>
          )) : <p className="text-xs text-zinc-400">Empty in this world.</p>}
        </ul>
      )}
      {mode === 'effects' && (
        <ul className="space-y-1" data-testid="link-effects">
          {effects.length ? effects.map((e) => (
            <li key={e.effect_id} className={`rounded border px-2 py-1 text-xs ${e.kind === 'buff' ? 'border-emerald-600/40 text-emerald-300' : 'border-red-600/40 text-red-300'}`}>
              {e.effect_id} <span className="text-zinc-500">×{e.magnitude}</span>
            </li>
          )) : <p className="text-xs text-zinc-400">No active effects.</p>}
        </ul>
      )}
    </div>
  );
}

export default LinkShell;
