'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ClipboardList, Plus, Loader2, FileText } from 'lucide-react';
import { VetSoapNote } from './vet-types';

export function RecordsPanel() {
  const [notes, setNotes] = useState<VetSoapNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [patientName, setPatientName] = useState('');
  const [vet, setVet] = useState('');
  const [date, setDate] = useState('');
  const [subjective, setSubjective] = useState('');
  const [objective, setObjective] = useState('');
  const [assessment, setAssessment] = useState('');
  const [plan, setPlan] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('veterinary', 'soap-list', {});
    if (r.data.ok && r.data.result) {
      setNotes((r.data.result as { notes: VetSoapNote[] }).notes || []);
      setError(null);
    } else {
      setError(r.data.error || 'failed to load SOAP notes');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chart = async () => {
    if (!patientName.trim()) return;
    setBusy(true);
    const r = await lensRun('veterinary', 'soap-chart', {
      patientName,
      vet,
      date,
      subjective,
      objective,
      assessment,
      plan,
    });
    setBusy(false);
    if (r.data.ok) {
      setPatientName('');
      setVet('');
      setDate('');
      setSubjective('');
      setObjective('');
      setAssessment('');
      setPlan('');
      await load();
    } else {
      setError(r.data.error || 'failed to chart');
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-2">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          <FileText className="h-4 w-4" /> New SOAP medical note
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <input
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            placeholder="Patient name *"
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
          />
          <input
            value={vet}
            onChange={(e) => setVet(e.target.value)}
            placeholder="Attending vet"
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
          />
          <input
            value={date}
            onChange={(e) => setDate(e.target.value)}
            type="date"
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
          />
        </div>
        <textarea
          value={subjective}
          onChange={(e) => setSubjective(e.target.value)}
          placeholder="S — Subjective (owner-reported history, behaviour)"
          rows={2}
          className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <textarea
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder="O — Objective (vitals, exam findings, lab values)"
          rows={2}
          className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <textarea
          value={assessment}
          onChange={(e) => setAssessment(e.target.value)}
          placeholder="A — Assessment (diagnosis, differentials)"
          rows={2}
          className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <textarea
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          placeholder="P — Plan (treatment, meds, follow-up)"
          rows={2}
          className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <button
          onClick={chart}
          disabled={busy || !patientName.trim()}
          className="flex w-full items-center justify-center gap-2 rounded bg-pink-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-pink-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Save SOAP note
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading records…
        </div>
      ) : notes.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-800 py-8 text-center text-sm text-zinc-500">
          <ClipboardList className="mx-auto mb-2 h-8 w-8 opacity-30" />
          No medical notes charted yet.
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map((n) => (
            <div key={n.id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white">{n.patientName}</p>
                <p className="text-xs text-zinc-500">
                  {n.date} {n.vet && `· ${n.vet}`}
                </p>
              </div>
              <dl className="mt-2 space-y-1 text-xs">
                {[
                  ['S', n.subjective],
                  ['O', n.objective],
                  ['A', n.assessment],
                  ['P', n.plan],
                ].map(([k, v]) =>
                  v ? (
                    <div key={k} className="flex gap-2">
                      <dt className="w-4 shrink-0 font-bold text-pink-400">{k}</dt>
                      <dd className="text-zinc-300">{v}</dd>
                    </div>
                  ) : null,
                )}
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
