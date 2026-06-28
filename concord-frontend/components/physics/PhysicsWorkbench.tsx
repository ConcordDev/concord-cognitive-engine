'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, Atom, Zap, Activity, Calculator, Compass } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = 'kinematics' | 'projectile' | 'units' | 'constants';

export function PhysicsWorkbench({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('kinematics');

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[560px] max-w-[100vw] z-40 bg-[#0d1117] border-l border-indigo-500/20 shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-indigo-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <Atom className="w-4 h-4 text-indigo-400" />
          <span className="text-sm font-semibold text-gray-200">Physics Workbench</span>
        </div>
        <button type="button" onClick={onClose}
          className="p-1 rounded-md hover:bg-white/5 text-gray-400" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </header>

      <nav className="px-3 py-2 border-b border-white/10 flex items-center gap-1">
        {([
          { id: 'kinematics', label: 'Kinematics', icon: Activity },
          { id: 'projectile', label: 'Projectile', icon: Compass },
          { id: 'units',      label: 'Units',      icon: Calculator },
          { id: 'constants',  label: 'Constants',  icon: Zap },
        ] as const).map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition',
                active
                  ? 'bg-indigo-500/15 text-indigo-200 border border-indigo-500/40'
                  : 'text-gray-400 hover:text-gray-200 border border-transparent',
              )}>
              <Icon className="w-3 h-3" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto">
        {tab === 'kinematics' && <KinematicsTab />}
        {tab === 'projectile' && <ProjectileTab />}
        {tab === 'units' && <UnitsTab />}
        {tab === 'constants' && <ConstantsTab />}
      </div>
    </div>
  );
}

function KinematicsTab() {
  const [vals, setVals] = useState({ v0: '0', v: '', a: '9.81', t: '2', x: '' });
  const [result, setResult] = useState<{ solved: Record<string, number | null>; equations: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Surface BOTH a thrown fetch error AND a handler-level { ok:false, error }.
  // The kinematics-1d handler returns ok:false (with a string error) when fewer
  // than 3 of {v0,v,a,t,x} are finite — a silent `r.data.result || null` would
  // hide that as a blank panel (the swallowed-fetch → silent-empty defect).
  const calc = async () => {
    setBusy(true); setError(null);
    try {
      const input: Record<string, number | undefined> = {};
      for (const [k, v] of Object.entries(vals)) if (v.trim()) input[k] = Number(v);
      const r = await api.post('/api/lens/run', { domain: 'physics', action: 'kinematics-1d', input });
      const env = r.data as { ok?: boolean; error?: string; result?: (typeof result) & { ok?: boolean; error?: string } };
      const inner = env.result;
      if (inner && inner.ok === false) { setResult(null); setError(inner.error || 'Could not solve.'); return; }
      if (env.ok === false) { setResult(null); setError(env.error || 'Could not solve.'); return; }
      if (!inner || !inner.solved) { setResult(null); setError('No solution returned.'); return; }
      setResult(inner);
    } catch (e) {
      console.error(e);
      setResult(null);
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally { setBusy(false); }
  };

  return (
    <div className="p-3 space-y-3">
      <p className="text-[11px] text-gray-400">Provide any 3 of v₀, v, a, t, x. Empty fields will be solved.</p>
      <div className="grid grid-cols-5 gap-2">
        {(['v0','v','a','t','x'] as const).map((k) => (
          <label key={k} className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-gray-400 font-mono">{k}</span>
            <input type="number" value={vals[k]}
              onChange={(e) => setVals({ ...vals, [k]: e.target.value })}
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
          </label>
        ))}
      </div>
      <button type="button" onClick={calc} disabled={busy}
        className="px-3 py-1 rounded-md border border-indigo-500/40 bg-indigo-500/15 text-xs text-indigo-100 disabled:opacity-50 inline-flex items-center gap-1.5">
        {busy && <Loader2 className="w-3 h-3 animate-spin" />}Solve</button>

      {error && (
        <div role="alert" className="rounded border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300">{error}</div>
      )}

      {!result && !error && !busy && (
        <p className="text-[11px] text-gray-500 italic">Enter values and Solve to compute the missing quantity.</p>
      )}

      {result && (
        <div className="rounded border border-indigo-500/20 bg-indigo-500/5 p-3 space-y-1 text-sm">
          {Object.entries(result.solved).map(([k, v]) => (
            <p key={k}>
              <span className="font-mono text-gray-400">{k}:</span>{' '}
              <span className="font-mono text-gray-100">{v == null ? '—' : v}</span>
            </p>
          ))}
          <p className="text-[10px] text-gray-400 mt-2">{result.equations.join(' · ')}</p>
        </div>
      )}
    </div>
  );
}

function ProjectileTab() {
  const [v0, setV0] = useState('20');
  const [angle, setAngle] = useState('45');
  const [h0, setH0] = useState('0');
  const [result, setResult] = useState<{
    timeOfFlight_s: number; range_m: number; maxHeight_m: number;
    timeToApex_s: number; impactSpeed_mps: number; v0x_mps: number; v0y_mps: number;
  } | null>(null);

  const calc = async () => {
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'physics', action: 'projectile',
        input: { v0: Number(v0), angleDeg: Number(angle), h0: Number(h0) },
      });
      setResult(((r.data as { result?: typeof result }).result) || null);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {([
          ['v₀ (m/s)', v0, setV0],
          ['Angle (°)', angle, setAngle],
          ['h₀ (m)', h0, setH0],
        ] as const).map(([label, val, setter]) => (
          <label key={label} className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-gray-400">{label}</span>
            <input type="number" value={val}
              onChange={(e) => setter(e.target.value)}
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
          </label>
        ))}
      </div>
      <button type="button" onClick={calc}
        className="px-3 py-1 rounded-md border border-indigo-500/40 bg-indigo-500/15 text-xs text-indigo-100">Launch</button>

      {result && (
        <div className="rounded border border-indigo-500/20 bg-indigo-500/5 p-3 grid grid-cols-2 gap-2 text-xs">
          <p><span className="text-gray-400">Time of flight:</span> <span className="font-mono text-gray-100">{result.timeOfFlight_s}s</span></p>
          <p><span className="text-gray-400">Range:</span> <span className="font-mono text-gray-100">{result.range_m}m</span></p>
          <p><span className="text-gray-400">Max height:</span> <span className="font-mono text-gray-100">{result.maxHeight_m}m</span></p>
          <p><span className="text-gray-400">Time to apex:</span> <span className="font-mono text-gray-100">{result.timeToApex_s}s</span></p>
          <p><span className="text-gray-400">Impact speed:</span> <span className="font-mono text-gray-100">{result.impactSpeed_mps} m/s</span></p>
          <p><span className="text-gray-400">v₀x · v₀y:</span> <span className="font-mono text-gray-100">{result.v0x_mps} · {result.v0y_mps}</span></p>
        </div>
      )}
    </div>
  );
}

function UnitsTab() {
  const [value, setValue] = useState('1');
  const [kind, setKind] = useState('length');
  const [from, setFrom] = useState('m');
  const [to, setTo] = useState('ft');
  const [result, setResult] = useState<{ result: number } | null>(null);

  const UNITS_LIST: Record<string, string[]> = {
    length: ['m', 'km', 'cm', 'mm', 'mi', 'yd', 'ft', 'in'],
    mass: ['kg', 'g', 'mg', 'lb', 'oz', 'ton'],
    time: ['s', 'ms', 'min', 'h', 'day'],
    velocity: ['mps', 'kmh', 'mph', 'fps', 'knot'],
    energy: ['J', 'kJ', 'cal', 'kcal', 'eV', 'kWh', 'BTU'],
    force: ['N', 'kN', 'lbf', 'dyne'],
    pressure: ['Pa', 'kPa', 'atm', 'bar', 'psi', 'mmHg'],
    temperature: ['K', 'C', 'F'],
  };

  const calc = async () => {
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'physics', action: 'convert-units',
        input: { value: Number(value), from, to, kind },
      });
      setResult(((r.data as { result?: typeof result }).result) || null);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-3">
      <select value={kind} onChange={(e) => { setKind(e.target.value); setFrom(UNITS_LIST[e.target.value][0]); setTo(UNITS_LIST[e.target.value][1]); }}
        className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
        {Object.keys(UNITS_LIST).map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
      <div className="grid grid-cols-3 gap-2">
        <input type="number" value={value} onChange={(e) => setValue(e.target.value)}
          className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
        <select value={from} onChange={(e) => setFrom(e.target.value)}
          className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
          {UNITS_LIST[kind].map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <select value={to} onChange={(e) => setTo(e.target.value)}
          className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
          {UNITS_LIST[kind].map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <button type="button" onClick={calc}
        className="px-3 py-1 rounded-md border border-indigo-500/40 bg-indigo-500/15 text-xs text-indigo-100">Convert</button>

      {result && (
        <div className="rounded border border-indigo-500/20 bg-indigo-500/5 p-3 text-sm">
          <p className="font-mono text-gray-100">
            {value} {from} = <span className="text-indigo-300 text-lg">{result.result}</span> {to}
          </p>
        </div>
      )}
    </div>
  );
}

function ConstantsTab() {
  const [constants, setConstants] = useState<Record<string, { value: number; units: string; name: string }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.post('/api/lens/run', { domain: 'physics', action: 'constants', input: {} });
        setConstants(((r.data as { result?: { constants?: typeof constants } }).result?.constants) || {});
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="text-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>;

  return (
    <div className="p-3 space-y-1">
      {Object.entries(constants).map(([sym, c]) => (
        <div key={sym} className="rounded border border-white/10 bg-black/20 p-2 flex items-center justify-between text-xs">
          <div>
            <p className="font-mono text-indigo-300">{sym}</p>
            <p className="text-[10px] text-gray-400">{c.name}</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-gray-100">{c.value.toExponential(4)}</p>
            <p className="text-[10px] text-gray-400 font-mono">{c.units}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default PhysicsWorkbench;
