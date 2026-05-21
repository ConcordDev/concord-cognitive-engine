'use client';

/**
 * ResourcePanel — deployable resource inventory. Calls crisis.resources
 * to list assets, crisis.resource_upsert to add/edit one, and
 * crisis.resource_deploy to deploy / recall quantities against a crisis.
 */

import { useEffect, useState, useCallback } from 'react';
import { Boxes, Loader2, Plus, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Resource {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  deployed: number;
}
interface ResourcesResult {
  resources: Resource[];
  totals: { total: number; deployed: number; available: number; kinds: number };
}

const CATEGORIES = ['general', 'personnel', 'vehicles', 'medical', 'supplies', 'equipment'];

export function ResourcePanel({ crisisId }: { crisisId?: string }) {
  const [data, setData] = useState<ResourcesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', category: 'general', quantity: 0, unit: 'units' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<ResourcesResult>('crisis', 'resources', {});
    if (r.data?.ok && r.data.result) setData(r.data.result);
    else setData({ resources: [], totals: { total: 0, deployed: 0, available: 0, kinds: 0 } });
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const upsert = useCallback(async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    const r = await lensRun('crisis', 'resource_upsert', {
      name: form.name.trim(),
      category: form.category,
      quantity: Number(form.quantity) || 0,
      unit: form.unit.trim() || 'units',
    });
    if (r.data?.ok) {
      setForm({ name: '', category: 'general', quantity: 0, unit: 'units' });
      setAdding(false);
      await load();
    }
    setBusy(false);
  }, [form, load]);

  const deploy = useCallback(async (resourceId: string, amount: number) => {
    const r = await lensRun('crisis', 'resource_deploy', {
      resourceId, crisisId, amount,
    });
    if (r.data?.ok) await load();
  }, [crisisId, load]);

  return (
    <div className="space-y-3">
      <header className="flex items-center gap-2">
        <Boxes className="h-4 w-4 text-rose-300" />
        <h3 className="text-sm font-semibold text-white">Resource inventory</h3>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="ml-auto flex items-center gap-1 rounded border border-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/5"
        >
          <Plus className="h-3 w-3" /> Add asset
        </button>
      </header>

      {data && (
        <div className="grid grid-cols-3 gap-2 text-center">
          {([
            ['Total', data.totals.total],
            ['Available', data.totals.available],
            ['Deployed', data.totals.deployed],
          ] as const).map(([label, v]) => (
            <div key={label} className="rounded-lg border border-white/10 bg-white/5 p-2">
              <div className="text-lg font-bold text-white tabular-nums">{v}</div>
              <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="space-y-2 rounded-lg border border-rose-500/25 bg-rose-900/10 p-2.5">
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Asset name (e.g. Rescue boat)"
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-white placeholder:text-zinc-600"
          />
          <div className="flex gap-2">
            <select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-white"
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input
              type="number"
              min={0}
              value={form.quantity}
              onChange={(e) => setForm((f) => ({ ...f, quantity: Number(e.target.value) }))}
              placeholder="Qty"
              className="w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-white"
            />
            <input
              value={form.unit}
              onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
              placeholder="unit"
              className="w-24 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-white placeholder:text-zinc-600"
            />
            <button
              type="button"
              disabled={busy || !form.name.trim()}
              onClick={upsert}
              className="rounded bg-rose-600/40 px-2 py-1 text-xs text-rose-100 hover:bg-rose-600/60 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading inventory…
        </div>
      )}

      {!loading && data && data.resources.length === 0 && (
        <p className="rounded border border-white/10 bg-white/5 p-3 text-center text-xs text-zinc-500">
          No resources tracked. Add an asset to start.
        </p>
      )}

      {!loading && data && data.resources.length > 0 && (
        <ul className="space-y-1.5">
          {data.resources.map((res) => {
            const avail = Math.max(0, res.quantity - res.deployed);
            return (
              <li
                key={res.id}
                className="rounded-lg border border-white/10 bg-white/5 p-2.5"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-zinc-100">{res.name}</span>
                      <span className="rounded bg-black/40 px-1 py-0.5 font-mono text-[8px] uppercase text-zinc-400">
                        {res.category}
                      </span>
                    </div>
                    <span className="text-[11px] text-zinc-500">
                      {avail}/{res.quantity} {res.unit} available · {res.deployed} deployed
                    </span>
                  </div>
                  {crisisId && (
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        disabled={avail <= 0}
                        onClick={() => deploy(res.id, 1)}
                        className="flex items-center gap-0.5 rounded bg-emerald-600/30 px-1.5 py-1 text-[10px] text-emerald-200 hover:bg-emerald-600/50 disabled:opacity-30"
                      >
                        <ArrowUpRight className="h-3 w-3" /> Deploy
                      </button>
                      <button
                        type="button"
                        disabled={res.deployed <= 0}
                        onClick={() => deploy(res.id, -1)}
                        className="flex items-center gap-0.5 rounded bg-zinc-700/50 px-1.5 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700 disabled:opacity-30"
                      >
                        <ArrowDownLeft className="h-3 w-3" /> Recall
                      </button>
                    </div>
                  )}
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full bg-amber-500"
                    style={{ width: `${res.quantity ? (res.deployed / res.quantity) * 100 : 0}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
