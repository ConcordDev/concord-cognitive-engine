'use client';

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Activity, Scale, Syringe, Calculator, Loader2 } from 'lucide-react';
import { SPECIES_OPTIONS } from './vet-types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CalcResult = Record<string, any>;

const TRIAGE_LIMIT = 'Not a veterinary assessment and not a substitute for one. Call a veterinarian or an emergency clinic.';

const TRIAGE_SYMPTOMS = [
  'seizure',
  'bleeding',
  'not-breathing',
  'unconscious',
  'poisoning',
  'bloat',
  'vomiting',
  'diarrhea',
  'limping',
  'not-eating',
  'lethargy',
  'swelling',
];

function yearsOrNull(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const PROCEDURES = [
  'exam',
  'vaccination',
  'spay',
  'neuter',
  'dental',
  'xray',
  'bloodwork',
  'surgery',
  'emergency',
  'microchip',
];

type ChartPatient = { id: string; name?: string; species?: string };

function useChartPatients() {
  const [patients, setPatients] = useState<ChartPatient[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await lensRun('veterinary', 'patient-list', {});
      if (cancelled) return;
      if (r.data.ok) {
        const raw = (r.data.result as { patients?: ChartPatient[] } | null)?.patients;
        const list = Array.isArray(raw) ? raw.filter((p) => p && typeof p.id === 'string' && p.id) : [];
        setPatients(list);
        setLoadError(null);
      } else {
        setPatients([]);
        setLoadError(typeof r.data.error === 'string' && r.data.error ? r.data.error : 'Patient list unavailable');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { patients, loadError };
}

function PatientScopeSelect({
  patients,
  loadError,
  patientId,
  onChange,
  genericLine,
}: {
  patients: ChartPatient[];
  loadError: string | null;
  patientId: string;
  onChange: (id: string) => void;
  genericLine: string;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
        Patient
        <select
          aria-label="Patient"
          value={patientId}
          onChange={(e) => onChange(e.target.value)}
          className="mt-0.5 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs normal-case tracking-normal text-white"
        >
          <option value="">No patient — generic</option>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || 'Unnamed'}
              {p.species ? ` · ${p.species}` : ''}
            </option>
          ))}
        </select>
      </label>
      {loadError ? <p className="text-[10px] text-zinc-500">{loadError}</p> : null}
      <p className="text-[10px] text-zinc-400">{patientId ? 'Reads this patient chart.' : genericLine}</p>
    </div>
  );
}

export function CalculatorsPanel() {
  const chart = useChartPatients();
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <TriageCalc />
      <WeightCalc chart={chart} />
      <VaccineCalc chart={chart} />
      <CostCalc />
    </div>
  );
}

function CalcCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
        {icon} {title}
      </p>
      {children}
    </div>
  );
}

function TriageCalc() {
  const [species, setSpecies] = useState('dog');
  const [age, setAge] = useState('3');
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [result, setResult] = useState<CalcResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const years = yearsOrNull(age);
    if (years == null) {
      setResult({ status: 'NOT_COMPUTED', message: 'Age not recorded' });
      return;
    }
    setBusy(true);
    const r = await lensRun('veterinary', 'triageAssess', { species, age: years, symptoms });
    setBusy(false);
    if (r.data.ok) setResult(r.data.result as CalcResult);
  };

  return (
    <CalcCard icon={<Activity className="h-4 w-4 text-red-400" />} title="Triage assessment">
      <div className="space-y-2">
        <p className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1.5 text-xs text-red-100">{TRIAGE_LIMIT}</p>
        <div className="flex gap-2">
          <select
            value={species}
            onChange={(e) => setSpecies(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white"
          >
            {SPECIES_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            value={age}
            onChange={(e) => setAge(e.target.value)}
            type="number"
            placeholder="Age"
            className="w-20 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {TRIAGE_SYMPTOMS.map((s) => (
            <button
              key={s}
              onClick={() =>
                setSymptoms((prev) =>
                  prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
                )
              }
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                symptoms.includes(s)
                  ? 'bg-red-500/20 text-red-300'
                  : 'bg-zinc-800 text-zinc-400'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="flex w-full items-center justify-center gap-1 rounded bg-red-600 px-2 py-1.5 text-xs text-white hover:bg-red-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
          Assess
        </button>
        {result?.status === 'NOT_COMPUTED' ? (
          <p className="rounded bg-zinc-950 p-2 text-xs text-zinc-400">{result.message || 'Not recorded'}</p>
        ) : result ? (
          <div className="rounded bg-zinc-950 p-2 text-xs text-zinc-300">
            <p className="font-semibold text-red-400">{result.triageLevel}</p>
            <p className="mt-1 text-zinc-400">{result.advisoryBasis || TRIAGE_LIMIT}</p>
            <p>{result.responseTime}</p>
            {result.firstAid?.length > 0 && (
              <ul className="mt-1 list-disc pl-4 text-zinc-400">
                {result.firstAid.map((f: string, i: number) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </CalcCard>
  );
}

function WeightCalc({ chart }: { chart: { patients: ChartPatient[]; loadError: string | null } }) {
  const [patientId, setPatientId] = useState('');
  const [species, setSpecies] = useState('dog');
  const [breed, setBreed] = useState('');
  const [weight, setWeight] = useState('');
  const [result, setResult] = useState<CalcResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (patientId) {
      setBusy(true);
      const r = await lensRun('veterinary', 'weightCheck', { patientId });
      setBusy(false);
      if (r.data.ok) setResult(r.data.result as CalcResult);
      else setResult({ status: 'NOT_COMPUTED', message: r.data.error || 'Patient chart unavailable' });
      return;
    }
    const raw = weight.trim();
    const n = raw === '' ? null : Number(raw);
    if (n == null || !Number.isFinite(n) || n <= 0) {
      setResult({ status: 'NOT_COMPUTED', message: 'Weight not recorded', scope: 'generic' });
      return;
    }
    setBusy(true);
    const r = await lensRun('veterinary', 'weightCheck', { species, breed, weight: n });
    setBusy(false);
    if (r.data.ok) setResult(r.data.result as CalcResult);
    else setResult({ status: 'NOT_COMPUTED', message: r.data.error || 'Weight check unavailable' });
  };

  return (
    <CalcCard icon={<Scale className="h-4 w-4 text-emerald-400" />} title="Weight check">
      <div className="space-y-2">
        <PatientScopeSelect
          patients={chart.patients}
          loadError={chart.loadError}
          patientId={patientId}
          onChange={setPatientId}
          genericLine="Generic band. It does not read a patient chart."
        />
        <div className="flex gap-2">
          <select
            value={species}
            onChange={(e) => setSpecies(e.target.value)}
            disabled={patientId !== ''}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white disabled:opacity-40"
          >
            {SPECIES_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            value={breed}
            onChange={(e) => setBreed(e.target.value)}
            placeholder="Breed"
            disabled={patientId !== ''}
            className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white disabled:opacity-40"
          />
          <input
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            type="number"
            placeholder="lbs"
            disabled={patientId !== ''}
            className="w-20 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white disabled:opacity-40"
          />
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="flex w-full items-center justify-center gap-1 rounded bg-emerald-600 px-2 py-1.5 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Scale className="h-3 w-3" />}
          Check
        </button>
        {result?.status === 'NOT_COMPUTED' ? (
          <p className="rounded bg-zinc-950 p-2 text-xs text-zinc-400">
            {result.message || (Array.isArray(result.missingInputs) ? `Not recorded: ${result.missingInputs.join(', ')}` : 'Not recorded')}
          </p>
        ) : result ? (
          <div className="rounded bg-zinc-950 p-2 text-xs text-zinc-300">
            <p className="text-zinc-500">
              {result.scope === 'patient' ? 'From this patient chart.' : 'Generic band. It does not read a patient chart.'}
            </p>
            <p className="font-semibold text-emerald-400">{result.status}</p>
            <p>Ideal range: {result.idealRange}</p>
            <p className="text-zinc-400">{result.recommendation}</p>
          </div>
        ) : null}
      </div>
    </CalcCard>
  );
}

function VaccineCalc({ chart }: { chart: { patients: ChartPatient[]; loadError: string | null } }) {
  const [patientId, setPatientId] = useState('');
  const [species, setSpecies] = useState('dog');
  const [age, setAge] = useState('1');
  const [result, setResult] = useState<CalcResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (patientId) {
      setBusy(true);
      const r = await lensRun('veterinary', 'vaccineSchedule', { patientId });
      setBusy(false);
      if (r.data.ok) setResult(r.data.result as CalcResult);
      else setResult({ status: 'NOT_COMPUTED', message: r.data.error || 'Patient chart unavailable' });
      return;
    }
    const years = yearsOrNull(age);
    if (years == null) {
      setResult({ status: 'NOT_COMPUTED', message: 'Age not recorded', scope: 'generic' });
      return;
    }
    setBusy(true);
    const r = await lensRun('veterinary', 'vaccineSchedule', { species, age: years });
    setBusy(false);
    if (r.data.ok) setResult(r.data.result as CalcResult);
    else setResult({ status: 'NOT_COMPUTED', message: r.data.error || 'Vaccine schedule unavailable' });
  };

  return (
    <CalcCard icon={<Syringe className="h-4 w-4 text-blue-400" />} title="Vaccine schedule">
      <div className="space-y-2">
        <PatientScopeSelect
          patients={chart.patients}
          loadError={chart.loadError}
          patientId={patientId}
          onChange={setPatientId}
          genericLine="Generic table. It does not read a patient chart."
        />
        <div className="flex gap-2">
          <select
            value={species}
            onChange={(e) => setSpecies(e.target.value)}
            disabled={patientId !== ''}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white disabled:opacity-40"
          >
            <option value="dog">dog</option>
            <option value="cat">cat</option>
          </select>
          <input
            value={age}
            onChange={(e) => setAge(e.target.value)}
            type="number"
            placeholder="Age (yr)"
            disabled={patientId !== ''}
            className="w-24 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white disabled:opacity-40"
          />
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="flex w-full items-center justify-center gap-1 rounded bg-blue-600 px-2 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Syringe className="h-3 w-3" />}
          Build schedule
        </button>
        {result?.status === 'NOT_COMPUTED' ? (
          <p className="rounded bg-zinc-950 p-2 text-xs text-zinc-400">
            {result.message || (Array.isArray(result.missingInputs) ? `Not recorded: ${result.missingInputs.join(', ')}` : 'Not recorded')}
          </p>
        ) : result ? (
          <div className="space-y-1 rounded bg-zinc-950 p-2 text-xs text-zinc-300">
            <p className="text-zinc-500">
              {result.scope === 'patient' ? 'Reads this patient chart.' : 'Generic table. It does not read a patient chart.'}
            </p>
            {result.vaccines?.map((v: CalcResult, i: number) => (
              <div key={i} className="flex justify-between gap-2">
                <span className="text-blue-400">{v.vaccine}</span>
                <span className="text-right text-zinc-400">
                  {v.fromChart ? 'chart · ' : ''}
                  {v.due} · booster {v.booster}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </CalcCard>
  );
}

/**
 * Why a cost estimate has no total. The server sends `unavailable` (the
 * procedure lines with no catalog or quoted price) for reason `not_recorded`;
 * `message` only exists on the empty-input reply, so never render a blank.
 */
function costNotRecordedText(result: CalcResult): string {
  const missing: string[] = Array.isArray(result.unavailable) ? result.unavailable : [];
  if (missing.length > 0) {
    const names = missing.map((m) => (m.startsWith('procedures[') ? 'an unnamed procedure' : m));
    return `Not recorded: ${names.join(', ')}`;
  }
  return result.message || 'Not recorded';
}

function CostCalc() {
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<CalcResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const r = await lensRun('veterinary', 'costEstimate', {
      procedures: selected.map((type) => ({ type })),
    });
    setBusy(false);
    if (r.data.ok) setResult(r.data.result as CalcResult);
  };

  return (
    <CalcCard icon={<Calculator className="h-4 w-4 text-amber-400" />} title="Cost estimate">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1">
          {PROCEDURES.map((p) => (
            <button
              key={p}
              onClick={() =>
                setSelected((prev) =>
                  prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
                )
              }
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                selected.includes(p)
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'bg-zinc-800 text-zinc-400'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="flex w-full items-center justify-center gap-1 rounded bg-amber-600 px-2 py-1.5 text-xs text-white hover:bg-amber-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Calculator className="h-3 w-3" />}
          Estimate
        </button>
        {result && (
          <div className="rounded bg-zinc-950 p-2 text-xs text-zinc-300">
            {result.totalEstimate != null ? (
              <>
                {result.procedures?.map((p: CalcResult, i: number) => (
                  <div key={i} className="flex justify-between">
                    <span>{p.procedure}</span>
                    <span className="font-mono">${p.estimatedCost}</span>
                  </div>
                ))}
                <div className="mt-1 flex justify-between border-t border-zinc-800 pt-1 font-semibold text-amber-400">
                  <span>Total</span>
                  <span className="font-mono">${result.totalEstimate}</span>
                </div>
                <p className="mt-1 text-zinc-400">{result.tip}</p>
              </>
            ) : (
              <p className="text-zinc-400">{costNotRecordedText(result)}</p>
            )}
          </div>
        )}
      </div>
    </CalcCard>
  );
}
