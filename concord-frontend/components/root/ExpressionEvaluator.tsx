'use client';

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Calculator, AlertCircle, Save, Share2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface EvalStep {
  op: string;
  a: number;
  b: number;
  decimal: number;
  glyph: string;
}
interface EvalResult {
  expression: string;
  decimal: number | null;
  glyph: string;
  semantic: string;
  steps: EvalStep[];
  tokenCount: number;
}

/* Multi-term expression evaluator — talks to the root.evaluate macro so
   precedence + parentheses + glyph operands match the server algebra. */
export function ExpressionEvaluator({ onSaved }: { onSaved?: () => void }) {
  const [expr, setExpr] = useState('');
  const [result, setResult] = useState<EvalResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const evaluate = useCallback(async () => {
    if (!expr.trim()) { setError('Enter an expression'); return; }
    setBusy(true); setError(''); setNotice('');
    const r = await lensRun<EvalResult>('root', 'evaluate', { expression: expr.trim() });
    setBusy(false);
    if (r.data?.ok && r.data.result) { setResult(r.data.result); }
    else { setResult(null); setError(r.data?.error || 'Could not evaluate'); }
  }, [expr]);

  const save = useCallback(async () => {
    if (!result) return;
    setNotice('');
    const r = await lensRun('root', 'save', {
      kind: 'expression',
      expression: result.expression,
      resultGlyph: result.glyph,
      resultDecimal: result.decimal,
    });
    if (r.data?.ok) { setNotice('Saved to notebook'); onSaved?.(); }
    else setNotice(r.data?.error || 'Save failed');
  }, [result, onSaved]);

  const share = useCallback(async () => {
    if (!result) return;
    setNotice('');
    const r = await lensRun<{ link: string }>('root', 'share', {
      kind: 'expression',
      expression: result.expression,
      resultGlyph: result.glyph,
      resultDecimal: result.decimal,
    });
    if (r.data?.ok && r.data.result?.link) {
      const url = `${window.location.origin}${r.data.result.link}`;
      try { await navigator.clipboard.writeText(url); setNotice('Share link copied'); }
      catch { setNotice(`Share link: ${url}`); }
    } else setNotice(r.data?.error || 'Share failed');
  }, [result]);

  return (
    <section className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Calculator className="w-4 h-4 text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Expression Evaluator</h2>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Multi-term expressions with precedence and parentheses. Mix decimals and glyphs:
        e.g. <span className="text-violet-400">(2 + 3) * 4</span> or <span className="text-violet-400">⟲⟐ + 1</span>.
      </p>
      <div className="flex gap-2">
        <input
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 focus:outline-none focus:border-violet-500 text-sm"
          placeholder="(2 + 3) * 4 - ⊚"
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void evaluate(); }}
        />
        <button
          onClick={() => void evaluate()}
          disabled={busy}
          className="px-4 py-2 bg-violet-700/50 hover:bg-violet-700/70 border border-violet-700 rounded-lg text-violet-100 text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
          Evaluate
        </button>
      </div>
      {error && (
        <div className="mt-2 text-xs text-red-400 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />{error}
        </div>
      )}
      {result && (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-2xl text-violet-300">{result.glyph}</div>
            <div className="text-sm text-gray-400">
              <span className="text-gray-600">decimal: </span>
              {result.decimal !== null ? result.decimal : '∞'}
            </div>
            <div className="flex gap-2">
              <button onClick={() => void save()}
                className="text-[11px] px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-gray-300 inline-flex items-center gap-1">
                <Save className="w-3 h-3" /> Save
              </button>
              <button onClick={() => void share()}
                className="text-[11px] px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-gray-300 inline-flex items-center gap-1">
                <Share2 className="w-3 h-3" /> Share
              </button>
            </div>
          </div>
          <div className="text-xs text-violet-400 italic bg-violet-950/30 rounded-lg p-3 border border-violet-900/40">
            {result.semantic}
          </div>
          {result.steps.length > 0 && (
            <div className="border-t border-gray-800 pt-2">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">
                Evaluation steps ({result.steps.length})
              </div>
              <ol className="space-y-1 text-xs font-mono">
                {result.steps.map((s, i) => (
                  <li key={i} className="flex items-center gap-2 text-gray-400">
                    <span className="text-gray-600 w-5">{i + 1}.</span>
                    <span className="text-gray-300">{s.a} {s.op} {s.b}</span>
                    <span className="text-gray-600">=</span>
                    <span className="text-emerald-300">{isFinite(s.decimal) ? s.decimal : '∞'}</span>
                    <span className="text-violet-300">{s.glyph}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {notice && <div className="text-[11px] text-emerald-400">{notice}</div>}
        </motion.div>
      )}
    </section>
  );
}
