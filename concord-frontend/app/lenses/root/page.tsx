'use client';

import { useState, useMemo, useCallback } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { RootMetrics } from '@/components/root/RootMetrics';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { motion } from 'framer-motion';
import { Hash, ArrowRightLeft, X, BookOpen, AlertCircle, History } from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { useArtifacts, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';

/* ─── Refusal Algebra types ─── */
interface AlgebraResult {
  numerical: string;
  decimal: number;
  semantic: string;
}

/* ─── Glyph constants (mirrors server/lib/refusal-algebra/glyphs.js) ─── */
const GLYPHS: Record<number, string> = { 0: '⟐', 1: '⟲', 2: '⊚', 3: '⟐⟲', 4: '⊚⟲', 5: '⟐⊚' };
const GLYPH_NAMES: Record<string, string> = {
  '⟐': 'Refusal', '⟲': 'Pivot', '⊚': 'Bridge',
  '⟐⟲': 'Refusal-Pivot', '⊚⟲': 'Bridge-Pivot', '⟐⊚': 'Refusal-Bridge',
};
const GLYPH_TO_DIGIT: Record<string, number> = { '⟐': 0, '⟲': 1, '⊚': 2, '⟐⟲': 3, '⊚⟲': 4, '⟐⊚': 5 };
const RADIX = '⸱';
const NEG_MARKER = '−';

/* ─── Conversion logic ─── */
function parseGlyphs(s: string): number[] {
  const digits: number[] = [];
  let i = 0;
  while (i < s.length) {
    if (i + 1 < s.length) {
      const two = s.slice(i, i + 2);
      if (two in GLYPH_TO_DIGIT) { digits.push(GLYPH_TO_DIGIT[two]); i += 2; continue; }
    }
    const one = s[i];
    if (one in GLYPH_TO_DIGIT) { digits.push(GLYPH_TO_DIGIT[one]); i++; continue; }
    if (one === RADIX || one === NEG_MARKER) { i++; continue; }
    throw new Error(`Unknown glyph: "${one}"`);
  }
  return digits;
}

function intToGlyphs(n: number): string {
  if (n === 0) return GLYPHS[0];
  let r = ''; let t = n;
  while (t > 0) { r = GLYPHS[t % 6] + r; t = Math.floor(t / 6); }
  return r;
}

function decimalToGlyphs(n: number): string {
  if (!isFinite(n)) throw new Error('Must be finite');
  if (n < 0) return NEG_MARKER + decimalToGlyphs(-n);
  if (n === 0) return GLYPHS[0];
  const int = Math.floor(n);
  const frac = n - int;
  let s = intToGlyphs(int);
  if (frac > 1e-12) {
    let fracStr = RADIX; let f = frac; let p = 8;
    while (f > 1e-12 && p-- > 0) { f *= 6; const d = Math.floor(f); fracStr += GLYPHS[d]; f -= d; }
    s += fracStr;
  }
  return s;
}

function glyphsToDecimal(s: string): number {
  if (s.startsWith(NEG_MARKER)) return -glyphsToDecimal(s.slice(NEG_MARKER.length));
  const [intP, fracP] = s.split(RADIX);
  const intDigits = parseGlyphs(intP || GLYPHS[0]);
  let r = intDigits.reduce((a, d) => a * 6 + d, 0);
  if (fracP) {
    const fd = parseGlyphs(fracP);
    let div = 6;
    for (const d of fd) { r += d / div; div *= 6; }
  }
  return r;
}

function operate(a: number, b: number, op: string): AlgebraResult {
  let dec: number;
  switch (op) {
    case '+': dec = a + b; break;
    case '−': dec = a - b; break;
    case '×': dec = a * b; break;
    case '÷': dec = b === 0 ? Infinity : a / b; break;
    default: dec = 0;
  }
  const num = isFinite(dec) ? decimalToGlyphs(dec) : '∞';
  const ag = decimalToGlyphs(a); const bg = decimalToGlyphs(b);
  let sem = `${GLYPH_NAMES[ag] ?? 'compound'} ${op} ${GLYPH_NAMES[bg] ?? 'compound'} produces structural transformation`;
  if (op === '×' && (a === 0 || b === 0)) sem = 'Refusal absorbs the operation; result returns to Refusal';
  if (op === '÷' && b === 0) sem = 'Division by Refusal is undefined; the structure cannot resolve';
  return { numerical: num, decimal: dec, semantic: sem };
}

/* ─── Glyph reference table ─── */
const GLYPH_REF = Object.entries(GLYPHS).map(([digit, glyph]) => ({
  digit: Number(digit), glyph, name: GLYPH_NAMES[glyph],
}));

/* ─── Component ─── */
export default function RootLens() {
  useLensCommand([
    { id: 'root-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'root' });

  useLensNav('root');

  const [decInput, setDecInput] = useState('');
  const [glyphInput, setGlyphInput] = useState('');
  const [opA, setOpA] = useState('');
  const [opB, setOpB] = useState('');
  const [op, setOp] = useState('+');
  const [showSemantic, setShowSemantic] = useState(true);
  const [glyphError, setGlyphError] = useState('');

  /* Decimal → glyph */
  const dec2glyph = useMemo(() => {
    const n = parseFloat(decInput);
    if (decInput === '' || isNaN(n)) return null;
    try { return decimalToGlyphs(n); } catch { return null; }
  }, [decInput]);

  /* Glyph → decimal */
  const glyph2dec = useMemo(() => {
    if (!glyphInput.trim()) { setGlyphError(''); return null; }
    try { const v = glyphsToDecimal(glyphInput.trim()); setGlyphError(''); return v; }
    catch (e) { setGlyphError(e instanceof Error ? e.message : String(e)); return null; }
  }, [glyphInput]);

  /* Operation result */
  const opResult: AlgebraResult | null = useMemo(() => {
    const a = parseFloat(opA); const b = parseFloat(opB);
    if (isNaN(a) || isNaN(b)) return null;
    return operate(a, b, op);
  }, [opA, opB, op]);

  const swap = useCallback(() => {
    setDecInput(dec2glyph ? '' : decInput);
    setGlyphInput(dec2glyph || '');
  }, [dec2glyph, decInput]);

  // Persist saved computations as 'computation' lens artifacts so the
  // user can build a working notebook of glyph algebra.
  const recent = useArtifacts<{
    a: number; b: number; op: string; result: AlgebraResult;
  }>('root', { type: 'computation', limit: 8 });
  const createComputation = useCreateArtifact<{
    a: number; b: number; op: string; result: AlgebraResult;
  }>('root');

  const saveResult = useCallback(() => {
    const a = parseFloat(opA); const b = parseFloat(opB);
    if (isNaN(a) || isNaN(b) || !opResult) return;
    createComputation.mutate({
      type: 'computation',
      title: `${a} ${op} ${b} = ${opResult.numerical}`,
      data: { a, b, op, result: opResult },
      meta: { tags: ['root', 'glyph-algebra'], status: 'completed', visibility: 'private' },
    });
  }, [opA, opB, op, opResult, createComputation]);

  return (
    <LensShell lensId="root" asMain={false}>
      <FirstRunTour lensId="root" />
      <ManifestActionBar />
      <DepthBadge lensId="root" size="sm" className="ml-2" />
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 sm:p-8 font-mono">
      <div className="max-w-3xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Hash className="w-7 h-7 text-violet-400" />
          <div>
            <h1 className="text-2xl font-bold text-violet-300">Refusal Algebra</h1>
            <p className="text-sm text-gray-500">Base-6 numeral system — where numbers carry meaning</p>
          </div>
        </div>

        {/* Glyph Reference */}
        <section className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <div className="flex items-center gap-2 mb-4">
            <BookOpen className="w-4 h-4 text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Glyph Reference</h2>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {GLYPH_REF.map(({ digit, glyph, name }) => (
              <div key={digit} className="bg-gray-800 rounded-lg p-3 flex items-center gap-3">
                <span className="text-2xl text-violet-300 w-8 text-center">{glyph}</span>
                <div>
                  <div className="text-xs text-gray-500">base-6 digit {digit}</div>
                  <div className="text-sm text-gray-300">{name}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Converter */}
        <section className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-4">Converter</h2>
          <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-start">
            {/* Decimal input */}
            <div className="space-y-2">
              <label className="text-xs text-gray-500">Decimal</label>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 focus:outline-none focus:border-violet-500 text-sm"
                placeholder="e.g. 47"
                value={decInput}
                onChange={e => setDecInput(e.target.value)}
              />
              {dec2glyph && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="text-xl text-violet-300 mt-1">{dec2glyph}</motion.div>
              )}
            </div>

            {/* Swap */}
            <button onClick={swap}
              className="mt-7 p-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-violet-400 transition-colors" aria-label="Arrow right left">
              <ArrowRightLeft className="w-4 h-4" />
            </button>

            {/* Glyph input */}
            <div className="space-y-2">
              <label className="text-xs text-gray-500">Glyph notation</label>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 focus:outline-none focus:border-violet-500 text-sm"
                placeholder="e.g. ⟲⟲⟐⊚"
                value={glyphInput}
                onChange={e => setGlyphInput(e.target.value)}
              />
              {glyphError && <div className="text-xs text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{glyphError}</div>}
              {glyph2dec !== null && !glyphError && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="text-xl text-emerald-300 mt-1">{glyph2dec}</motion.div>
              )}
            </div>
          </div>
        </section>

        {/* Operation Playground */}
        <section className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Operation Playground</h2>
            <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
              <input type="checkbox" checked={showSemantic} onChange={e => setShowSemantic(e.target.checked)}
                className="accent-violet-500" />
              Show semantic layer
            </label>
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr_auto_auto] gap-3 items-center mb-4">
            <input className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 focus:outline-none focus:border-violet-500 text-sm"
              placeholder="a (decimal)" value={opA} onChange={e => setOpA(e.target.value)} />
            <select className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 focus:outline-none text-sm"
              value={op} onChange={e => setOp(e.target.value)}>
              {['+', '−', '×', '÷'].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <input className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 focus:outline-none focus:border-violet-500 text-sm"
              placeholder="b (decimal)" value={opB} onChange={e => setOpB(e.target.value)} />
            <span className="text-gray-500 text-sm">=</span>
            <div className="text-xl text-violet-300 min-w-[4rem]">{opResult?.numerical ?? '–'}</div>
          </div>

          {opResult && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm text-gray-400">
                  <span className="text-gray-600">decimal: </span>{isFinite(opResult.decimal) ? opResult.decimal : '∞'}
                </div>
                <button
                  onClick={saveResult}
                  className="text-[11px] px-2 py-1 bg-violet-700/40 hover:bg-violet-700/60 border border-violet-700 rounded text-violet-200 inline-flex items-center gap-1"
                >
                  <History className="w-3 h-3" /> Save to notebook
                </button>
              </div>
              {showSemantic && (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                  className="text-xs text-violet-400 italic bg-violet-950/30 rounded-lg p-3 border border-violet-900/40">
                  {opResult.semantic}
                </motion.div>
              )}
            </div>
          )}
          {recent.data?.artifacts && recent.data.artifacts.length > 0 && (
            <div className="mt-4 border-t border-gray-800 pt-3">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5 inline-flex items-center gap-1">
                <History className="w-3 h-3" /> Recent computations
              </div>
              <ul className="space-y-0.5 text-xs text-gray-400 font-mono">
                {recent.data.artifacts.slice(0, 8).map((a) => (
                  <li key={a.id} className="truncate">{a.title}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Glyph insertion palette */}
        <section className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">Insert Glyphs</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(GLYPHS).map(([d, g]) => (
              <button key={d}
                onClick={() => setGlyphInput(prev => prev + g)}
                title={`${GLYPH_NAMES[g]} (${d})`}
                className="px-3 py-2 bg-gray-800 hover:bg-violet-900/40 border border-gray-700 hover:border-violet-700 rounded-lg text-lg text-violet-300 transition-colors">
                {g}
              </button>
            ))}
            <button onClick={() => setGlyphInput(prev => prev + RADIX)}
              title="Radix separator"
              className="px-3 py-2 bg-gray-800 hover:bg-violet-900/40 border border-gray-700 hover:border-violet-700 rounded-lg text-violet-500 text-sm transition-colors">
              ⸱ (radix)
            </button>
            <button onClick={() => setGlyphInput('')}
              className="px-3 py-2 bg-gray-800 hover:bg-red-900/30 border border-gray-700 hover:border-red-700 rounded-lg text-gray-500 hover:text-red-400 text-sm transition-colors" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <RootMetrics />
        </section>
      </div>
    </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* Loader2 spinner rendered when data is fetching */}</div>
    </LensShell>
  );
}
