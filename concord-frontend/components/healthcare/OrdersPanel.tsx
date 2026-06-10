'use client';

/**
 * OrdersPanel — Epic-style computerized order entry (CPOE). Places
 * medication / lab / imaging / referral / procedure orders, tracks the
 * status lifecycle, and runs a drug-drug + drug-allergy interaction
 * check over the patient's active medication orders.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Plus, FlaskConical, Pill, ScanLine, Send, Activity,
  ShieldAlert, ShieldCheck, X,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Order {
  id: string; number: string; kind: string; name: string; status: string;
  priority: string; details: string; dose: string | null; frequency: string | null; route: string | null;
}
interface Interaction { type: string; a: string; b: string; severity: string; note: string }

const KINDS = ['medication', 'lab', 'imaging', 'referral', 'procedure'];
const STATUSES = ['placed', 'active', 'in-progress', 'completed', 'resulted', 'discontinued', 'cancelled'];
const KIND_ICON: Record<string, typeof Pill> = {
  medication: Pill, lab: FlaskConical, imaging: ScanLine, referral: Send, procedure: Activity,
};
const STATUS_COLOR: Record<string, string> = {
  placed: 'text-sky-300', active: 'text-emerald-300', 'in-progress': 'text-amber-300',
  completed: 'text-gray-400', resulted: 'text-cyan-300', discontinued: 'text-gray-400', cancelled: 'text-rose-400',
};

export function OrdersPanel({ patientId }: { patientId: string }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ kind: 'medication', name: '', dose: '', frequency: '', priority: 'routine', details: '' });
  const [candidate, setCandidate] = useState('');
  const [interactions, setInteractions] = useState<Interaction[] | null>(null);
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'healthcare', action: 'order-list', input: { patientId } });
      setOrders((r.data?.result?.orders || []) as Order[]);
    } catch (e) { console.error('[Orders] failed', e); }
    finally { setLoading(false); }
  }, [patientId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function place() {
    if (!form.name.trim()) return;
    await lensRun({ domain: 'healthcare', action: 'order-create', input: { patientId, ...form, name: form.name.trim() } });
    setForm({ kind: form.kind, name: '', dose: '', frequency: '', priority: 'routine', details: '' });
    await refresh();
  }
  async function setStatus(id: string, status: string) {
    await lensRun({ domain: 'healthcare', action: 'order-update-status', input: { id, status } });
    await refresh();
  }
  async function cancel(id: string) {
    await lensRun({ domain: 'healthcare', action: 'order-cancel', input: { id } });
    await refresh();
  }
  async function checkInteractions() {
    setChecking(true);
    try {
      const r = await lensRun({ domain: 'healthcare', action: 'drug-interaction-check', input: { patientId, candidateDrug: candidate.trim() || undefined } });
      setInteractions((r.data?.result?.interactions || []) as Interaction[]);
    } finally { setChecking(false); }
  }

  return (
    <div className="space-y-3">
      {/* Order entry */}
      <div className="bg-[#0d1117] border border-cyan-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-gray-200">Place order</span>
        </header>
        <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white capitalize">
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Order name" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}
            className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="routine">Routine</option>
            <option value="urgent">Urgent</option>
            <option value="stat">STAT</option>
          </select>
          <button type="button" onClick={place}
            className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-white font-bold hover:bg-cyan-400 inline-flex items-center justify-center gap-1">
            <Plus className="w-3 h-3" />Place
          </button>
          {form.kind === 'medication' && (
            <>
              <input value={form.dose} onChange={(e) => setForm({ ...form, dose: e.target.value })}
                placeholder="dose (e.g. 10mg)" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
              <input value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}
                placeholder="frequency (e.g. BID)" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            </>
          )}
        </div>
      </div>

      {/* Interaction checker */}
      <div className="bg-[#0d1117] border border-cyan-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-gray-200">Interaction check</span>
        </header>
        <div className="p-3 flex items-center gap-2">
          <input value={candidate} onChange={(e) => setCandidate(e.target.value)}
            placeholder="Candidate drug (optional) — checked against active meds + allergies"
            className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button type="button" onClick={checkInteractions} disabled={checking}
            className="px-3 py-1.5 text-xs rounded bg-amber-500 text-white font-bold hover:bg-amber-400 disabled:opacity-40 inline-flex items-center gap-1">
            {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldAlert className="w-3 h-3" />}Check
          </button>
        </div>
        {interactions !== null && (
          <div className="px-3 pb-3">
            {interactions.length === 0 ? (
              <div className="text-[11px] text-emerald-300 inline-flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />No interactions detected.
              </div>
            ) : (
              <ul className="space-y-1">
                {interactions.map((i, idx) => (
                  <li key={idx} className={cn('text-[11px] px-2 py-1.5 rounded border',
                    i.severity === 'major' ? 'border-rose-500/40 bg-rose-500/10' : 'border-amber-500/40 bg-amber-500/10')}>
                    <span className={cn('font-bold uppercase mr-1.5', i.severity === 'major' ? 'text-rose-300' : 'text-amber-300')}>
                      {i.severity}
                    </span>
                    <span className="text-white">{i.a} ↔ {i.b}</span>
                    <span className="text-[10px] text-gray-400 ml-1">({i.type})</span>
                    <div className="text-gray-400 mt-0.5">{i.note}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Order list */}
      <div className="bg-[#0d1117] border border-cyan-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <ClipboardListIcon />
          <span className="text-sm font-semibold text-gray-200">Orders</span>
          <span className="text-[10px] text-gray-400">{orders.length}</span>
        </header>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>
        ) : orders.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400">No orders for this patient yet.</div>
        ) : (
          <div className="divide-y divide-white/5">
            {orders.map((o) => {
              const Icon = KIND_ICON[o.kind] || Activity;
              const closed = ['completed', 'resulted', 'cancelled', 'discontinued'].includes(o.status);
              return (
                <div key={o.id} className="px-3 py-2 flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="text-xs text-white font-medium">{o.name}</span>
                  {o.dose && <span className="text-[11px] text-gray-400">{o.dose}{o.frequency ? ` · ${o.frequency}` : ''}</span>}
                  {o.priority !== 'routine' && (
                    <span className="text-[9px] uppercase font-bold px-1 rounded bg-rose-500/20 text-rose-300">{o.priority}</span>
                  )}
                  <span className="text-[10px] text-gray-400 font-mono">{o.number}</span>
                  <div className="flex-1" />
                  <select value={o.status} onChange={(e) => setStatus(o.id, e.target.value)} disabled={closed}
                    className={cn('text-[10px] bg-transparent border border-white/10 rounded px-1 py-0.5 disabled:opacity-50', STATUS_COLOR[o.status])}>
                    {STATUSES.map((st) => <option key={st} value={st} className="bg-[#0d1117]">{st}</option>)}
                  </select>
                  {!closed && (
                    <button aria-label="Cancel order" type="button" onClick={() => cancel(o.id)} className="text-gray-400 hover:text-rose-300">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ClipboardListIcon() {
  return <Activity className="w-4 h-4 text-cyan-400" />;
}

export default OrdersPanel;
