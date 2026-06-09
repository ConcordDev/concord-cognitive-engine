'use client';

/**
 * PetHealthPanel — vaccinations, medications and vet visits for the
 * selected pet. Hydrates via pets.vaccine-list / medication-list /
 * vet-visit-list.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Syringe, Pill, Stethoscope, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Vaccine { id: string; name: string; date: string; nextDueDate: string | null; status: string }
interface Medication { id: string; name: string; dosage: string | null; frequency: string | null; active: boolean }
interface VetVisit { id: string; date: string; reason: string; diagnosis: string | null; cost: number }

const STATUS_COLOR: Record<string, string> = {
  overdue: 'text-rose-400', due_soon: 'text-amber-400', scheduled: 'text-emerald-400', none: 'text-zinc-400',
};

export function PetHealthPanel({ petId, onChange }: { petId: string; onChange: () => void }) {
  const [vaccines, setVaccines] = useState<Vaccine[]>([]);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [visits, setVisits] = useState<VetVisit[]>([]);
  const [visitCost, setVisitCost] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vac, setVac] = useState({ name: '', date: '', nextDueDate: '' });
  const [med, setMed] = useState({ name: '', dosage: '', frequency: '' });
  const [visit, setVisit] = useState({ reason: '', date: '', diagnosis: '', cost: '' });

  const refresh = useCallback(async () => {
    if (!petId) return;
    setLoading(true);
    const [v, m, vis] = await Promise.all([
      lensRun('pets', 'vaccine-list', { petId }),
      lensRun('pets', 'medication-list', { petId }),
      lensRun('pets', 'vet-visit-list', { petId }),
    ]);
    setVaccines(v.data?.result?.vaccines || []);
    setMedications(m.data?.result?.medications || []);
    setVisits(vis.data?.result?.visits || []);
    setVisitCost(vis.data?.result?.totalCost || 0);
    setLoading(false);
  }, [petId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addVaccine = async () => {
    if (!vac.name.trim()) { setError('Vaccine name is required.'); return; }
    const r = await lensRun('pets', 'vaccine-record', { petId, name: vac.name.trim(), date: vac.date, nextDueDate: vac.nextDueDate });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setVac({ name: '', date: '', nextDueDate: '' });
    setError(null);
    await refresh(); onChange();
  };
  const delVaccine = async (id: string) => { await lensRun('pets', 'vaccine-delete', { petId, id }); await refresh(); onChange(); };

  const addMed = async () => {
    if (!med.name.trim()) { setError('Medication name is required.'); return; }
    const r = await lensRun('pets', 'medication-add', { petId, name: med.name.trim(), dosage: med.dosage, frequency: med.frequency });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setMed({ name: '', dosage: '', frequency: '' });
    setError(null);
    await refresh(); onChange();
  };
  const stopMed = async (id: string) => { await lensRun('pets', 'medication-delete', { petId, id, stop: true }); await refresh(); };

  const addVisit = async () => {
    if (!visit.reason.trim()) { setError('Visit reason is required.'); return; }
    const r = await lensRun('pets', 'vet-visit-log', {
      petId, reason: visit.reason.trim(), date: visit.date, diagnosis: visit.diagnosis, cost: Number(visit.cost) || 0,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setVisit({ reason: '', date: '', diagnosis: '', cost: '' });
    setError(null);
    await refresh(); onChange();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Vaccinations */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Syringe className="w-3.5 h-3.5 text-teal-400" /> Vaccinations
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input placeholder="Vaccine" value={vac.name} onChange={(e) => setVac({ ...vac, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input type="date" title="Given" value={vac.date} onChange={(e) => setVac({ ...vac, date: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input type="date" title="Next due" value={vac.nextDueDate} onChange={(e) => setVac({ ...vac, nextDueDate: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addVaccine}
            className="flex items-center justify-center gap-1 bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Record
          </button>
        </div>
        {vaccines.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No vaccinations recorded.</p>
        ) : (
          <ul className="space-y-1">
            {vaccines.map((v) => (
              <li key={v.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div>
                  <p className="text-xs text-zinc-200">{v.name}</p>
                  <p className="text-[10px] text-zinc-400">
                    Given {v.date}{v.nextDueDate ? ` · next due ${v.nextDueDate}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn('text-[10px] capitalize', STATUS_COLOR[v.status] || 'text-zinc-400')}>
                    {v.status.replace(/_/g, ' ')}
                  </span>
                  <button aria-label="Delete" type="button" onClick={() => delVaccine(v.id)} className="text-zinc-600 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Medications */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Pill className="w-3.5 h-3.5 text-teal-400" /> Medications
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input placeholder="Medication" value={med.name} onChange={(e) => setMed({ ...med, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Dosage" value={med.dosage} onChange={(e) => setMed({ ...med, dosage: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Frequency" value={med.frequency} onChange={(e) => setMed({ ...med, frequency: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addMed}
            className="flex items-center justify-center gap-1 bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        {medications.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No medications.</p>
        ) : (
          <ul className="space-y-1">
            {medications.map((m) => (
              <li key={m.id} className={cn('flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2',
                !m.active && 'opacity-50')}>
                <span className="text-xs text-zinc-200">
                  {m.name} <span className="text-zinc-400">{[m.dosage, m.frequency].filter(Boolean).join(' · ')}</span>
                </span>
                {m.active && (
                  <button type="button" onClick={() => stopMed(m.id)} className="text-[10px] text-zinc-400 hover:text-zinc-300">Stop</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Vet visits */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Stethoscope className="w-3.5 h-3.5 text-teal-400" /> Vet visits
          {visitCost > 0 && <span className="text-[10px] text-zinc-400">· ${visitCost} total</span>}
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input placeholder="Reason" value={visit.reason} onChange={(e) => setVisit({ ...visit, reason: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input type="date" value={visit.date} onChange={(e) => setVisit({ ...visit, date: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Cost ($)" inputMode="decimal" value={visit.cost} onChange={(e) => setVisit({ ...visit, cost: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addVisit}
            className="flex items-center justify-center gap-1 bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Log
          </button>
        </div>
        {visits.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No vet visits logged.</p>
        ) : (
          <ul className="space-y-1">
            {visits.map((v) => (
              <li key={v.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-200">{v.reason}</span>
                  <span className="text-[11px] text-zinc-400">{v.date}{v.cost > 0 ? ` · $${v.cost}` : ''}</span>
                </div>
                {v.diagnosis && <p className="text-[10px] text-zinc-400 mt-0.5">{v.diagnosis}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
