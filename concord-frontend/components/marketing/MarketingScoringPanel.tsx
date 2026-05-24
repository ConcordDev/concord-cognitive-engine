'use client';

/**
 * MarketingScoringPanel — configurable lead-scoring model editor.
 * Wires: scoring-model-save, scoring-model-list, scoring-model-delete,
 * scoring-model-apply, lead-list.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, SlidersHorizontal, Trash2, X, Target } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ScoringRule { signal: string; points: number }
interface ScoringModel {
  id: string; name: string; rules: ScoringRule[]; ruleCount: number;
  threshold: number; maxScore: number;
}
interface Lead { id: string; name: string; email: string | null; stage: string; score: number }
interface ApplyResult {
  leadId: string; score: number; grade: string; qualified: boolean;
  threshold: number; breakdown: { signal: string; count: number; points: number; contributed: number }[];
}

export function MarketingScoringPanel() {
  const [models, setModels] = useState<ScoringModel[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ScoringModel | null>(null);
  const [fName, setFName] = useState('');
  const [fThreshold, setFThreshold] = useState('50');
  const [fRules, setFRules] = useState<ScoringRule[]>([]);

  const [applyModel, setApplyModel] = useState<ScoringModel | null>(null);
  const [applyLead, setApplyLead] = useState('');
  const [applySignals, setApplySignals] = useState<Record<string, string>>({});
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [m, l] = await Promise.all([
      lensRun('marketing', 'scoring-model-list', {}),
      lensRun('marketing', 'lead-list', {}),
    ]);
    setModels(m.data?.result?.models || []);
    setLeads(l.data?.result?.leads || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const openCreate = () => {
    setEditing(null); setCreating(true);
    setFName(''); setFThreshold('50'); setFRules([{ signal: '', points: 10 }]);
  };
  const openEdit = (m: ScoringModel) => {
    setEditing(m); setCreating(true);
    setFName(m.name); setFThreshold(String(m.threshold));
    setFRules(m.rules.map((r) => ({ ...r })));
  };

  const addRule = () => setFRules((r) => [...r, { signal: '', points: 10 }]);
  const updateRule = (i: number, patch: Partial<ScoringRule>) =>
    setFRules((r) => r.map((rl, idx) => (idx === i ? { ...rl, ...patch } : rl)));
  const removeRule = (i: number) => setFRules((r) => r.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!fName.trim()) { setError('Model name is required.'); return; }
    const cleanRules = fRules.filter((r) => r.signal.trim());
    if (cleanRules.length === 0) { setError('Add at least one rule.'); return; }
    setBusy(true); setError(null);
    const payload = {
      name: fName.trim(), threshold: Number(fThreshold) || 0,
      rules: cleanRules.map((r) => ({ signal: r.signal.trim(), points: r.points })),
    };
    const r = editing
      ? await lensRun('marketing', 'scoring-model-save', { id: editing.id, ...payload })
      : await lensRun('marketing', 'scoring-model-save', payload);
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setCreating(false);
    await refresh();
  };

  const del = async (id: string) => {
    const r = await lensRun('marketing', 'scoring-model-delete', { id });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    await refresh();
  };

  const openApply = (m: ScoringModel) => {
    setApplyModel(m); setApplyResult(null); setApplyLead('');
    const init: Record<string, string> = {};
    for (const rl of m.rules) init[rl.signal] = '';
    setApplySignals(init);
  };

  const runApply = async () => {
    if (!applyModel || !applyLead) { setError('Select a lead.'); return; }
    setBusy(true); setError(null);
    const signals: Record<string, number> = {};
    for (const [k, v] of Object.entries(applySignals)) signals[k] = Number(v) || 0;
    const r = await lensRun('marketing', 'scoring-model-apply', {
      modelId: applyModel.id, leadId: applyLead, signals,
    });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Apply failed'); return; }
    setApplyResult(r.data?.result || null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
          <SlidersHorizontal className="w-3.5 h-3.5 text-orange-400" /> Lead scoring models
        </h3>
        <button type="button" onClick={openCreate}
          className="flex items-center gap-1 bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium rounded-lg px-3 py-1.5">
          <Plus className="w-3.5 h-3.5" /> New model
        </button>
      </div>

      {models.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic">No scoring models. Define rules mapping signals to points.</p>
      ) : (
        <ul className="space-y-2">
          {models.map((m) => (
            <li key={m.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-100 truncate">{m.name}</p>
                  <p className="text-[11px] text-zinc-500">{m.ruleCount} rules · max {m.maxScore} pts · qualified ≥ {m.threshold}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => openApply(m)}
                    className="flex items-center gap-1 text-[11px] text-emerald-300 hover:text-emerald-200 px-2 py-1 rounded border border-emerald-800/60">
                    <Target className="w-3 h-3" /> Apply
                  </button>
                  <button type="button" onClick={() => openEdit(m)}
                    className="text-[11px] text-zinc-300 hover:text-white px-2 py-1 rounded border border-zinc-700">Edit</button>
                  <button type="button" onClick={() => del(m.id)} aria-label="Delete model"
                    className="text-rose-400 hover:text-rose-300 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {m.rules.map((rl, i) => (
                  <span key={i} className="text-[10px] bg-zinc-800 text-zinc-300 rounded px-1.5 py-0.5">
                    {rl.signal} {rl.points >= 0 ? '+' : ''}{rl.points}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Editor modal */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setCreating(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3"
            onClick={(ev) => ev.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-white">{editing ? 'Edit' : 'New'} scoring model</h4>
              <button type="button" onClick={() => setCreating(false)} aria-label="Close"><X className="w-4 h-4 text-zinc-400" /></button>
            </div>
            <input placeholder="Model name" value={fName} onChange={(e) => setFName(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
            <div>
              <label className="text-[10px] text-zinc-400">Qualification threshold</label>
              <input type="number" min={0} value={fThreshold} onChange={(e) => setFThreshold(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
            </div>
            <div className="space-y-1.5">
              {fRules.map((rl, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={rl.signal} onChange={(e) => updateRule(i, { signal: e.target.value })}
                    placeholder="Signal name" className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100" />
                  <input type="number" value={rl.points} onChange={(e) => updateRule(i, { points: Number(e.target.value) || 0 })}
                    placeholder="Points" className="w-20 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100" />
                  <button type="button" onClick={() => removeRule(i)} aria-label="Remove rule"
                    className="text-rose-400 hover:text-rose-300"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              <button type="button" onClick={addRule}
                className="text-[11px] text-orange-400 hover:text-orange-300">+ Add rule</button>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setCreating(false)}
                className="text-xs text-zinc-400 hover:text-white px-3 py-1.5">Cancel</button>
              <button type="button" onClick={save} disabled={busy}
                className={cn('text-xs font-medium rounded-lg px-3 py-1.5 text-white',
                  busy ? 'bg-zinc-700' : 'bg-orange-600 hover:bg-orange-500')}>
                {busy ? 'Saving…' : 'Save model'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Apply modal */}
      {applyModel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setApplyModel(null)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="w-full max-w-sm max-h-[85vh] overflow-y-auto bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3"
            onClick={(ev) => ev.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-white">Apply &ldquo;{applyModel.name}&rdquo;</h4>
              <button type="button" onClick={() => setApplyModel(null)} aria-label="Close"><X className="w-4 h-4 text-zinc-400" /></button>
            </div>
            <div>
              <label className="text-[10px] text-zinc-400">Lead</label>
              <select value={applyLead} onChange={(e) => setApplyLead(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
                <option value="">Select a lead…</option>
                {leads.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.stage})</option>)}
              </select>
            </div>
            {applyModel.rules.map((rl) => (
              <div key={rl.signal}>
                <label className="text-[10px] text-zinc-400">{rl.signal} (count, {rl.points >= 0 ? '+' : ''}{rl.points} ea)</label>
                <input type="number" min={0} value={applySignals[rl.signal] || ''}
                  onChange={(e) => setApplySignals((s) => ({ ...s, [rl.signal]: e.target.value }))}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-100" />
              </div>
            ))}
            <div className="flex justify-end">
              <button type="button" onClick={runApply} disabled={busy}
                className={cn('text-xs font-medium rounded-lg px-3 py-1.5 text-white',
                  busy ? 'bg-zinc-700' : 'bg-emerald-600 hover:bg-emerald-500')}>
                {busy ? 'Scoring…' : 'Compute score'}
              </button>
            </div>
            {applyResult && (
              <div className={cn('rounded-lg border p-2.5',
                applyResult.qualified ? 'border-emerald-700/60 bg-emerald-950/30' : 'border-zinc-700 bg-zinc-900')}>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-white">{applyResult.score}</span>
                  <span className="text-xs text-zinc-400">grade {applyResult.grade} ·
                    {applyResult.qualified ? ' qualified' : ' below threshold'} ({applyResult.threshold})</span>
                </div>
                {applyResult.breakdown.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {applyResult.breakdown.map((b) => (
                      <li key={b.signal} className="text-[10px] text-zinc-400">
                        {b.signal}: {b.count} × {b.points} = {b.contributed}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
