'use client';

/**
 * MaterialShortlist — Granta MI-shape material selection: shortlist
 * candidate materials with key properties, then compare them side by
 * side with the best pick highlighted per property. Wires the
 * materials.shortlist-* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Layers, Plus, Trash2, Loader2, Trophy } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Material {
  id: string; name: string; formula: string | null; category: string;
  properties: Record<string, number | null>;
}
interface CompareRow { property: string; key: string; values: { id: string; name: string; value: number }[]; best: string | null }
interface Comparison { materials: { id: string; name: string }[]; comparison: CompareRow[] }

const FIELDS = [
  { key: 'density', label: 'Density' },
  { key: 'tensileStrengthMPa', label: 'Tensile (MPa)' },
  { key: 'meltingPointC', label: 'Melt (°C)' },
  { key: 'youngsModulusGPa', label: 'Modulus (GPa)' },
  { key: 'costPerKg', label: '$/kg' },
];

export function MaterialShortlist() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Record<string, string>>({ name: '', category: '', density: '', tensileStrengthMPa: '', meltingPointC: '', youngsModulusGPa: '', costPerKg: '' });

  const refresh = useCallback(async () => {
    const r = await lensRun('materials', 'shortlist-list', {});
    setMaterials((r.data?.result?.materials as Material[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function add() {
    if (!form.name.trim()) return;
    const input: Record<string, unknown> = { name: form.name.trim(), category: form.category.trim() || 'general' };
    for (const f of FIELDS) if (form[f.key]) input[f.key] = Number(form[f.key]);
    await lensRun('materials', 'shortlist-add', input);
    setForm({ name: '', category: '', density: '', tensileStrengthMPa: '', meltingPointC: '', youngsModulusGPa: '', costPerKg: '' });
    setComparison(null);
    await refresh();
  }
  async function remove(id: string) {
    await lensRun('materials', 'shortlist-remove', { id });
    setComparison(null);
    await refresh();
  }
  async function compare() {
    const r = await lensRun('materials', 'shortlist-compare', {});
    if (r.data?.ok) setComparison(r.data.result as Comparison);
    else alert(r.data?.error || 'Need 2+ materials.');
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Layers className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-bold text-zinc-100">Material Shortlist</h3>
        <span className="text-[11px] text-zinc-400">Granta MI shape</span>
        <button onClick={compare} disabled={materials.length < 2}
          className="ml-auto px-2.5 py-1 text-xs rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-40">Compare</button>
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3 flex flex-wrap gap-1.5">
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Material name"
          className="flex-1 min-w-[120px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="category"
          className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        {FIELDS.map(f => (
          <input key={f.key} value={form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })} placeholder={f.label}
            className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        ))}
        <button onClick={add} disabled={!form.name.trim()}
          className="px-2.5 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />Add
        </button>
      </div>

      {materials.length === 0 ? (
        <p className="text-xs text-zinc-400 italic">No materials shortlisted — add candidates above or from MP search.</p>
      ) : comparison ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-400 text-left">
                <th className="py-1 pr-2">Property</th>
                {comparison.materials.map(m => <th key={m.id} className="py-1 px-2">{m.name}</th>)}
                <th className="py-1 pl-2">Best</th>
              </tr>
            </thead>
            <tbody>
              {comparison.comparison.map(row => (
                <tr key={row.key} className="border-t border-zinc-800">
                  <td className="py-1 pr-2 text-zinc-400">{row.property}</td>
                  {comparison.materials.map(m => {
                    const v = row.values.find(x => x.id === m.id);
                    return (
                      <td key={m.id} className={cn('py-1 px-2', row.best === m.name ? 'text-emerald-300 font-semibold' : 'text-zinc-300')}>
                        {v ? v.value : '—'}
                      </td>
                    );
                  })}
                  <td className="py-1 pl-2 text-emerald-400 inline-flex items-center gap-1">
                    {row.best && <Trophy className="w-3 h-3" />}{row.best || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={() => setComparison(null)} className="mt-2 text-[11px] text-zinc-400 hover:text-zinc-300">← back to list</button>
        </div>
      ) : (
        <ul className="space-y-1">
          {materials.map(m => (
            <li key={m.id} className="group flex items-center gap-2 bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-1.5">
              <span className="text-xs font-semibold text-zinc-100">{m.name}</span>
              {m.formula && <span className="text-[10px] font-mono text-zinc-400">{m.formula}</span>}
              <span className="text-[9px] px-1 rounded bg-cyan-900/40 text-cyan-300">{m.category}</span>
              <span className="text-[10px] text-zinc-400 ml-auto">
                {FIELDS.filter(f => m.properties[f.key] != null).map(f => `${f.label} ${m.properties[f.key]}`).join(' · ')}
              </span>
              <button aria-label="Delete" onClick={() => remove(m.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
