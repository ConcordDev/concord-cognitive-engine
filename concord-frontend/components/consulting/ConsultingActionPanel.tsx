'use client';

/**
 * ConsultingActionPanel — consulting practice bench.
 * engagementScope / utilizationRate / proposalScore / clientHealth +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Briefcase, Clock, FileCheck, Heart, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('consulting', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'scope' | 'util' | 'proposal' | 'health' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface ScopeRow { name: string; hours: number; fee: number }
interface ScopeResult { client: string; deliverables: ScopeRow[]; totalHours: number; hourlyRate: number; subtotal: number; contingency: number; grandTotal: number; timeline: string }
interface UtilResult { billableHours: number; totalHours: number; utilizationRate: number; target: number; variance: number; status: string }
interface ProposalResult { score: number; sectionsPresent: string[]; sectionsMissing: string[]; completeness: string }
interface HealthResult { client: string; nps: number; paymentRate: number; avgResponseDays: number; healthScore: number; risk: string }

const DEFAULT_SCOPE = JSON.stringify({ client: 'Acme Corp', hourlyRate: 250, deliverables: [{ name: 'Strategy workshop', hours: 24 }, { name: 'Market research', hours: 60 }, { name: 'Implementation roadmap', hours: 40 }, { name: 'Stakeholder interviews', hours: 28 }] }, null, 2);
const DEFAULT_UTIL = JSON.stringify({ billableHours: 32, totalHours: 40 }, null, 2);
const DEFAULT_PROP = JSON.stringify({ 'executive-summary': true, methodology: true, timeline: true, pricing: true, team: false, references: false }, null, 2);
const DEFAULT_HEALTH = JSON.stringify({ client: 'Acme Corp', nps: 45, invoicesPaid: 8, invoicesTotal: 10, avgResponseDays: 2.5 }, null, 2);

export function ConsultingActionPanel() {
  const [scopeText, setScopeText] = useState(DEFAULT_SCOPE);
  const [utilText, setUtilText] = useState(DEFAULT_UTIL);
  const [propText, setPropText] = useState(DEFAULT_PROP);
  const [healthText, setHealthText] = useState(DEFAULT_HEALTH);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [scopeResult, setScopeResult] = useState<ScopeResult | null>(null);
  const [utilResult, setUtilResult] = useState<UtilResult | null>(null);
  const [propResult, setPropResult] = useState<ProposalResult | null>(null);
  const [healthResult, setHealthResult] = useState<HealthResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actScope() {
    try { const parsed = JSON.parse(scopeText); setBusy('scope'); setFeedback(null);
      const r = await callMacro<ScopeResult>('engagementScope', { artifact: { data: parsed } });
      if (r.ok && r.result) { setScopeResult(r.result); ok(`$${r.result.grandTotal} · ${r.result.timeline}`); } else err(r.error ?? 'scope failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid scope JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actUtil() {
    try { const parsed = JSON.parse(utilText); setBusy('util'); setFeedback(null);
      const r = await callMacro<UtilResult>('utilizationRate', { artifact: { data: parsed } });
      if (r.ok && r.result) { setUtilResult(r.result); ok(`${r.result.utilizationRate}% · ${r.result.status}`); } else err(r.error ?? 'util failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid util JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actProposal() {
    try { const parsed = JSON.parse(propText); setBusy('proposal'); setFeedback(null);
      const r = await callMacro<ProposalResult>('proposalScore', { artifact: { data: parsed } });
      if (r.ok && r.result) { setPropResult(r.result); ok(`${r.result.score}% · ${r.result.completeness}`); } else err(r.error ?? 'proposal failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid proposal JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actHealth() {
    try { const parsed = JSON.parse(healthText); setBusy('health'); setFeedback(null);
      const r = await callMacro<HealthResult>('clientHealth', { artifact: { data: parsed } });
      if (r.ok && r.result) { setHealthResult(r.result); ok(`${r.result.healthScore}/100 · ${r.result.risk} risk`); } else err(r.error ?? 'health failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid health JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Consulting brief`, tags: ['consulting', scopeResult?.client, healthResult?.risk].filter((t): t is string => !!t), source: 'consulting:brief:mint', meta: { visibility: 'private', consent: { allowCitations: false }, consulting: { scope: scopeResult, util: utilResult, proposal: propResult, health: healthResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Brief DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`💼 Consulting brief`, '', scopeResult ? `Scope: ${scopeResult.client} · $${scopeResult.grandTotal} (${scopeResult.totalHours}h) · ${scopeResult.timeline}` : '', utilResult ? `Utilization: ${utilResult.utilizationRate}% (target ${utilResult.target}%) · ${utilResult.status}` : '', propResult ? `Proposal: ${propResult.score}% · ${propResult.completeness}` : '', healthResult ? `Client health: ${healthResult.healthScore}/100 · ${healthResult.risk} risk` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!scopeResult) { err('Scope first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Engagement model: ${scopeResult.client}`, tags: ['consulting', 'engagement', 'public'], source: 'consulting:engagement:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, consulting: { scope: scopeResult, proposal: propResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Consulting partner brief. ${scopeResult ? `Engagement: $${scopeResult.grandTotal} over ${scopeResult.timeline}.` : ''} ${utilResult ? `Utilization: ${utilResult.utilizationRate}% (${utilResult.status}).` : ''} ${propResult ? `Proposal: ${propResult.score}% complete; missing ${propResult.sectionsMissing.join(', ') || 'nothing'}.` : ''} ${healthResult ? `Client health: ${healthResult.healthScore}/100 · ${healthResult.risk} risk.` : ''} Recommend the single highest-ROI move + one red flag to watch. Plain text, ≤ 3 sentences.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Partner brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'scope' as ActionId, label: 'Scope', desc: 'engagementScope ($)', icon: Briefcase, accent: '#3b82f6', handler: actScope },
    { id: 'util' as ActionId, label: 'Util %', desc: 'utilizationRate', icon: Clock, accent: '#f59e0b', handler: actUtil },
    { id: 'proposal' as ActionId, label: 'Proposal', desc: 'proposalScore', icon: FileCheck, accent: '#22c55e', handler: actProposal },
    { id: 'health' as ActionId, label: 'Health', desc: 'clientHealth', icon: Heart, accent: '#ef4444', handler: actHealth },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private brief', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon engagement', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Partner', desc: 'Agent: next move', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const STATUS_COLOR: Record<string, string> = { excellent: 'text-emerald-300', 'on-target': 'text-blue-300', 'below-target': 'text-amber-300', critical: 'text-red-300' };
  const RISK_COLOR: Record<string, string> = { low: 'text-emerald-300', medium: 'text-amber-300', high: 'text-red-300' };

  return (
    <div className="rounded-lg border border-blue-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-blue-500/10 pb-2">
        <Briefcase className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">Consulting practice bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">scope · util · proposal · health</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Engagement JSON</label>
          <textarea value={scopeText} onChange={(e) => setScopeText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Utilization JSON</label>
          <textarea value={utilText} onChange={(e) => setUtilText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Proposal sections JSON</label>
          <textarea value={propText} onChange={(e) => setPropText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">Client health JSON</label>
          <textarea value={healthText} onChange={(e) => setHealthText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
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
        {scopeResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Scope · {scopeResult.client}</div>
            <div className="text-2xl font-bold text-blue-200">${scopeResult.grandTotal}</div>
            <div className="text-[10px] text-zinc-300">{scopeResult.totalHours}h @ ${scopeResult.hourlyRate}/hr · {scopeResult.timeline}</div>
            <div className="text-[10px] text-zinc-500">Sub ${scopeResult.subtotal} + cont ${scopeResult.contingency}</div>
            {scopeResult.deliverables.slice(0, 4).map((d, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span>{d.name}</span><span className="font-mono">${d.fee} · {d.hours}h</span></div>)}
          </div>
        )}
        {utilResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Utilization</div>
            <div className={cn('text-3xl font-bold', STATUS_COLOR[utilResult.status])}>{utilResult.utilizationRate}<span className="text-sm text-zinc-400">%</span></div>
            <div className="text-[10px] text-zinc-300">Target {utilResult.target}% · var {utilResult.variance > 0 ? '+' : ''}{utilResult.variance}</div>
            <div className="mt-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden"><div className={cn('h-full', utilResult.utilizationRate >= 75 ? 'bg-emerald-400' : utilResult.utilizationRate >= 50 ? 'bg-amber-400' : 'bg-red-400')} style={{ width: `${Math.min(100, utilResult.utilizationRate)}%` }} /></div>
            <div className="text-[10px] text-zinc-400 mt-1">{utilResult.billableHours}h billable / {utilResult.totalHours}h total</div>
          </div>
        )}
        {propResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Proposal · {propResult.completeness}</div>
            <div className={cn('text-3xl font-bold', propResult.score >= 80 ? 'text-emerald-300' : propResult.score >= 50 ? 'text-amber-300' : 'text-red-300')}>{propResult.score}%</div>
            <div className="text-[10px] text-zinc-300 mt-1">Present:</div>
            <div className="flex flex-wrap gap-1 mt-0.5">{propResult.sectionsPresent.map((s, i) => <span key={i} className="px-1.5 py-0.5 rounded bg-emerald-900/30 text-[9px] text-emerald-200">{s}</span>)}</div>
            {propResult.sectionsMissing.length > 0 && <><div className="text-[10px] text-zinc-300 mt-1">Missing:</div><div className="flex flex-wrap gap-1 mt-0.5">{propResult.sectionsMissing.map((s, i) => <span key={i} className="px-1.5 py-0.5 rounded bg-red-900/30 text-[9px] text-red-200">{s}</span>)}</div></>}
          </div>
        )}
        {healthResult && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold">Health · {healthResult.client}</div>
            <div className={cn('text-3xl font-bold', healthResult.healthScore >= 70 ? 'text-emerald-300' : healthResult.healthScore >= 40 ? 'text-amber-300' : 'text-red-300')}>{healthResult.healthScore}<span className="text-sm text-zinc-400">/100</span></div>
            <div className={cn('text-[10px] font-semibold', RISK_COLOR[healthResult.risk])}>{healthResult.risk} risk</div>
            <div className="text-[10px] text-zinc-300 mt-1">NPS {healthResult.nps} · paid {healthResult.paymentRate}% · {healthResult.avgResponseDays}d response</div>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Partner brief</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
