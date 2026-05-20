'use client';

/**
 * TravelDocsPanel — travel documents (passport, visa, insurance, …)
 * with expiry-status flags.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, FileText, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface TravelDoc {
  id: string; title: string; kind: string; number: string | null;
  expiryDate: string | null; expiryStatus: string;
}

const KINDS = ['passport', 'visa', 'insurance', 'ticket', 'reservation', 'vaccination', 'other'];
const STATUS_COLOR: Record<string, string> = {
  expired: 'text-rose-400', expiring_soon: 'text-amber-400', valid: 'text-emerald-400', none: 'text-zinc-500',
};

export function TravelDocsPanel() {
  const [docs, setDocs] = useState<TravelDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', kind: 'passport', number: '', expiryDate: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('travel', 'travel-doc-list', {});
    setDocs(r.data?.result?.documents || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = async () => {
    if (!form.title.trim()) { setError('Document title is required.'); return; }
    const r = await lensRun('travel', 'travel-doc-add', {
      title: form.title.trim(), kind: form.kind, number: form.number.trim(), expiryDate: form.expiryDate,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', kind: 'passport', number: '', expiryDate: '' });
    setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input placeholder="Document title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input placeholder="Number / reference" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <input type="date" title="Expiry" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={add}
          className="col-span-2 flex items-center justify-center gap-1 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">
          <Plus className="w-3.5 h-3.5" /> Add document
        </button>
      </div>

      {docs.length === 0 ? (
        <div className="text-center text-zinc-500 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No travel documents. Track passports, visas and insurance with expiry alerts.
        </div>
      ) : (
        <ul className="space-y-2">
          {docs.map((d) => (
            <li key={d.id} className={cn('flex items-center justify-between bg-zinc-900/70 border rounded-xl p-3',
              d.expiryStatus === 'expired' ? 'border-rose-900/60' : 'border-zinc-800')}>
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-sky-400" />
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{d.title}</p>
                  <p className="text-[11px] text-zinc-500 capitalize">
                    {d.kind}{d.number ? ` · ${d.number}` : ''}{d.expiryDate ? ` · expires ${d.expiryDate}` : ''}
                  </p>
                </div>
              </div>
              {d.expiryStatus !== 'none' && (
                <span className={cn('flex items-center gap-1 text-[10px] capitalize', STATUS_COLOR[d.expiryStatus])}>
                  {d.expiryStatus !== 'valid' && <AlertTriangle className="w-3 h-3" />}
                  {d.expiryStatus.replace(/_/g, ' ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
