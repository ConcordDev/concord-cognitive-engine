'use client';

/**
 * ImmunizationsPanel — surfaces the healthcare lens's immunization records (the
 * healthcare.immunizations-* macros existed backend-side but had no UI). Pick a
 * patient, see their vaccines, add a new one. An Epic-core EHR feature.
 */

import { useCallback, useEffect, useState } from 'react';
import { Syringe, Plus, Loader2, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Patient { id: string; mrn?: string; firstName?: string; lastName?: string }
interface Immunization { id: string; vaccine: string; administeredAt?: string; doseSeries?: string; manufacturer?: string }

export function ImmunizationsPanel({ className }: { className?: string }) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientId, setPatientId] = useState('');
  const [records, setRecords] = useState<Immunization[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [vaccine, setVaccine] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Load the patient roster once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await lensRun({ domain: 'healthcare', action: 'patients-list', input: {} });
        const list = (r?.data?.result?.patients || []) as Patient[];
        if (cancelled) return;
        setPatients(list);
        if (list.length && !patientId) setPatientId(list[0].id);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load patients');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRecords = useCallback(async (pid: string) => {
    if (!pid) { setRecords([]); return; }
    setLoading(true); setError(null);
    try {
      const r = await lensRun({ domain: 'healthcare', action: 'immunizations-list', input: { patientId: pid } });
      const list = (r?.data?.result?.immunizations || []) as Immunization[];
      setRecords(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load immunizations');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadRecords(patientId); }, [patientId, loadRecords]);

  const add = useCallback(async () => {
    if (!patientId || !vaccine.trim()) return;
    setSaving(true); setError(null);
    try {
      const r = await lensRun({
        domain: 'healthcare', action: 'immunizations-add',
        input: { patientId, vaccine: vaccine.trim(), administeredAt: date || new Date().toISOString().slice(0, 10) },
      });
      if (r?.data?.error) setError(String(r.data.error));
      else { setVaccine(''); setDate(''); await loadRecords(patientId); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add immunization');
    } finally { setSaving(false); }
  }, [patientId, vaccine, date, loadRecords]);

  const pLabel = (p: Patient) => `${p.lastName || ''}${p.firstName ? ', ' + p.firstName : ''}${p.mrn ? ' (' + p.mrn + ')' : ''}` || p.id;

  return (
    <div className={cn('rounded-xl border border-zinc-800 bg-zinc-950/40 p-4', className)}>
      <div className="flex items-center gap-2 mb-3">
        <Syringe className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-zinc-100">Immunizations</h3>
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />}
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 text-xs text-rose-300">
          <AlertTriangle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      <div className="mb-3">
        <select value={patientId} onChange={(e) => setPatientId(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none">
          {patients.length === 0 && <option value="">No patients</option>}
          {patients.map((p) => <option key={p.id} value={p.id}>{pLabel(p)}</option>)}
        </select>
      </div>

      <div className="space-y-1.5 mb-3">
        {records.length === 0 && !loading && <p className="text-xs text-zinc-400">No immunizations recorded for this patient.</p>}
        {records.map((r) => (
          <div key={r.id} className="flex items-center gap-2 text-xs">
            <span className="text-zinc-100 font-medium flex-1">{r.vaccine}</span>
            {r.doseSeries && <span className="text-zinc-500">{r.doseSeries}</span>}
            {r.administeredAt && <span className="text-cyan-300/80 font-mono">{String(r.administeredAt).slice(0, 10)}</span>}
          </div>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void add(); }} className="flex flex-wrap items-center gap-2">
        <input value={vaccine} onChange={(e) => setVaccine(e.target.value)} placeholder="Vaccine (e.g. MMR)" maxLength={60} disabled={!patientId}
          className="flex-1 min-w-[8rem] bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:border-cyan-500 focus:outline-none disabled:opacity-50" />
        <input value={date} onChange={(e) => setDate(e.target.value)} type="date" disabled={!patientId}
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:outline-none disabled:opacity-50" />
        <button type="submit" disabled={saving || !patientId || !vaccine.trim()}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs font-medium hover:bg-cyan-500/30 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Record
        </button>
      </form>
    </div>
  );
}

export default ImmunizationsPanel;
