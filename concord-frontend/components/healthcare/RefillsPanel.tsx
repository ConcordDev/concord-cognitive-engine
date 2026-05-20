'use client';

import { useEffect, useState } from 'react';
import { Pill, Loader2, Plus, CheckCircle, XCircle, Package } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Patient { id: string; firstName: string; lastName: string; mrn: string }
interface Refill {
  id: string; number: string; patientId: string;
  medication: string; dose: string; pharmacy: string; notes: string;
  status: 'requested' | 'approved' | 'denied' | 'filled';
  requestedAt: string; respondedAt: string | null; responseNotes?: string;
}

export function RefillsPanel() {
  const [list, setList] = useState<Refill[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [filter, setFilter] = useState<'all' | 'requested' | 'approved' | 'denied' | 'filled'>('requested');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ patientId: '', medication: '', dose: '', pharmacy: '', notes: '' });

  useEffect(() => { refresh(); }, [filter]);

  async function refresh() {
    setLoading(true);
    try {
      const [r, p] = await Promise.all([
        lensRun({ domain: 'healthcare', action: 'refills-list', input: filter === 'all' ? {} : { status: filter } }),
        lensRun({ domain: 'healthcare', action: 'patients-list', input: {} }),
      ]);
      setList((r.data?.result?.refills || []) as Refill[]);
      setPatients((p.data?.result?.patients || []) as Patient[]);
    } catch (e) { console.error('[Refills] failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!draft.patientId || !draft.medication.trim()) return;
    try {
      await lensRun({ domain: 'healthcare', action: 'refills-request', input: draft });
      setDraft({ patientId: '', medication: '', dose: '', pharmacy: '', notes: '' });
      setCreating(false);
      await refresh();
    } catch (e) { console.error('[Refills] create', e); }
  }

  async function respond(id: string, status: 'approved' | 'denied' | 'filled') {
    try {
      await lensRun({ domain: 'healthcare', action: 'refills-respond', input: { id, status } });
      await refresh();
    } catch (e) { console.error('[Refills] respond', e); }
  }

  function patientName(id: string): string {
    const p = patients.find(x => x.id === id);
    return p ? `${p.lastName}, ${p.firstName}` : '—';
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Pill className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-semibold text-gray-200">Refill requests</span>
        <span className="text-[10px] text-gray-500">{list.length}</span>
        <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} className="ml-2 text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="requested">Pending</option>
          <option value="approved">Approved</option>
          <option value="denied">Denied</option>
          <option value="filled">Filled</option>
          <option value="all">All</option>
        </select>
        <button onClick={() => setCreating(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded bg-cyan-500 text-black font-semibold hover:bg-cyan-400 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />Request refill
        </button>
      </header>

      {creating && (
        <div className="p-3 grid grid-cols-12 gap-2 border-b border-white/10">
          <select value={draft.patientId} onChange={e => setDraft({ ...draft, patientId: e.target.value })} className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="">Patient *</option>
            {patients.map(p => <option key={p.id} value={p.id}>{p.lastName}, {p.firstName}</option>)}
          </select>
          <input value={draft.medication} onChange={e => setDraft({ ...draft, medication: e.target.value })} placeholder="Medication *" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={draft.dose} onChange={e => setDraft({ ...draft, dose: e.target.value })} placeholder="Dose" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={draft.pharmacy} onChange={e => setDraft({ ...draft, pharmacy: e.target.value })} placeholder="Pharmacy" className="col-span-8 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={create} className="col-span-4 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Submit</button>
        </div>
      )}

      <div className="max-h-[32rem] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : list.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><Pill className="w-6 h-6 mx-auto mb-2 opacity-30" />No refill requests in this view.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {list.map(r => (
              <li key={r.id} className="px-4 py-2.5 hover:bg-white/[0.02] flex items-center gap-3">
                <span className={cn(
                  'text-[9px] uppercase px-1.5 py-0.5 rounded font-mono',
                  r.status === 'requested' ? 'bg-amber-500/20 text-amber-300' :
                  r.status === 'approved'  ? 'bg-cyan-500/20 text-cyan-300' :
                  r.status === 'denied'    ? 'bg-rose-500/20 text-rose-300' :
                                              'bg-emerald-500/20 text-emerald-300',
                )}>{r.status}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">
                    {r.medication} {r.dose && <span className="text-[10px] text-gray-500">{r.dose}</span>}
                  </div>
                  <div className="text-[10px] text-gray-500 truncate">{patientName(r.patientId)} · {r.pharmacy || 'no pharmacy'} · {r.requestedAt.slice(0, 10)}</div>
                </div>
                {r.status === 'requested' && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => respond(r.id, 'approved')} className="px-2 py-0.5 text-[10px] rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center gap-0.5"><CheckCircle className="w-3 h-3" />Approve</button>
                    <button onClick={() => respond(r.id, 'denied')} className="px-2 py-0.5 text-[10px] rounded bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 inline-flex items-center gap-0.5"><XCircle className="w-3 h-3" />Deny</button>
                  </div>
                )}
                {r.status === 'approved' && (
                  <button onClick={() => respond(r.id, 'filled')} className="px-2 py-0.5 text-[10px] rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center gap-0.5"><Package className="w-3 h-3" />Mark filled</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default RefillsPanel;
