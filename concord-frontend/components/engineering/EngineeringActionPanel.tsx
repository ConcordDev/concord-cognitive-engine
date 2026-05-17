'use client';

/**
 * EngineeringActionPanel — design engineer bench.
 * toleranceAnalysis (worst-case + RSS) / stressAnalysis (yield + SF) /
 * bom / unitConvert + mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Cog, Ruler, Activity, Package, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('engineering', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'tol' | 'stress' | 'bom' | 'unit' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface TolPart { part: string; nominal: number; tolerance: number; min: number; max: number; toleranceClass: string }
interface StackUp { nominal: number; worstCaseTolerance: number; rssTolerance: number; worstCaseMin: number; worstCaseMax: number }
interface TolResult { parts: TolPart[]; stackUp: StackUp; method: string }
interface StressResult { appliedForce: string; crossSection: string; appliedStress: string; yieldStrength: string; safetyFactor: number; status: string; recommendation: string }
interface BomItem { partNumber: string; description: string; quantity: number; unitCost: number; extendedCost: number; leadTime: string; supplier: string }
interface BomResult { bom: BomItem[]; totalLineItems: number; totalParts: number; totalCost: number; criticalPath: string; uniqueSuppliers: number }
interface UnitResult { input: string; output: string; conversion: string }

const DEMO_PARTS = JSON.stringify({
  parts: [
    { name: 'Shaft', nominal: 25.0, tolerance: 0.01 },
    { name: 'Bearing bore', nominal: 25.1, tolerance: 0.005 },
    { name: 'Spacer', nominal: 12.5, tolerance: 0.02 },
    { name: 'Cap', nominal: 8.0, tolerance: 0.01 },
  ],
}, null, 2);

const DEMO_BOM = JSON.stringify({
  bomItems: [
    { partNumber: 'SCR-M5x16', description: 'M5×16 socket cap screw', quantity: 24, unitCost: 0.18, leadTime: 'stock', supplier: 'Fastenal' },
    { partNumber: 'BRG-6204', description: '6204-2RS bearing', quantity: 4, unitCost: 8.50, leadTime: '14', supplier: 'SKF' },
    { partNumber: 'SHFT-25-200', description: '25mm × 200mm shaft', quantity: 2, unitCost: 32.00, leadTime: '21', supplier: 'McMaster' },
    { partNumber: 'HSG-AL-001', description: 'Housing, AL 6061', quantity: 1, unitCost: 145.00, leadTime: '28', supplier: 'Local machine shop' },
  ],
}, null, 2);

const UNIT_PAIRS = [['mm', 'in'], ['in', 'mm'], ['m', 'ft'], ['ft', 'm'], ['kg', 'lb'], ['lb', 'kg'], ['n', 'lbf'], ['lbf', 'n'], ['mpa', 'psi'], ['psi', 'mpa'], ['c', 'f'], ['f', 'c'], ['nm', 'ftlb'], ['ftlb', 'nm'], ['l', 'gal'], ['gal', 'l']];

export function EngineeringActionPanel() {
  const [partsText, setPartsText] = useState(DEMO_PARTS);
  const [forceN, setForceN] = useState('5000');
  const [areaMm2, setAreaMm2] = useState('120');
  const [yieldMpa, setYieldMpa] = useState('275');
  const [bomText, setBomText] = useState(DEMO_BOM);
  const [unitValue, setUnitValue] = useState('25');
  const [unitFrom, setUnitFrom] = useState('mm');
  const [unitTo, setUnitTo] = useState('in');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [tolResult, setTolResult] = useState<TolResult | null>(null);
  const [stressResult, setStressResult] = useState<StressResult | null>(null);
  const [bomResult, setBomResult] = useState<BomResult | null>(null);
  const [unitResult, setUnitResult] = useState<UnitResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  function parseJSON<T>(text: string): T | null { try { return JSON.parse(text) as T; } catch { return null; } }

  async function actTol() {
    const parsed = parseJSON<Record<string, unknown>>(partsText); if (!parsed) { err('Invalid parts JSON.'); return; }
    setBusy('tol'); setFeedback(null);
    try { const r = await callMacro<TolResult>('toleranceAnalysis', { artifact: { data: parsed } }); if (r.ok && r.result) { setTolResult(r.result); ok(`Stack ${r.result.stackUp.nominal} ±${r.result.stackUp.worstCaseTolerance}.`); } else err(r.error ?? 'tol failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actStress() {
    setBusy('stress'); setFeedback(null);
    try { const r = await callMacro<StressResult>('stressAnalysis', { artifact: { data: { forceNewtons: parseFloat(forceN), crossSectionMm2: parseFloat(areaMm2), yieldStrengthMPa: parseFloat(yieldMpa) } } }); if (r.ok && r.result) { setStressResult(r.result); ok(`SF ${r.result.safetyFactor} · ${r.result.status}.`); } else err(r.error ?? 'stress failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actBom() {
    const parsed = parseJSON<Record<string, unknown>>(bomText); if (!parsed) { err('Invalid BOM JSON.'); return; }
    setBusy('bom'); setFeedback(null);
    try { const r = await callMacro<BomResult>('bom', { artifact: { data: parsed } }); if (r.ok && r.result) { setBomResult(r.result); ok(`$${r.result.totalCost.toLocaleString()} · ${r.result.totalParts} parts.`); } else err(r.error ?? 'bom failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actUnit() {
    setBusy('unit'); setFeedback(null);
    try { const r = await callMacro<UnitResult>('unitConvert', { artifact: { data: { value: parseFloat(unitValue), from: unitFrom, to: unitTo } } }); if (r.ok && r.result) { setUnitResult(r.result); ok(`${r.result.output}.`); } else err(r.error ?? 'unit failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Engineering — ${stressResult?.status ?? 'design'}`, tags: ['engineering', 'design'], source: 'engineering:design:mint', meta: { visibility: 'private', consent: { allowCitations: false }, eng: { tol: tolResult, stress: stressResult, bom: bomResult, unit: unitResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Design DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`⚙ Engineering review`, '', tolResult ? `Tolerance stack: ${tolResult.stackUp.nominal} ±${tolResult.stackUp.worstCaseTolerance} (RSS ±${tolResult.stackUp.rssTolerance})` : '', stressResult ? `Stress: ${stressResult.appliedStress} / yield ${stressResult.yieldStrength} → SF ${stressResult.safetyFactor} · ${stressResult.status}` : '', bomResult ? `BOM: $${bomResult.totalCost.toLocaleString()} · ${bomResult.totalParts} parts · CP ${bomResult.criticalPath}` : '', unitResult ? `${unitResult.input} = ${unitResult.output}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!tolResult && !stressResult) { err('Run analysis first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Engineering analysis card`, tags: ['engineering', 'analysis', 'public'], source: 'engineering:analysis:publish', meta: { visibility: 'public', consent: { allowCitations: true }, tol: tolResult, stress: stressResult } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Mechanical engineering review. ${tolResult ? `Stack-up nominal ${tolResult.stackUp.nominal} ±${tolResult.stackUp.worstCaseTolerance} (RSS ±${tolResult.stackUp.rssTolerance}).` : ''} ${stressResult ? `Stress ${stressResult.appliedStress} vs yield ${stressResult.yieldStrength}, SF ${stressResult.safetyFactor} (${stressResult.status}).` : ''} ${bomResult ? `BOM: $${bomResult.totalCost.toLocaleString()}, critical lead: ${bomResult.criticalPath}.` : ''} Identify the single biggest design risk + one optimization opportunity. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Review ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'tol' as ActionId, label: 'Tolerance', desc: 'WC + RSS stack-up', icon: Ruler, accent: '#3b82f6', handler: actTol },
    { id: 'stress' as ActionId, label: 'Stress', desc: 'yield × SF', icon: Activity, accent: '#ef4444', handler: actStress },
    { id: 'bom' as ActionId, label: 'BOM', desc: 'cost + critical lead', icon: Package, accent: '#f59e0b', handler: actBom },
    { id: 'unit' as ActionId, label: 'Convert', desc: 'unitConvert', icon: Cog, accent: '#a855f7', handler: actUnit },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private design DTU', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send eng review', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public analysis', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Review', desc: 'Agent: risk + opt', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const STATUS_COLOR: Record<string, string> = { safe: 'text-emerald-300', acceptable: 'text-blue-300', marginal: 'text-amber-300' };

  return (
    <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-cyan-500/10 pb-2">
        <Cog className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">Engineering bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">tolerance · stress · BOM · units</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Parts JSON</label>
          <textarea value={partsText} onChange={(e) => setPartsText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">BOM JSON</label>
          <textarea value={bomText} onChange={(e) => setBomText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[10px] text-white font-mono mt-1" />
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">Stress</div>
          <input type="text" value={forceN} onChange={(e) => setForceN(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="Force N" />
          <input type="text" value={areaMm2} onChange={(e) => setAreaMm2(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="Area mm²" />
          <input type="text" value={yieldMpa} onChange={(e) => setYieldMpa(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="Yield MPa" />
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Units</div>
          <input type="text" value={unitValue} onChange={(e) => setUnitValue(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="Value" />
          <div className="grid grid-cols-2 gap-1">
            <select value={unitFrom} onChange={(e) => setUnitFrom(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white">{[...new Set(UNIT_PAIRS.map(p => p[0]))].map(u => <option key={u} value={u}>{u}</option>)}</select>
            <select value={unitTo} onChange={(e) => setUnitTo(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white">{[...new Set(UNIT_PAIRS.map(p => p[1]))].map(u => <option key={u} value={u}>{u}</option>)}</select>
          </div>
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {actions.map(act => {
          const Icon = act.icon; const isBusy = busy === act.id;
          return (
            <button key={act.id} type="button" disabled={!!busy} onClick={act.handler}
              className={cn('flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all', 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700', 'disabled:opacity-40 disabled:cursor-not-allowed')}>
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: act.accent + '20', color: act.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[11px] font-semibold text-zinc-100 leading-tight">{act.label}</div>
              <div className="text-[10px] text-zinc-500 leading-tight line-clamp-2">{act.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        {tolResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Tolerance stack-up</div>
            <div className="text-2xl font-bold text-blue-300">{tolResult.stackUp.nominal}<span className="text-xs text-zinc-400"> ±{tolResult.stackUp.worstCaseTolerance}</span></div>
            <div className="text-[10px] text-zinc-500">RSS ±{tolResult.stackUp.rssTolerance} · range {tolResult.stackUp.worstCaseMin}–{tolResult.stackUp.worstCaseMax}</div>
            {tolResult.parts.map((p, i) => <div key={i} className="text-[10px] text-zinc-400 mt-0.5"><span className="font-mono text-blue-200">{p.part}</span> {p.nominal} ±{p.tolerance} · {p.toleranceClass}</div>)}
          </div>
        )}
        {stressResult && (
          <div className={cn('rounded-md border p-2.5', stressResult.safetyFactor >= 3 ? 'border-emerald-500/30 bg-emerald-500/5' : stressResult.safetyFactor >= 1.5 ? 'border-amber-500/30 bg-amber-500/5' : 'border-red-500/30 bg-red-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold">Stress · SF {stressResult.safetyFactor}</div>
            <div className={cn('text-2xl font-bold', STATUS_COLOR[stressResult.status] ?? 'text-red-300')}>{stressResult.appliedStress}</div>
            <div className="text-[10px] text-zinc-500">/ yield {stressResult.yieldStrength}</div>
            <div className={cn('text-[11px] font-semibold', STATUS_COLOR[stressResult.status] ?? 'text-red-300')}>{stressResult.status}</div>
            <div className="text-[10px] text-zinc-500 italic mt-0.5">{stressResult.recommendation}</div>
          </div>
        )}
        {bomResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">BOM</div>
            <div className="text-2xl font-bold text-amber-300">${bomResult.totalCost.toLocaleString()}</div>
            <div className="text-[10px] text-zinc-500">{bomResult.totalLineItems} SKUs · {bomResult.totalParts} parts · {bomResult.uniqueSuppliers} suppliers</div>
            <div className="text-[10px] text-zinc-500">CP: <span className="text-amber-200 font-mono">{bomResult.criticalPath}</span></div>
            {bomResult.bom.slice(0, 4).map((b, i) => <div key={i} className="text-[10px] text-zinc-400 mt-0.5"><span className="font-mono">{b.partNumber}</span> ×{b.quantity} = ${b.extendedCost}</div>)}
          </div>
        )}
        {unitResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">{unitResult.conversion}</div>
            <div className="text-sm text-zinc-200 font-mono">{unitResult.input}</div>
            <div className="text-2xl font-bold text-purple-300">{unitResult.output}</div>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Design review</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
