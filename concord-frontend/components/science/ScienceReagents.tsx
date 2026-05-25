'use client';

import { useState, useEffect, useCallback } from 'react';
import { FlaskRound, Plus, Trash2, Save, Minus, ArrowLeft, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { RunButton } from '@/components/science/ScienceWorkbench';

interface UsageEntry { amount: number; at: string; reason: string; remaining: number }
interface Reagent {
  id: string;
  name: string;
  catalogNumber: string;
  lotNumber: string;
  vendor: string;
  quantity: number;
  unit: string;
  reorderThreshold: number;
  location: string;
  hazardClass: string;
  expiryDate: string | null;
  lowStock: boolean;
  expired: boolean;
  usageLog?: UsageEntry[];
  createdAt: string;
  updatedAt: string;
}

const HAZARDS = ['none', 'biohazard', 'chemical', 'radioactive', 'flammable', 'corrosive'];
const inputCls = 'w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100';

/**
 * Reagent / consumable inventory — quantity tracking, reorder thresholds,
 * expiry, and a per-reagent consumption log.
 */
export function ScienceReagents() {
  const [reagents, setReagents] = useState<Reagent[]>([]);
  const [counts, setCounts] = useState({ low: 0, expired: 0 });
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Reagent | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Partial<Reagent>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [consumeFor, setConsumeFor] = useState<string | null>(null);
  const [consumeAmt, setConsumeAmt] = useState('');
  const [consumeReason, setConsumeReason] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ reagents: Reagent[]; lowStockCount: number; expiredCount: number }>(
      'science', 'reagent-list', {});
    if (r.data?.ok && r.data.result) {
      setReagents(r.data.result.reagents || []);
      setCounts({ low: r.data.result.lowStockCount || 0, expired: r.data.result.expiredCount || 0 });
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const startNew = () => {
    setCreating(true); setEditing(null);
    setForm({ hazardClass: 'none', unit: 'units', quantity: 0, reorderThreshold: 0 });
    setMsg(null);
  };
  const openEdit = (r: Reagent) => {
    setEditing(r); setCreating(false);
    setForm({ ...r });
    setMsg(null);
  };
  const close = () => { setEditing(null); setCreating(false); setMsg(null); };

  const save = async () => {
    if (!form.name?.trim()) { setMsg('Reagent name required'); return; }
    const qty = Number(form.quantity);
    if (!Number.isFinite(qty) || qty < 0) { setMsg('Quantity must be ≥ 0'); return; }
    setBusy(true); setMsg(null);
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      catalogNumber: form.catalogNumber || '',
      lotNumber: form.lotNumber || '',
      vendor: form.vendor || '',
      quantity: qty,
      unit: form.unit || 'units',
      reorderThreshold: Number(form.reorderThreshold) || 0,
      location: form.location || '',
      hazardClass: form.hazardClass || 'none',
    };
    if (form.expiryDate) payload.expiryDate = form.expiryDate;
    if (editing) payload.id = editing.id;
    const r = await lensRun('science', 'reagent-save', payload);
    if (r.data?.ok) { close(); await refresh(); }
    else setMsg(r.data?.error || 'Save failed');
    setBusy(false);
  };

  const del = async (id: string) => {
    setBusy(true);
    const r = await lensRun('science', 'reagent-delete', { id });
    if (r.data?.ok) await refresh();
    else setMsg(r.data?.error || 'Delete failed');
    setBusy(false);
  };

  const consume = async (id: string) => {
    const amt = Number(consumeAmt);
    if (!Number.isFinite(amt) || amt <= 0) { setMsg('Amount must be > 0'); return; }
    setBusy(true); setMsg(null);
    const r = await lensRun('science', 'reagent-consume', {
      id, amount: amt, reason: consumeReason.trim(),
    });
    if (r.data?.ok) {
      setConsumeFor(null); setConsumeAmt(''); setConsumeReason('');
      await refresh();
    } else setMsg(r.data?.error || 'Consume failed');
    setBusy(false);
  };

  if (creating || editing) {
    return (
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={close}
            className="p-1 rounded hover:bg-white/5 text-gray-400" aria-label="Back">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-gray-200">
            {editing ? 'Edit Reagent' : 'New Reagent'}
          </span>
        </div>
        <input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Reagent name" className={inputCls} />
        <div className="grid grid-cols-2 gap-2">
          <input value={form.catalogNumber || ''}
            onChange={(e) => setForm({ ...form, catalogNumber: e.target.value })}
            placeholder="Catalog #" className={inputCls} />
          <input value={form.lotNumber || ''}
            onChange={(e) => setForm({ ...form, lotNumber: e.target.value })}
            placeholder="Lot #" className={inputCls} />
        </div>
        <input value={form.vendor || ''} onChange={(e) => setForm({ ...form, vendor: e.target.value })}
          placeholder="Vendor" className={inputCls} />
        <div className="grid grid-cols-3 gap-2">
          <input type="number" value={form.quantity ?? ''}
            onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
            placeholder="Quantity" className={inputCls} />
          <input value={form.unit || ''} onChange={(e) => setForm({ ...form, unit: e.target.value })}
            placeholder="Unit" className={inputCls} />
          <input type="number" value={form.reorderThreshold ?? ''}
            onChange={(e) => setForm({ ...form, reorderThreshold: Number(e.target.value) })}
            placeholder="Reorder at" className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input value={form.location || ''}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            placeholder="Storage location" className={inputCls} />
          <select value={form.hazardClass || 'none'}
            onChange={(e) => setForm({ ...form, hazardClass: e.target.value })}
            className={inputCls}>
            {HAZARDS.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>
        <label className="text-[10px] text-gray-400 uppercase block">
          Expiry date
          <input type="date" value={form.expiryDate || ''}
            onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
            className={cn(inputCls, 'mt-1')} />
        </label>
        <RunButton onClick={save} busy={busy}>
          <Save className="w-3 h-3" /> Save Reagent
        </RunButton>
        {msg && <p className="text-xs text-gray-400">{msg}</p>}
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5">
          <FlaskRound className="w-4 h-4 text-teal-400" /> Reagent Inventory
        </h3>
        <RunButton onClick={startNew} busy={false}>
          <Plus className="w-3 h-3" /> New Reagent
        </RunButton>
      </div>
      {(counts.low > 0 || counts.expired > 0) && (
        <div className="flex gap-2 text-[11px]">
          {counts.low > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">
              {counts.low} low stock
            </span>
          )}
          {counts.expired > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-300">
              {counts.expired} expired
            </span>
          )}
        </div>
      )}
      {loading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : reagents.length === 0 ? (
        <p className="text-xs text-gray-400">No reagents tracked yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {reagents.map((r) => (
            <li key={r.id} className="rounded border border-white/10 bg-black/30 px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <button type="button" onClick={() => openEdit(r)} className="text-left flex-1 min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-100 font-medium truncate">{r.name}</span>
                    {r.lowStock && <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />}
                    {r.expired && (
                      <span className="text-[9px] px-1 rounded bg-red-500/20 text-red-300 shrink-0">
                        expired
                      </span>
                    )}
                    {r.hazardClass !== 'none' && (
                      <span className="text-[9px] px-1 rounded bg-orange-500/20 text-orange-300 shrink-0">
                        {r.hazardClass}
                      </span>
                    )}
                  </span>
                  <span className="block text-[11px] text-gray-400 mt-0.5">
                    <span className={cn('font-mono', r.lowStock ? 'text-amber-300' : 'text-gray-300')}>
                      {r.quantity} {r.unit}
                    </span>
                    {r.location ? ` · ${r.location}` : ''}
                    {r.vendor ? ` · ${r.vendor}` : ''}
                  </span>
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => {
                    setConsumeFor(consumeFor === r.id ? null : r.id);
                    setConsumeAmt(''); setConsumeReason('');
                  }}
                    className="p-1 rounded hover:bg-white/5 text-gray-400 hover:text-teal-300"
                    aria-label="Consume">
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => del(r.id)}
                    className="p-1 rounded hover:bg-red-500/10 text-gray-400 hover:text-red-400"
                    aria-label="Delete reagent">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {consumeFor === r.id && (
                <div className="flex gap-1.5 mt-2 pt-2 border-t border-white/10">
                  <input type="number" value={consumeAmt}
                    onChange={(e) => setConsumeAmt(e.target.value)}
                    placeholder={`Amount (${r.unit})`}
                    className="w-24 px-1.5 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-gray-100" />
                  <input value={consumeReason}
                    onChange={(e) => setConsumeReason(e.target.value)}
                    placeholder="Reason"
                    className="flex-1 px-1.5 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-gray-100" />
                  <RunButton onClick={() => consume(r.id)} busy={busy}>Log</RunButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="text-xs text-gray-400">{msg}</p>}
    </div>
  );
}

export default ScienceReagents;
