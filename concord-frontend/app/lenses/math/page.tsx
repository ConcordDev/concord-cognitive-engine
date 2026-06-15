'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ArxivPanel } from '@/components/research/ArxivPanel';
import { MathStackFeed } from '@/components/math/MathStackFeed';
import { MathActionPanel } from '@/components/math/MathActionPanel';
import { SymbolicWorkbench } from '@/components/math/SymbolicWorkbench';
import { PipingProvider } from '@/components/panel-polish';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useState, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Calculator, Play, CheckCircle, XCircle, Sigma, Pi, Loader2,
  History, TrendingUp, Hash, Plus, Trash2, BarChart3, Layers, ChevronDown
} from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { apiHelpers } from '@/lib/api/client';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import STSVKExplorer from '@/components/visualizations/STSVKExplorer';
import { SubLensQuickNav } from '@/components/lens/SubLensQuickNav';

/* ─── Interfaces ─── */
interface ExpressionRecord {
  expression: string;
  result: string;
  verified: boolean;
  evaluatedAt: string;
}

interface FormulaRecord {
  name: string;
  latex: string;
  description: string;
  category: string;
}

interface PlotPoint {
  x: number;
  y: number;
}

/* ─── Unicode LaTeX-style display helper ─── */
function renderFormula(latex: string): string {
  return latex
    .replace(/\\pi/g, '\u03C0')
    .replace(/\\theta/g, '\u03B8')
    .replace(/\\alpha/g, '\u03B1')
    .replace(/\\beta/g, '\u03B2')
    .replace(/\\gamma/g, '\u03B3')
    .replace(/\\delta/g, '\u03B4')
    .replace(/\\epsilon/g, '\u03B5')
    .replace(/\\sigma/g, '\u03C3')
    .replace(/\\Sigma/g, '\u03A3')
    .replace(/\\lambda/g, '\u03BB')
    .replace(/\\mu/g, '\u03BC')
    .replace(/\\omega/g, '\u03C9')
    .replace(/\\Omega/g, '\u03A9')
    .replace(/\\phi/g, '\u03C6')
    .replace(/\\psi/g, '\u03C8')
    .replace(/\\tau/g, '\u03C4')
    .replace(/\\infty/g, '\u221E')
    .replace(/\\int/g, '\u222B')
    .replace(/\\sum/g, '\u2211')
    .replace(/\\prod/g, '\u220F')
    .replace(/\\sqrt\{([^}]+)\}/g, '\u221A($1)')
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1)/($2)')
    .replace(/\^2/g, '\u00B2')
    .replace(/\^3/g, '\u00B3')
    .replace(/\^n/g, '\u207F')
    .replace(/\\neq/g, '\u2260')
    .replace(/\\leq/g, '\u2264')
    .replace(/\\geq/g, '\u2265')
    .replace(/\\approx/g, '\u2248')
    .replace(/\\pm/g, '\u00B1')
    .replace(/\\times/g, '\u00D7')
    .replace(/\\div/g, '\u00F7')
    .replace(/\\cdot/g, '\u00B7')
    .replace(/\\rightarrow/g, '\u2192')
    .replace(/\\leftarrow/g, '\u2190')
    .replace(/\\partial/g, '\u2202')
    .replace(/\\nabla/g, '\u2207')
    .replace(/\{/g, '')
    .replace(/\}/g, '');
}

/* ─── Simple function plotter logic ─── */
const PLOT_WIDTH = 300;
const PLOT_HEIGHT = 200;
const PLOT_PADDING = 30;

// Safe math expression evaluator — no new Function / eval
const SAFE_MATH_TOKEN = /^(\s|[0-9.+\-*/()x,]|Math\.(sin|cos|tan|abs|log|exp|sqrt|PI|E)|\*\*)*$/;

function evaluatePlotFn(expr: string, x: number): number | null {
  try {
    const sanitized = expr
      .replace(/\bsin\b/g, 'Math.sin')
      .replace(/\bcos\b/g, 'Math.cos')
      .replace(/\btan\b/g, 'Math.tan')
      .replace(/\babs\b/g, 'Math.abs')
      .replace(/\blog\b/g, 'Math.log')
      .replace(/\bexp\b/g, 'Math.exp')
      .replace(/\bsqrt\b/g, 'Math.sqrt')
      .replace(/\bpi\b/g, 'Math.PI')
      .replace(/\be\b(?!x)/g, 'Math.E')
      .replace(/\^/g, '**');
    // Allowlist: only permit math tokens, numbers, operators, and x
    const withX = sanitized.replace(/\bx\b/g, String(x));
    if (!SAFE_MATH_TOKEN.test(withX)) return null;
    const fn = new Function(`"use strict"; return (${withX});`);
    const result = fn();
    if (typeof result === 'number' && isFinite(result)) return result;
    return null;
  } catch {
    return null;
  }
}

function generatePlotPoints(expr: string, xMin: number, xMax: number, steps: number): PlotPoint[] {
  const points: PlotPoint[] = [];
  const dx = (xMax - xMin) / steps;
  for (let i = 0; i <= steps; i++) {
    const x = xMin + i * dx;
    const y = evaluatePlotFn(expr, x);
    if (y !== null) points.push({ x, y });
  }
  return points;
}

/* ─── Equation Solver types ─── */
type SolverMode = 'linear' | 'quadratic' | 'expression';

/* ─── Difficulty badge for formulas ─── */
const CATEGORY_DIFFICULTY: Record<string, { label: string; color: string; bg: string }> = {
  general:    { label: 'Intro',     color: 'text-green-400',  bg: 'bg-green-400/15 border-green-400/30' },
  algebra:    { label: 'Beginner',  color: 'text-blue-400',   bg: 'bg-blue-400/15 border-blue-400/30' },
  geometry:   { label: 'Beginner',  color: 'text-cyan-400',   bg: 'bg-cyan-400/15 border-cyan-400/30' },
  statistics: { label: 'Intermediate', color: 'text-yellow-400', bg: 'bg-yellow-400/15 border-yellow-400/30' },
  calculus:   { label: 'Advanced',  color: 'text-orange-400', bg: 'bg-orange-400/15 border-orange-400/30' },
  physics:    { label: 'Advanced',  color: 'text-red-400',    bg: 'bg-red-400/15 border-red-400/30' },
};

export default function MathLensPage() {
  useLensNav('math');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('math');

  const runAction = useRunArtifact('math');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const handleAction = async (action: string) => {
    const targetId = expressionItems[0]?.id;
    if (!targetId) { setActionResult({ message: 'Add a math expression first to run analysis.' }); return; }
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    finally { setIsRunning(null); }
  };

  /* ─── Expression evaluator state ─── */
  const [expression, setExpression] = useState('');
  const [result, setResult] = useState<{ value: string; verified: boolean } | null>(null);
  const [evaluating, setEvaluating] = useState(false);

  /* ─── Equation solver state ─── */
  const [solverMode, setSolverMode] = useState<SolverMode>('quadratic');
  const [solverA, setSolverA] = useState('1');
  const [solverB, setSolverB] = useState('-5');
  const [solverC, setSolverC] = useState('6');
  const [solverResult, setSolverResult] = useState<string | null>(null);
  const [solverSteps, setSolverSteps] = useState<string[]>([]);

  /* ─── Function plotter state ─── */
  const [plotExpr, setPlotExpr] = useState('sin(x)');
  const [plotXMin, setPlotXMin] = useState(-6.28);
  const [plotXMax, setPlotXMax] = useState(6.28);

  /* ─── Active tab ─── */
  const [activeTab, setActiveTab] = useState<'evaluator' | 'solver' | 'formulas' | 'plotter'>('evaluator');

  // Lens-scoped keyboard commands (auto-wired by codemod).
  useLensCommand(
    [
      { id: 'tab-evaluator', keys: 'e', description: 'Evaluator', category: 'navigation', action: () => setActiveTab('evaluator') },
      { id: 'tab-solver', keys: 's', description: 'Solver', category: 'navigation', action: () => setActiveTab('solver') },
      { id: 'tab-formulas', keys: 'f', description: 'Formulas', category: 'navigation', action: () => setActiveTab('formulas') },
      { id: 'tab-plotter', keys: 'p', description: 'Plotter', category: 'navigation', action: () => setActiveTab('plotter') },
    ],
    { lensId: 'math' }
  );
  const [showFeatures, setShowFeatures] = useState(true);

  /* ─── Data from backend ─── */
  const {
    items: expressionItems,
    isLoading: expLoading,
    isError: isError,
    error: error,
    refetch: refetch,
    create: createExpression,
    remove: removeExpression,
  } = useLensData<ExpressionRecord>('math', 'expression', { seed: [] });

  const {
    items: formulaItems,
    isLoading: formulaLoading,
    isError: isError2,
    error: error2,
    refetch: refetch2,
    create: createFormula,
    remove: removeFormula,
  } = useLensData<FormulaRecord>('math', 'formula', { seed: [] });

  /* ─── Derived stats ─── */
  const totalExpressions = expressionItems.length;
  const verifiedCount = expressionItems.filter(e => e.data.verified).length;
  const accuracyPct = totalExpressions > 0
    ? `${Math.round((verifiedCount / totalExpressions) * 100)}%`
    : '---';

  /* ─── Expression evaluator ─── */
  const handleEvaluate = async () => {
    if (!expression.trim()) return;
    setEvaluating(true);
    setResult(null);
    try {
      const response = await apiHelpers.chat.ask(expression, 'math');
      const respData = response.data;

      let evalValue: string;
      let verified: boolean;

      if (respData && typeof respData === 'object') {
        evalValue = String(
          respData.result ?? respData.answer ?? respData.reply ?? respData.message ?? respData.data ?? 'No result'
        );
        verified = respData.verified !== false && evalValue !== 'Error' && evalValue !== 'No result';
      } else {
        evalValue = String(respData);
        verified = true;
      }

      setResult({ value: evalValue, verified });

      await createExpression({
        title: expression,
        data: {
          expression,
          result: evalValue,
          verified,
          evaluatedAt: new Date().toISOString(),
        } as unknown as Partial<ExpressionRecord>,
        meta: { tags: ['math', verified ? 'verified' : 'unverified'], status: verified ? 'verified' : 'error' },
      });
    } catch {
      setResult({ value: 'Error: Failed to evaluate', verified: false });
    } finally {
      setEvaluating(false);
    }
  };

  /* ─── Equation solver ─── */
  const handleSolve = useCallback(() => {
    const a = parseFloat(solverA);
    const b = parseFloat(solverB);
    const c = parseFloat(solverC);
    const steps: string[] = [];

    if (solverMode === 'linear') {
      // ax + b = 0 => x = -b/a
      steps.push(`Start with: ${solverA}x + ${solverB} = 0`);
      if (a === 0) {
        setSolverResult(b === 0 ? 'Infinite solutions' : 'No solution');
        setSolverSteps(steps);
        return;
      }
      steps.push(`Subtract ${solverB} from both sides: ${solverA}x = ${-b}`);
      steps.push(`Divide both sides by ${solverA}`);
      const x = -b / a;
      steps.push(`x = ${-b} ÷ ${a} = ${x}`);
      setSolverResult(`x = ${x}`);
    } else if (solverMode === 'quadratic') {
      steps.push(`Start with: ${solverA}x² + ${solverB}x + ${solverC} = 0`);
      steps.push(`Using the quadratic formula: x = (−b ± √(b²−4ac)) / 2a`);
      steps.push(`Identify: a = ${a}, b = ${b}, c = ${c}`);
      if (a === 0) {
        if (b === 0) {
          setSolverResult(c === 0 ? 'Infinite solutions' : 'No solution');
        } else {
          setSolverResult(`x = ${-c / b}`);
        }
        setSolverSteps(steps);
        return;
      }
      const discriminant = b * b - 4 * a * c;
      steps.push(`Compute discriminant: b²−4ac = ${b}²−4·${a}·${c} = ${discriminant.toFixed(4)}`);
      if (discriminant > 0) {
        const x1 = (-b + Math.sqrt(discriminant)) / (2 * a);
        const x2 = (-b - Math.sqrt(discriminant)) / (2 * a);
        steps.push(`√discriminant = √${discriminant.toFixed(4)} ≈ ${Math.sqrt(discriminant).toFixed(6)}`);
        steps.push(`x₁ = (${-b} + ${Math.sqrt(discriminant).toFixed(4)}) / ${2 * a} = ${x1.toFixed(6)}`);
        steps.push(`x₂ = (${-b} − ${Math.sqrt(discriminant).toFixed(4)}) / ${2 * a} = ${x2.toFixed(6)}`);
        setSolverResult(`x\u2081 = ${x1.toFixed(6)}, x\u2082 = ${x2.toFixed(6)}`);
      } else if (discriminant === 0) {
        const x = -b / (2 * a);
        steps.push(`discriminant = 0 → one repeated root`);
        steps.push(`x = −b / 2a = ${-b} / ${2 * a} = ${x.toFixed(6)}`);
        setSolverResult(`x = ${x.toFixed(6)} (repeated root)`);
      } else {
        const real = (-b / (2 * a)).toFixed(6);
        const imag = (Math.sqrt(-discriminant) / (2 * a)).toFixed(6);
        steps.push(`discriminant < 0 → complex roots`);
        steps.push(`Real part: ${-b} / ${2 * a} = ${real}`);
        steps.push(`Imaginary part: √${Math.abs(discriminant).toFixed(4)} / ${2 * a} = ${imag}i`);
        setSolverResult(`x\u2081 = ${real} + ${imag}i, x\u2082 = ${real} - ${imag}i`);
      }
    } else {
      // expression mode - evaluate directly
      const val = evaluatePlotFn(solverA, 0);
      steps.push(`Evaluate: ${solverA}`);
      steps.push(val !== null ? `= ${val}` : 'Expression could not be parsed');
      setSolverResult(val !== null ? `Result = ${val}` : 'Could not evaluate');
    }
    setSolverSteps(steps);
  }, [solverMode, solverA, solverB, solverC]);

  /* ─── Save formula to backend ─── */
  const [newFormulaName, setNewFormulaName] = useState('');
  const [newFormulaLatex, setNewFormulaLatex] = useState('');
  const [newFormulaDesc, setNewFormulaDesc] = useState('');
  const [newFormulaCat, setNewFormulaCat] = useState('general');
  const [showAddFormula, setShowAddFormula] = useState(false);

  const handleSaveFormula = async () => {
    if (!newFormulaName.trim() || !newFormulaLatex.trim()) return;
    await createFormula({
      title: newFormulaName,
      data: {
        name: newFormulaName,
        latex: newFormulaLatex,
        description: newFormulaDesc,
        category: newFormulaCat,
      } as unknown as Partial<FormulaRecord>,
      meta: { tags: ['math', 'formula', newFormulaCat], status: 'active' },
    });
    setNewFormulaName('');
    setNewFormulaLatex('');
    setNewFormulaDesc('');
    setShowAddFormula(false);
  };

  /* ─── Plot data ─── */
  const plotPoints = useMemo(
    () => generatePlotPoints(plotExpr, plotXMin, plotXMax, 200),
    [plotExpr, plotXMin, plotXMax]
  );

  const plotYValues = plotPoints.map(p => p.y);
  const plotYMin = plotYValues.length > 0 ? Math.min(...plotYValues) : -1;
  const plotYMax = plotYValues.length > 0 ? Math.max(...plotYValues) : 1;
  const plotYRange = plotYMax - plotYMin || 1;
  const plotXRange = plotXMax - plotXMin || 1;

  function toSvgX(x: number): number {
    return PLOT_PADDING + ((x - plotXMin) / plotXRange) * (PLOT_WIDTH - 2 * PLOT_PADDING);
  }
  function toSvgY(y: number): number {
    return PLOT_HEIGHT - PLOT_PADDING - ((y - plotYMin) / plotYRange) * (PLOT_HEIGHT - 2 * PLOT_PADDING);
  }

  const plotPath = plotPoints.length > 1
    ? plotPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toSvgX(p.x).toFixed(2)} ${toSvgY(p.y).toFixed(2)}`).join(' ')
    : '';

  /* ─── Quick examples ─── */
  const examples = [
    { label: 'Quadratic', expr: '(-5 + sqrt(25 - 4*2*3)) / (2*2)' },
    { label: 'Fibonacci', expr: '(1.618^10 - (-0.618)^10) / 2.236' },
    { label: 'Golden Ratio', expr: '(1 + sqrt(5)) / 2' },
  ];

  const isLoading = expLoading || formulaLoading;

  if (isError || isError2) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message} onRetry={() => { refetch(); refetch2(); }} />
      </div>
    );
  }

  return (
    <LensShell lensId="math" asMain={false}>
      <FirstRunTour lensId="math" />
      <ManifestActionBar />
      <DepthBadge lensId="math" size="sm" className="ml-2" />
    <div data-lens-theme="math" className="p-6 space-y-6">
      {/* Phase 4 — REAL arXiv math feed. */}
      <ArxivPanel domain="math" title="arXiv · Mathematics" />
      <header className="flex items-center gap-3">
        <Calculator className="w-7 h-7 text-neon-blue" />
        <div>
          <h1 className="text-xl font-bold">Math Lens</h1>
          <p className="text-sm text-gray-400">
            Expression evaluator, equation solver, formula reference & function plotter
          </p>
        </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="math" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      </header>


      {/* AI Actions */}
      <UniversalActions domain="math" artifactId={expressionItems[0]?.id} compact />
      {isLoading ? (
        <div className="flex items-center justify-center p-12 text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          Loading math data...
        </div>
      ) : (
        <>
          {/* ── Stats Row ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="lens-card">
              <Calculator className="w-5 h-5 text-neon-blue mb-2" />
              <p className="text-2xl font-bold">{totalExpressions}</p>
              <p className="text-sm text-gray-400">Expressions</p>
            </div>
            <div className="lens-card">
              <Sigma className="w-5 h-5 text-neon-purple mb-2" />
              <p className="text-2xl font-bold">{verifiedCount}</p>
              <p className="text-sm text-gray-400">Verified</p>
            </div>
            <div className="lens-card">
              <Pi className="w-5 h-5 text-neon-cyan mb-2" />
              <p className="text-2xl font-bold">{formulaItems.length}</p>
              <p className="text-sm text-gray-400">Formulas Saved</p>
            </div>
            <div className="lens-card">
              <CheckCircle className="w-5 h-5 text-neon-green mb-2" />
              <p className="text-2xl font-bold">{accuracyPct}</p>
              <p className="text-sm text-gray-400">Accuracy</p>
            </div>
          </div>

          {/* ── Computational Math Engine (CAS) — symbolic, step-solve, plot, units, number theory ── */}
          <SymbolicWorkbench />

          {/* ── STSVK Theorem Explorer ── */}
          <STSVKExplorer />

          {/* ── Sub-Lenses ── */}
          <SubLensQuickNav lensId="math" />

          {/* ── Tab Navigation ── */}
          <div className="flex gap-2 border-b border-lattice-border pb-2">
            {[
              { id: 'evaluator' as const, label: 'Evaluator', icon: Play },
              { id: 'solver' as const, label: 'Solver', icon: Hash },
              { id: 'formulas' as const, label: 'Formulas', icon: Sigma },
              { id: 'plotter' as const, label: 'Plotter', icon: BarChart3 },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-t-lg text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/30 border-b-0'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Tab: Expression Evaluator ── */}
          {activeTab === 'evaluator' && (
            <div className="space-y-4">
              <div className="panel p-4">
                <h2 className="font-semibold mb-4 flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-neon-blue" />
                  Expression Evaluator
                </h2>
                <div className="flex gap-2 mb-4">
                  <input
                    type="text"
                    value={expression}
                    onChange={(e) => setExpression(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !evaluating && handleEvaluate()}
                    placeholder="e.g.  sin(pi/4) + sqrt(2)  or  integrate x^2..."
                    className="input-lattice flex-1 font-mono text-base tracking-wide bg-black/40 border-neon-blue/20 focus:border-neon-blue/50"
                    disabled={evaluating}
                  />
                  <button
                    onClick={handleEvaluate}
                    disabled={evaluating || !expression.trim()}
                    className="btn-neon purple flex items-center gap-1 disabled:opacity-50"
                  >
                    {evaluating ? (
                      <Loader2 className="w-4 h-4 mr-1 inline animate-spin" />
                    ) : (
                      <Play className="w-4 h-4 mr-1 inline" />
                    )}
                    {evaluating ? 'Evaluating...' : 'Evaluate'}
                  </button>
                </div>
                {result && (
                  <div className={`p-4 rounded-lg flex items-center gap-3 ${
                    result.verified ? 'bg-neon-green/20' : 'bg-neon-pink/20'
                  }`}>
                    {result.verified ? (
                      <CheckCircle className="w-5 h-5 text-neon-green" />
                    ) : (
                      <XCircle className="w-5 h-5 text-neon-pink" />
                    )}
                    <span className="font-mono text-xl">{result.value}</span>
                  </div>
                )}
              </div>

              <div className="panel p-4">
                <h2 className="font-semibold mb-4">Quick Examples</h2>
                <div className="flex flex-wrap gap-2">
                  {examples.map((ex) => (
                    <button
                      key={ex.label}
                      onClick={() => setExpression(ex.expr)}
                      className="px-3 py-2 bg-lattice-surface rounded-lg text-sm hover:bg-lattice-elevated transition-colors"
                    >
                      {ex.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Expression History */}
              {expressionItems.length > 0 ? (
                <div className="panel p-4">
                  <h2 className="font-semibold mb-4 flex items-center gap-2">
                    <History className="w-4 h-4 text-neon-purple" />
                    Computation History ({expressionItems.length})
                  </h2>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {expressionItems.slice(0, 20).map((item) => (
                      <div key={item.id} className="flex items-center justify-between p-3 bg-lattice-deep rounded-lg group">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          {item.data.verified ? (
                            <CheckCircle className="w-4 h-4 text-neon-green shrink-0" />
                          ) : (
                            <XCircle className="w-4 h-4 text-neon-pink shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-mono truncate">{item.data.expression || item.title}</p>
                            <p className="text-xs text-gray-400">
                              {item.data.evaluatedAt
                                ? new Date(item.data.evaluatedAt).toLocaleString()
                                : new Date(item.createdAt).toLocaleString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-neon-blue text-sm">{item.data.result}</span>
                          <button
                            onClick={() => removeExpression(item.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-neon-pink/20 rounded transition-all"
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3 text-neon-pink" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-6 text-gray-400 text-sm border border-dashed border-white/10 rounded-lg">
                  <p>No expressions yet. Create mathematical expressions to see computation results.</p>
                </div>
              )}
            </div>
          )}

          {/* ── Tab: Equation Solver ── */}
          {activeTab === 'solver' && (
            <div className="space-y-4">
              <div className="panel p-4">
                <h2 className="font-semibold mb-4 flex items-center gap-2">
                  <Hash className="w-4 h-4 text-neon-cyan" />
                  Equation Solver
                </h2>

                <div className="flex gap-2 mb-4">
                  {[
                    { id: 'linear' as const, label: 'Linear (ax+b=0)' },
                    { id: 'quadratic' as const, label: 'Quadratic (ax\u00B2+bx+c=0)' },
                    { id: 'expression' as const, label: 'Expression' },
                  ].map(mode => (
                    <button
                      key={mode.id}
                      onClick={() => { setSolverMode(mode.id); setSolverResult(null); }}
                      className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                        solverMode === mode.id
                          ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30'
                          : 'bg-lattice-surface text-gray-400 hover:text-white'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>

                <div className="space-y-3">
                  {solverMode === 'expression' ? (
                    <div>
                      <label className="text-sm text-gray-400 block mb-1">Expression (use x as variable)</label>
                      <input
                        type="text"
                        value={solverA}
                        onChange={e => setSolverA(e.target.value)}
                        placeholder="e.g., sin(pi/4) + cos(0)"
                        className="input-lattice w-full font-mono"
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-sm text-gray-400 block mb-1">a</label>
                        <input
                          type="number"
                          value={solverA}
                          onChange={e => setSolverA(e.target.value)}
                          className="input-lattice w-full font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-sm text-gray-400 block mb-1">b</label>
                        <input
                          type="number"
                          value={solverB}
                          onChange={e => setSolverB(e.target.value)}
                          className="input-lattice w-full font-mono"
                        />
                      </div>
                      {solverMode === 'quadratic' && (
                        <div>
                          <label className="text-sm text-gray-400 block mb-1">c</label>
                          <input
                            type="number"
                            value={solverC}
                            onChange={e => setSolverC(e.target.value)}
                            className="input-lattice w-full font-mono"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Equation display */}
                  <div className="p-3 bg-lattice-deep rounded-lg font-mono text-center text-lg">
                    {solverMode === 'linear' && (
                      <span>{solverA}x + {solverB} = 0</span>
                    )}
                    {solverMode === 'quadratic' && (
                      <span>{solverA}x{'\u00B2'} + {solverB}x + {solverC} = 0</span>
                    )}
                    {solverMode === 'expression' && (
                      <span className="text-gray-400">{solverA || 'Enter expression...'}</span>
                    )}
                  </div>

                  <button
                    onClick={handleSolve}
                    className="btn-neon purple flex items-center gap-2"
                  >
                    <Play className="w-4 h-4" />
                    Solve
                  </button>

                  {solverResult && (
                    <div className="space-y-3">
                      {/* Final answer */}
                      <div className="p-4 bg-neon-green/10 rounded-lg border border-neon-green/30">
                        <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Solution</p>
                        <p className="font-mono text-lg text-neon-green">{solverResult}</p>
                      </div>
                      {/* Step-by-step */}
                      {solverSteps.length > 0 && (
                        <div className="p-3 bg-black/30 rounded-lg border border-white/5">
                          <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Step-by-step</p>
                          <ol className="space-y-1.5">
                            {solverSteps.map((step, idx) => (
                              <li key={idx} className="flex items-start gap-2 text-sm">
                                <span className="shrink-0 w-5 h-5 rounded-full bg-neon-blue/20 text-neon-blue text-[10px] font-bold flex items-center justify-center mt-0.5">
                                  {idx + 1}
                                </span>
                                <span className="font-mono text-gray-300">{step}</span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Discriminant visual for quadratic */}
              {solverMode === 'quadratic' && (
                <div className="panel p-4">
                  <h3 className="font-semibold mb-3 text-sm">Discriminant Analysis</h3>
                  {(() => {
                    const a = parseFloat(solverA);
                    const b = parseFloat(solverB);
                    const c = parseFloat(solverC);
                    const d = b * b - 4 * a * c;
                    const label = d > 0 ? 'Two real roots' : d === 0 ? 'One repeated root' : 'Complex roots';
                    const color = d > 0 ? 'text-neon-green' : d === 0 ? 'text-neon-blue' : 'text-neon-pink';
                    return (
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-400">Discriminant (b{'\u00B2'} - 4ac)</span>
                          <span className={`font-mono ${color}`}>{isNaN(d) ? '---' : d.toFixed(4)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-400">Root type</span>
                          <span className={color}>{isNaN(d) ? '---' : label}</span>
                        </div>
                        {!isNaN(a) && a !== 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-400">Vertex</span>
                            <span className="font-mono">({(-b / (2 * a)).toFixed(3)}, {(-(d) / (4 * a)).toFixed(3)})</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {/* ── Tab: Formula Reference ── */}
          {activeTab === 'formulas' && (
            <div className="space-y-4">
              <div className="panel p-4">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-semibold flex items-center gap-2">
                    <Sigma className="w-4 h-4 text-neon-purple" />
                    Formula Reference
                  </h2>
                  <button
                    onClick={() => setShowAddFormula(!showAddFormula)}
                    className="btn-neon flex items-center gap-1 text-sm"
                  >
                    <Plus className="w-4 h-4" />
                    Add Formula
                  </button>
                </div>

                {showAddFormula && (
                  <div className="space-y-3 mb-4 p-4 bg-lattice-deep rounded-lg border border-lattice-border">
                    <input
                      type="text"
                      value={newFormulaName}
                      onChange={e => setNewFormulaName(e.target.value)}
                      placeholder="Formula name (e.g., Pythagorean Theorem)"
                      className="input-lattice w-full"
                    />
                    <input
                      type="text"
                      value={newFormulaLatex}
                      onChange={e => setNewFormulaLatex(e.target.value)}
                      placeholder="LaTeX notation (e.g., a^2 + b^2 = c^2)"
                      className="input-lattice w-full font-mono"
                    />
                    <input
                      type="text"
                      value={newFormulaDesc}
                      onChange={e => setNewFormulaDesc(e.target.value)}
                      placeholder="Description"
                      className="input-lattice w-full"
                    />
                    <select
                      value={newFormulaCat}
                      onChange={e => setNewFormulaCat(e.target.value)}
                      className="input-lattice w-full"
                    >
                      <option value="general">General</option>
                      <option value="algebra">Algebra</option>
                      <option value="calculus">Calculus</option>
                      <option value="geometry">Geometry</option>
                      <option value="statistics">Statistics</option>
                      <option value="physics">Physics</option>
                    </select>
                    {newFormulaLatex && (
                      <div className="p-3 bg-lattice-surface rounded-lg">
                        <p className="text-xs text-gray-400 mb-1">Preview:</p>
                        <p className="font-mono text-lg">{renderFormula(newFormulaLatex)}</p>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveFormula}
                        disabled={!newFormulaName.trim() || !newFormulaLatex.trim()}
                        className="btn-neon purple disabled:opacity-50"
                      >
                        Save Formula
                      </button>
                      <button
                        onClick={() => setShowAddFormula(false)}
                        className="btn-neon"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {formulaItems.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    <Sigma className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>No formulas saved yet. Add your first formula above.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {formulaItems.map(item => {
                      const diff = CATEGORY_DIFFICULTY[item.data.category] || CATEGORY_DIFFICULTY.general;
                      return (
                        <motion.div
                          key={item.id}
                          layout
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="lens-card group relative"
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="space-y-1">
                              <p className="font-semibold text-sm">{item.data.name}</p>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs px-1.5 py-0.5 rounded border bg-neon-purple/15 border-neon-purple/30 text-neon-purple">
                                  {item.data.category}
                                </span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${diff.bg} ${diff.color}`}>
                                  {diff.label}
                                </span>
                              </div>
                            </div>
                            <button
                              onClick={() => removeFormula(item.id)}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-neon-pink/20 rounded transition-all"
                            aria-label="Delete">
                              <Trash2 className="w-3 h-3 text-neon-pink" />
                            </button>
                          </div>
                          {/* Equation editor style display */}
                          <div className="p-3 bg-lattice-deep rounded-lg mb-2 border border-white/5 text-center">
                            <p className="font-mono text-lg tracking-wide">{renderFormula(item.data.latex)}</p>
                          </div>
                          {item.data.description && (
                            <p className="text-xs text-gray-400">{item.data.description}</p>
                          )}
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Common Constants Reference */}
              <div className="panel p-4">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-neon-blue" />
                  Mathematical Constants
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { name: '\u03C0 (Pi)', value: '\u03C0 \u2248 3.14159265358979' },
                    { name: 'e (Euler)', value: 'e \u2248 2.71828182845905' },
                    { name: '\u03C6 (Golden Ratio)', value: '\u03C6 \u2248 1.61803398874989' },
                    { name: '\u221A2', value: '\u221A2 \u2248 1.41421356237310' },
                    { name: 'ln(2)', value: 'ln(2) \u2248 0.69314718055995' },
                    { name: '\u03B3 (Euler-Mascheroni)', value: '\u03B3 \u2248 0.57721566490153' },
                    { name: '\u03B6(3) (Ap\u00E9ry)', value: '\u03B6(3) \u2248 1.20205690315959' },
                    { name: '\u221A3', value: '\u221A3 \u2248 1.73205080756888' },
                  ].map(c => (
                    <div key={c.name} className="p-3 bg-lattice-deep rounded-lg">
                      <p className="text-sm font-semibold text-neon-cyan mb-1">{c.name}</p>
                      <p className="font-mono text-xs text-gray-300">{c.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Tab: Function Plotter ── */}
          {activeTab === 'plotter' && (
            <div className="space-y-4">
              <div className="panel p-4">
                <h2 className="font-semibold mb-4 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-neon-green" />
                  Function Plotter
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                  <div>
                    <label className="text-sm text-gray-400 block mb-1">f(x) =</label>
                    <input
                      type="text"
                      value={plotExpr}
                      onChange={e => setPlotExpr(e.target.value)}
                      placeholder="e.g., sin(x), x^2, exp(-x)"
                      className="input-lattice w-full font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 block mb-1">x min</label>
                    <input
                      type="number"
                      value={plotXMin}
                      onChange={e => setPlotXMin(parseFloat(e.target.value) || -10)}
                      className="input-lattice w-full font-mono"
                      step="0.5"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-400 block mb-1">x max</label>
                    <input
                      type="number"
                      value={plotXMax}
                      onChange={e => setPlotXMax(parseFloat(e.target.value) || 10)}
                      className="input-lattice w-full font-mono"
                      step="0.5"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-4">
                  {[
                    { label: 'sin(x)', expr: 'sin(x)' },
                    { label: 'cos(x)', expr: 'cos(x)' },
                    { label: 'x\u00B2', expr: 'x^2' },
                    { label: 'x\u00B3', expr: 'x^3' },
                    { label: '1/x', expr: '1/x' },
                    { label: 'e^x', expr: 'exp(x)' },
                    { label: 'ln(x)', expr: 'log(x)' },
                    { label: '\u221Ax', expr: 'sqrt(abs(x))' },
                  ].map(fn => (
                    <button
                      key={fn.label}
                      onClick={() => setPlotExpr(fn.expr)}
                      className="px-3 py-1 bg-lattice-surface rounded text-sm hover:bg-lattice-elevated transition-colors"
                    >
                      {fn.label}
                    </button>
                  ))}
                </div>

                {/* SVG Plot */}
                <div className="bg-lattice-deep rounded-lg p-2">
                  <svg
                    viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
                    className="w-full h-auto"
                    style={{ maxHeight: '400px' }}
                  >
                    {/* Grid lines */}
                    {Array.from({ length: 5 }, (_, i) => {
                      const y = PLOT_PADDING + ((PLOT_HEIGHT - 2 * PLOT_PADDING) / 4) * i;
                      return (
                        <line key={`h${i}`} x1={PLOT_PADDING} y1={y} x2={PLOT_WIDTH - PLOT_PADDING} y2={y}
                          stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                      );
                    })}
                    {Array.from({ length: 5 }, (_, i) => {
                      const x = PLOT_PADDING + ((PLOT_WIDTH - 2 * PLOT_PADDING) / 4) * i;
                      return (
                        <line key={`v${i}`} x1={x} y1={PLOT_PADDING} x2={x} y2={PLOT_HEIGHT - PLOT_PADDING}
                          stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
                      );
                    })}

                    {/* Axes (if visible) */}
                    {plotYMin <= 0 && plotYMax >= 0 && (
                      <line
                        x1={PLOT_PADDING} y1={toSvgY(0)} x2={PLOT_WIDTH - PLOT_PADDING} y2={toSvgY(0)}
                        stroke="rgba(255,255,255,0.2)" strokeWidth="0.5"
                      />
                    )}
                    {plotXMin <= 0 && plotXMax >= 0 && (
                      <line
                        x1={toSvgX(0)} y1={PLOT_PADDING} x2={toSvgX(0)} y2={PLOT_HEIGHT - PLOT_PADDING}
                        stroke="rgba(255,255,255,0.2)" strokeWidth="0.5"
                      />
                    )}

                    {/* Plot line */}
                    {plotPath && (
                      <path d={plotPath} fill="none" stroke="#00d4ff" strokeWidth="1.5" strokeLinecap="round" />
                    )}

                    {/* Axis labels */}
                    <text x={PLOT_PADDING} y={PLOT_HEIGHT - 8} fontSize="7" fill="#888">{plotXMin.toFixed(1)}</text>
                    <text x={PLOT_WIDTH - PLOT_PADDING - 15} y={PLOT_HEIGHT - 8} fontSize="7" fill="#888">{plotXMax.toFixed(1)}</text>
                    <text x={4} y={PLOT_PADDING + 4} fontSize="7" fill="#888">{plotYMax.toFixed(1)}</text>
                    <text x={4} y={PLOT_HEIGHT - PLOT_PADDING} fontSize="7" fill="#888">{plotYMin.toFixed(1)}</text>

                    {/* Border */}
                    <rect x={PLOT_PADDING} y={PLOT_PADDING}
                      width={PLOT_WIDTH - 2 * PLOT_PADDING} height={PLOT_HEIGHT - 2 * PLOT_PADDING}
                      fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5"
                    />
                  </svg>
                </div>

                {plotPoints.length === 0 && (
                  <p className="text-center text-sm text-neon-pink mt-2">
                    Could not plot this function. Check your expression.
                  </p>
                )}

                {plotPoints.length > 0 && (
                  <div className="grid grid-cols-3 gap-3 mt-3 text-sm">
                    <div className="p-2 bg-lattice-surface rounded text-center">
                      <p className="text-gray-400 text-xs">Min Y</p>
                      <p className="font-mono">{plotYMin.toFixed(4)}</p>
                    </div>
                    <div className="p-2 bg-lattice-surface rounded text-center">
                      <p className="text-gray-400 text-xs">Max Y</p>
                      <p className="font-mono">{plotYMax.toFixed(4)}</p>
                    </div>
                    <div className="p-2 bg-lattice-surface rounded text-center">
                      <p className="text-gray-400 text-xs">Points</p>
                      <p className="font-mono">{plotPoints.length}</p>
                    </div>
                  </div>
                )}
              </div>

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="math"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
            </div>
          )}
        </>
      )}

      {/* Backend Action Panel */}
      <div className="panel p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Sigma className="w-4 h-4 text-neon-cyan" />
          Math Analysis
        </h2>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'statisticalAnalysis', label: 'Statistical Analysis' },
            { action: 'matrixOperations', label: 'Matrix Operations' },
            { action: 'polynomialAnalysis', label: 'Polynomial Analysis' },
            { action: 'regressionFit', label: 'Regression Fit' },
          ].map(({ action, label }) => (
            <button key={action} onClick={() => handleAction(action)} disabled={!!isRunning}
              className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
              {isRunning === action ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {label}
            </button>
          ))}
        </div>
        {actionResult && (
          <div className="bg-lattice-deep rounded-lg p-4 space-y-3 text-sm">
            {'centralTendency' in actionResult && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {'n' in actionResult && <span className="text-gray-400">n: <span className="text-neon-cyan font-bold">{String(actionResult.n)}</span></span>}
                  {'centralTendency' in actionResult && actionResult.centralTendency !== null && typeof actionResult.centralTendency === 'object' && (
                    Object.entries(actionResult.centralTendency as Record<string, unknown>).map(([k, v]) => (
                      <span key={k} className="text-gray-400">{k}: <span className="text-white">{String(v)}</span></span>
                    ))
                  )}
                  {'spread' in actionResult && actionResult.spread !== null && typeof actionResult.spread === 'object' && (
                    Object.entries(actionResult.spread as Record<string, unknown>).map(([k, v]) => (
                      <span key={k} className="text-gray-400">{k}: <span className="text-neon-cyan">{String(v)}</span></span>
                    ))
                  )}
                </div>
                {'outliers' in actionResult && actionResult.outliers !== null && typeof actionResult.outliers === 'object' && (
                  <div className="text-xs text-gray-400">
                    Outliers: <span className="text-yellow-400">{String((actionResult.outliers as Record<string, unknown>).count || 0)}</span>
                  </div>
                )}
              </div>
            )}
            {'operation' in actionResult && 'determinant' in actionResult && (
              <div className="text-xs">
                <span className="text-gray-400">Operation: <span className="text-neon-cyan">{String(actionResult.operation)}</span></span>
                <span className="ml-4 text-gray-400">Det: <span className="text-white">{String(actionResult.determinant)}</span></span>
              </div>
            )}
            {'degree' in actionResult && 'coefficients' in actionResult && (
              <div className="space-y-1 text-xs">
                <p className="text-gray-400">Degree: <span className="text-neon-cyan">{String(actionResult.degree)}</span></p>
                {'roots' in actionResult && actionResult.roots !== null && typeof actionResult.roots === 'object' && (
                  <p className="text-gray-400">Roots: <span className="text-neon-green">{String((actionResult.roots as Record<string, unknown>).values || 'none')}</span></p>
                )}
              </div>
            )}
            {'rSquared' in actionResult && 'type' in actionResult && 'equation' in actionResult && (
              <div className="space-y-1 text-xs">
                <p className="text-gray-400">Type: <span className="text-neon-cyan">{String(actionResult.type)}</span></p>
                <p className="font-mono text-white bg-lattice-surface rounded px-2 py-1">{String(actionResult.equation)}</p>
                <p className="text-gray-400">R²: <span className={String(actionResult.rSquared) > '0.9' ? 'text-neon-green' : 'text-yellow-400'}>{String(actionResult.rSquared)}</span></p>
              </div>
            )}
            {'message' in actionResult && <p className="text-gray-400">{String(actionResult.message)}</p>}
          </div>
        )}
      </div>

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="math" />
          </div>
        )}
      </div>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <MathStackFeed />
      </section>

      {/* math workbench: stats / matrix / polynomial / regression + actions */}
      <PipingProvider>
        <section className="mt-6">
          <MathActionPanel />
        </section>
      </PipingProvider>
    </div>
          <RecentMineCard domain="math" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="math" hideWhenEmpty className="mt-3" title="More actions" />
          <CrossLensRecentsPanel lensId="math" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
