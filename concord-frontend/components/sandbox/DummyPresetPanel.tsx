'use client';

/**
 * DummyPresetPanel — pick a dummy behavior preset (static / idle / defensive /
 * aggressive) and HP/count, then save it as a named per-user config through
 * the sandbox domain. Applying a preset reconfigures the arena dummies so
 * combat-feel can be tuned against something other than a static target.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Target, Save, Trash2, Loader2 } from 'lucide-react';

interface BehaviorDef {
  id: string;
  label: string;
  blockChance: number;
  moveSpeed: number;
  counterAttack: boolean;
  blurb: string;
}
interface DummyConfig {
  id: string;
  name: string;
  behaviorId: string;
  hp: number;
  count: number;
  createdAt: string;
}

export interface AppliedDummyConfig {
  behaviorId: string;
  hp: number;
  count: number;
}

export function DummyPresetPanel({ onApply }: { onApply: (c: AppliedDummyConfig) => void }) {
  const [behaviors, setBehaviors] = useState<BehaviorDef[]>([]);
  const [behaviorId, setBehaviorId] = useState('static');
  const [hp, setHp] = useState(100);
  const [count, setCount] = useState(3);
  const [name, setName] = useState('');
  const [saved, setSaved] = useState<DummyConfig[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await lensRun('sandbox', 'listDummyConfigs', {});
    if (r.data?.ok && r.data.result) setSaved((r.data.result.dummyConfigs as DummyConfig[]) || []);
  }, []);

  useEffect(() => {
    (async () => {
      const c = await lensRun('sandbox', 'catalog', {});
      if (c.data?.ok && c.data.result) {
        const bs = (c.data.result.behaviors as BehaviorDef[]) || [];
        setBehaviors(bs);
        if (bs[0]) setBehaviorId(bs[0].id);
      }
      await refresh();
    })();
  }, [refresh]);

  const selected = behaviors.find((b) => b.id === behaviorId);

  const apply = useCallback(() => {
    onApply({ behaviorId, hp, count });
  }, [onApply, behaviorId, hp, count]);

  const save = async () => {
    setBusy(true);
    try {
      const r = await lensRun('sandbox', 'saveDummyConfig', {
        behaviorId,
        hp,
        count,
        name: name.trim(),
      });
      if (r.data?.ok) {
        setName('');
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const loadSaved = (c: DummyConfig) => {
    setBehaviorId(c.behaviorId);
    setHp(c.hp);
    setCount(c.count);
    onApply({ behaviorId: c.behaviorId, hp: c.hp, count: c.count });
  };

  const remove = async (id: string) => {
    await lensRun('sandbox', 'deleteDummyConfig', { configId: id });
    await refresh();
  };

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-900/80 p-3 text-xs">
      <div className="mb-2 flex items-center gap-1.5 font-semibold uppercase tracking-wide text-amber-200">
        <Target className="h-3.5 w-3.5" /> Dummy Behavior
      </div>

      <label className="mb-1 block text-[10px] uppercase text-slate-400" htmlFor="sb-behavior">Preset</label>
      <select
        id="sb-behavior"
        value={behaviorId}
        onChange={(e) => setBehaviorId(e.target.value)}
        className="mb-1.5 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
      >
        {behaviors.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
      </select>
      {selected && (
        <div className="mb-2 rounded bg-slate-800/40 px-2 py-1 text-[10px] text-slate-400">
          {selected.blurb}
          <div className="mt-0.5 tabular-nums text-slate-500">
            block {Math.round(selected.blockChance * 100)}% · speed {selected.moveSpeed} · {selected.counterAttack ? 'counters' : 'no counter'}
          </div>
        </div>
      )}

      <div className="mb-2 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase text-slate-400">HP each</span>
          <input
            type="number" min={1} max={100000} value={hp}
            onChange={(e) => setHp(Math.max(1, Math.min(100000, Math.round(Number(e.target.value) || 1))))}
            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 tabular-nums text-slate-100"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase text-slate-400">Count</span>
          <input
            type="number" min={1} max={10} value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(10, Math.round(Number(e.target.value) || 1))))}
            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 tabular-nums text-slate-100"
          />
        </label>
      </div>

      <button
        onClick={apply}
        className="mb-2 w-full rounded bg-amber-600 px-2 py-1 font-semibold text-amber-50 hover:bg-amber-500"
      >
        Apply to arena
      </button>

      <div className="mb-2 flex gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Preset name"
          className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 placeholder:text-slate-600"
        />
        <button
          onClick={save}
          disabled={busy}
          className="flex items-center gap-1 rounded bg-slate-700 px-2 py-1 hover:bg-slate-600 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
        </button>
      </div>

      {saved.length === 0 ? (
        <div className="rounded border border-dashed border-slate-700 px-2 py-2 text-center text-[10px] text-slate-500">
          No saved dummy presets yet.
        </div>
      ) : (
        <ul className="space-y-1">
          {saved.map((c) => (
            <li key={c.id} className="flex items-center gap-1.5 rounded bg-slate-800/60 px-2 py-1">
              <button onClick={() => loadSaved(c)} className="min-w-0 flex-1 text-left hover:text-amber-200">
                <div className="truncate text-slate-200">{c.name}</div>
                <div className="text-[9px] text-slate-500">{c.behaviorId} · {c.count}× {c.hp} HP</div>
              </button>
              <button onClick={() => remove(c.id)} aria-label="Delete dummy preset" className="text-slate-500 hover:text-rose-400">
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
