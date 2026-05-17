'use client';

/**
 * VeterinaryActionPanel — clinic-bench surface.
 * triageAssess / weightCheck / vaccineSchedule / costEstimate +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Stethoscope, Scale, Syringe, DollarSign, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('veterinary', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'triage' | 'weight' | 'vaccine' | 'cost' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface TriageResult { species: string; age: number; symptoms: string[]; triageLevel: string; responseTime: string; firstAid: string[] }
interface WeightResult { species: string; breed: string; currentWeight: number; idealRange: string; status: string; recommendation: string }
interface VaccineRow { vaccine: string; ageMonths: number; booster: string; due: string }
interface VaccineResult { species: string; ageMonths: number; vaccines: VaccineRow[]; overdueCount: number }
interface CostRow { procedure: string; estimatedCost: number }
interface CostResult { procedures: CostRow[]; totalEstimate: number; tip: string }

const DEFAULT_SPECIES = 'dog';
const DEFAULT_TRIAGE = JSON.stringify({ species: 'dog', age: 4, symptoms: [{ name: 'vomiting' }, { name: 'lethargy' }] }, null, 2);
const DEFAULT_WEIGHT = JSON.stringify({ species: 'dog', breed: 'labrador', weight: 78, age: 5 }, null, 2);
const DEFAULT_VACCINE = JSON.stringify({ species: 'dog', age: 1.5 }, null, 2);
const DEFAULT_COST = JSON.stringify({ procedures: [{ type: 'exam' }, { type: 'vaccination' }, { type: 'bloodwork' }, { type: 'dental' }] }, null, 2);

export function VeterinaryActionPanel() {
  const [triageText, setTriageText] = useState(DEFAULT_TRIAGE);
  const [weightText, setWeightText] = useState(DEFAULT_WEIGHT);
  const [vaccineText, setVaccineText] = useState(DEFAULT_VACCINE);
  const [costText, setCostText] = useState(DEFAULT_COST);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [triageResult, setTriageResult] = useState<TriageResult | null>(null);
  const [weightResult, setWeightResult] = useState<WeightResult | null>(null);
  const [vaccineResult, setVaccineResult] = useState<VaccineResult | null>(null);
  const [costResult, setCostResult] = useState<CostResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actTriage() {
    try { const parsed = JSON.parse(triageText); setBusy('triage'); setFeedback(null);
      const r = await callMacro<TriageResult>('triageAssess', { artifact: { data: parsed } });
      if (r.ok && r.result) { setTriageResult(r.result); ok(`${r.result.triageLevel} · ${r.result.responseTime}`); } else err(r.error ?? 'triage failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid triage JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actWeight() {
    try { const parsed = JSON.parse(weightText); setBusy('weight'); setFeedback(null);
      const r = await callMacro<WeightResult>('weightCheck', { artifact: { data: parsed } });
      if (r.ok && r.result) { setWeightResult(r.result); ok(`${r.result.status} · ${r.result.idealRange}`); } else err(r.error ?? 'weight failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid weight JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actVaccine() {
    try { const parsed = JSON.parse(vaccineText); setBusy('vaccine'); setFeedback(null);
      const r = await callMacro<VaccineResult>('vaccineSchedule', { artifact: { data: parsed } });
      if (r.ok && r.result) { setVaccineResult(r.result); ok(`${r.result.vaccines.length} vaccines · ${r.result.overdueCount} due`); } else err(r.error ?? 'vaccine failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid vaccine JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actCost() {
    try { const parsed = JSON.parse(costText); setBusy('cost'); setFeedback(null);
      const r = await callMacro<CostResult>('costEstimate', { artifact: { data: parsed } });
      if (r.ok && r.result) { setCostResult(r.result); ok(`Total $${r.result.totalEstimate ?? 0}`); } else err(r.error ?? 'cost failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid cost JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Vet visit brief`, tags: ['veterinary', DEFAULT_SPECIES, triageResult?.triageLevel].filter((t): t is string => !!t), source: 'veterinary:visit:mint', meta: { visibility: 'private', consent: { allowCitations: false }, vet: { triage: triageResult, weight: weightResult, vaccine: vaccineResult, cost: costResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Vet DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🐾 Vet brief`, '', triageResult ? `Triage: ${triageResult.triageLevel} · ${triageResult.responseTime}` : '', weightResult ? `Weight: ${weightResult.currentWeight} lbs (${weightResult.idealRange}) — ${weightResult.status}` : '', vaccineResult ? `Vaccines: ${vaccineResult.overdueCount}/${vaccineResult.vaccines.length} overdue` : '', costResult ? `Est. cost: $${costResult.totalEstimate}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!triageResult && !weightResult && !vaccineResult) { err('Run at least one check first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Pet care snapshot`, tags: ['veterinary', 'snapshot', 'public'], source: 'veterinary:snapshot:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, vet: { triage: triageResult, weight: weightResult, vaccine: vaccineResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Veterinary brief. ${triageResult ? `Triage: ${triageResult.triageLevel} (symptoms: ${triageResult.symptoms.join(', ')}).` : ''} ${weightResult ? `Weight: ${weightResult.currentWeight} lbs, ${weightResult.status}.` : ''} ${vaccineResult ? `${vaccineResult.overdueCount} vaccines overdue.` : ''} ${costResult ? `Est cost: $${costResult.totalEstimate}.` : ''} Give the owner one clear next step + one preventive recommendation. Plain text, ≤ 3 sentences.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'triage' as ActionId, label: 'Triage', desc: 'triageAssess (urgency)', icon: Stethoscope, accent: '#ef4444', handler: actTriage },
    { id: 'weight' as ActionId, label: 'Weight', desc: 'weightCheck (BCS)', icon: Scale, accent: '#f59e0b', handler: actWeight },
    { id: 'vaccine' as ActionId, label: 'Vaccines', desc: 'vaccineSchedule (CDC)', icon: Syringe, accent: '#22c55e', handler: actVaccine },
    { id: 'cost' as ActionId, label: 'Cost', desc: 'costEstimate', icon: DollarSign, accent: '#a855f7', handler: actCost },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private vet DTU', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon snapshot', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Plan', desc: 'Agent: next step', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const TRIAGE_COLOR: Record<string, string> = { EMERGENCY: 'text-red-300', urgent: 'text-amber-300', routine: 'text-emerald-300' };
  const STATUS_COLOR: Record<string, string> = { 'healthy-weight': 'text-emerald-300', 'overweight': 'text-amber-300', 'underweight': 'text-red-300' };

  return (
    <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-cyan-500/10 pb-2">
        <Stethoscope className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">Veterinary clinic bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">triage · weight · vaccines · cost</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">Triage JSON (species/age/symptoms)</label>
          <textarea value={triageText} onChange={(e) => setTriageText(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Weight JSON</label>
          <textarea value={weightText} onChange={(e) => setWeightText(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Vaccine JSON</label>
          <textarea value={vaccineText} onChange={(e) => setVaccineText(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Cost JSON (procedures[])</label>
          <textarea value={costText} onChange={(e) => setCostText(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient user-id" />
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
        {triageResult && (
          <div className={cn('rounded-md border p-2.5 max-h-44 overflow-y-auto', triageResult.triageLevel === 'EMERGENCY' ? 'border-red-500/40 bg-red-500/10' : triageResult.triageLevel === 'urgent' ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold">Triage · {triageResult.species}</div>
            <div className={cn('text-xl font-bold', TRIAGE_COLOR[triageResult.triageLevel])}>{triageResult.triageLevel}</div>
            <div className="text-[10px] text-zinc-300 mt-0.5">{triageResult.responseTime}</div>
            <div className="text-[10px] text-zinc-500 mt-1">Symptoms: {triageResult.symptoms.join(', ')}</div>
            {triageResult.firstAid.length > 0 && triageResult.firstAid.map((a, i) => <div key={i} className="text-[10px] text-red-200 mt-0.5">→ {a}</div>)}
          </div>
        )}
        {weightResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Weight · {weightResult.breed}</div>
            <div className={cn('text-2xl font-bold', STATUS_COLOR[weightResult.status])}>{weightResult.currentWeight} <span className="text-xs text-zinc-400">lbs</span></div>
            <div className="text-[10px] text-zinc-300">Ideal: {weightResult.idealRange}</div>
            <div className="text-[10px] text-zinc-400 mt-1">{weightResult.recommendation}</div>
          </div>
        )}
        {vaccineResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Vaccines · {vaccineResult.overdueCount} due</div>
            <div className="text-[10px] text-zinc-500">{vaccineResult.species} · {vaccineResult.ageMonths}mo</div>
            {vaccineResult.vaccines.map((v, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span><strong>{v.vaccine}</strong> · {v.booster}</span><span className={cn('font-mono', v.due === 'due-or-overdue' ? 'text-red-300' : 'text-zinc-500')}>{v.due}</span></div>)}
          </div>
        )}
        {costResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Cost · ${costResult.totalEstimate}</div>
            {costResult.procedures.map((p, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span>{p.procedure}</span><span className="font-mono text-purple-200">${p.estimatedCost}</span></div>)}
            <div className="text-[10px] text-zinc-400 mt-1 italic">{costResult.tip}</div>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Care plan</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
