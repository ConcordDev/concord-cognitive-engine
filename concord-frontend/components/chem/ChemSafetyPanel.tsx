'use client';

/**
 * ChemSafetyPanel — compound safety data sheet + interaction checker +
 * element reference. Surfaces three real chem.* macros that had zero
 * bespoke UI (generate-safety / check-interactions / explore-element) —
 * every other chem macro already has a home in ChemActionPanel,
 * ChemWorkbench, ChemStructureLab, or PeriodicTable.
 *
 * generate-safety returns a real GHS hazard-class + pictogram + first-aid
 * profile from a keyword-matched hazard table (server/domains/chem.js).
 * check-interactions cross-references a compound list against a pairwise
 * incompatibility table (acid+base, oxidizer+organic, etc). explore-element
 * looks up a small bundled element library (full 118 is PeriodicTable's job).
 */

import { useState } from 'react';
import { ShieldAlert, FlaskConical, Atom, Plus, X, Loader2, AlertTriangle, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string; message?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('chem', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T; error?: string; message?: string } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface SafetyResult {
  compound: string;
  formula: string | null;
  hazardClasses: string[];
  ghsPictograms: string[];
  handling: string;
  storage: string;
  firstAid: { skin: string; eye: string; inhalation: string; ingestion: string };
  disposal: string;
  summary: string;
  sources: { name: string; url: string }[];
}
interface InteractionResult {
  compounds: string[];
  interactions: { between: [string, string]; severity: string; issue: string }[];
  severity: 'ok' | 'medium' | 'high';
  summary: string;
}
interface ElementProfile {
  requested?: string;
  message?: string;
  link?: string;
  name?: string; symbol?: string; z?: number; group?: number; period?: number;
  category?: string; atomicMass?: number; uses?: string[]; history?: string; summary?: string;
}

type Tool = 'safety' | 'interactions' | 'element';

export function ChemSafetyPanel() {
  const [tool, setTool] = useState<Tool>('safety');

  // Safety
  const [safetyName, setSafetyName] = useState('');
  const [safetyBusy, setSafetyBusy] = useState(false);
  const [safetyResult, setSafetyResult] = useState<SafetyResult | null>(null);
  const [safetyErr, setSafetyErr] = useState<string | null>(null);

  async function runSafety() {
    if (!safetyName.trim()) { setSafetyErr('Compound name required (e.g. sulfuric acid).'); return; }
    setSafetyBusy(true); setSafetyErr(null);
    try {
      const r = await callMacro<SafetyResult>('generate-safety', { name: safetyName.trim() });
      if (r.ok && r.result) setSafetyResult(r.result); else setSafetyErr(r.error ?? r.message ?? 'lookup failed');
    } catch (e) { setSafetyErr(pickMessage(e)); } finally { setSafetyBusy(false); }
  }

  // Interactions
  const [compoundList, setCompoundList] = useState<string[]>(['', '']);
  const [interBusy, setInterBusy] = useState(false);
  const [interResult, setInterResult] = useState<InteractionResult | null>(null);
  const [interErr, setInterErr] = useState<string | null>(null);

  function setCompoundAt(i: number, v: string) { setCompoundList(l => l.map((c, idx) => idx === i ? v : c)); }
  function addCompoundSlot() { setCompoundList(l => (l.length < 8 ? [...l, ''] : l)); }
  function removeCompoundSlot(i: number) { setCompoundList(l => l.length > 2 ? l.filter((_, idx) => idx !== i) : l); }

  async function runInteractions() {
    const names = compoundList.map(c => c.trim()).filter(Boolean);
    if (names.length < 2) { setInterErr('Provide at least two compounds.'); return; }
    setInterBusy(true); setInterErr(null);
    try {
      const r = await callMacro<InteractionResult>('check-interactions', { compounds: names });
      if (r.ok && r.result) setInterResult(r.result); else setInterErr(r.error ?? r.message ?? 'check failed');
    } catch (e) { setInterErr(pickMessage(e)); } finally { setInterBusy(false); }
  }

  // Element lookup
  const [elSymbol, setElSymbol] = useState('');
  const [elBusy, setElBusy] = useState(false);
  const [elResult, setElResult] = useState<ElementProfile | null>(null);
  const [elErr, setElErr] = useState<string | null>(null);

  async function runElement() {
    if (!elSymbol.trim()) { setElErr('Symbol or name required (e.g. Fe, iron).'); return; }
    setElBusy(true); setElErr(null);
    try {
      const r = await callMacro<ElementProfile>('explore-element', { symbol: elSymbol.trim() });
      if (r.ok && r.result) setElResult(r.result); else setElErr(r.error ?? r.message ?? 'lookup failed');
    } catch (e) { setElErr(pickMessage(e)); } finally { setElBusy(false); }
  }

  const tools: { id: Tool; label: string; icon: typeof ShieldAlert; accent: string }[] = [
    { id: 'safety', label: 'Safety Sheet', icon: ShieldAlert, accent: '#f59e0b' },
    { id: 'interactions', label: 'Interaction Check', icon: FlaskConical, accent: '#ef4444' },
    { id: 'element', label: 'Element Lookup', icon: Atom, accent: '#06b6d4' },
  ];

  return (
    <div className="rounded-lg border border-amber-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-amber-500/10 pb-2">
        <ShieldAlert className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Safety &amp; reference</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">GHS · incompatibilities · elements</span>
      </header>

      <div className="flex gap-1">
        {tools.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} type="button" onClick={() => setTool(t.id)}
              className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors',
                tool === t.id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" style={{ color: tool === t.id ? t.accent : undefined }} /> {t.label}
            </button>
          );
        })}
      </div>

      {tool === 'safety' && (
        <div className="space-y-2.5">
          <div className="flex gap-2">
            <input type="text" value={safetyName} onChange={(e) => setSafetyName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSafety()}
              placeholder="Compound name (e.g. sulfuric acid, methanol, cyanide)"
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-xs text-white" />
            <button type="button" onClick={runSafety} disabled={safetyBusy}
              className="px-3 py-1.5 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 text-xs font-medium disabled:opacity-40 flex items-center gap-1.5">
              {safetyBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldAlert className="w-3.5 h-3.5" />} Look up
            </button>
          </div>
          {safetyErr && <p className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {safetyErr}</p>}
          <AnimatePresence>
            {safetyResult && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-md border border-amber-500/25 bg-amber-500/5 p-3 space-y-2 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-white">{safetyResult.compound}</span>
                  {safetyResult.hazardClasses.map(h => (
                    <span key={h} className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 text-[10px] uppercase">{h}</span>
                  ))}
                  {safetyResult.ghsPictograms.map(p => (
                    <span key={p} className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[10px] font-mono">{p}</span>
                  ))}
                </div>
                <p className="text-zinc-300"><span className="text-zinc-500">Handling: </span>{safetyResult.handling}</p>
                <p className="text-zinc-300"><span className="text-zinc-500">Storage: </span>{safetyResult.storage}</p>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <p className="text-zinc-400"><span className="text-zinc-500">Skin: </span>{safetyResult.firstAid.skin}</p>
                  <p className="text-zinc-400"><span className="text-zinc-500">Eye: </span>{safetyResult.firstAid.eye}</p>
                  <p className="text-zinc-400"><span className="text-zinc-500">Inhalation: </span>{safetyResult.firstAid.inhalation}</p>
                  <p className="text-zinc-400"><span className="text-zinc-500">Ingestion: </span>{safetyResult.firstAid.ingestion}</p>
                </div>
                <div className="flex items-center gap-3 pt-1 border-t border-amber-500/10">
                  {safetyResult.sources.map(s => (
                    <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 text-[10px]">
                      {s.name} <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {tool === 'interactions' && (
        <div className="space-y-2.5">
          <div className="space-y-1.5">
            {compoundList.map((c, i) => (
              <div key={i} className="flex gap-2">
                <input type="text" value={c} onChange={(e) => setCompoundAt(i, e.target.value)}
                  placeholder={`Compound ${i + 1} (e.g. ${i === 0 ? 'bleach' : 'ammonia'})`}
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-xs text-white" />
                {compoundList.length > 2 && (
                  <button type="button" onClick={() => removeCompoundSlot(i)} className="text-zinc-500 hover:text-red-400" aria-label="Remove compound">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={addCompoundSlot} disabled={compoundList.length >= 8}
              className="px-2.5 py-1.5 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 text-xs flex items-center gap-1 disabled:opacity-40">
              <Plus className="w-3.5 h-3.5" /> Add compound
            </button>
            <button type="button" onClick={runInteractions} disabled={interBusy}
              className="px-3 py-1.5 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30 text-xs font-medium disabled:opacity-40 flex items-center gap-1.5">
              {interBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />} Check interactions
            </button>
          </div>
          {interErr && <p className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {interErr}</p>}
          <AnimatePresence>
            {interResult && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                className={cn('rounded-md border p-3 space-y-2 text-xs',
                  interResult.severity === 'high' ? 'border-red-500/30 bg-red-500/5' : interResult.severity === 'medium' ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5')}>
                <p className="text-zinc-200">{interResult.summary}</p>
                {interResult.interactions.map((it, i) => (
                  <div key={i} className="flex items-start gap-2 py-1 border-t border-white/5">
                    <span className={cn('px-1.5 py-0.5 rounded text-[10px] uppercase shrink-0', it.severity === 'high' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300')}>{it.severity}</span>
                    <div>
                      <p className="text-zinc-300 font-medium">{it.between[0]} + {it.between[1]}</p>
                      <p className="text-zinc-400">{it.issue}</p>
                    </div>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {tool === 'element' && (
        <div className="space-y-2.5">
          <div className="flex gap-2">
            <input type="text" value={elSymbol} onChange={(e) => setElSymbol(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runElement()}
              placeholder="Symbol or name (e.g. Fe, gold, uranium)"
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-xs text-white font-mono" />
            <button type="button" onClick={runElement} disabled={elBusy}
              className="px-3 py-1.5 rounded bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 text-xs font-medium disabled:opacity-40 flex items-center gap-1.5">
              {elBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Atom className="w-3.5 h-3.5" />} Look up
            </button>
          </div>
          {elErr && <p className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {elErr}</p>}
          <AnimatePresence>
            {elResult && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-md border border-cyan-500/25 bg-cyan-500/5 p-3 text-xs">
                {elResult.name ? (
                  <div className="space-y-1.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-lg font-bold text-white">{elResult.symbol}</span>
                      <span className="text-cyan-300">{elResult.name}</span>
                      <span className="text-zinc-500">Z={elResult.z} · {elResult.category}</span>
                    </div>
                    <p className="text-zinc-300">{elResult.summary}</p>
                    <p className="text-zinc-400">Uses: {elResult.uses?.join(', ')}</p>
                    <p className="text-zinc-500">{elResult.history}</p>
                  </div>
                ) : (
                  <div className="text-zinc-400">
                    <p>{elResult.message}</p>
                    {elResult.link && <a href={elResult.link} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 mt-1 text-[10px]">Full periodic table <ExternalLink className="w-2.5 h-2.5" /></a>}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

export default ChemSafetyPanel;
