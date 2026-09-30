'use client';

/**
 * Formula notebook — persisted expressions (math.naturalQuery) and
 * KaTeX formula artifacts. Panel owns useLensData; nothing is fabricated.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Calculator, Play, CheckCircle, XCircle, Sigma, Plus, Trash2,
  History, TrendingUp, Loader2,
} from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { lensRun } from '@/lib/api/client';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { MathFormula } from '@/components/math/MathFormula';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

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

const CATEGORY_DIFFICULTY: Record<string, { label: string; color: string; bg: string }> = {
  general:    { label: 'Intro',        color: 'text-green-400',  bg: 'bg-green-400/15 border-green-400/30' },
  algebra:    { label: 'Beginner',     color: 'text-blue-400',   bg: 'bg-blue-400/15 border-blue-400/30' },
  geometry:   { label: 'Beginner',     color: 'text-cyan-400',   bg: 'bg-cyan-400/15 border-cyan-400/30' },
  statistics: { label: 'Intermediate', color: 'text-yellow-400', bg: 'bg-yellow-400/15 border-yellow-400/30' },
  calculus:   { label: 'Advanced',     color: 'text-orange-400', bg: 'bg-orange-400/15 border-orange-400/30' },
  physics:    { label: 'Advanced',     color: 'text-red-400',    bg: 'bg-red-400/15 border-red-400/30' },
};

const EXAMPLES = [
  { label: 'Quadratic', expr: '(-5 + sqrt(25 - 4*2*3)) / (2*2)' },
  { label: 'Fibonacci', expr: '(1.618^10 - (-0.618)^10) / 2.236' },
  { label: 'Golden Ratio', expr: '(1 + sqrt(5)) / 2' },
];

const CONSTANTS = [
  { name: '\u03C0 (Pi)', value: '\u03C0 \u2248 3.14159265358979' },
  { name: 'e (Euler)', value: 'e \u2248 2.71828182845905' },
  { name: '\u03C6 (Golden Ratio)', value: '\u03C6 \u2248 1.61803398874989' },
  { name: '\u221A2', value: '\u221A2 \u2248 1.41421356237310' },
  { name: 'ln(2)', value: 'ln(2) \u2248 0.69314718055995' },
  { name: '\u03B3 (Euler-Mascheroni)', value: '\u03B3 \u2248 0.57721566490153' },
  { name: '\u03B6(3) (Ap\u00E9ry)', value: '\u03B6(3) \u2248 1.20205690315959' },
  { name: '\u221A3', value: '\u221A3 \u2248 1.73205080756888' },
];

export function FormulaNotebookPanel() {
  const {
    items: expressionItems,
    isLoading: expLoading,
    isError: expError,
    error: expErr,
    refetch: refetchExp,
    create: createExpression,
    remove: removeExpression,
  } = useLensData<ExpressionRecord>('math', 'expression', { seed: [] });

  const {
    items: formulaItems,
    isLoading: formulaLoading,
    isError: formulaError,
    error: formulaErr,
    refetch: refetchFormula,
    create: createFormula,
    remove: removeFormula,
  } = useLensData<FormulaRecord>('math', 'formula', { seed: [] });

  const [expression, setExpression] = useState('');
  const [result, setResult] = useState<{ value: string; verified: boolean } | null>(null);
  const [evaluating, setEvaluating] = useState(false);

  const [newFormulaName, setNewFormulaName] = useState('');
  const [newFormulaLatex, setNewFormulaLatex] = useState('');
  const [newFormulaDesc, setNewFormulaDesc] = useState('');
  const [newFormulaCat, setNewFormulaCat] = useState('general');
  const [showAddFormula, setShowAddFormula] = useState(false);

  const handleEvaluate = async () => {
    if (!expression.trim()) return;
    setEvaluating(true);
    setResult(null);
    try {
      const r = await lensRun<{ answer?: unknown; kind?: string }>('math', 'naturalQuery', { query: expression });
      let evalValue: string;
      let verified: boolean;
      if (r.data.ok && r.data.result) {
        const answer = r.data.result.answer;
        evalValue = answer != null ? String(answer) : 'No result';
        verified = answer != null;
      } else {
        evalValue = `Error: ${r.data.error || 'Could not evaluate expression'}`;
        verified = false;
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

  if (expError || formulaError) {
    return (
      <ErrorState
        message={expErr?.message || formulaErr?.message || 'Notebook failed to load'}
        onRetry={() => { refetchExp(); refetchFormula(); }}
      />
    );
  }

  if (expLoading || formulaLoading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton variant="block" height={72} />
        <Skeleton variant="block" height={160} />
        <Skeleton variant="block" height={160} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className={ds.panel}>
        <h2 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}>
          <Calculator className="h-4 w-4" style={{ color: 'var(--lens-accent)' }} />
          Evaluate
        </h2>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !evaluating && handleEvaluate()}
            placeholder="sin(pi/4) + sqrt(2)  ·  integral of x^2 from 0 to 5"
            className={cn(ds.input, 'flex-1 font-mono')}
            disabled={evaluating}
            aria-label="Expression"
          />
          <button
            type="button"
            onClick={handleEvaluate}
            disabled={evaluating || !expression.trim()}
            className={ds.btnPrimary}
          >
            {evaluating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {evaluating ? 'Evaluating…' : 'Evaluate'}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              onClick={() => setExpression(ex.expr)}
              className={ds.btnGhost}
            >
              {ex.label}
            </button>
          ))}
        </div>
        {result && (
          <div
            role="status"
            className={cn(
              'p-3 rounded-lg flex items-center gap-3 font-mono text-lg',
              result.verified ? 'bg-emerald-500/15 text-emerald-200' : 'bg-red-500/15 text-red-200',
            )}
          >
            {result.verified ? <CheckCircle className="h-5 w-5 shrink-0" /> : <XCircle className="h-5 w-5 shrink-0" />}
            {result.value}
          </div>
        )}
      </section>

      {expressionItems.length === 0 ? (
        <EmptyState
          compact
          icon={<History className="h-8 w-8" />}
          title="No saved evaluations"
          description="Run an expression above. Results persist as math.expression artifacts."
        />
      ) : (
        <section className={ds.panel}>
          <h2 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}>
            <History className="h-4 w-4" style={{ color: 'var(--lens-secondary)' }} />
            Saved evaluations ({expressionItems.length})
          </h2>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {expressionItems.slice(0, 20).map((item) => (
              <div key={item.id} className="flex items-center justify-between p-2.5 rounded-lg bg-lattice-deep group">
                <div className="flex items-center gap-3 min-w-0">
                  {item.data.verified
                    ? <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
                    : <XCircle className="h-4 w-4 text-red-400 shrink-0" />}
                  <div className="min-w-0">
                    <p className="text-sm font-mono truncate">{item.data.expression || item.title}</p>
                    <p className={ds.caption}>
                      {item.data.evaluatedAt
                        ? new Date(item.data.evaluatedAt).toLocaleString()
                        : new Date(item.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm" style={{ color: 'var(--lens-accent)' }}>{item.data.result}</span>
                  <button
                    type="button"
                    onClick={() => removeExpression(item.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20"
                    aria-label="Delete evaluation"
                  >
                    <Trash2 className="h-3 w-3 text-red-400" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className={ds.panel}>
        <div className="flex items-center justify-between mb-3">
          <h2 className={cn(ds.heading3, 'flex items-center gap-2')}>
            <Sigma className="h-4 w-4" style={{ color: 'var(--lens-secondary)' }} />
            Formula reference
          </h2>
          <button type="button" onClick={() => setShowAddFormula((v) => !v)} className={ds.btnSecondary}>
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>

        {showAddFormula && (
          <div className="space-y-2 mb-4 p-3 rounded-lg bg-lattice-deep border border-lattice-border">
            <input type="text" value={newFormulaName} onChange={(e) => setNewFormulaName(e.target.value)} placeholder="Name (e.g. Pythagorean Theorem)" className={ds.input} />
            <input type="text" value={newFormulaLatex} onChange={(e) => setNewFormulaLatex(e.target.value)} placeholder="LaTeX (e.g. a^2 + b^2 = c^2)" className={cn(ds.input, 'font-mono')} />
            <input type="text" value={newFormulaDesc} onChange={(e) => setNewFormulaDesc(e.target.value)} placeholder="Description" className={ds.input} />
            <select value={newFormulaCat} onChange={(e) => setNewFormulaCat(e.target.value)} className={ds.select}>
              <option value="general">General</option>
              <option value="algebra">Algebra</option>
              <option value="calculus">Calculus</option>
              <option value="geometry">Geometry</option>
              <option value="statistics">Statistics</option>
              <option value="physics">Physics</option>
            </select>
            {newFormulaLatex && (
              <div className="p-3 bg-lattice-surface rounded-lg overflow-x-auto">
                <p className={cn(ds.caption, 'mb-1')}>Preview</p>
                <MathFormula latex={newFormulaLatex} displayMode={false} />
              </div>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={handleSaveFormula} disabled={!newFormulaName.trim() || !newFormulaLatex.trim()} className={ds.btnPrimary}>Save</button>
              <button type="button" onClick={() => setShowAddFormula(false)} className={ds.btnGhost}>Cancel</button>
            </div>
          </div>
        )}

        {formulaItems.length === 0 ? (
          <EmptyState
            compact
            icon={<Sigma className="h-8 w-8" />}
            title="No formulas saved"
            description="Add a formula with LaTeX. Rendering uses KaTeX, not a Unicode stand-in."
            action={{ label: 'Add formula', onClick: () => setShowAddFormula(true) }}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {formulaItems.map((item) => {
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
                        <span className="text-xs px-1.5 py-0.5 rounded border bg-violet-500/15 border-violet-500/30 text-violet-300">
                          {item.data.category}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${diff.bg} ${diff.color}`}>
                          {diff.label}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFormula(item.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded"
                      aria-label="Delete formula"
                    >
                      <Trash2 className="h-3 w-3 text-red-400" />
                    </button>
                  </div>
                  <div className="p-3 bg-lattice-deep rounded-lg mb-2 border border-white/5 text-center overflow-x-auto">
                    <MathFormula latex={item.data.latex} displayMode className="text-lg" />
                  </div>
                  {item.data.description && (
                    <p className={ds.textBody + ' text-xs'}>{item.data.description}</p>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </section>

      <section className={ds.panel}>
        <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2 text-base')}>
          <TrendingUp className="h-4 w-4" style={{ color: 'var(--lens-accent)' }} />
          Constants
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {CONSTANTS.map((c) => (
            <div key={c.name} className="p-2.5 bg-lattice-deep rounded-lg">
              <p className="text-sm font-semibold mb-0.5" style={{ color: 'var(--lens-accent)' }}>{c.name}</p>
              <p className="font-mono text-xs text-gray-300">{c.value}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
