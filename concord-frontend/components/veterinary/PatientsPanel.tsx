'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Heart, Plus, Trash2, Loader2, Stethoscope, Syringe, ChevronRight } from 'lucide-react';
import {
  VetPatient,
  SPECIES_OPTIONS,
  SPECIES_EMOJI,
  VISIT_KINDS,
} from './vet-types';

export function PatientsPanel({ onChanged }: { onChanged?: () => void }) {
  const [patients, setPatients] = useState<VetPatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [pName, setPName] = useState('');
  const [pSpecies, setPSpecies] = useState('dog');
  const [pBreed, setPBreed] = useState('');
  const [pOwner, setPOwner] = useState('');
  const [pAge, setPAge] = useState('');
  const [pWeight, setPWeight] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('veterinary', 'patient-list', {});
    if (r.data.ok && r.data.result) {
      setPatients((r.data.result as { patients: VetPatient[] }).patients || []);
      setError(null);
    } else {
      setError(r.data.error || 'failed to load patients');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addPatient = async () => {
    if (!pName.trim()) return;
    setBusy(true);
    const r = await lensRun('veterinary', 'patient-add', {
      name: pName,
      species: pSpecies,
      breed: pBreed,
      owner: pOwner,
      ageYears: Number(pAge) || 0,
      weightLbs: Number(pWeight) || 0,
    });
    setBusy(false);
    if (r.data.ok) {
      setPName('');
      setPBreed('');
      setPOwner('');
      setPAge('');
      setPWeight('');
      await load();
      onChanged?.();
    } else {
      setError(r.data.error || 'failed to add patient');
    }
  };

  const removePatient = async (id: string) => {
    await lensRun('veterinary', 'patient-delete', { id });
    await load();
    onChanged?.();
  };

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          addPatient();
        }}
        className="grid grid-cols-2 md:grid-cols-4 gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3"
      >
        <input
          value={pName}
          onChange={(e) => setPName(e.target.value)}
          placeholder="Patient name *"
          className="col-span-2 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <select
          value={pSpecies}
          onChange={(e) => setPSpecies(e.target.value)}
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        >
          {SPECIES_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {SPECIES_EMOJI[s]} {s}
            </option>
          ))}
        </select>
        <input
          value={pBreed}
          onChange={(e) => setPBreed(e.target.value)}
          placeholder="Breed"
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <input
          value={pOwner}
          onChange={(e) => setPOwner(e.target.value)}
          placeholder="Owner"
          className="col-span-2 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <input
          value={pAge}
          onChange={(e) => setPAge(e.target.value)}
          placeholder="Age (yr)"
          type="number"
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <input
          value={pWeight}
          onChange={(e) => setPWeight(e.target.value)}
          placeholder="Weight (lb)"
          type="number"
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <button
          type="submit"
          disabled={busy || !pName.trim()}
          className="col-span-2 md:col-span-4 flex items-center justify-center gap-2 rounded bg-pink-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-pink-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Register patient
        </button>
      </form>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading patients…
        </div>
      ) : patients.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-800 py-8 text-center text-sm text-zinc-500">
          <Heart className="mx-auto mb-2 h-8 w-8 opacity-30" />
          No patients registered yet.
        </div>
      ) : (
        <div className="space-y-2">
          {patients.map((p) => (
            <div key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-900">
              <div className="flex items-center justify-between p-3">
                <button
                  onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                  className="flex flex-1 items-center gap-3 text-left"
                >
                  <ChevronRight
                    className={`h-4 w-4 text-zinc-500 transition-transform ${expanded === p.id ? 'rotate-90' : ''}`}
                  />
                  <span className="text-lg">{SPECIES_EMOJI[p.species] || '🐾'}</span>
                  <div>
                    <p className="text-sm font-semibold text-white">{p.name}</p>
                    <p className="text-xs text-zinc-500">
                      {p.breed} · {p.species} · {p.owner || 'no owner'}
                    </p>
                  </div>
                </button>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-xs text-zinc-400">
                    <Stethoscope className="h-3.5 w-3.5" /> {p.visitCount ?? p.visits.length}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-zinc-400">
                    <Syringe className="h-3.5 w-3.5" /> {p.vaccinationCount ?? p.vaccinations.length}
                  </span>
                  <button
                    onClick={() => removePatient(p.id)}
                    aria-label="Delete patient"
                    className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {expanded === p.id && (
                <PatientDetail patient={p} onChanged={async () => { await load(); onChanged?.(); }} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PatientDetail({ patient, onChanged }: { patient: VetPatient; onChanged: () => void }) {
  const [vKind, setVKind] = useState('checkup');
  const [vDiagnosis, setVDiagnosis] = useState('');
  const [vCost, setVCost] = useState('');
  const [vacName, setVacName] = useState('');
  const [vacDue, setVacDue] = useState('');
  const [busy, setBusy] = useState(false);

  const logVisit = async () => {
    setBusy(true);
    await lensRun('veterinary', 'visit-log', {
      patientId: patient.id,
      kind: vKind,
      diagnosis: vDiagnosis,
      cost: Number(vCost) || 0,
    });
    setBusy(false);
    setVDiagnosis('');
    setVCost('');
    onChanged();
  };

  const addVaccine = async () => {
    if (!vacName.trim()) return;
    setBusy(true);
    await lensRun('veterinary', 'vaccine-record', {
      patientId: patient.id,
      vaccine: vacName,
      nextDue: vacDue,
    });
    setBusy(false);
    setVacName('');
    setVacDue('');
    onChanged();
  };

  return (
    <div className="grid gap-3 border-t border-zinc-800 p-3 md:grid-cols-2">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Visit history</p>
        <div className="max-h-32 space-y-1 overflow-y-auto">
          {patient.visits.length === 0 && <p className="text-xs text-zinc-600">No visits.</p>}
          {patient.visits.map((v) => (
            <div key={v.id} className="rounded bg-zinc-950 px-2 py-1 text-xs text-zinc-300">
              <span className="text-pink-400">{v.kind}</span> · {v.date} · ${v.cost}
              {v.diagnosis && <span className="text-zinc-500"> — {v.diagnosis}</span>}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          <select
            value={vKind}
            onChange={(e) => setVKind(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-xs text-white"
          >
            {VISIT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <input
            value={vDiagnosis}
            onChange={(e) => setVDiagnosis(e.target.value)}
            placeholder="Diagnosis"
            className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-xs text-white"
          />
          <input
            value={vCost}
            onChange={(e) => setVCost(e.target.value)}
            placeholder="$"
            type="number"
            className="w-16 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-xs text-white"
          />
          <button
            onClick={logVisit}
            disabled={busy}
            className="rounded bg-zinc-700 px-2 py-1 text-xs text-white hover:bg-zinc-600 disabled:opacity-50"
          >
            Log visit
          </button>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Vaccinations</p>
        <div className="max-h-32 space-y-1 overflow-y-auto">
          {patient.vaccinations.length === 0 && <p className="text-xs text-zinc-600">No vaccinations.</p>}
          {patient.vaccinations.map((v) => (
            <div key={v.id} className="rounded bg-zinc-950 px-2 py-1 text-xs text-zinc-300">
              <span className="text-emerald-400">{v.vaccine}</span> · {v.date}
              {v.nextDue && <span className="text-zinc-500"> → due {v.nextDue}</span>}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          <input
            value={vacName}
            onChange={(e) => setVacName(e.target.value)}
            placeholder="Vaccine"
            className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-xs text-white"
          />
          <input
            value={vacDue}
            onChange={(e) => setVacDue(e.target.value)}
            placeholder="Next due"
            type="date"
            className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-xs text-white"
          />
          <button
            onClick={addVaccine}
            disabled={busy || !vacName.trim()}
            className="rounded bg-zinc-700 px-2 py-1 text-xs text-white hover:bg-zinc-600 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
