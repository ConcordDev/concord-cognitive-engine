'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Pill, Plus, Loader2, RefreshCw } from 'lucide-react';
import { VetPrescription } from './vet-types';

const STATUS_COLOR: Record<string, string> = {
  active: 'text-green-400 bg-green-400/10',
  completed: 'text-zinc-400 bg-zinc-400/10',
};

export function PharmacyPanel() {
  const [rxs, setRxs] = useState<VetPrescription[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [drug, setDrug] = useState('');
  const [patientName, setPatientName] = useState('');
  const [dosage, setDosage] = useState('');
  const [frequency, setFrequency] = useState('');
  const [durationDays, setDurationDays] = useState('');
  const [refills, setRefills] = useState('0');
  const [prescribedBy, setPrescribedBy] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('veterinary', 'prescription-list', {});
    if (r.data.ok && r.data.result) {
      const res = r.data.result as { prescriptions: VetPrescription[]; active: number };
      setRxs(res.prescriptions || []);
      setActiveCount(res.active || 0);
      setError(null);
    } else {
      setError(r.data.error || 'failed to load prescriptions');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addRx = async () => {
    if (!drug.trim()) return;
    setBusy(true);
    const r = await lensRun('veterinary', 'prescription-add', {
      drug,
      patientName,
      dosage,
      frequency,
      durationDays: Number(durationDays) || 0,
      refills: Number(refills) || 0,
      prescribedBy,
    });
    setBusy(false);
    if (r.data.ok) {
      setDrug('');
      setPatientName('');
      setDosage('');
      setFrequency('');
      setDurationDays('');
      setRefills('0');
      setPrescribedBy('');
      await load();
    } else {
      setError(r.data.error || 'failed to add prescription');
    }
  };

  const refill = async (id: string) => {
    const r = await lensRun('veterinary', 'prescription-refill', { id });
    if (!r.data.ok) setError(r.data.error || 'refill failed');
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
        <p className="text-[10px] uppercase tracking-wide text-zinc-400">Active prescriptions</p>
        <p className="font-mono text-lg text-green-300">{activeCount}</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          addRx();
        }}
        className="grid grid-cols-2 md:grid-cols-3 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3"
      >
        <input
          value={drug}
          onChange={(e) => setDrug(e.target.value)}
          placeholder="Drug *"
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <input
          value={patientName}
          onChange={(e) => setPatientName(e.target.value)}
          placeholder="Patient name"
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <input
          value={dosage}
          onChange={(e) => setDosage(e.target.value)}
          placeholder="Dosage (250mg)"
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <input
          value={frequency}
          onChange={(e) => setFrequency(e.target.value)}
          placeholder="Frequency (BID)"
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <input
          value={durationDays}
          onChange={(e) => setDurationDays(e.target.value)}
          type="number"
          placeholder="Days"
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <input
          value={refills}
          onChange={(e) => setRefills(e.target.value)}
          type="number"
          placeholder="Refills"
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <input
          value={prescribedBy}
          onChange={(e) => setPrescribedBy(e.target.value)}
          placeholder="Prescribing vet"
          className="col-span-2 md:col-span-3 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <button
          type="submit"
          disabled={busy || !drug.trim()}
          className="col-span-2 md:col-span-3 flex items-center justify-center gap-2 rounded bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add prescription
        </button>
      </form>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading prescriptions…
        </div>
      ) : rxs.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-800 py-8 text-center text-sm text-zinc-400">
          <Pill className="mx-auto mb-2 h-8 w-8 opacity-30" />
          No prescriptions on file.
        </div>
      ) : (
        <div className="space-y-2">
          {rxs.map((rx) => (
            <div
              key={rx.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3"
            >
              <div>
                <p className="text-sm font-semibold text-white">
                  {rx.drug}{' '}
                  <span
                    className={`ml-1 rounded px-1.5 py-0.5 text-[10px] ${STATUS_COLOR[rx.status] || ''}`}
                  >
                    {rx.status}
                  </span>
                </p>
                <p className="text-xs text-zinc-400">
                  {rx.patientName || 'unassigned'}
                  {rx.dosage && ` · ${rx.dosage}`}
                  {rx.frequency && ` · ${rx.frequency}`}
                  {rx.durationDays > 0 && ` · ${rx.durationDays}d`}
                  {rx.prescribedBy && ` · ${rx.prescribedBy}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400">
                  refills {rx.refillsRemaining}/{rx.refillsTotal}
                </span>
                <button
                  onClick={() => refill(rx.id)}
                  disabled={rx.refillsRemaining <= 0}
                  className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-xs text-violet-300 hover:bg-zinc-700 disabled:opacity-40"
                >
                  <RefreshCw className="h-3 w-3" /> Refill
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
