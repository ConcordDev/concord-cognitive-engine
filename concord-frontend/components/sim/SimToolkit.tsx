'use client';

/**
 * SimToolkit — eight analysis tools backed by the sim domain:
 *   • Formula     — safe arithmetic expression evaluator (`sim.evaluateFormula`)
 *   • Goal Seek   — find a parameter value hitting a target (`sim.goalSeek`)
 *   • Compare     — Welch t-test scenario diff (`sim.scenarioDiff`)
 *   • Calibrate   — fit a system-dynamics model to data (`sim.calibrate`)
 *   • Scenario    — rule-based state projection (`sim.scenarioRun`)
 *   • Sweep       — single-parameter what-if sweep (`sim.parameterSweep`)
 *   • Monte Carlo — uniform/normal sampling + percentiles (`sim.monteCarlo`)
 *   • Elasticity  — deterministic ± perturbation tornado chart (`sim.sensitivityAnalysis`)
 *
 * The last four call their macros directly via `lensRun` with a real params
 * object — NOT through the artifact-run path (`/api/lens/:domain/:id/run`),
 * because those four macro handlers read only from `artifact.data` and
 * ignore `params`. `lensRun` builds a virtual artifact whose `.data` IS the
 * input object, so this is the correct dispatch for them (see sim.js).
 */

import { useCallback, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  Calculator, Target, GitCompare, Crosshair, Play, RefreshCw,
  AlertCircle, CheckCircle2, FlaskConical, Sliders, Shuffle, Activity,
} from 'lucide-react';

type Tool = 'formula' | 'goalseek' | 'compare' | 'calibrate' | 'scenario' | 'sweep' | 'montecarlo' | 'elasticity';

const TOOLS: Array<{ key: Tool; label: string; icon: React.ReactNode }> = [
  { key: 'formula', label: 'Formula', icon: <Calculator className="w-4 h-4" /> },
  { key: 'goalseek', label: 'Goal Seek', icon: <Target className="w-4 h-4" /> },
  { key: 'compare', label: 'Compare', icon: <GitCompare className="w-4 h-4" /> },
  { key: 'calibrate', label: 'Calibrate', icon: <Crosshair className="w-4 h-4" /> },
  { key: 'scenario', label: 'Scenario Run', icon: <FlaskConical className="w-4 h-4" /> },
  { key: 'sweep', label: 'Param Sweep', icon: <Sliders className="w-4 h-4" /> },
  { key: 'montecarlo', label: 'Monte Carlo', icon: <Shuffle className="w-4 h-4" /> },
  { key: 'elasticity', label: 'Elasticity', icon: <Activity className="w-4 h-4" /> },
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
      {tool === 'scenario' && <ScenarioRunTool />}
      {tool === 'sweep' && <ParameterSweepTool />}
      {tool === 'montecarlo' && <MonteCarloBackendTool />}
      {tool === 'elasticity' && <ElasticityTool />}
    </div>
  );
}

// ─── Shared parsing helpers for rule-based tools ─────────────────────────────
// A "rule" is a field-transition applied every step: growth/decay multiply the
// field by (1 ± rate), add adds a fixed value, cap/floor clamp the field.
// Text format (one per line): `<field> <type> <amount>`, e.g. `population growth 0.05`.

interface SimRule {
  field: string;
  type: 'growth' | 'decay' | 'add' | 'cap' | 'floor';
  rate?: number;
  value?: number;
  max?: number;
  min?: number;
}

function parseStateLines(text: string): Record<string, number> {
  const state: Record<string, number> = {};
  for (const line of text.split('\n')) {
    const [k, v] = line.split('=').map((s) => s.trim());
    if (k && v !== undefined && Number.isFinite(Number(v))) state[k] = Number(v);
  }
  return state;
}

function parseRuleLines(text: string): SimRule[] {
  const rules: SimRule[] = [];
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const [field, type, amountRaw] = parts;
    const n = Number(amountRaw);
    if (!field || !Number.isFinite(n)) continue;
    if (type === 'growth' || type === 'decay') rules.push({ field, type, rate: n });
    else if (type === 'add') rules.push({ field, type, value: n });
    else if (type === 'cap') rules.push({ field, type, max: n });
    else if (type === 'floor') rules.push({ field, type, min: n });
  }
  return rules;
}

const RULE_HELP = 'One rule per line: <field> <growth|decay|add|cap|floor> <amount>. Growth/decay amount is a fractional rate (0.05 = 5%); add/cap/floor amounts are absolute.';

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

// ─── Scenario run (rule-based state projection) ──────────────────────────────

interface ScenarioRunResult {
  message?: string;
  stepsRun: number;
  initialState: Record<string, number>;
  finalState: Record<string, number>;
  deltas: Record<string, { start: number; end: number; change: number }>;
}

function ScenarioRunTool() {
  const [stateText, setStateText] = useState('population=1000\nbudget=50000');
  const [rulesText, setRulesText] = useState('population growth 0.03\nbudget decay 0.05');
  const [steps, setSteps] = useState(10);
  const [res, setRes] = useState<ScenarioRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    const initialState = parseStateLines(stateText);
    const rules = parseRuleLines(rulesText);
    const r = await lensRun<ScenarioRunResult>('sim', 'scenarioRun', { initialState, rules, steps });
    if (r.data.ok && r.data.result) { setRes(r.data.result); }
    else { setRes(null); setError(r.data.error || 'Scenario run failed'); }
    setBusy(false);
  }, [stateText, rulesText, steps]);

  return (
    <div className={cn(ds.panel, 'space-y-3')}>
      <p className={ds.textMuted}>
        Step a set of named fields forward through simple transition rules — a
        lightweight alternative to full system dynamics for quick what-ifs.
      </p>
      <div className={ds.grid2}>
        <div>
          <label className={ds.label}>Initial State (name=value)</label>
          <textarea className={cn(ds.textarea, 'h-24 font-mono text-xs')} value={stateText}
            onChange={(e) => setStateText(e.target.value)} />
        </div>
        <div>
          <label className={ds.label}>Rules</label>
          <textarea className={cn(ds.textarea, 'h-24 font-mono text-xs')} value={rulesText}
            onChange={(e) => setRulesText(e.target.value)} />
          <p className="text-[10px] text-gray-500 mt-1">{RULE_HELP}</p>
        </div>
      </div>
      <div>
        <label className={ds.label}>Steps</label>
        <input type="number" className={cn(ds.input, 'w-32')} value={steps}
          onChange={(e) => setSteps(parseInt(e.target.value) || 1)} />
      </div>
      <button onClick={run} disabled={busy} className={ds.btnPrimary}>
        {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Run
      </button>
      {error && <ErrBox msg={error} />}
      {res && (res.message ? (
        <p className="text-sm text-gray-400">{res.message}</p>
      ) : (
        <div className="space-y-2">
          <p className={cn(ds.textMuted, 'font-medium')}>State Changes ({res.stepsRun} steps)</p>
          {Object.entries(res.deltas).map(([key, delta]) => (
            <div key={key} className="flex items-center gap-2 text-xs bg-lattice-surface/50 rounded-lg p-2">
              <span className="text-gray-400 flex-1 font-mono">{key}</span>
              <span className="text-gray-400 font-mono">{delta.start}</span>
              <span className="text-gray-600">→</span>
              <span className="text-white font-mono">{delta.end}</span>
              <span className={cn('font-mono', delta.change > 0 ? 'text-green-400' : delta.change < 0 ? 'text-red-400' : 'text-gray-400')}>
                ({delta.change > 0 ? '+' : ''}{delta.change})
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Parameter sweep (single-parameter what-if) ──────────────────────────────

interface SweepResult {
  message?: string;
  parameter: string;
  runsCompleted: number;
  stepsPerRun: number;
  results: Array<Record<string, number>>;
  bestOutcome: Record<string, unknown>;
}

function ParameterSweepTool() {
  const [baseText, setBaseText] = useState('inventory=100\nprice=20');
  const [param, setParam] = useState('price');
  const [min, setMin] = useState(10);
  const [max, setMax] = useState(50);
  const [step, setStep] = useState(5);
  const [rulesText, setRulesText] = useState('inventory decay 0.1');
  const [steps, setSteps] = useState(10);
  const [res, setRes] = useState<SweepResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    const baseState = parseStateLines(baseText);
    const rules = parseRuleLines(rulesText);
    const r = await lensRun<SweepResult>('sim', 'parameterSweep', {
      baseState, parameter: param, range: { min, max, step }, rules, steps,
    });
    if (r.data.ok && r.data.result) { setRes(r.data.result); }
    else { setRes(null); setError(r.data.error || 'Parameter sweep failed'); }
    setBusy(false);
  }, [baseText, param, min, max, step, rulesText, steps]);

  return (
    <div className={cn(ds.panel, 'space-y-3')}>
      <p className={ds.textMuted}>
        Sweep one parameter across a range and project the outcome field at
        each value — quick sensitivity scan before a full simulation.
      </p>
      <div className={ds.grid2}>
        <div>
          <label className={ds.label}>Base State (name=value)</label>
          <textarea className={cn(ds.textarea, 'h-20 font-mono text-xs')} value={baseText}
            onChange={(e) => setBaseText(e.target.value)} />
        </div>
        <div>
          <label className={ds.label}>Rules</label>
          <textarea className={cn(ds.textarea, 'h-20 font-mono text-xs')} value={rulesText}
            onChange={(e) => setRulesText(e.target.value)} />
          <p className="text-[10px] text-gray-500 mt-1">{RULE_HELP}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div>
          <label className={ds.label}>Parameter</label>
          <input className={cn(ds.input, 'font-mono')} value={param} onChange={(e) => setParam(e.target.value)} />
        </div>
        <div>
          <label className={ds.label}>Min</label>
          <input type="number" className={ds.input} value={min} onChange={(e) => setMin(parseFloat(e.target.value) || 0)} />
        </div>
        <div>
          <label className={ds.label}>Max</label>
          <input type="number" className={ds.input} value={max} onChange={(e) => setMax(parseFloat(e.target.value) || 0)} />
        </div>
        <div>
          <label className={ds.label}>Step</label>
          <input type="number" className={ds.input} value={step} onChange={(e) => setStep(parseFloat(e.target.value) || 1)} />
        </div>
        <div>
          <label className={ds.label}>Steps/Run</label>
          <input type="number" className={ds.input} value={steps} onChange={(e) => setSteps(parseInt(e.target.value) || 1)} />
        </div>
      </div>
      <button onClick={run} disabled={busy} className={ds.btnPrimary}>
        {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sliders className="w-4 h-4" />} Sweep
      </button>
      {error && <ErrBox msg={error} />}
      {res && (res.message ? (
        <p className="text-sm text-gray-400">{res.message}</p>
      ) : (
        <div className="space-y-1.5">
          <p className={cn(ds.textMuted, 'font-medium')}>{res.runsCompleted} runs · {res.stepsPerRun} steps each</p>
          {res.results.map((r, i) => {
            const outcome = Number(r.outcome) || 0;
            const maxOutcome = Math.max(...res.results.map((x) => Number(x.outcome) || 0), 1e-9);
            const pct = maxOutcome !== 0 ? (outcome / maxOutcome) * 100 : 0;
            return (
              <div key={i} className="space-y-0.5">
                <div className="flex justify-between text-xs text-gray-400">
                  <span className="font-mono">{param}={String(r[param])}</span>
                  <span className="font-mono text-white">{outcome.toFixed(3)}</span>
                </div>
                <div className="h-1.5 bg-black/30 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-violet-500/70" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── Monte Carlo (backend distribution engine) ───────────────────────────────

interface MonteCarloBackendResult {
  message?: string;
  trials: number;
  formula: string;
  mean: number;
  stddev: number;
  min: number;
  max: number;
  percentiles: { p5: number; p25: number; p50: number; p75: number; p95: number };
  confidenceInterval90: { lower: number; upper: number };
}

function MonteCarloBackendTool() {
  const [trials, setTrials] = useState(2000);
  const [formula, setFormula] = useState<'sum' | 'product' | 'max' | 'min'>('sum');
  const [varsText, setVarsText] = useState('revenue 80000 120000\ncost 40000 70000');
  const [res, setRes] = useState<MonteCarloBackendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    const variables: Array<{ name: string; min?: number; max?: number; mean?: number; stddev?: number }> = [];
    for (const line of varsText.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      const [name, a, b, kind] = parts;
      if (!Number.isFinite(Number(a)) || !Number.isFinite(Number(b))) continue;
      if (kind === 'normal') variables.push({ name, mean: Number(a), stddev: Number(b) });
      else variables.push({ name, min: Number(a), max: Number(b) });
    }
    const r = await lensRun<MonteCarloBackendResult>('sim', 'monteCarlo', { trials, variables, formula });
    if (r.data.ok && r.data.result) { setRes(r.data.result); }
    else { setRes(null); setError(r.data.error || 'Monte Carlo failed'); }
    setBusy(false);
  }, [trials, varsText, formula]);

  return (
    <div className={cn(ds.panel, 'space-y-3')}>
      <p className={ds.textMuted}>
        Backend uniform/normal sampling engine with exact percentiles and a 90%
        confidence interval — aggregates variables via the chosen formula.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={ds.label}>Trials</label>
          <input type="number" className={ds.input} value={trials}
            onChange={(e) => setTrials(Math.min(10000, parseInt(e.target.value) || 100))} />
        </div>
        <div>
          <label className={ds.label}>Aggregate Formula</label>
          <select className={ds.select} value={formula} onChange={(e) => setFormula(e.target.value as typeof formula)}>
            <option value="sum">Sum</option>
            <option value="product">Product</option>
            <option value="max">Max</option>
            <option value="min">Min</option>
          </select>
        </div>
      </div>
      <div>
        <label className={ds.label}>Variables (one per line)</label>
        <textarea className={cn(ds.textarea, 'h-24 font-mono text-xs')} value={varsText}
          onChange={(e) => setVarsText(e.target.value)} />
        <p className="text-[10px] text-gray-500 mt-1">
          {'<name> <min> <max>'} for uniform, or {'<name> <mean> <stddev> normal'} for a normal draw.
        </p>
      </div>
      <button onClick={run} disabled={busy} className={ds.btnPrimary}>
        {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Shuffle className="w-4 h-4" />} Run
      </button>
      {error && <ErrBox msg={error} />}
      {res && (res.message ? (
        <p className="text-sm text-gray-400">{res.message}</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <CmpStat label="Mean" value={res.mean} />
            <CmpStat label="Std Dev" value={res.stddev} />
            <CmpStat label="Trials" value={res.trials} />
          </div>
          <div className="space-y-1.5">
            {(['p5', 'p25', 'p50', 'p75', 'p95'] as const).map((key) => {
              const maxVal = Math.abs(res.percentiles.p95 || 1);
              const barWidth = maxVal > 0 ? Math.min((Math.abs(res.percentiles[key] || 0) / maxVal) * 100, 100) : 0;
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 w-16 shrink-0 uppercase">{key}</span>
                  <div className="flex-1 h-2 bg-black/30 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-orange-500/60" style={{ width: `${barWidth}%` }} />
                  </div>
                  <span className="text-xs font-mono text-gray-300 w-16 text-right">{res.percentiles[key]}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2 text-xs bg-black/20 rounded p-2">
            <span className="text-gray-400">90% CI:</span>
            <span className="font-mono text-orange-300">[{res.confidenceInterval90.lower} — {res.confidenceInterval90.upper}]</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Elasticity (deterministic ± perturbation tornado chart) ────────────────

interface ElasticityResult {
  message?: string;
  outputField: string;
  baselineOutput: number;
  mostSensitive: string;
  leastSensitive: string;
  sensitivity: Array<{ parameter: string; sensitivity: number; direction: string }>;
}

function ElasticityTool() {
  const [stateText, setStateText] = useState('units=500\nprice=25\nfixedCost=3000');
  const [rulesText, setRulesText] = useState('units growth 0.02\nprice decay 0.01\nfixedCost add 50');
  const [perturbation, setPerturbation] = useState(10);
  const [steps, setSteps] = useState(10);
  const [res, setRes] = useState<ElasticityResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    const baseState = parseStateLines(stateText);
    const rules = parseRuleLines(rulesText);
    const r = await lensRun<ElasticityResult>('sim', 'sensitivityAnalysis', { baseState, rules, perturbation, steps });
    if (r.data.ok && r.data.result) { setRes(r.data.result); }
    else { setRes(null); setError(r.data.error || 'Elasticity analysis failed'); }
    setBusy(false);
  }, [stateText, rulesText, perturbation, steps]);

  return (
    <div className={cn(ds.panel, 'space-y-3')}>
      <p className={ds.textMuted}>
        Deterministic ± perturbation elasticity: nudges each numeric field up
        and down by a percentage and ranks which one moves the outcome most —
        a tornado chart, not a Monte Carlo correlation.
      </p>
      <div className={ds.grid2}>
        <div>
          <label className={ds.label}>Base State (name=value)</label>
          <textarea className={cn(ds.textarea, 'h-24 font-mono text-xs')} value={stateText}
            onChange={(e) => setStateText(e.target.value)} />
        </div>
        <div>
          <label className={ds.label}>Rules</label>
          <textarea className={cn(ds.textarea, 'h-24 font-mono text-xs')} value={rulesText}
            onChange={(e) => setRulesText(e.target.value)} />
          <p className="text-[10px] text-gray-500 mt-1">{RULE_HELP}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={ds.label}>Perturbation %</label>
          <input type="number" className={ds.input} value={perturbation}
            onChange={(e) => setPerturbation(parseFloat(e.target.value) || 1)} />
        </div>
        <div>
          <label className={ds.label}>Steps</label>
          <input type="number" className={ds.input} value={steps}
            onChange={(e) => setSteps(parseInt(e.target.value) || 1)} />
        </div>
      </div>
      <button onClick={run} disabled={busy} className={ds.btnPrimary}>
        {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />} Analyze
      </button>
      {error && <ErrBox msg={error} />}
      {res && (res.message ? (
        <p className="text-sm text-gray-400">{res.message}</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs text-gray-400">
            <span>Output: <span className="text-white font-mono">{res.outputField}</span></span>
            <span>Baseline: <span className="text-white font-mono">{res.baselineOutput}</span></span>
            <span>Most Sensitive: <span className="text-green-400 font-mono">{res.mostSensitive}</span></span>
          </div>
          <div className="space-y-2">
            {res.sensitivity.map((item, i) => {
              const maxSens = Math.max(...res.sensitivity.map((x) => x.sensitivity), 1);
              const barPct = (item.sensitivity / maxSens) * 100;
              return (
                <div key={i} className="space-y-0.5">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-4 text-gray-600 font-mono shrink-0">{i + 1}.</span>
                    <span className="flex-1 text-gray-300 font-mono">{item.parameter}</span>
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full',
                      item.direction === 'positive' ? 'bg-green-500/20 text-green-400' :
                      item.direction === 'negative' ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400')}>
                      {item.direction}
                    </span>
                    <span className="text-gray-400 font-mono w-10 text-right">{item.sensitivity}</span>
                  </div>
                  <div className="h-1.5 bg-black/30 rounded-full overflow-hidden ml-5">
                    <div className={cn('h-full rounded-full', i === 0 ? 'bg-green-500' : i === 1 ? 'bg-emerald-400' : 'bg-green-400/60')}
                      style={{ width: `${barPct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
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
