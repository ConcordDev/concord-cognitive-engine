'use client';

/**
 * SurvivalKit — per-expedition survival kit checklist via
 * desert.kitSave / kitList / kitToggleItem / kitDelete. A baseline kit
 * is generated server-side scaled to team size + trip length.
 */

import { useState, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Plus, Trash2, Backpack, CheckCircle2, Circle, AlertTriangle } from 'lucide-react';

interface KitItem {
  id: string;
  category: string;
  item: string;
  qty: number;
  unit: string;
  critical: boolean;
  packed: boolean;
}

interface KitStats {
  total: number;
  packed: number;
  unpacked: number;
  packedPercent: number;
  criticalTotal: number;
  criticalPacked: number;
  criticalMissing: number;
  ready: boolean;
}

interface Kit {
  id: string;
  name: string;
  teamSize: number;
  days: number;
  items: KitItem[];
  stats: KitStats;
  updatedAt: string;
}

export function SurvivalKit() {
  const [kits, setKits] = useState<Kit[]>([]);
  const [name, setName] = useState('');
  const [teamSize, setTeamSize] = useState('2');
  const [days, setDays] = useState('3');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await lensRun<{ kits: Kit[] }>('desert', 'kitList', {});
    if (r.data?.ok && r.data.result) {
      setKits(r.data.result.kits);
      if (!activeId && r.data.result.kits.length) setActiveId(r.data.result.kits[0].id);
    }
  }, [activeId]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = useCallback(async () => {
    setErr(null);
    setBusy(true);
    const r = await lensRun<Kit>('desert', 'kitSave', {
      name: name || 'Expedition kit',
      teamSize: Number(teamSize) || 1,
      days: Number(days) || 1,
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      setName('');
      setActiveId(r.data.result.id);
      load();
    } else {
      setErr(r.data?.error || 'Create failed');
    }
  }, [name, teamSize, days, load]);

  const toggle = useCallback(
    async (kitId: string, itemId: string) => {
      const r = await lensRun<Kit>('desert', 'kitToggleItem', { id: kitId, itemId });
      if (r.data?.ok && r.data.result) {
        const updated = r.data.result;
        setKits((ks) => ks.map((k) => (k.id === updated.id ? updated : k)));
      }
    },
    [],
  );

  const remove = useCallback(
    async (id: string) => {
      await lensRun('desert', 'kitDelete', { id });
      if (activeId === id) setActiveId(null);
      load();
    },
    [activeId, load],
  );

  const active = kits.find((k) => k.id === activeId) || null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Backpack className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">Survival kit checklist</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Kit name"
            className="flex-1 min-w-[140px] rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          />
          <input
            value={teamSize}
            onChange={(e) => setTeamSize(e.target.value)}
            type="number"
            min={1}
            placeholder="Team"
            className="w-20 rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          />
          <input
            value={days}
            onChange={(e) => setDays(e.target.value)}
            type="number"
            min={1}
            placeholder="Days"
            className="w-20 rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-sm text-white"
          />
          <button
            onClick={create}
            disabled={busy}
            className="flex items-center gap-1 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-2.5 py-1.5 text-xs text-white"
          >
            <Plus className="h-3.5 w-3.5" /> Generate kit
          </button>
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        {kits.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {kits.map((k) => (
              <button
                key={k.id}
                onClick={() => setActiveId(k.id)}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs ${
                  activeId === k.id ? 'bg-zinc-700 text-white' : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {k.name}
                <span className="font-mono">{k.stats.packedPercent}%</span>
                {k.stats.ready && <CheckCircle2 className="h-3 w-3 text-green-400" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {active && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-white">
              {active.name} · {active.teamSize} pax · {active.days} d
            </span>
            <button onClick={() => remove(active.id)} className="p-1 text-zinc-400 hover:text-red-400" aria-label="Delete kit">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full bg-amber-500" style={{ width: `${active.stats.packedPercent}%` }} />
            </div>
            <span className="font-mono text-white">
              {active.stats.packed}/{active.stats.total}
            </span>
            {active.stats.criticalMissing > 0 ? (
              <span className="flex items-center gap-1 text-red-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                {active.stats.criticalMissing} critical missing
              </span>
            ) : (
              <span className="flex items-center gap-1 text-green-400">
                <CheckCircle2 className="h-3.5 w-3.5" /> ready
              </span>
            )}
          </div>
          <div className="space-y-1">
            {active.items.map((it) => (
              <button
                key={it.id}
                onClick={() => toggle(active.id, it.id)}
                className="flex w-full items-center gap-2 rounded bg-zinc-950 border border-zinc-800 px-3 py-1.5 text-left hover:border-zinc-700"
              >
                {it.packed ? (
                  <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-zinc-600 shrink-0" />
                )}
                <span className={`text-sm ${it.packed ? 'text-zinc-400 line-through' : 'text-white'}`}>{it.item}</span>
                {it.critical && (
                  <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-300">critical</span>
                )}
                <span className="ml-auto font-mono text-xs text-zinc-400">
                  {it.qty} {it.unit}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-zinc-400">{it.category}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {kits.length === 0 && <p className="text-center text-sm text-zinc-400 py-6">No kits yet — generate one above.</p>}
    </div>
  );
}
