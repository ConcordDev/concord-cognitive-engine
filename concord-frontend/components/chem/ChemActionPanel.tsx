'use client';

/**
 * ChemActionPanel — chemist's lab bench.
 * molecular-weight / calc-molarity / calc-ph / calc-dilution +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { FlaskConical, Beaker, Droplets, Scale, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('chem', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'mw' | 'molarity' | 'ph' | 'dilution' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface MWComponent { element: string; name?: string; count: number; atomicMass: number; contribution: number; percentMass: number }
interface MWResult { formula: string; molecularWeight: number; units: string; components: MWComponent[] }
interface MolarityResult { moles?: number; liters?: number; molarity?: number; formula?: string }
interface PhResult { pH: number; pOH: number; hPlus: number; ohMinus: number; classification: string }
interface DilutionResult { m1: number; v1: number; m2: number; v2: number; formula?: string }

export function ChemActionPanel() {
  const [formula, setFormula] = useState('');
  const [molMoles, setMolMoles] = useState('');
  const [molLiters, setMolLiters] = useState('');
  const [molMolarity, setMolMolarity] = useState('');
  const [phConcentration, setPhConcentration] = useState('');
  const [phKind, setPhKind] = useState<'acid' | 'base' | 'h_plus' | 'oh_minus'>('acid');
  const [dilM1, setDilM1] = useState('');
  const [dilV1, setDilV1] = useState('');
  const [dilM2, setDilM2] = useState('');
  const [dilV2, setDilV2] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [mwResult, setMwResult] = useState<MWResult | null>(null);
  const [molarityResult, setMolarityResult] = useState<MolarityResult | null>(null);
  const [phResult, setPhResult] = useState<PhResult | null>(null);
  const [dilutionResult, setDilutionResult] = useState<DilutionResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (t: string) => setFeedback({ kind: 'ok', text: t });
  const err = (t: string) => setFeedback({ kind: 'err', text: t });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actMW() {
    if (!formula.trim()) { err('Formula required (e.g. C6H12O6).'); return; }
    setBusy('mw'); setFeedback(null);
    try {
      const r = await callMacro<MWResult>('molecular-weight', { formula: formula.trim() });
      if (r.ok && r.result) { setMwResult(r.result); pipe.publish('chem.mw', r.result, { label: `MW ${r.result.molecularWeight}` }); ok(`MW = ${r.result.molecularWeight} g/mol.`); } else err(r.error ?? 'mw failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMolarity() {
    const input: Record<string, number> = {};
    if (molMoles) input.moles = parseFloat(molMoles);
    if (molLiters) input.liters = parseFloat(molLiters);
    if (molMolarity) input.molarity = parseFloat(molMolarity);
    if (Object.keys(input).length < 2) { err('Provide at least 2 of: moles, liters, molarity.'); return; }
    setBusy('molarity'); setFeedback(null);
    try {
      const r = await callMacro<MolarityResult>('calc-molarity', input);
      if (r.ok && r.result) { setMolarityResult(r.result); pipe.publish('chem.molarity', r.result, { label: `M ${r.result.molarity}` }); ok(`M = ${r.result.molarity} mol/L.`); } else err(r.error ?? 'molarity failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPh() {
    const c = parseFloat(phConcentration);
    if (!Number.isFinite(c)) { err('Concentration required (mol/L).'); return; }
    setBusy('ph'); setFeedback(null);
    try {
      const r = await callMacro<PhResult>('calc-ph', { concentration: c, kind: phKind });
      if (r.ok && r.result) { setPhResult(r.result); pipe.publish('chem.ph', r.result, { label: `pH ${r.result.pH}` }); ok(`pH = ${r.result.pH} (${r.result.classification}).`); } else err(r.error ?? 'ph failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDilution() {
    const input: Record<string, number> = {};
    if (dilM1) input.m1 = parseFloat(dilM1);
    if (dilV1) input.v1 = parseFloat(dilV1);
    if (dilM2) input.m2 = parseFloat(dilM2);
    if (dilV2) input.v2 = parseFloat(dilV2);
    if (Object.keys(input).length < 3) { err('Provide 3 of m1/v1/m2/v2 to solve for the 4th.'); return; }
    setBusy('dilution'); setFeedback(null);
    try {
      const r = await callMacro<DilutionResult>('calc-dilution', input);
      if (r.ok && r.result) { setDilutionResult(r.result); pipe.publish('chem.dilution', r.result, { label: `M₁V₁=M₂V₂` }); ok(`Resolved.`); } else err(r.error ?? 'dilution failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Chem — ${formula || 'lab'}`, tags: ['chem', 'lab', phResult?.classification].filter((t): t is string => !!t), source: 'chem:lab:mint', meta: { visibility: 'private', consent: { allowCitations: false }, chem: { formula, mw: mwResult, molarity: molarityResult, ph: phResult, dilution: dilutionResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('chem.mintedDtuId', id, { label: `Lab DTU ${id.slice(0, 8)}…` }); ok(`Lab DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🧪 Chem bench`, '',
      mwResult ? `${mwResult.formula}: ${mwResult.molecularWeight} g/mol` : '',
      molarityResult ? `M = ${molarityResult.molarity} mol/L` : '',
      phResult ? `pH = ${phResult.pH} (${phResult.classification})` : '',
      dilutionResult ? `Dilution: M1V1=M2V2 → ${dilutionResult.m1}×${dilutionResult.v1} = ${dilutionResult.m2}×${dilutionResult.v2}` : '',
      mintedDtuId ? `\n[DTU ${mintedDtuId}]` : '',
    ].filter(Boolean).join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { ok('Sent. 60s to recall.'); setRecipient(''); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!mwResult) { err('Run MW first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Compound profile — ${formula}`, tags: ['chem', 'compound', 'public'], source: 'chem:compound:publish', meta: { visibility: 'public', consent: { allowCitations: true }, formula, mw: mwResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('chem.publishedDtuId', id, { label: `Public compound ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Chem bench review. ${mwResult ? `${mwResult.formula} → ${mwResult.molecularWeight} g/mol (largest contributor: ${mwResult.components[0]?.element} ${mwResult.components[0]?.percentMass}%).` : ''} ${phResult ? `pH ${phResult.pH} — ${phResult.classification}.` : ''} ${molarityResult ? `Solution at ${molarityResult.molarity} M.` : ''} Identify the most likely lab use case and one safety note. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'mw' as ActionId, label: 'MW', desc: 'molecular-weight', icon: Scale, accent: '#10b981', handler: actMW },
    { id: 'molarity' as ActionId, label: 'Molarity', desc: 'calc-molarity M=mol/L', icon: Beaker, accent: '#3b82f6', handler: actMolarity },
    { id: 'ph' as ActionId, label: 'pH', desc: 'calc-ph from conc.', icon: FlaskConical, accent: '#f59e0b', handler: actPh },
    { id: 'dilution' as ActionId, label: 'Dilution', desc: 'M1V1=M2V2', icon: Droplets, accent: '#06b6d4', handler: actDilution },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private lab DTU', icon: Sparkles, accent: '#8b5cf6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send bench results', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public compound', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Brief', desc: 'Agent: use + safety', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-emerald-500/10 pb-2">
        <FlaskConical className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">Chem bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">periodic · molarity · pH · dilution</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold">Compound</div>
          <input type="text" value={formula} onChange={(e) => setFormula(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="C6H12O6" />
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Molarity (2 of 3)</div>
          <input type="text" value={molMoles} onChange={(e) => setMolMoles(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="moles" />
          <input type="text" value={molLiters} onChange={(e) => setMolLiters(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="liters" />
          <input type="text" value={molMolarity} onChange={(e) => setMolMolarity(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="molarity" />
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">pH</div>
          <input type="text" value={phConcentration} onChange={(e) => setPhConcentration(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="concentration mol/L" />
          <select value={phKind} onChange={(e) => setPhKind(e.target.value as typeof phKind)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white">
            <option value="acid">acid</option>
            <option value="base">base</option>
            <option value="h_plus">[H+]</option>
            <option value="oh_minus">[OH-]</option>
          </select>
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient" />
          <div className="flex items-center gap-2 flex-wrap">
            <RecallSlot ctl={dmRecall} />
            <RecallSlot ctl={publishRecall} />
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-cyan-400 font-semibold">Dilution (3 of 4)</div>
          <div className="grid grid-cols-2 gap-1">
            <input type="text" value={dilM1} onChange={(e) => setDilM1(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="M1" />
            <input type="text" value={dilV1} onChange={(e) => setDilV1(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="V1" />
            <input type="text" value={dilM2} onChange={(e) => setDilM2(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="M2" />
            <input type="text" value={dilV2} onChange={(e) => setDilV2(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="V2" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {actions.map(a => {
          const Icon = a.icon; const isBusy = busy === a.id;
          return (
            <button key={a.id} type="button" disabled={!!busy} onClick={a.handler}
              className={cn('flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all', 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700', 'disabled:opacity-40 disabled:cursor-not-allowed')}>
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: a.accent + '20', color: a.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[11px] font-semibold text-zinc-100 leading-tight">{a.label}</div>
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        {mwResult && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">{mwResult.formula}</div>
            <div className="text-2xl font-bold text-emerald-300">{mwResult.molecularWeight} <span className="text-xs text-zinc-400">g/mol</span></div>
            <div className="space-y-0.5 mt-1 max-h-24 overflow-y-auto">
              {mwResult.components.slice(0, 6).map((c, i) => <div key={i} className="text-[10px] text-zinc-400"><span className="font-mono text-emerald-200">{c.element}</span> ×{c.count} → {c.percentMass}%</div>)}
            </div>
          </div>
        )}
        {molarityResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Molarity</div>
            <div className="text-2xl font-bold text-blue-300">{molarityResult.molarity} <span className="text-xs text-zinc-400">M</span></div>
            <div className="text-[10px] text-zinc-400">{molarityResult.moles} mol / {molarityResult.liters} L</div>
            <div className="text-[10px] text-zinc-400 font-mono">{molarityResult.formula}</div>
          </div>
        )}
        {phResult && (
          <div className={cn('rounded-md border p-2.5', phResult.classification === 'acidic' ? 'border-red-500/30 bg-red-500/5' : phResult.classification === 'basic' ? 'border-purple-500/30 bg-purple-500/5' : 'border-zinc-500/30 bg-zinc-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">pH · {phResult.classification}</div>
            <div className="text-2xl font-bold" style={{ color: phResult.classification === 'acidic' ? '#f87171' : phResult.classification === 'basic' ? '#c084fc' : '#a1a1aa' }}>{phResult.pH}</div>
            <div className="text-[10px] text-zinc-400">pOH {phResult.pOH}</div>
            <div className="text-[10px] text-zinc-400">[H+]={phResult.hPlus.toExponential(2)}</div>
          </div>
        )}
        {dilutionResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Dilution</div>
            <div className="text-sm text-cyan-200 font-mono">M1={dilutionResult.m1}</div>
            <div className="text-sm text-cyan-200 font-mono">V1={dilutionResult.v1}</div>
            <div className="text-sm text-cyan-200 font-mono">M2={dilutionResult.m2}</div>
            <div className="text-sm text-cyan-200 font-mono">V2={dilutionResult.v2}</div>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Lab brief</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
