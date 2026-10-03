'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { RootMetrics } from '@/components/root/RootMetrics';
import { ExpressionEvaluator } from '@/components/root/ExpressionEvaluator';
import { BitwisePanel } from '@/components/root/BitwisePanel';
import { GlyphKeyboard } from '@/components/root/GlyphKeyboard';
import { AlgebraTutorial } from '@/components/root/AlgebraTutorial';
import { ComputationNotebook } from '@/components/root/ComputationNotebook';
import type { NotebookHandle, ReloadPayload } from '@/components/root/ComputationNotebook';
import { SharedComputationBanner } from '@/components/root/SharedComputationBanner';
import { ArrowRightLeft, X, BookOpen, AlertCircle, History, Share2, Calculator, Library, GraduationCap, Activity, Save } from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { lensRun } from '@/lib/api/client';

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

type RootView = 'convert' | 'compute' | 'notebook' | 'learn' | 'metrics';

const VIEWS: { id: RootView; label: string; keys: string; title: string; hint: string; icon: typeof Calculator }[] = [
  { id: 'convert', label: 'Convert', keys: '1', title: 'Say a number in glyphs', hint: 'Decimal and glyph converter with glyph keyboard', icon: ArrowRightLeft },
  { id: 'compute', label: 'Compute', keys: '2', title: 'Do arithmetic where numbers mean something', hint: 'Operation playground, expression evaluator, bitwise and modular ops', icon: Calculator },
  { id: 'notebook', label: 'Notebook', keys: '3', title: 'What you have worked out', hint: 'Saved computations with reload and share', icon: Library },
  { id: 'learn', label: 'Learn', keys: '4', title: 'Learn the base-6 glyphs', hint: 'Glyph reference and worked-example tutorial', icon: GraduationCap },
  { id: 'metrics', label: 'Metrics', keys: '5', title: 'How the algebra is being used', hint: 'Live refusal-algebra metrics', icon: Activity },
];

const CARD = 'rounded-2xl border border-white/10 bg-[#111] p-4';

/* ─── Component ─── */
export default function RootLens() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<RootView>('convert');
  useLensCommand(VIEWS.map((v) => ({
    id: `root-${v.id}`,
    keys: v.keys,
    description: `${v.label} — ${v.hint}`,
    category: 'navigation' as const,
    action: () => setView(v.id),
  })), { lensId: 'root' });

  useLensNav('root');

  const [decInput, setDecInput] = useState('');
  const [glyphInput, setGlyphInput] = useState('');
  const [opA, setOpA] = useState('');
  const [opB, setOpB] = useState('');
  const [op, setOp] = useState('+');
  const [showSemantic, setShowSemantic] = useState(true);

  /* Decimal → glyph */
  const dec2glyph = useMemo(() => {
    const n = parseFloat(decInput);
    if (decInput === '' || isNaN(n)) return null;
    try { return decimalToGlyphs(n); } catch { return null; }
  }, [decInput]);

  /* Glyph → decimal */
  const glyph2dec = useMemo(() => {
    if (!glyphInput.trim()) return null;
    try { return glyphsToDecimal(glyphInput.trim()); }
    catch { return null; }
  }, [glyphInput]);

  const glyphError = useMemo(() => {
    if (!glyphInput.trim()) return '';
    try { glyphsToDecimal(glyphInput.trim()); return ''; }
    catch (e) { return e instanceof Error ? e.message : String(e); }
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

  // Notebook handle — lets a save / reload refresh the persisted list.
  const notebookRef = useRef<NotebookHandle>(null);
  const [opNotice, setOpNotice] = useState('');

  // Persist the current playground operation via the root.save macro so the
  // notebook survives across sessions and devices (not just client artifacts).
  const saveResult = useCallback(async () => {
    const a = parseFloat(opA); const b = parseFloat(opB);
    if (isNaN(a) || isNaN(b) || !opResult) return;
    setOpNotice('');
    const r = await lensRun('root', 'save', {
      kind: 'operation', a, b, op,
      resultGlyph: opResult.numerical,
      resultDecimal: isFinite(opResult.decimal) ? opResult.decimal : null,
    });
    if (r.data?.ok) { setOpNotice('Saved to notebook'); notebookRef.current?.refresh(); }
    else setOpNotice(r.data?.error || 'Save failed');
  }, [opA, opB, op, opResult]);

  // Share the current playground operation as a stable read-only link.
  const shareResult = useCallback(async () => {
    const a = parseFloat(opA); const b = parseFloat(opB);
    if (isNaN(a) || isNaN(b) || !opResult) return;
    setOpNotice('');
    const r = await lensRun<{ link: string }>('root', 'share', {
      kind: 'operation', a, b, op,
      resultGlyph: opResult.numerical,
      resultDecimal: isFinite(opResult.decimal) ? opResult.decimal : null,
    });
    if (r.data?.ok && r.data.result?.link) {
      const url = `${window.location.origin}${r.data.result.link}`;
      try { await navigator.clipboard.writeText(url); setOpNotice('Share link copied'); }
      catch { setOpNotice(`Share link: ${url}`); }
    } else setOpNotice(r.data?.error || 'Share failed');
  }, [opA, opB, op, opResult]);

  // Re-hydrate the playground from a saved or shared computation.
  const applyReload = useCallback((payload: ReloadPayload) => {
    if (payload.kind === 'expression') {
      setGlyphInput(payload.expression || '');
      return;
    }
    if (payload.a != null) setOpA(payload.a);
    if (payload.b != null) setOpB(payload.b);
    if (payload.op && ['+', '−', '×', '÷'].includes(payload.op)) setOp(payload.op);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const canSave = !isNaN(parseFloat(opA)) && !isNaN(parseFloat(opB)) && !!opResult;
  const current = VIEWS.find((v) => v.id === view)!;

  const glyphReference = (
    <section className={CARD}>
      <div className="mb-4 flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-zinc-400" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">Glyph Reference</h2>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {GLYPH_REF.map(({ digit, glyph, name }) => (
          <div key={digit} className="flex items-center gap-3 rounded-xl bg-white/[0.04] p-3">
            <span className="w-8 text-center text-2xl text-teal-300">{glyph}</span>
            <div>
              <div className="text-xs text-zinc-400">base-6 digit {digit}</div>
              <div className="text-sm text-zinc-200">{name}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <LensShell lensId="root" asMain={false}>
      <FirstRunTour lensId="root" />
      <DepthBadge lensId="root" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="root"
        crumb="Root"
        title={`${current.title}${view === 'convert' && who ? `, ${who}` : ''}`}
        subtitle="Refusal Algebra: a base-6 numeral system where numbers carry meaning."
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys, hint: v.hint }))}
        activeTab={view}
        onTab={(id) => setView(id as RootView)}
        tabsLabel="Root views"
        cta={{
          label: 'Save to notebook',
          icon: Save,
          onClick: () => { setView('compute'); void saveResult(); },
          disabled: !canSave,
          title: canSave ? 'Save the current operation to your notebook' : 'Enter a and b in the playground first',
        }}
      >
        <div className="space-y-5">
          <SharedComputationBanner onOpen={applyReload} />

          {view === 'convert' && (
            <>
              <div className="grid gap-5 xl:grid-cols-[3fr_2fr]">
                <section className={CARD}>
                  <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-zinc-300">Converter</h2>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-4">
                    <div className="space-y-2">
                      <label className="text-xs text-zinc-400">Decimal</label>
                      <input
                        className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 focus:border-teal-400/60 focus:outline-none"
                        placeholder="e.g. 47"
                        value={decInput}
                        onChange={e => setDecInput(e.target.value)}
                      />
                      {dec2glyph && <div className="mt-1 text-xl text-teal-300">{dec2glyph}</div>}
                    </div>
                    <button onClick={swap}
                      className="mt-7 rounded-lg border border-white/10 bg-white/[0.04] p-2 text-zinc-400 transition-colors hover:text-teal-300" aria-label="Arrow right left">
                      <ArrowRightLeft className="h-4 w-4" />
                    </button>
                    <div className="space-y-2">
                      <label className="text-xs text-zinc-400">Glyph notation</label>
                      <input
                        className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 focus:border-teal-400/60 focus:outline-none"
                        placeholder="e.g. ⟲⟲⟐⊚"
                        value={glyphInput}
                        onChange={e => setGlyphInput(e.target.value)}
                      />
                      {glyphError && <div className="flex items-center gap-1 text-xs text-red-400"><AlertCircle className="h-3 w-3" />{glyphError}</div>}
                      {glyph2dec !== null && !glyphError && <div className="mt-1 text-xl text-emerald-300">{glyph2dec}</div>}
                    </div>
                  </div>
                  <div className="mt-5 border-t border-white/10 pt-4">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Insert Glyphs</h3>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(GLYPHS).map(([d, g]) => (
                        <button key={d}
                          onClick={() => setGlyphInput(prev => prev + g)}
                          title={`${GLYPH_NAMES[g]} (${d})`}
                          className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-lg text-teal-300 transition-colors hover:border-teal-400/40">
                          {g}
                        </button>
                      ))}
                      <button onClick={() => setGlyphInput(prev => prev + RADIX)}
                        title="Radix separator"
                        className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-400 transition-colors hover:border-teal-400/40">
                        ⸱ (radix)
                      </button>
                      <button onClick={() => setGlyphInput('')}
                        className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-400 transition-colors hover:border-red-500/50 hover:text-red-400" aria-label="Close">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </section>
                {glyphReference}
              </div>
              <GlyphKeyboard onInsert={setGlyphInput} />
            </>
          )}

          {view === 'compute' && (
            <>
              <section className={CARD}>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">Operation Playground</h2>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
                    <input type="checkbox" checked={showSemantic} onChange={e => setShowSemantic(e.target.checked)} className="accent-teal-400" />
                    Show semantic layer
                  </label>
                </div>
                <div className="mb-4 grid grid-cols-[1fr_auto_1fr_auto_auto] items-center gap-3">
                  <input className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 focus:border-teal-400/60 focus:outline-none"
                    placeholder="a (decimal)" value={opA} onChange={e => setOpA(e.target.value)} />
                  <select className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 focus:outline-none"
                    value={op} onChange={e => setOp(e.target.value)}>
                    {['+', '−', '×', '÷'].map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <input className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 focus:border-teal-400/60 focus:outline-none"
                    placeholder="b (decimal)" value={opB} onChange={e => setOpB(e.target.value)} />
                  <span className="text-sm text-zinc-400">=</span>
                  <div className="min-w-[4rem] text-xl text-teal-300">{opResult?.numerical ?? '–'}</div>
                </div>
                {opResult && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm text-zinc-400">
                        <span className="text-zinc-600">decimal: </span>{isFinite(opResult.decimal) ? opResult.decimal : '∞'}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => void saveResult()}
                          className="inline-flex items-center gap-1 rounded-lg border border-teal-400/30 bg-teal-400/10 px-2.5 py-1 text-[11px] text-teal-200 hover:bg-teal-400/20">
                          <History className="h-3 w-3" /> Save to notebook
                        </button>
                        <button onClick={() => void shareResult()}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-white/10">
                          <Share2 className="h-3 w-3" /> Share
                        </button>
                      </div>
                    </div>
                    {showSemantic && (
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs italic text-zinc-300">{opResult.semantic}</div>
                    )}
                    {opNotice && <div className="text-[11px] text-emerald-400">{opNotice}</div>}
                  </div>
                )}
              </section>
              <ExpressionEvaluator onSaved={() => notebookRef.current?.refresh()} />
              <BitwisePanel />
            </>
          )}

          <div className={view === 'notebook' ? '' : 'hidden'}>
            <ComputationNotebook ref={notebookRef} onReload={(p) => { applyReload(p); setView(p.kind === 'expression' ? 'convert' : 'compute'); }} />
          </div>

          {view === 'learn' && (
            <>
              {glyphReference}
              <AlgebraTutorial />
            </>
          )}

          {view === 'metrics' && (
            <section className={CARD}>
              <RootMetrics />
            </section>
          )}
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
