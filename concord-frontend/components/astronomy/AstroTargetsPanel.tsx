'use client';

/**
 * AstroTargetsPanel — observing targets, the built-in Messier catalog
 * and per-target observation logging.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Star, Sparkles, ChevronLeft, Trash2, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Target {
  id: string; name: string; type: string; constellation: string | null;
  magnitude: number | null; observed: boolean; observationCount: number;
}
interface Observation { id: string; date: string; conditions: string | null; notes: string | null; rating: number }
interface CatalogObject { id: string; name: string; type: string; constellation: string; magnitude: number }

const TYPES = ['planet', 'moon', 'star', 'galaxy', 'nebula', 'cluster', 'comet', 'double_star'];

export function AstroTargetsPanel({ onChange }: { onChange: () => void }) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [catalog, setCatalog] = useState<CatalogObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'mine' | 'catalog'>('mine');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'nebula', constellation: '', magnitude: '' });
  const [selected, setSelected] = useState<Target | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [obsForm, setObsForm] = useState({ conditions: '', notes: '', rating: 4 });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [t, c] = await Promise.all([
      lensRun('astronomy', 'target-list', {}),
      lensRun('astronomy', 'catalog-list', {}),
    ]);
    setTargets(t.data?.result?.targets || []);
    setCatalog(c.data?.result?.catalog || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const openTarget = useCallback(async (t: Target) => {
    setSelected(t);
    const r = await lensRun('astronomy', 'target-detail', { id: t.id });
    setObservations(r.data?.result?.observations || []);
  }, []);

  const add = async () => {
    if (!form.name.trim()) { setError('Target name is required.'); return; }
    const r = await lensRun('astronomy', 'target-add', {
      name: form.name.trim(), type: form.type, constellation: form.constellation.trim(),
      magnitude: form.magnitude ? Number(form.magnitude) : undefined,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', type: 'nebula', constellation: '', magnitude: '' });
    setShowAdd(false); setError(null);
    await refresh(); onChange();
  };
  const importCatalog = async (catalogId: string) => {
    await lensRun('astronomy', 'catalog-import', { catalogId });
    await refresh(); onChange();
  };
  const del = async (id: string) => { await lensRun('astronomy', 'target-delete', { id }); await refresh(); onChange(); };
  const logObs = async () => {
    if (!selected) return;
    await lensRun('astronomy', 'observation-log', {
      targetId: selected.id, conditions: obsForm.conditions.trim(),
      notes: obsForm.notes.trim(), rating: obsForm.rating,
    });
    setObsForm({ conditions: '', notes: '', rating: 4 });
    await openTarget(selected);
    await refresh(); onChange();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  // ── Target detail ──
  if (selected) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => setSelected(null)}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
          <ChevronLeft className="w-3.5 h-3.5" /> All targets
        </button>
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
          <h3 className="text-base font-bold text-zinc-100">{selected.name}</h3>
          <p className="text-xs text-zinc-400 capitalize">
            {selected.type.replace(/_/g, ' ')}
            {selected.constellation ? ` · ${selected.constellation}` : ''}
            {selected.magnitude != null ? ` · mag ${selected.magnitude}` : ''}
          </p>
        </div>

        {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <p className="text-xs font-semibold text-zinc-300 mb-2">Log an observation</p>
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="Conditions" value={obsForm.conditions} onChange={(e) => setObsForm({ ...obsForm, conditions: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <select value={obsForm.rating} onChange={(e) => setObsForm({ ...obsForm, rating: Number(e.target.value) })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} star{n > 1 ? 's' : ''}</option>)}
            </select>
            <input placeholder="Notes" value={obsForm.notes} onChange={(e) => setObsForm({ ...obsForm, notes: e.target.value })}
              className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          </div>
          <button type="button" onClick={logObs}
            className="mt-2 px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg">Log observation</button>
        </div>

        {observations.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No observations logged for this target.</p>
        ) : (
          <ul className="space-y-1">
            {observations.map((o) => (
              <li key={o.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star key={n} className={cn('w-3 h-3', n <= o.rating ? 'text-amber-400 fill-amber-400' : 'text-zinc-700')} />
                    ))}
                  </span>
                  <span className="text-[10px] text-zinc-400">{o.date}{o.conditions ? ` · ${o.conditions}` : ''}</span>
                </div>
                {o.notes && <p className="text-[11px] text-zinc-400 mt-0.5">{o.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ── List / catalog ──
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          <button type="button" onClick={() => setView('mine')}
            className={cn('text-[11px] px-2 py-1 rounded-lg', view === 'mine' ? 'bg-indigo-950/40 text-indigo-300' : 'text-zinc-400')}>
            My targets
          </button>
          <button type="button" onClick={() => setView('catalog')}
            className={cn('text-[11px] px-2 py-1 rounded-lg', view === 'catalog' ? 'bg-indigo-950/40 text-indigo-300' : 'text-zinc-400')}>
            Messier catalog
          </button>
        </div>
        {view === 'mine' && (
          <button type="button" onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        )}
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {showAdd && view === 'mine' && (
        <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <input placeholder="Object name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
          <input placeholder="Constellation" value={form.constellation} onChange={(e) => setForm({ ...form, constellation: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Magnitude" inputMode="decimal" value={form.magnitude} onChange={(e) => setForm({ ...form, magnitude: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={add}
            className="col-span-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Add target</button>
        </div>
      )}

      {view === 'catalog' ? (
        <ul className="space-y-1">
          {catalog.map((c) => (
            <li key={c.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
              <div>
                <p className="text-xs text-zinc-200">{c.id} · {c.name}</p>
                <p className="text-[10px] text-zinc-400 capitalize">{c.type} · {c.constellation} · mag {c.magnitude}</p>
              </div>
              <button type="button" onClick={() => importCatalog(c.id)}
                className="text-[11px] px-2 py-0.5 rounded-lg border border-indigo-700/50 bg-indigo-950/40 text-indigo-300">
                + Add
              </button>
            </li>
          ))}
        </ul>
      ) : targets.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No targets. Add one or import from the Messier catalog.
        </div>
      ) : (
        <ul className="space-y-2">
          {targets.map((t) => (
            <li key={t.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <button type="button" onClick={() => openTarget(t)} className="text-left flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-zinc-100">
                    {t.name}
                    {t.observed && <Check className="inline w-3.5 h-3.5 text-emerald-400 ml-1" />}
                  </p>
                  <p className="text-[11px] text-zinc-400 capitalize">
                    {t.type.replace(/_/g, ' ')}{t.constellation ? ` · ${t.constellation}` : ''}
                    {t.observationCount > 0 ? ` · ${t.observationCount} obs` : ''}
                  </p>
                </div>
              </button>
              <button aria-label="Delete" type="button" onClick={() => del(t.id)} className="text-zinc-600 hover:text-rose-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
