'use client';

/**
 * EthicsActionPanel — ethics review bench.
 * frameworkAnalysis / stakeholderImpact / biasDetection (3 macros + 1 dual-pass) +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Scale, Users, ShieldCheck, BarChart3, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('ethics', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'framework' | 'stakeholder' | 'bias' | 'tensions' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface FwScore { name: string; score: number; assessment: string }
interface FrameworkResult { frameworks: { utilitarian: FwScore; deontological: FwScore; virtue: FwScore; care: FwScore }; overallScore: number; consensus: string; tensions: string[]; recommendation: string }
interface SHRow { name: string; group: string; salience: number; quadrant: string; weightedImpact: number; priority: string }
interface StakeholderResult { stakeholders: SHRow[]; summary: { total: number; positivelyAffected: number; negativelyAffected: number; vulnerableHarmed: number; highPriority: number }; equityScore: number; equityAssessment: string; quadrantDistribution: Record<string, number> }
interface BiasGroup { disparateImpact?: number; parityDifference?: number; biased?: boolean; severity?: string }
interface BiasResult { results?: Record<string, BiasGroup>; overallBias?: string; protectedAttributesAnalyzed?: number; recommendation?: string }

const DEFAULT_ACTION = JSON.stringify({ action: { description: 'Deploy facial-recognition surveillance for retail loss prevention.', consequences: [{ impact: -40, affectedCount: 5000, probability: 0.85 }, { impact: 30, affectedCount: 50, probability: 0.95 }], stakeholders: [{ name: 'customers', vulnerable: true, impact: -50, powerLevel: 'low' }, { name: 'store owners', impact: 60, powerLevel: 'high' }], principles: ['safety', 'consent', 'transparency'] }, context: { domain: 'retail', urgency: 'medium', reversibility: 'difficult', scope: 'broad' } }, null, 2);
const DEFAULT_STAKEHOLDERS = JSON.stringify({ stakeholders: [{ name: 'low-wage workers', group: 'employees', power: 20, interest: 90, impact: -45, vulnerability: 70 }, { name: 'shareholders', group: 'investors', power: 90, interest: 60, impact: 65, vulnerability: 0 }, { name: 'local community', group: 'public', power: 30, interest: 70, impact: -20, vulnerability: 50 }, { name: 'executive team', group: 'mgmt', power: 95, interest: 95, impact: 80, vulnerability: 0 }] }, null, 2);
const DEFAULT_BIAS = JSON.stringify({ protectedAttributes: ['gender', 'race'], decisions: Array.from({ length: 24 }).map((_, i) => ({ id: `d${i}`, outcome: i % 5 !== 0, attributes: { gender: i % 2 === 0 ? 'M' : 'F', race: i % 3 === 0 ? 'A' : i % 3 === 1 ? 'B' : 'C' } })) }, null, 2);

export function EthicsActionPanel() {
  const [actionText, setActionText] = useState(DEFAULT_ACTION);
  const [stakeholderText, setStakeholderText] = useState(DEFAULT_STAKEHOLDERS);
  const [biasText, setBiasText] = useState(DEFAULT_BIAS);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [fwResult, setFwResult] = useState<FrameworkResult | null>(null);
  const [shResult, setShResult] = useState<StakeholderResult | null>(null);
  const [biasResult, setBiasResult] = useState<BiasResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actFramework() {
    try { const parsed = JSON.parse(actionText); setBusy('framework'); setFeedback(null);
      const r = await callMacro<FrameworkResult>('frameworkAnalysis', { artifact: { data: parsed } });
      if (r.ok && r.result) { setFwResult(r.result); ok(`Score ${r.result.overallScore} · ${r.result.consensus}.`); } else err(r.error ?? 'framework failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid action JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actStakeholder() {
    try { const parsed = JSON.parse(stakeholderText); setBusy('stakeholder'); setFeedback(null);
      const r = await callMacro<StakeholderResult>('stakeholderImpact', { artifact: { data: parsed } });
      if (r.ok && r.result) { setShResult(r.result); ok(`${r.result.equityAssessment} · equity ${r.result.equityScore}.`); } else err(r.error ?? 'stakeholder failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid stakeholder JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actBias() {
    try { const parsed = JSON.parse(biasText); setBusy('bias'); setFeedback(null);
      const r = await callMacro<BiasResult>('biasDetection', { artifact: { data: parsed } });
      if (r.ok && r.result) { setBiasResult(r.result); ok(`Overall: ${r.result.overallBias ?? 'analyzed'}.`); } else err(r.error ?? 'bias failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid bias JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actTensions() {
    if (!fwResult) { err('Run framework analysis first.'); return; }
    setBusy('tensions'); setFeedback(null);
    const tensions = fwResult.tensions ?? [];
    if (tensions.length === 0) { ok('No tensions detected across frameworks.'); setBusy(null); return; }
    ok(`${tensions.length} tension(s): ${tensions[0]}`); setBusy(null);
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Ethics review`, tags: ['ethics', fwResult?.consensus, biasResult?.overallBias].filter((t): t is string => !!t), source: 'ethics:review:mint', meta: { visibility: 'private', consent: { allowCitations: false }, ethics: { framework: fwResult, stakeholder: shResult, bias: biasResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Review DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`⚖ Ethics review`, '', fwResult ? `Frameworks: util ${fwResult.frameworks.utilitarian.score} · deont ${fwResult.frameworks.deontological.score} · virtue ${fwResult.frameworks.virtue.score} · care ${fwResult.frameworks.care.score} → ${fwResult.consensus}` : '', shResult ? `Stakeholders: ${shResult.equityAssessment} · ${shResult.summary.vulnerableHarmed} vulnerable harmed of ${shResult.summary.total}` : '', biasResult ? `Bias: ${biasResult.overallBias ?? 'n/a'}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!fwResult) { err('Run framework first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Ethics review summary`, tags: ['ethics', 'review', 'public'], source: 'ethics:summary:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, ethics: { framework: fwResult, stakeholder: shResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Ethics committee brief. ${fwResult ? `Frameworks: ${fwResult.consensus} (overall ${fwResult.overallScore}/100); tensions: ${(fwResult.tensions || []).slice(0, 2).join('; ') || 'none'}.` : ''} ${shResult ? `Equity: ${shResult.equityAssessment}; ${shResult.summary.vulnerableHarmed} vulnerable stakeholders harmed.` : ''} ${biasResult?.overallBias ? `Bias: ${biasResult.overallBias}.` : ''} State the single strongest objection and one constructive mitigation. Plain text, ≤ 3 sentences.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Committee brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'framework' as ActionId, label: 'Frameworks', desc: 'frameworkAnalysis (4)', icon: Scale, accent: '#3b82f6', handler: actFramework },
    { id: 'stakeholder' as ActionId, label: 'Stakeholders', desc: 'stakeholderImpact', icon: Users, accent: '#22c55e', handler: actStakeholder },
    { id: 'bias' as ActionId, label: 'Bias', desc: 'biasDetection (4/5 rule)', icon: BarChart3, accent: '#f59e0b', handler: actBias },
    { id: 'tensions' as ActionId, label: 'Tensions', desc: 'cross-framework conflicts', icon: ShieldCheck, accent: '#a855f7', handler: actTensions },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private review', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send review', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon summary', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Committee', desc: 'Agent: objection+fix', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const CONSENSUS_COLOR: Record<string, string> = { 'all-frameworks-approve': 'text-emerald-300', 'all-frameworks-disapprove': 'text-red-300', 'frameworks-disagree': 'text-amber-300' };
  const QUADRANT_COLOR: Record<string, string> = { 'manage-closely': 'text-red-300', 'keep-satisfied': 'text-amber-300', 'keep-informed': 'text-blue-300', monitor: 'text-zinc-400' };

  return (
    <div className="rounded-lg border border-amber-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-amber-500/10 pb-2">
        <Scale className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Ethics review bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">frameworks · stakeholders · bias · tensions</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Action JSON</label>
          <textarea value={actionText} onChange={(e) => setActionText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Stakeholders JSON</label>
          <textarea value={stakeholderText} onChange={(e) => setStakeholderText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Bias decisions JSON (≥10 rows)</label>
          <textarea value={biasText} onChange={(e) => setBiasText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="md:col-span-3 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient user-id" />
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {fwResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Frameworks</div>
            <div className={cn('text-2xl font-bold', CONSENSUS_COLOR[fwResult.consensus])}>{fwResult.overallScore}</div>
            <div className="text-[10px] text-zinc-400">{fwResult.consensus}</div>
            {(['utilitarian', 'deontological', 'virtue', 'care'] as const).map(k => <div key={k} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span>{fwResult.frameworks[k].name}</span><span className={cn('font-mono', fwResult.frameworks[k].score >= 50 ? 'text-emerald-200' : fwResult.frameworks[k].score >= 0 ? 'text-amber-200' : 'text-red-300')}>{fwResult.frameworks[k].score} · {fwResult.frameworks[k].assessment}</span></div>)}
            {(fwResult.tensions ?? []).slice(0, 2).map((t, i) => <div key={i} className="text-[10px] text-amber-200 mt-0.5">⚡ {t}</div>)}
            <div className="text-[10px] text-blue-200 mt-1 italic">{fwResult.recommendation}</div>
          </div>
        )}
        {shResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Stakeholders · equity {shResult.equityScore}</div>
            <div className="text-[10px] text-zinc-400">{shResult.equityAssessment} · {shResult.summary.vulnerableHarmed}/{shResult.summary.total} vulnerable harmed</div>
            {shResult.stakeholders.slice(0, 5).map((s, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span><strong>{s.name}</strong> ({s.group})</span><span className={cn('font-mono text-[9px]', QUADRANT_COLOR[s.quadrant])}>{s.quadrant} · {s.weightedImpact}</span></div>)}
          </div>
        )}
        {biasResult?.results && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Bias · {biasResult.overallBias ?? '—'}</div>
            <div className="text-[10px] text-zinc-400">{biasResult.protectedAttributesAnalyzed ?? Object.keys(biasResult.results).length} attrs analyzed</div>
            {Object.entries(biasResult.results).map(([attr, g], i) => <div key={i} className={cn('text-[10px] mt-0.5 flex justify-between', g.biased ? 'text-red-300' : 'text-emerald-300')}><span>{attr}</span><span className="font-mono">DI {((g.disparateImpact ?? 0) * 100).toFixed(0)}%{g.severity ? ` · ${g.severity}` : ''}</span></div>)}
            {biasResult.recommendation && <div className="text-[10px] text-amber-200 mt-1 italic">{biasResult.recommendation}</div>}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Committee opinion</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
