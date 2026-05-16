'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Beaker, Atom, Calculator, Activity, FlaskConical } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface MWResult {
  formula: string;
  molecularWeight: number;
  units: string;
  components: {
    element: string;
    name: string;
    count: number;
    atomicMass: number;
    contribution: number;
    percentMass: number;
  }[];
}

export interface Element {
  z: number;
  name: string;
  mass: number;
  category: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = 'mw' | 'molarity' | 'dilution' | 'ph' | 'gas' | 'table';

const CATEGORY_COLOR: Record<string, string> = {
  nonmetal:          'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  noble_gas:         'bg-violet-500/20 text-violet-300 border-violet-500/40',
  alkali_metal:      'bg-rose-500/20 text-rose-300 border-rose-500/40',
  alkaline_earth:    'bg-amber-500/20 text-amber-300 border-amber-500/40',
  transition_metal:  'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  post_transition:   'bg-sky-500/20 text-sky-300 border-sky-500/40',
  metalloid:         'bg-teal-500/20 text-teal-300 border-teal-500/40',
  halogen:           'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  actinide:          'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40',
};

export function ChemWorkbench({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('mw');

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[640px] max-w-[100vw] z-40 bg-[#0d1117] border-l border-violet-500/20 shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-violet-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <Beaker className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold text-gray-200">Chem Workbench</span>
        </div>
        <button type="button" onClick={onClose}
          className="p-1 rounded-md hover:bg-white/5 text-gray-400" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </header>

      <nav className="px-3 py-2 border-b border-white/10 flex items-center gap-1 overflow-x-auto">
        {([
          { id: 'mw',       label: 'MW',         icon: Atom },
          { id: 'molarity', label: 'Molarity',   icon: Calculator },
          { id: 'dilution', label: 'Dilution',   icon: Calculator },
          { id: 'ph',       label: 'pH',         icon: FlaskConical },
          { id: 'gas',      label: 'Gas law',    icon: Activity },
          { id: 'table',    label: 'Periodic',   icon: Atom },
        ] as const).map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition flex-shrink-0',
                active
                  ? 'bg-violet-500/15 text-violet-200 border border-violet-500/40'
                  : 'text-gray-400 hover:text-gray-200 border border-transparent',
              )}>
              <Icon className="w-3 h-3" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto">
        {tab === 'mw' && <MWTab />}
        {tab === 'molarity' && <MolarityTab />}
        {tab === 'dilution' && <DilutionTab />}
        {tab === 'ph' && <PhTab />}
        {tab === 'gas' && <GasTab />}
        {tab === 'table' && <PeriodicTab />}
      </div>
    </div>
  );
}

function MWTab() {
  const [formula, setFormula] = useState('C6H12O6');
  const [result, setResult] = useState<MWResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const calc = async () => {
    setError(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'chem', action: 'molecular-weight', input: { formula },
      });
      const data = r.data as { ok?: boolean; error?: string; result?: MWResult };
      if (data.ok) setResult(data.result || null);
      else { setError(data.error || 'Failed'); setResult(null); }
    } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { calc(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-3 space-y-3">
      <div className="flex gap-2">
        <input type="text" value={formula} onChange={(e) => setFormula(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') calc(); }}
          placeholder="C6H12O6 / NaCl / Ca(OH)2"
          className="flex-1 px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
        <button type="button" onClick={calc}
          className="px-3 py-1 rounded-md border border-violet-500/40 bg-violet-500/15 text-xs text-violet-100">Calc</button>
      </div>

      {error && <p className="text-xs text-rose-300">{error}</p>}

      {result && (
        <div className="rounded border border-violet-500/20 bg-violet-500/5 p-3">
          <p className="text-sm text-gray-200">
            <span className="font-mono text-violet-300">{result.formula}</span>
            <span className="ml-2 text-2xl text-gray-100">{result.molecularWeight}</span>
            <span className="text-[11px] text-gray-500 ml-1">{result.units}</span>
          </p>
          <div className="mt-3 space-y-1">
            <p className="text-[10px] uppercase text-gray-500 tracking-wider">Composition</p>
            {result.components.map((c) => (
              <div key={c.element} className="flex justify-between text-xs">
                <span className="text-gray-300 font-mono">{c.element}<sub>{c.count}</sub> · {c.name}</span>
                <span className="text-gray-200 font-mono">{c.contribution} ({c.percentMass}%)</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MolarityTab() {
  const [moles, setMoles] = useState('0.5');
  const [liters, setLiters] = useState('1');
  const [result, setResult] = useState<{ moles?: number; liters?: number; molarity?: number; formula?: string } | null>(null);

  const calc = async () => {
    try {
      const input: Record<string, number | undefined> = {};
      if (moles) input.moles = Number(moles);
      if (liters) input.liters = Number(liters);
      const r = await api.post('/api/lens/run', {
        domain: 'chem', action: 'calc-molarity', input,
      });
      const data = r.data as { ok?: boolean; result?: typeof result };
      if (data.ok) setResult(data.result || null);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-3">
      <p className="text-[11px] text-gray-500">Provide any 2 of moles / liters / molarity — solver fills the third.</p>
      <div className="grid grid-cols-3 gap-2">
        {[
          ['moles', 'Moles', moles, setMoles],
          ['liters', 'Liters', liters, setLiters],
        ].map(([id, label, val, setter]) => (
          <label key={id as string} className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-gray-500">{label as string}</span>
            <input type="number" value={val as string} step="0.0001"
              onChange={(e) => (setter as (v: string) => void)(e.target.value)}
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
          </label>
        ))}
      </div>
      <button type="button" onClick={calc}
        className="px-3 py-1 rounded-md border border-violet-500/40 bg-violet-500/15 text-xs text-violet-100">Calculate</button>

      {result && (
        <div className="rounded border border-violet-500/20 bg-violet-500/5 p-3 space-y-1 text-sm">
          <p>Moles: <span className="font-mono text-gray-100">{result.moles}</span></p>
          <p>Liters: <span className="font-mono text-gray-100">{result.liters}</span></p>
          <p>Molarity: <span className="font-mono text-violet-300">{result.molarity} M</span></p>
          <p className="text-[10px] text-gray-500">{result.formula}</p>
        </div>
      )}
    </div>
  );
}

function DilutionTab() {
  const [m1, setM1] = useState('1');
  const [v1, setV1] = useState('');
  const [m2, setM2] = useState('0.1');
  const [v2, setV2] = useState('100');
  const [result, setResult] = useState<{ m1?: number; v1?: number; m2?: number; v2?: number; formula?: string } | null>(null);

  const calc = async () => {
    try {
      const input: Record<string, number | undefined> = {};
      if (m1) input.m1 = Number(m1);
      if (v1) input.v1 = Number(v1);
      if (m2) input.m2 = Number(m2);
      if (v2) input.v2 = Number(v2);
      const r = await api.post('/api/lens/run', {
        domain: 'chem', action: 'calc-dilution', input,
      });
      const data = r.data as { ok?: boolean; result?: typeof result };
      if (data.ok) setResult(data.result || null);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-3">
      <p className="text-[11px] text-gray-500">M1V1 = M2V2 — provide any 3 of the 4 values.</p>
      <div className="grid grid-cols-4 gap-2">
        {[
          ['M1', m1, setM1],
          ['V1', v1, setV1],
          ['M2', m2, setM2],
          ['V2', v2, setV2],
        ].map(([label, val, setter]) => (
          <label key={label as string} className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-gray-500">{label as string}</span>
            <input type="number" value={val as string} step="0.001"
              onChange={(e) => (setter as (v: string) => void)(e.target.value)}
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
          </label>
        ))}
      </div>
      <button type="button" onClick={calc}
        className="px-3 py-1 rounded-md border border-violet-500/40 bg-violet-500/15 text-xs text-violet-100">Solve</button>

      {result && (
        <div className="rounded border border-violet-500/20 bg-violet-500/5 p-3 text-sm font-mono space-y-1">
          <p>M1: <span className="text-gray-100">{result.m1}</span></p>
          <p>V1: <span className="text-gray-100">{result.v1}</span></p>
          <p>M2: <span className="text-gray-100">{result.m2}</span></p>
          <p>V2: <span className="text-gray-100">{result.v2}</span></p>
        </div>
      )}
    </div>
  );
}

function PhTab() {
  const [concentration, setConcentration] = useState('0.01');
  const [kind, setKind] = useState<'acid' | 'base'>('acid');
  const [result, setResult] = useState<{ pH: number; pOH: number; hPlus: number; ohMinus: number; classification: string } | null>(null);

  const calc = async () => {
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'chem', action: 'calc-ph',
        input: { concentration: Number(concentration), kind },
      });
      const data = r.data as { ok?: boolean; result?: typeof result };
      if (data.ok) setResult(data.result || null);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex gap-2">
        <input type="number" value={concentration}
          onChange={(e) => setConcentration(e.target.value)}
          step="0.0001"
          className="flex-1 px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}
          className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
          <option value="acid">Acid (H+)</option>
          <option value="base">Base (OH-)</option>
        </select>
        <button type="button" onClick={calc}
          className="px-3 py-1 rounded-md border border-violet-500/40 bg-violet-500/15 text-xs text-violet-100">Calc</button>
      </div>

      {result && (
        <div className="rounded border border-violet-500/20 bg-violet-500/5 p-3 space-y-1 text-sm">
          <p>pH: <span className="font-mono text-2xl text-violet-300">{result.pH}</span>
            <span className={cn('ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded',
              result.classification === 'acidic' ? 'bg-rose-500/20 text-rose-300'
              : result.classification === 'basic' ? 'bg-cyan-500/20 text-cyan-300'
              : 'bg-emerald-500/20 text-emerald-300')}>
              {result.classification}
            </span>
          </p>
          <p>pOH: <span className="font-mono text-gray-200">{result.pOH}</span></p>
          <p className="text-xs">[H+]: <span className="font-mono text-gray-300">{result.hPlus.toExponential(2)}</span></p>
          <p className="text-xs">[OH-]: <span className="font-mono text-gray-300">{result.ohMinus.toExponential(2)}</span></p>
        </div>
      )}
    </div>
  );
}

function GasTab() {
  const [P, setP] = useState('1');
  const [V, setV] = useState('22.4');
  const [n, setN] = useState('1');
  const [T, setT] = useState('');
  const [result, setResult] = useState<{ P?: number; V?: number; n?: number; T?: number; formula?: string } | null>(null);

  const calc = async () => {
    try {
      const input: Record<string, number | undefined> = {};
      if (P) input.P = Number(P);
      if (V) input.V = Number(V);
      if (n) input.n = Number(n);
      if (T) input.T = Number(T);
      const r = await api.post('/api/lens/run', {
        domain: 'chem', action: 'calc-gas-law', input,
      });
      const data = r.data as { ok?: boolean; result?: typeof result };
      if (data.ok) setResult(data.result || null);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-3">
      <p className="text-[11px] text-gray-500">PV = nRT — provide any 3 of P (atm), V (L), n (mol), T (K).</p>
      <div className="grid grid-cols-4 gap-2">
        {[
          ['P (atm)', P, setP],
          ['V (L)', V, setV],
          ['n (mol)', n, setN],
          ['T (K)', T, setT],
        ].map(([label, val, setter]) => (
          <label key={label as string} className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-gray-500">{label as string}</span>
            <input type="number" value={val as string} step="0.001"
              onChange={(e) => (setter as (v: string) => void)(e.target.value)}
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
          </label>
        ))}
      </div>
      <button type="button" onClick={calc}
        className="px-3 py-1 rounded-md border border-violet-500/40 bg-violet-500/15 text-xs text-violet-100">Solve</button>

      {result && (
        <div className="rounded border border-violet-500/20 bg-violet-500/5 p-3 text-sm font-mono space-y-1">
          <p>P: <span className="text-gray-100">{result.P} atm</span></p>
          <p>V: <span className="text-gray-100">{result.V} L</span></p>
          <p>n: <span className="text-gray-100">{result.n} mol</span></p>
          <p>T: <span className="text-gray-100">{result.T} K</span></p>
        </div>
      )}
    </div>
  );
}

function PeriodicTab() {
  const [elements, setElements] = useState<Record<string, Element>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'chem', action: 'periodic-table', input: {},
      });
      setElements(((r.data as { result?: { elements?: Record<string, Element> } }).result?.elements) || {});
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) {
    return <div className="flex items-center justify-center py-8 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>;
  }

  const sorted = Object.entries(elements).sort((a, b) => a[1].z - b[1].z);

  return (
    <div className="p-3">
      <p className="text-[11px] text-gray-500 mb-3">{sorted.length} elements (subset of 118 — extend via DTU)</p>
      <div className="grid grid-cols-6 gap-1">
        {sorted.map(([sym, el]) => (
          <div key={sym}
            className={cn(
              'rounded border p-1.5 text-center hover:brightness-110 cursor-default',
              CATEGORY_COLOR[el.category] || 'bg-gray-500/20 text-gray-300 border-gray-500/40',
            )}
            title={`${el.name} · Z=${el.z} · ${el.mass} g/mol`}
          >
            <p className="text-[9px] text-gray-500 font-mono">{el.z}</p>
            <p className="text-sm font-bold">{sym}</p>
            <p className="text-[8px]">{el.mass.toFixed(2)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ChemWorkbench;
