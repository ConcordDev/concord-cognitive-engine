'use client';

import { useEffect, useState } from 'react';
import { Pill, Plus, Check, Bell, Trash2, Loader2, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface Medication {
  id: string;
  name: string;
  dose: string;
  schedule: string;
  prescribedBy?: string;
  refillRemaining?: number;
  status: 'active' | 'paused' | 'discontinued';
  takenToday: boolean;
  dosesScheduledToday: number;
  dosesTakenToday: number;
}

export function MedicationTracker() {
  const [meds, setMeds] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [dose, setDose] = useState('');
  const [schedule, setSchedule] = useState('daily');

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', { domain: 'healthcare', action: 'medications-list', input: {} });
      setMeds((res.data?.result?.medications || []) as Medication[]);
    } catch (e) { console.error('[Meds] failed', e); }
    finally { setLoading(false); }
  }

  async function addMed() {
    if (!name.trim() || !dose.trim()) return;
    try {
      await api.post('/api/lens/run', {
        domain: 'healthcare', action: 'medications-add',
        input: { name: name.trim(), dose: dose.trim(), schedule },
      });
      setName(''); setDose(''); setAdding(false);
      await refresh();
    } catch (e) { console.error('[Meds] add failed', e); }
  }

  async function logDose(id: string) {
    try {
      await api.post('/api/lens/run', { domain: 'healthcare', action: 'medications-log-dose', input: { id } });
      await refresh();
    } catch (e) { console.error('[Meds] log failed', e); }
  }

  async function remove(id: string) {
    try {
      await api.post('/api/lens/run', { domain: 'healthcare', action: 'medications-delete', input: { id } });
      setMeds(prev => prev.filter(m => m.id !== id));
    } catch (e) { console.error('[Meds] remove failed', e); }
  }

  const adherence = meds.length > 0
    ? meds.reduce((s, m) => s + (m.dosesScheduledToday > 0 ? m.dosesTakenToday / m.dosesScheduledToday : 1), 0) / meds.length * 100
    : 100;
  const needsRefill = meds.filter(m => (m.refillRemaining ?? 0) <= 7).length;

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Pill className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Medications</span>
        <span className="ml-auto text-[10px] text-gray-500">{Math.round(adherence)}% adherence today{needsRefill > 0 ? ` · ${needsRefill} refill needed` : ''}</span>
        <button onClick={() => setAdding(v => !v)} className="p-1 text-gray-400 hover:text-white" title="Add medication">
          <Plus className="w-4 h-4" />
        </button>
      </header>

      {adding && (
        <div className="p-3 border-b border-white/10 grid grid-cols-3 gap-2 text-xs">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Medication name" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={dose} onChange={e => setDose(e.target.value)} placeholder="Dose (e.g. 500mg)" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={schedule} onChange={e => setSchedule(e.target.value)} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="daily">Daily</option>
            <option value="twice_daily">Twice daily</option>
            <option value="three_times_daily">3× daily</option>
            <option value="four_times_daily">4× daily</option>
            <option value="weekly">Weekly</option>
            <option value="as_needed">As needed</option>
          </select>
          <button onClick={addMed} className="col-span-3 py-1.5 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Add to list</button>
        </div>
      )}

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : meds.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><Pill className="w-6 h-6 mx-auto mb-2 opacity-30" /> No medications yet. Hit + to add.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {meds.map(m => {
              const doneToday = m.dosesTakenToday >= m.dosesScheduledToday;
              return (
                <li key={m.id} className="px-3 py-2 hover:bg-white/[0.03] group">
                  <div className="flex items-center gap-3">
                    <div className={cn('w-2 h-10 rounded',
                      doneToday ? 'bg-green-500' :
                      m.status === 'paused' ? 'bg-yellow-500' :
                      m.dosesTakenToday > 0 ? 'bg-cyan-500' : 'bg-gray-600'
                    )} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">{m.name}</span>
                        <span className="text-xs text-cyan-300">{m.dose}</span>
                        <span className="text-[9px] text-gray-500 uppercase">{m.schedule.replace(/_/g, ' ')}</span>
                      </div>
                      <div className="text-[10px] text-gray-500 mt-0.5">
                        {m.dosesTakenToday}/{m.dosesScheduledToday} taken today
                        {m.prescribedBy && ` · Rx ${m.prescribedBy}`}
                        {m.refillRemaining != null && (
                          <span className={cn(m.refillRemaining <= 7 && 'text-yellow-300')}> · {m.refillRemaining}d refill</span>
                        )}
                      </div>
                    </div>
                    {!doneToday && m.status === 'active' && (
                      <button onClick={() => logDose(m.id)} className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30">
                        <Check className="w-3 h-3" /> Take
                      </button>
                    )}
                    {m.refillRemaining != null && m.refillRemaining <= 7 && (
                      <Bell className="w-4 h-4 text-yellow-400" />
                    )}
                    <button onClick={() => remove(m.id)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-red-400" title="Remove">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {needsRefill > 0 && (
        <div className="px-3 py-2 border-t border-yellow-500/30 bg-yellow-500/10 text-xs text-yellow-300 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" /> {needsRefill} medication{needsRefill === 1 ? '' : 's'} need{needsRefill === 1 ? 's' : ''} refilling within 7 days.
        </div>
      )}
    </div>
  );
}

export default MedicationTracker;
