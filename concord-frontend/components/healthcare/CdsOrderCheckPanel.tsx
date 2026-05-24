'use client';

/**
 * CdsOrderCheckPanel — clinical decision support at order entry.
 * Fires Best-Practice-Advisory alerts (duplicate orders, renal dosing
 * on contrast, missing baselines, Beers criteria, allergy cross-check).
 * Backend: healthcare.cds-order-check.
 */

import { useState } from 'react';
import { ShieldAlert, Loader2, AlertTriangle, CheckCircle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface CdsAlert { severity: 'major' | 'moderate'; code: string; message: string }
interface CdsResult { orderName: string; orderKind: string; alerts: CdsAlert[]; alertCount: number; hasMajor: boolean; clean: boolean }

const ORDER_KINDS = ['lab', 'imaging', 'medication', 'referral', 'procedure'];

export function CdsOrderCheckPanel({ patientId }: { patientId: string }) {
  const [orderKind, setOrderKind] = useState('medication');
  const [orderName, setOrderName] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CdsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    if (!orderName.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await lensRun('healthcare', 'cds-order-check', { patientId, orderKind, orderName: orderName.trim() });
      if (r.data?.ok) setResult(r.data.result as CdsResult);
      else setError((r.data as { error?: string })?.error || 'Check failed');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-semibold text-gray-200">Decision support — order check</span>
      </header>

      <div className="p-3 grid grid-cols-12 gap-2 border-b border-white/10">
        <select value={orderKind} onChange={e => setOrderKind(e.target.value)} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          {ORDER_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <input
          value={orderName}
          onChange={e => setOrderName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') check(); }}
          placeholder="Order name — e.g. CT abdomen with contrast, Lorazepam 1mg"
          className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
        />
        <button onClick={check} disabled={loading || !orderName.trim()} className="col-span-3 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldAlert className="w-3 h-3" />}
          Run check
        </button>
      </div>

      <div className="p-3">
        {error && <div className="text-xs text-rose-300 px-2 py-1.5 bg-rose-500/10 rounded">{error}</div>}
        {!error && !result && (
          <div className="text-xs text-gray-400 text-center py-8">Enter a proposed order to screen it for advisories before placing it.</div>
        )}
        {result && result.clean && (
          <div className="flex items-center gap-2 text-xs text-emerald-300 px-2 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded">
            <CheckCircle className="w-4 h-4" /> No advisories for &ldquo;{result.orderName}&rdquo; — clear to place.
          </div>
        )}
        {result && !result.clean && (
          <ul className="space-y-2">
            {result.alerts.map((a, i) => (
              <li key={i} className={cn('flex items-start gap-2 px-2.5 py-2 rounded border',
                a.severity === 'major' ? 'bg-rose-500/10 border-rose-500/25' : 'bg-amber-500/10 border-amber-500/25')}>
                <AlertTriangle className={cn('w-4 h-4 mt-0.5 shrink-0', a.severity === 'major' ? 'text-rose-400' : 'text-amber-400')} />
                <div>
                  <div className="flex items-center gap-2">
                    <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded font-mono', a.severity === 'major' ? 'bg-rose-500/25 text-rose-200' : 'bg-amber-500/25 text-amber-200')}>{a.severity}</span>
                    <span className="text-[10px] font-mono text-gray-400">{a.code}</span>
                  </div>
                  <p className="text-xs text-gray-200 mt-0.5">{a.message}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default CdsOrderCheckPanel;
