'use client';

/**
 * SimToolkit — four analysis tools backed by the sim domain:
 *   • Formula     — safe arithmetic expression evaluator (`sim.evaluateFormula`)
 *   • Goal Seek   — find a parameter value hitting a target (`sim.goalSeek`)
 *   • Compare     — Welch t-test scenario diff (`sim.scenarioDiff`)
 *   • Calibrate   — fit a system-dynamics model to data (`sim.calibrate`)
 */

import { useCallback, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  Calculator, Target, GitCompare, Crosshair, Play, RefreshCw,
  AlertCircle, CheckCircle2,
} from 'lucide-react';

type Tool = 'formula' | 'goalseek' | 'compare' | 'calibrate';

const TOOLS: Array<{ key: Tool; label: string; icon: React.ReactNode }> = [
  { key: 'formula', label: 'Formula', icon: <Calculator className="w-4 h-4" /> },
  { key: 'goalseek', label: 'Goal Seek', icon: <Target className="w-4 h-4" /> },
  { key: 'compare', label: 'Compare', icon: <GitCompare className="w-4 h-4" /> },
  { key: 'calibrate', label: 'Calibrate', icon: <Crosshair className="w-4 h-4" /> },
];

export function SimToolkit() {
  const [tool, setTool] = useState<Tool>('formula');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {TOOLS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTool(t.key)}
            className={cn(ds.btnSmall, 'flex items-center gap-1.5', tool === t.key ? ds.btnPrimary : ds.btnSecondary)}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      {tool === 'formula' && <FormulaTool />}
      {tool === 'goalseek' && <GoalSeekTool />}
      {tool === 'compare' && <CompareTool />}
      {tool === 'calibrate' && <CalibrateTool />}
    </div>
  );
}

// ─── Formula evaluator ───────────────────────────────────────────────────────

function FormulaTool() {
  const [expr, setExpr] = useState('revenue * margin - fixedCost');
  const [varsText, setVarsText] = useState('revenue=1000000\nmargin=0.25\nfixedCost=120000');
  const [value, setValue] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    const variables: Record<string, number> = {};
    for (const line of varsText.split('\n')) {
      const [k, v] = line.split('=').map((s) => s.trim());
      if (k && v !== undefined && Number.isFinite(Number(v))) variables[k] = Number(v);
    }
    const r = await lensRun<{ value: number }>('sim', 'evaluateFormula', { expression: expr, variables });
    if (r.data.ok && r.data.result) { setValue(r.data.result.value); }
    else { setValue(null); setError(r.data.error || 'Formula error'); }
    setBusy(false);
  }, [expr, varsText]);

  return (
    <div className={cn(ds.panel, 'space-y-3')}>
      <p className={ds.textMuted}>
        Safe arithmetic evaluator: + − * / % ^, parentheses, and functions
        min, max, abs, sqrt, exp, ln, pow, sin, cos, floor, ceil, round.
      </p>
      <div>
        <label className={ds.label}>Expression</label>
        <input className={cn(ds.input, 'font-mono')} value={expr} onChange={(e) => setExpr(e.target.value)} />
      </div>
      <div>
        <label className={ds.label}>Variables (one per line, name=value)</label>
        <textarea
          className={cn(ds.textarea, 'h-24 font-mono text-xs')}
          value={varsText}
          onChange={(e) => setVarsText(e.target.value)}
        />
      </div>
      <button onClick={run} disabled={busy} className={ds.btnPrimary}>
        {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Evaluate
      </button>
      {error && <ErrBox msg={error} />}
      {value !== null && (
        <div className="bg-lattice-surface/50 rounded-lg p-4 text-center">
          <p className={ds.textMuted}>Result</p>
          <p className="text-2xl font-bold font-mono text-green-400 mt-1">{value.toLocaleString()}</p>
        </div>
      )}
    </div>
  );
}

// ─── Goal seek ───────────────────────────────────────────────────────────────

interface GoalSeekResult {
  solution: number;
  achievedOutput: number;
  residual: number | null;
  converged: boolean;
  iterationCount: number;
  objective: string;
  iterations: Array<{ iteration?: number; x: number; output: number; error?: number }>;
}

function GoalSeekTool() {
  const [expr, setExpr] = useState('units * price - fixedCost');
  const [param, setParam] = useState('units');
  const [constants, setConstants] = useState('price=49.99\nfixedCost=25000');
  const [objective, setObjective] = useState<'target' | 'maximize' | 'minimize'>('target');
  const [target, setTarget] = useState(0);
  const [min, setMin] = useState(0);
  const [max, setMax] = useState(10000);
  const [res, setRes] = useState<GoalSeekResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    const consts: Record<string, number> = {};
    for (const line of constants.split('\n')) {
      const [k, v] = line.split('=').map((s) => s.trim());
      if (k && v !== undefined && Number.isFinite(Number(v))) consts[k] = Number(v);
    }
    const r = await lensRun<GoalSeekResult>('sim', 'goalSeek', {
      expression: expr, parameter: param, constants: consts,
      objective, target: objective === 'target' ? target : undefined, min, max,
    });
    if (r.data.ok && r.data.result) { setRes(r.data.result); }
    else { setRes(null); setError(r.data.error || 'Goal seek failed'); }
    setBusy(false);
  }, [expr, param, constants, objective, target, min, max]);

  return (
    <div className={cn(ds.panel, 'space-y-3')}>
      <p className={ds.textMuted}>
        Find the value of a decision parameter that hits a target output
        (bisection) or maximizes / minimizes it (golden-section search).
      </p>
      <div>
        <label className={ds.label}>Expression</label>
        <input className={cn(ds.input, 'font-mono')} value={expr} onChange={(e) => setExpr(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className={ds.label}>Decision Parameter</label>
          <input className={cn(ds.input, 'font-mono')} value={param} onChange={(e) => setParam(e.target.value)} />
        </div>
        <div>
          <label className={ds.label}>Objective</label>
          <select className={ds.select} value={objective}
            onChange={(e) => setObjective(e.target.value as typeof objective)}>
            <option value="target">Hit Target</option>
            <option value="maximize">Maximize</option>
            <option value="minimize">Minimize</option>
          </select>
        </div>
        {objective === 'target' && (
          <div>
            <label className={ds.label}>Target Output</label>
            <input type="number" className={ds.input} value={target}
              onChange={(e) => setTarget(parseFloat(e.target.value) || 0)} />
          </div>
        )}
        <div>
          <label className={ds.label}>Search Min</label>
          <input type="number" className={ds.input} value={min}
            onChange={(e) => setMin(parseFloat(e.target.value) || 0)} />
        </div>
        <div>
          <label className={ds.label}>Search Max</label>
          <input type="number" className={ds.input} value={max}
            onChange={(e) => setMax(parseFloat(e.target.value) || 0)} />
        </div>
      </div>
      <div>
        <label className={ds.label}>Constants (one per line, name=value)</label>
        <textarea className={cn(ds.textarea, 'h-20 font-mono text-xs')} value={constants}
          onChange={(e) => setConstants(e.target.value)} />
      </div>
      <button onClick={run} disabled={busy} className={ds.btnPrimary}>
        {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />} Solve
      </button>
      {error && <ErrBox msg={error} />}
      {res && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="bg-lattice-surface/50 rounded-lg p-3 text-center">
              <p className={ds.textMuted}>{param}</p>
              <p className="text-xl font-bold font-mono text-green-400 mt-1">{res.solution.toLocaleString()}</p>
            </div>
            <div className="bg-lattice-surface/50 rounded-lg p-3 text-center">
              <p className={ds.textMuted}>Achieved Output</p>
              <p className="text-xl font-bold font-mono text-white mt-1">{res.achievedOutput.toLocaleString()}</p>
            </div>
            <div className="bg-lattice-surface/50 rounded-lg p-3 text-center">
              <p className={ds.textMuted}>Converged</p>
              <p className={cn('text-xl font-bold mt-1', res.converged ? 'text-green-400' : 'text-yellow-400')}>
                {res.converged ? 'Yes' : 'Approx'}
              </p>
            </div>
          </div>
          {res.iterations.length > 1 && (
            <div>
              <p className={cn(ds.textMuted, 'mb-2')}>Convergence ({res.iterationCount} iterations)</p>
              <ChartKit
                kind="line"
                data={res.iterations.map((it, i) => ({ step: it.iteration ?? i + 1, output: it.output }))}
                xKey="step"
                series={[{ key: 'output', label: 'Output', color: '#22c55e' }]}
                height={180}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Scenario compare (Welch t-test) ─────────────────────────────────────────

interface DiffResult {
  sampleA: { n: number; mean: number; std: number };
  sampleB: { n: number; mean: number; std: number };
  meanDifference: number;
  percentChange: number | null;
  tStatistic: number;
  pValue: number;
  significant: boolean;
  cohensD: number;
  effectSize: string;
  verdict: string;
}

function CompareTool() {
  const [aText, setAText] = useState('102, 98, 105, 99, 101, 103, 97, 100, 104, 96');
  const [bText, setBText] = useState('118, 122, 119, 125, 121, 117, 124, 120, 123, 116');
  const [res, setRes] = useState<DiffResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    const parse = (s: string) => s.split(/[\s,]+/).map(Number).filter((x) => Number.isFinite(x));
    const r = await lensRun<DiffResult>('sim', 'scenarioDiff', {
      sampleA: parse(aText), sampleB: parse(bText),
    });
    if (r.data.ok && r.data.result) { setRes(r.data.result); }
    else { setRes(null); setError(r.data.error || 'Comparison failed'); }
    setBusy(false);
  }, [aText, bText]);

  return (
    <div className={cn(ds.panel, 'space-y-3')}>
      <p className={ds.textMuted}>
        Welch&apos;s two-sample t-test comparing two scenarios&apos; run outcomes.
        Reports mean difference, p-value, and Cohen&apos;s d effect size.
      </p>
      <div className={ds.grid2}>
        <div>
          <label className={ds.label}>Scenario A outcomes</label>
          <textarea className={cn(ds.textarea, 'h-24 font-mono text-xs')} value={aText}
            onChange={(e) => setAText(e.target.value)} />
        </div>
        <div>
          <label className={ds.label}>Scenario B outcomes</label>
          <textarea className={cn(ds.textarea, 'h-24 font-mono text-xs')} value={bText}
            onChange={(e) => setBText(e.target.value)} />
        </div>
      </div>
      <button onClick={run} disabled={busy} className={ds.btnPrimary}>
        {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <GitCompare className="w-4 h-4" />} Compare
      </button>
      {error && <ErrBox msg={error} />}
      {res && (
        <div className="space-y-3">
          <div className={cn(
            'rounded-lg p-3 flex items-center gap-2',
            res.significant ? 'border border-green-500/30 bg-green-500/5' : 'border border-gray-500/30 bg-gray-500/5',
          )}>
            <CheckCircle2 className={cn('w-4 h-4', res.significant ? 'text-green-400' : 'text-gray-400')} />
            <span className={cn('text-sm', res.significant ? 'text-green-400' : 'text-gray-400')}>
              {res.verdict}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <CmpStat label="Mean A" value={res.sampleA.mean} />
            <CmpStat label="Mean B" value={res.sampleB.mean} />
            <CmpStat label="Mean Δ" value={res.meanDifference} />
            <CmpStat label="% Change" value={res.percentChange ?? 0} suffix="%" />
            <CmpStat label="t-statistic" value={res.tStatistic} />
            <CmpStat label="p-value" value={res.pValue} />
            <CmpStat label="Cohen's d" value={res.cohensD} />
            <div className="bg-lattice-surface/50 rounded-lg p-3 text-center">
              <p className={ds.textMuted}>Effect Size</p>
              <p className="text-lg font-bold text-purple-400 mt-1 capitalize">{res.effectSize}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CmpStat({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="bg-lattice-surface/50 rounded-lg p-3 text-center">
      <p className={ds.textMuted}>{label}</p>
      <p className={cn(ds.textMono, 'text-lg text-white mt-1')}>
        {value.toLocaleString()}{suffix || ''}
      </p>
    </div>
  );
}

// ─── Calibration ─────────────────────────────────────────────────────────────

interface CalibrateResult {
  fitStock: string;
  calibratedParameters: Record<string, number>;
  sse: number;
  rmse: number;
  rSquared: number;
  pointsMatched: number;
  fittedTrajectory: Array<{ t: number; fitted: number; observed: number | null }>;
}

function CalibrateTool() {
  const [stockName, setStockName] = useState('infected');
  const [initial, setInitial] = useState(10);
  const [flowExpr, setFlowExpr] = useState('infected * spreadRate');
  const [paramName, setParamName] = useState('spreadRate');
  const [paramMin, setParamMin] = useState(0);
  const [paramMax, setParamMax] = useState(1);
  const [observedText, setObservedText] = useState(
    '0:10\n1:14\n2:19\n3:27\n4:38\n5:53\n6:74\n7:103',
  );
  const [res, setRes] = useState<CalibrateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    const observed: Array<{ t: number; value: number }> = [];
    for (const line of observedText.split('\n')) {
      const [t, v] = line.split(/[:,]/).map((s) => s.trim());
      if (t !== undefined && v !== undefined && Number.isFinite(Number(t)) && Number.isFinite(Number(v))) {
        observed.push({ t: Number(t), value: Number(v) });
      }
    }
    const r = await lensRun<CalibrateResult>('sim', 'calibrate', {
      model: {
        stocks: [{ name: stockName, initial }],
        flows: [{ name: 'growth', expr: flowExpr, to: stockName }],
      },
      observed,
      fitStock: stockName,
      tunable: [{ name: paramName, min: paramMin, max: paramMax }],
      passes: 8,
    });
    if (r.data.ok && r.data.result) { setRes(r.data.result); }
    else { setRes(null); setError(r.data.error || 'Calibration failed'); }
    setBusy(false);
  }, [stockName, initial, flowExpr, paramName, paramMin, paramMax, observedText]);

  return (
    <div className={cn(ds.panel, 'space-y-3')}>
      <p className={ds.textMuted}>
        Calibrate a system-dynamics model against historical data — coordinate-descent
        tunes a flow parameter so the stock trajectory fits the observations (minimizes SSE).
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div>
          <label className={ds.label}>Stock to Fit</label>
          <input className={cn(ds.input, 'font-mono')} value={stockName}
            onChange={(e) => setStockName(e.target.value)} />
        </div>
        <div>
          <label className={ds.label}>Initial Value</label>
          <input type="number" className={ds.input} value={initial}
            onChange={(e) => setInitial(parseFloat(e.target.value) || 0)} />
        </div>
        <div>
          <label className={ds.label}>Inflow Expression</label>
          <input className={cn(ds.input, 'font-mono text-xs')} value={flowExpr}
            onChange={(e) => setFlowExpr(e.target.value)} />
        </div>
        <div>
          <label className={ds.label}>Tunable Parameter</label>
          <input className={cn(ds.input, 'font-mono')} value={paramName}
            onChange={(e) => setParamName(e.target.value)} />
        </div>
        <div>
          <label className={ds.label}>Param Min</label>
          <input type="number" step="any" className={ds.input} value={paramMin}
            onChange={(e) => setParamMin(parseFloat(e.target.value) || 0)} />
        </div>
        <div>
          <label className={ds.label}>Param Max</label>
          <input type="number" step="any" className={ds.input} value={paramMax}
            onChange={(e) => setParamMax(parseFloat(e.target.value) || 0)} />
        </div>
      </div>
      <div>
        <label className={ds.label}>Observed Data (one per line, t:value)</label>
        <textarea className={cn(ds.textarea, 'h-28 font-mono text-xs')} value={observedText}
          onChange={(e) => setObservedText(e.target.value)} />
      </div>
      <button onClick={run} disabled={busy} className={ds.btnPrimary}>
        {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Crosshair className="w-4 h-4" />} Calibrate
      </button>
      {error && <ErrBox msg={error} />}
      {res && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <CmpStat label="SSE" value={res.sse} />
            <CmpStat label="RMSE" value={res.rmse} />
            <div className="bg-lattice-surface/50 rounded-lg p-3 text-center">
              <p className={ds.textMuted}>R²</p>
              <p className={cn('text-lg font-bold font-mono mt-1',
                res.rSquared > 0.9 ? 'text-green-400' : res.rSquared > 0.6 ? 'text-yellow-400' : 'text-red-400')}>
                {res.rSquared}
              </p>
            </div>
            <CmpStat label="Points Matched" value={res.pointsMatched} />
          </div>
          <div className="bg-lattice-surface/50 rounded-lg p-3">
            <p className={cn(ds.textMuted, 'mb-1')}>Calibrated Parameters</p>
            {Object.entries(res.calibratedParameters).map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm">
                <span className="text-gray-400 font-mono">{k}</span>
                <span className="text-green-400 font-mono">{v}</span>
              </div>
            ))}
          </div>
          <div>
            <p className={cn(ds.textMuted, 'mb-2')}>Fitted vs Observed</p>
            <ChartKit
              kind="line"
              data={res.fittedTrajectory.map((d) => ({
                t: d.t, fitted: d.fitted, observed: d.observed ?? undefined,
              }))}
              xKey="t"
              series={[
                { key: 'observed', label: 'Observed', color: '#f59e0b' },
                { key: 'fitted', label: 'Fitted', color: '#22c55e' },
              ]}
              height={240}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ErrBox({ msg }: { msg: string }) {
  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 flex items-center gap-2">
      <AlertCircle className="w-4 h-4 text-red-400" />
      <span className="text-sm text-red-400">{msg}</span>
    </div>
  );
}
