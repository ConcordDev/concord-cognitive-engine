'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * SymbolicWorkbench — a CAS surface for the math lens.
 * Six purpose-built panels, each wired to a real backend macro in
 * server/domains/math.js: symbolicCompute, stepSolve, naturalQuery,
 * plotFunction, unitConvert, numberTheory. No mock data — every number
 * shown is computed server-side.
 */

import { useState, useCallback, useEffect } from 'react';
import {
  Sigma, Wand2, FunctionSquare, LineChart as LineIcon, Ruler, Hash,
  Loader2, Play, AlertTriangle, ListOrdered, History, Trash2,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';

type Panel = 'nlquery' | 'symbolic' | 'solve' | 'plot' | 'units' | 'numbertheory' | 'history';

interface MacroResult { ok: boolean; result?: any; error?: string | null }

async function runMath(action: string, input: Record<string, unknown>): Promise<MacroResult> {
  const r = await lensRun('math', action, input);
  return { ok: r.data.ok, result: r.data.result, error: r.data.error };
}

// Persist a computation to the per-user CAS history (fire-and-forget).
function recordHistory(entry: Record<string, unknown>): void {
  void runMath('casHistory', { action: 'record', entry }).catch(() => {});
}

const PANELS: { id: Panel; label: string; icon: typeof Sigma }[] = [
  { id: 'nlquery', label: 'Ask', icon: Wand2 },
  { id: 'symbolic', label: 'Symbolic CAS', icon: Sigma },
  { id: 'solve', label: 'Step Solver', icon: ListOrdered },
  { id: 'plot', label: 'Plotter', icon: LineIcon },
  { id: 'units', label: 'Units', icon: Ruler },
  { id: 'numbertheory', label: 'Number Theory', icon: Hash },
  { id: 'history', label: 'History', icon: History },
];

export function SymbolicWorkbench() {
  const [panel, setPanel] = useState<Panel>('nlquery');

  return (
    <div className="rounded-xl border border-indigo-500/20 bg-zinc-950/60 p-4 space-y-4">
      <header className="flex items-center gap-2 border-b border-indigo-500/10 pb-2">
        <FunctionSquare className="h-4 w-4 text-indigo-400" />
        <h3 className="text-sm font-semibold text-white">Computational Math Engine</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          CAS
        </span>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {PANELS.map((p) => {
          const Icon = p.icon;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPanel(p.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors ${
                panel === p.id
                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                  : 'bg-zinc-900/40 text-zinc-400 border border-zinc-800 hover:text-white'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {p.label}
            </button>
          );
        })}
      </div>

      {panel === 'nlquery' && <NaturalQueryPanel />}
      {panel === 'symbolic' && <SymbolicPanel />}
      {panel === 'solve' && <SolvePanel />}
      {panel === 'plot' && <PlotPanel />}
      {panel === 'units' && <UnitsPanel />}
      {panel === 'numbertheory' && <NumberTheoryPanel />}
      {panel === 'history' && <HistoryPanel active={panel === 'history'} />}
    </div>
  );
}

/* ─── shared bits ─── */
function ErrBanner({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      <span>{text}</span>
    </div>
  );
}
function RunBtn({ busy, onClick, label }: { busy: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex items-center gap-1.5 rounded-lg bg-indigo-500/20 px-4 py-2 text-xs font-semibold text-indigo-200 border border-indigo-500/40 hover:bg-indigo-500/30 disabled:opacity-40"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}
const inputCls =
  'w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-[12px] text-indigo-100 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400/40';

/* ─── 1. Natural-language query ─── */
function NaturalQueryPanel() {
  const [query, setQuery] = useState('integral of x^2 from 0 to 5');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const examples = [
    'derivative of sin(x)*x',
    'solve x^2 - 5x + 6 = 0',
    'factor 5040',
    'convert 100 km to mi',
    'is 7919 prime',
    'simplify 2x + 3x - 0',
  ];

  const ask = useCallback(async () => {
    if (!query.trim()) return;
    setBusy(true); setErr(null); setRes(null);
    const r = await runMath('naturalQuery', { query });
    if (r.ok) {
      setRes(r.result);
      recordHistory({ kind: 'naturalQuery', input: query, answer: r.result?.answer ?? null });
    } else setErr(r.error || 'Could not interpret query.');
    setBusy(false);
  }, [query]);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        Ask in plain English — parsed and computed server-side by the CAS.
      </p>
      <div className="flex gap-2">
        <input
          className={inputCls}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && ask()}
          placeholder='e.g. "integral of x^2 from 0 to 5"'
        />
        <RunBtn busy={busy} onClick={ask} label="Ask" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {examples.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setQuery(ex)}
            className="rounded bg-zinc-900 px-2 py-1 text-[10px] text-zinc-400 hover:text-indigo-300 border border-zinc-800"
          >
            {ex}
          </button>
        ))}
      </div>
      {err && <ErrBanner text={err} />}
      {res && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">
            {res.kind}
          </div>
          <div className="font-mono text-lg text-emerald-200 break-all">
            {res.answer != null ? String(res.answer) : '—'}
          </div>
          {res.primeFactors && (
            <div className="text-[11px] text-zinc-300 font-mono">
              {res.number} = {res.primeFactors.join(' × ')}
            </div>
          )}
          {res.bounds && (
            <div className="text-[10px] text-zinc-400">
              bounds [{res.bounds[0]}, {res.bounds[1]}] · {res.closedForm ? 'closed form' : 'numeric'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── 2. Symbolic CAS ─── */
function SymbolicPanel() {
  const [op, setOp] = useState<'simplify' | 'derivative' | 'integral'>('derivative');
  const [expr, setExpr] = useState('sin(x)*x^2');
  const [variable, setVariable] = useState('x');
  const [lower, setLower] = useState('');
  const [upper, setUpper] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!expr.trim()) return;
    setBusy(true); setErr(null); setRes(null);
    const input: Record<string, unknown> = { operation: op, expression: expr, variable };
    if (op === 'integral' && lower !== '' && upper !== '') {
      input.lower = parseFloat(lower);
      input.upper = parseFloat(upper);
    }
    const r = await runMath('symbolicCompute', input);
    if (r.ok) {
      setRes(r.result);
      const ans = r.result?.output ?? r.result?.derivative ?? r.result?.antiderivative ?? r.result?.definite;
      recordHistory({ kind: `symbolic:${op}`, input: expr, answer: ans != null ? String(ans) : null });
    } else setErr(r.error || 'Computation failed.');
    setBusy(false);
  }, [op, expr, variable, lower, upper]);

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {(['simplify', 'derivative', 'integral'] as const).map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => { setOp(o); setRes(null); }}
            className={`rounded px-3 py-1.5 text-xs capitalize ${
              op === o ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40' : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
            }`}
          >
            {o}
          </button>
        ))}
      </div>
      <input className={inputCls} value={expr} onChange={(e) => setExpr(e.target.value)} placeholder="expression, e.g. exp(x)*cos(x)" />
      <div className="flex gap-2">
        <div className="w-24">
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">Variable</label>
          <input className={inputCls} value={variable} onChange={(e) => setVariable(e.target.value)} />
        </div>
        {op === 'integral' && (
          <>
            <div className="w-24">
              <label className="text-[10px] uppercase tracking-wider text-zinc-400">Lower</label>
              <input className={inputCls} value={lower} onChange={(e) => setLower(e.target.value)} placeholder="opt." />
            </div>
            <div className="w-24">
              <label className="text-[10px] uppercase tracking-wider text-zinc-400">Upper</label>
              <input className={inputCls} value={upper} onChange={(e) => setUpper(e.target.value)} placeholder="opt." />
            </div>
          </>
        )}
      </div>
      <RunBtn busy={busy} onClick={run} label="Compute" />
      {err && <ErrBanner text={err} />}
      {res && (
        <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-indigo-300 font-semibold">{res.operation}</div>
          {res.operation === 'simplify' && (
            <div className="font-mono text-lg text-indigo-200">{res.output}</div>
          )}
          {res.operation === 'derivative' && (
            <div className="font-mono text-lg text-indigo-200">{res.display}</div>
          )}
          {res.operation === 'integral' && (
            <>
              {res.antiderivative && (
                <div className="font-mono text-base text-indigo-200">∫ = {res.antiderivative}</div>
              )}
              {res.definite != null && (
                <div className="font-mono text-lg text-emerald-300">
                  definite = {res.definite}
                  <span className="text-[10px] text-zinc-400 ml-2">{res.closedForm ? 'exact' : res.method}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── 3. Step solver ─── */
function SolvePanel() {
  const [left, setLeft] = useState('x^2 - 5*x + 6');
  const [right, setRight] = useState('0');
  const [variable, setVariable] = useState('x');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!left.trim()) return;
    setBusy(true); setErr(null); setRes(null);
    const r = await runMath('stepSolve', { left, right, variable });
    if (r.ok) {
      setRes(r.result);
      recordHistory({ kind: 'stepSolve', input: `${left} = ${right}`, answer: JSON.stringify(r.result?.roots) });
    } else setErr(r.error || 'Solver failed.');
    setBusy(false);
  }, [left, right, variable]);

  const fmtRoots = (roots: any): string => {
    if (roots === 'infinite') return 'infinitely many solutions';
    if (!Array.isArray(roots)) return '—';
    if (roots.length === 0) return 'no real solution';
    return roots
      .map((r: any) => (typeof r === 'object' && r !== null ? `${r.real} ${r.imag >= 0 ? '+' : '−'} ${Math.abs(r.imag)}i` : String(r)))
      .join(',  ');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input className={inputCls} value={left} onChange={(e) => setLeft(e.target.value)} placeholder="left side" />
        <span className="text-zinc-400 font-mono">=</span>
        <input className={`${inputCls} w-32`} value={right} onChange={(e) => setRight(e.target.value)} placeholder="right" />
      </div>
      <div className="flex items-center gap-2">
        <div className="w-24">
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">Variable</label>
          <input className={inputCls} value={variable} onChange={(e) => setVariable(e.target.value)} />
        </div>
        <RunBtn busy={busy} onClick={run} label="Solve" />
      </div>
      {err && <ErrBanner text={err} />}
      {res && (
        <div className="space-y-2">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">
              Solution · {res.kind}
            </div>
            <div className="font-mono text-lg text-emerald-200">{variable} = {fmtRoots(res.roots)}</div>
          </div>
          {Array.isArray(res.steps) && res.steps.length > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-black/30 p-3">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400 mb-2">Step-by-step working</div>
              <ol className="space-y-1.5">
                {res.steps.map((s: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-[11px]">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-[9px] font-bold text-indigo-300">
                      {i + 1}
                    </span>
                    <span className="font-mono text-zinc-300">{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── 4. Rich plotter ─── */
function PlotPanel() {
  const [exprText, setExprText] = useState('sin(x)\nx^2/10');
  const [xMin, setXMin] = useState('-6.28');
  const [xMax, setXMax] = useState('6.28');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    const expressions = exprText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (expressions.length === 0) { setErr('Enter at least one function.'); return; }
    setBusy(true); setErr(null); setRes(null);
    const r = await runMath('plotFunction', {
      expressions,
      xMin: parseFloat(xMin),
      xMax: parseFloat(xMax),
      samples: 300,
    });
    if (r.ok) setRes(r.result); else setErr(r.error || 'Plot failed.');
    setBusy(false);
  }, [exprText, xMin, xMax]);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">One function per line — overlay multiple curves.</p>
      <textarea
        className={`${inputCls} resize-none`}
        rows={3}
        value={exprText}
        onChange={(e) => setExprText(e.target.value)}
        placeholder={'sin(x)\ncos(x)\nx^2'}
      />
      <div className="flex items-end gap-2">
        <div className="w-28">
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">x min</label>
          <input className={inputCls} value={xMin} onChange={(e) => setXMin(e.target.value)} />
        </div>
        <div className="w-28">
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">x max</label>
          <input className={inputCls} value={xMax} onChange={(e) => setXMax(e.target.value)} />
        </div>
        <RunBtn busy={busy} onClick={run} label="Plot" />
      </div>
      {err && <ErrBanner text={err} />}
      {res && (
        <div className="space-y-2">
          <ChartKit
            kind="line"
            data={res.points}
            xKey="x"
            series={res.series.map((s: any) => ({ key: s.key, label: s.label }))}
            height={280}
          />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {res.series.map((s: any) => (
              <div key={s.key} className="rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1.5">
                <div className="font-mono text-[11px] text-indigo-300 truncate">{s.label}</div>
                <div className="text-[10px] text-zinc-400">
                  y ∈ [{s.yMin ?? '—'}, {s.yMax ?? '—'}] · {s.definedPoints} pts
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── 5. Unit conversion ─── */
function UnitsPanel() {
  const [value, setValue] = useState('100');
  const [from, setFrom] = useState('km');
  const [to, setTo] = useState('mi');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true); setErr(null); setRes(null);
    const r = await runMath('unitConvert', { value: parseFloat(value), from, to });
    if (r.ok) setRes(r.result); else setErr(r.error || 'Conversion failed.');
    setBusy(false);
  }, [value, from, to]);

  const pairs: [string, string, string][] = [
    ['km', 'mi', 'length'],
    ['c', 'f', 'temperature'],
    ['kg', 'lb', 'mass'],
    ['l', 'gal', 'volume'],
    ['kwh', 'j', 'energy'],
    ['gb', 'mb', 'data'],
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2 flex-wrap">
        <div className="w-28">
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">Value</label>
          <input className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="w-28">
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">From</label>
          <input className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <span className="pb-2 text-zinc-400">→</span>
        <div className="w-28">
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">To</label>
          <input className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <RunBtn busy={busy} onClick={run} label="Convert" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {pairs.map(([f, t, cat]) => (
          <button
            key={`${f}-${t}`}
            type="button"
            onClick={() => { setFrom(f); setTo(t); }}
            className="rounded bg-zinc-900 px-2 py-1 text-[10px] text-zinc-400 hover:text-indigo-300 border border-zinc-800"
          >
            {f}→{t} <span className="text-zinc-600">{cat}</span>
          </button>
        ))}
      </div>
      {err && <ErrBanner text={err} />}
      {res && (
        <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3">
          <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">{res.category}</div>
          <div className="font-mono text-lg text-cyan-200">
            {res.value} {res.from} = {res.converted} {res.to}
          </div>
          {res.rate != null && (
            <div className="text-[10px] text-zinc-400">1 {res.from} = {res.rate} {res.to}</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── 6. Number theory ─── */
function NumberTheoryPanel() {
  const [tool, setTool] = useState('factorize');
  const [n, setN] = useState('5040');
  const [m, setM] = useState('36');
  const [k, setK] = useState('3');
  const [count, setCount] = useState('15');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const tools = [
    'factorize', 'isprime', 'primes', 'gcd', 'lcm', 'factorial',
    'combinations', 'permutations', 'fibonacci', 'divisors', 'totient',
  ];
  const needsM = ['gcd', 'lcm'].includes(tool);
  const needsK = ['combinations', 'permutations'].includes(tool);
  const needsCount = ['primes', 'fibonacci'].includes(tool);
  const needsN = !['primes', 'fibonacci'].includes(tool);

  const run = useCallback(async () => {
    setBusy(true); setErr(null); setRes(null);
    const input: Record<string, unknown> = { tool };
    if (needsN) input.n = parseInt(n, 10);
    if (needsM) input.m = parseInt(m, 10);
    if (needsK) input.k = parseInt(k, 10);
    if (needsCount) input.count = parseInt(count, 10);
    const r = await runMath('numberTheory', input);
    if (r.ok) setRes(r.result); else setErr(r.error || 'Computation failed.');
    setBusy(false);
  }, [tool, n, m, k, count, needsN, needsM, needsK, needsCount]);

  return (
    <div className="space-y-3">
      <select
        value={tool}
        onChange={(e) => { setTool(e.target.value); setRes(null); }}
        className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-[12px] text-white"
      >
        {tools.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <div className="flex flex-wrap items-end gap-2">
        {needsN && (
          <div className="w-28">
            <label className="text-[10px] uppercase tracking-wider text-zinc-400">n</label>
            <input className={inputCls} value={n} onChange={(e) => setN(e.target.value)} />
          </div>
        )}
        {needsM && (
          <div className="w-28">
            <label className="text-[10px] uppercase tracking-wider text-zinc-400">m</label>
            <input className={inputCls} value={m} onChange={(e) => setM(e.target.value)} />
          </div>
        )}
        {needsK && (
          <div className="w-28">
            <label className="text-[10px] uppercase tracking-wider text-zinc-400">k</label>
            <input className={inputCls} value={k} onChange={(e) => setK(e.target.value)} />
          </div>
        )}
        {needsCount && (
          <div className="w-28">
            <label className="text-[10px] uppercase tracking-wider text-zinc-400">count</label>
            <input className={inputCls} value={count} onChange={(e) => setCount(e.target.value)} />
          </div>
        )}
        <RunBtn busy={busy} onClick={run} label="Run" />
      </div>
      {err && <ErrBanner text={err} />}
      {res && (
        <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-3 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">{res.tool}</div>
          {res.tool === 'factorize' && (
            <div className="font-mono text-base text-purple-200">
              {res.n} = {res.factorization.map((f: any) => (f.exponent > 1 ? `${f.base}^${f.exponent}` : `${f.base}`)).join(' · ')}
              {res.isPrime && <span className="ml-2 text-[10px] text-emerald-400">(prime)</span>}
            </div>
          )}
          {res.tool === 'isprime' && (
            <div className={`font-mono text-lg ${res.isPrime ? 'text-emerald-300' : 'text-red-300'}`}>
              {res.n} is {res.isPrime ? 'prime' : 'composite'}
            </div>
          )}
          {(res.tool === 'primes' || res.tool === 'fibonacci') && (
            <div className="font-mono text-[11px] text-purple-200 break-all">
              {(res.primes || res.sequence).join(', ')}
            </div>
          )}
          {res.tool === 'gcd' && <div className="font-mono text-lg text-purple-200">gcd = {res.gcd}</div>}
          {res.tool === 'lcm' && <div className="font-mono text-lg text-purple-200">lcm = {res.lcm}</div>}
          {res.tool === 'factorial' && <div className="font-mono text-lg text-purple-200">{res.n}! = {res.factorial}</div>}
          {res.tool === 'combinations' && <div className="font-mono text-lg text-purple-200">C({res.n},{res.k}) = {res.combinations}</div>}
          {res.tool === 'permutations' && <div className="font-mono text-lg text-purple-200">P({res.n},{res.k}) = {res.permutations}</div>}
          {res.tool === 'divisors' && (
            <div className="font-mono text-[11px] text-purple-200">
              {res.count} divisors: {res.divisors.join(', ')} · σ = {res.sum}
            </div>
          )}
          {res.tool === 'totient' && <div className="font-mono text-lg text-purple-200">φ({res.n}) = {res.totient}</div>}
        </div>
      )}
    </div>
  );
}

/* ─── 7. CAS history (persistent per-user) ─── */
interface HistoryEntry { kind?: string; input?: string; answer?: string | null; at?: string }

function HistoryPanel({ active }: { active: boolean }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    const r = await runMath('casHistory', { action: 'list', limit: 50 });
    if (r.ok) setEntries(r.result?.history || []); else setErr(r.error || 'Could not load history.');
    setBusy(false);
  }, []);

  const clear = useCallback(async () => {
    setBusy(true);
    await runMath('casHistory', { action: 'clear' });
    setEntries([]);
    setBusy(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (active) load(); }, [active]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-zinc-400">Your saved CAS computations (server-persisted).</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={load}
            disabled={busy}
            className="flex items-center gap-1 rounded bg-zinc-900 px-2 py-1 text-[10px] text-zinc-300 border border-zinc-800 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <History className="h-3 w-3" />}
            Refresh
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={busy || entries.length === 0}
            className="flex items-center gap-1 rounded bg-red-500/10 px-2 py-1 text-[10px] text-red-300 border border-red-500/30 disabled:opacity-40"
          >
            <Trash2 className="h-3 w-3" />
            Clear
          </button>
        </div>
      </div>
      {err && <ErrBanner text={err} />}
      {entries.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-800 py-6 text-center text-[11px] text-zinc-400">
          No computations yet — run a symbolic, solve, or ask query above.
        </div>
      ) : (
        <div className="space-y-1.5 max-h-80 overflow-y-auto">
          {entries.map((e, i) => (
            <div key={i} className="rounded border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5">
              <div className="flex items-center justify-between">
                <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-indigo-300">
                  {e.kind || 'compute'}
                </span>
                {e.at && (
                  <span className="text-[9px] text-zinc-400">{new Date(e.at).toLocaleString()}</span>
                )}
              </div>
              <div className="mt-1 font-mono text-[11px] text-zinc-300 truncate">{e.input}</div>
              {e.answer != null && (
                <div className="font-mono text-[11px] text-emerald-300 truncate">→ {e.answer}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
