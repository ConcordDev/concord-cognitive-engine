'use client';

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Activity, Scale, Syringe, Calculator, Loader2 } from 'lucide-react';
import { SPECIES_OPTIONS } from './vet-types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CalcResult = Record<string, any>;

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

export function CalculatorsPanel() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <TriageCalc />
      <WeightCalc />
      <VaccineCalc />
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
    setBusy(true);
    const r = await lensRun('veterinary', 'triageAssess', {
      data: { species, age: Number(age), symptoms },
    });
    setBusy(false);
    if (r.data.ok) setResult(r.data.result as CalcResult);
  };

  return (
    <CalcCard icon={<Activity className="h-4 w-4 text-red-400" />} title="Triage assessment">
      <div className="space-y-2">
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
        {result && (
          <div className="rounded bg-zinc-950 p-2 text-xs text-zinc-300">
            <p className="font-semibold text-red-400">{result.triageLevel}</p>
            <p>{result.responseTime}</p>
            {result.firstAid?.length > 0 && (
              <ul className="mt-1 list-disc pl-4 text-zinc-400">
                {result.firstAid.map((f: string, i: number) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </CalcCard>
  );
}

function WeightCalc() {
  const [species, setSpecies] = useState('dog');
  const [breed, setBreed] = useState('');
  const [weight, setWeight] = useState('');
  const [result, setResult] = useState<CalcResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const r = await lensRun('veterinary', 'weightCheck', {
      data: { species, breed, weight: Number(weight) },
    });
    setBusy(false);
    if (r.data.ok) setResult(r.data.result as CalcResult);
  };

  return (
    <CalcCard icon={<Scale className="h-4 w-4 text-emerald-400" />} title="Weight check">
      <div className="space-y-2">
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
            value={breed}
            onChange={(e) => setBreed(e.target.value)}
            placeholder="Breed"
            className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white"
          />
          <input
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            type="number"
            placeholder="lbs"
            className="w-20 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white"
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
        {result && (
          <div className="rounded bg-zinc-950 p-2 text-xs text-zinc-300">
            <p className="font-semibold text-emerald-400">{result.status}</p>
            <p>Ideal range: {result.idealRange}</p>
            <p className="text-zinc-400">{result.recommendation}</p>
          </div>
        )}
      </div>
    </CalcCard>
  );
}

function VaccineCalc() {
  const [species, setSpecies] = useState('dog');
  const [age, setAge] = useState('1');
  const [result, setResult] = useState<CalcResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const r = await lensRun('veterinary', 'vaccineSchedule', {
      data: { species, age: Number(age) },
    });
    setBusy(false);
    if (r.data.ok) setResult(r.data.result as CalcResult);
  };

  return (
    <CalcCard icon={<Syringe className="h-4 w-4 text-blue-400" />} title="Vaccine schedule">
      <div className="space-y-2">
        <div className="flex gap-2">
          <select
            value={species}
            onChange={(e) => setSpecies(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white"
          >
            <option value="dog">dog</option>
            <option value="cat">cat</option>
          </select>
          <input
            value={age}
            onChange={(e) => setAge(e.target.value)}
            type="number"
            placeholder="Age (yr)"
            className="w-24 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white"
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
        {result && (
          <div className="space-y-1 rounded bg-zinc-950 p-2 text-xs text-zinc-300">
            {result.vaccines?.map((v: CalcResult, i: number) => (
              <div key={i} className="flex justify-between">
                <span className="text-blue-400">{v.vaccine}</span>
                <span className="text-zinc-400">{v.due} · booster {v.booster}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </CalcCard>
  );
}

function CostCalc() {
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<CalcResult | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const r = await lensRun('veterinary', 'costEstimate', {
      data: { procedures: selected.map((type) => ({ type })) },
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
              <p className="text-zinc-400">{result.message}</p>
            )}
          </div>
        )}
      </div>
    </CalcCard>
  );
}
