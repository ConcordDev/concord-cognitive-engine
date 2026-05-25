'use client';

import { useEffect, useState } from 'react';
import { ClipboardCheck, Plus, Loader2, Check, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Inspection { id: string; permitId: string; kind: string; date: string; inspectorName: string; timeSlot: string; status: string; result: string | null; notes: string }
interface Permit { id: string; recordNumber: string; kind: string }

export function InspectionsPanel() {
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [permits, setPermits] = useState<Permit[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ permitId: '', kind: 'framing', date: new Date().toISOString().slice(0, 10), inspectorName: '', timeSlot: 'morning' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [i, p] = await Promise.all([
        lensRun({ domain: 'government', action: 'inspections-list', input: {} }),
        lensRun({ domain: 'government', action: 'permits-list', input: {} }),
      ]);
      setInspections((i.data?.result?.inspections || []) as Inspection[]);
      setPermits((p.data?.result?.permits || []) as Permit[]);
    } catch (e) { console.error('[Insp] failed', e); }
    finally { setLoading(false); }
  }

  async function schedule() {
    if (!form.permitId || !form.kind.trim() || !form.date) return;
    try {
      await lensRun({ domain: 'government', action: 'inspections-schedule', input: form });
      setForm({ ...form, inspectorName: '' });
      await refresh();
    } catch (e) { console.error('[Insp] schedule', e); }
  }

  async function complete(id: string, result: 'pass' | 'fail' | 'needs_followup') {
    const notes = prompt(`Notes for ${result} result?`) || '';
    try {
      await lensRun({ domain: 'government', action: 'inspections-complete', input: { id, result, notes } });
      await refresh();
    } catch (e) { console.error('[Insp] complete', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <ClipboardCheck className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Inspections</span>
        <span className="ml-auto text-[10px] text-gray-400">{inspections.filter(i => i.status === 'scheduled').length} scheduled</span>
      </header>
      <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
        <select value={form.permitId} onChange={e => setForm({ ...form, permitId: e.target.value })} className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="">Permit…</option>
          {permits.map(p => <option key={p.id} value={p.id}>{p.recordNumber} · {p.kind}</option>)}
        </select>
        <input value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} placeholder="Inspection kind" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <select value={form.timeSlot} onChange={e => setForm({ ...form, timeSlot: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="all_day">All day</option>
        </select>
        <input value={form.inspectorName} onChange={e => setForm({ ...form, inspectorName: e.target.value })} placeholder="Inspector name" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={schedule} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Schedule</button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : inspections.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><ClipboardCheck className="w-6 h-6 mx-auto mb-2 opacity-30" />No inspections yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {inspections.map(i => {
              const permit = permits.find(p => p.id === i.permitId);
              return (
                <li key={i.id} className="px-3 py-2 hover:bg-white/[0.03] flex items-center gap-3">
                  <ClipboardCheck className={cn('w-3.5 h-3.5', i.result === 'pass' ? 'text-emerald-400' : i.result === 'fail' ? 'text-rose-400' : 'text-cyan-300')} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-white">{permit?.recordNumber || '?'} · {i.kind}</div>
                    <div className="text-[10px] text-gray-400">{i.date} · {i.timeSlot} · {i.inspectorName || 'unassigned'}</div>
                  </div>
                  <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', i.result === 'pass' ? 'bg-emerald-500/15 text-emerald-300' : i.result === 'fail' ? 'bg-rose-500/15 text-rose-300' : i.result === 'needs_followup' ? 'bg-amber-500/15 text-amber-300' : 'bg-cyan-500/15 text-cyan-300')}>{i.result || i.status.replace('_', ' ')}</span>
                  {i.status === 'scheduled' && (
                    <>
                      <button onClick={() => complete(i.id, 'pass')} className="p-1 text-emerald-400 hover:text-emerald-300" title="Pass"><Check className="w-3 h-3" /></button>
                      <button onClick={() => complete(i.id, 'fail')} className="p-1 text-rose-400 hover:text-rose-300" title="Fail"><X className="w-3 h-3" /></button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default InspectionsPanel;
