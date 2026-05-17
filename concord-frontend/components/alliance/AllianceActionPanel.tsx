'use client';

/**
 * AllianceActionPanel — partnerships bench.
 * compatibilityScore / networkAnalysis / riskAssessment +
 * mint/DM/publish/agent (reset).
 */

import { useState } from 'react';
import { Users, Network, ShieldAlert, RefreshCw, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('alliance', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T; error?: string } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'compat' | 'net' | 'risk' | 'reset' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface CompatResult { partnerA: string; partnerB: string; compositeScore: number; compatibilityLevel: string; componentScores: { capabilitySimilarity: number; valuesAlignment: number; resourceSimilarity: number; complementarity: number }; overlap: { capabilities: string[]; values: string[]; resources: string[] } }
interface NetResult { nodeCount?: number; edgeCount?: number; density?: number; brokers?: { id: string; betweenness: number }[]; clusters?: { count: number; avgCoeff: number }; isolatedNodes?: string[] }
interface RiskResult { overallRisk?: string; riskScore?: number; categories?: { name: string; score: number; concerns?: string[] }[]; topRisks?: string[]; mitigations?: string[] }

const DEFAULT_COMPAT = JSON.stringify({ partnerA: { name: 'Acme Corp', capabilities: ['mfg', 'logistics', 'qa'], values: ['quality', 'sustainability', 'innovation'], resources: ['us-warehouses', 'union-labor'], strengths: ['scale', 'compliance'] }, partnerB: { name: 'NovaTech', capabilities: ['software', 'ai', 'qa'], values: ['innovation', 'transparency', 'sustainability'], resources: ['ml-talent', 'cloud-credits', 'patents'], strengths: ['speed', 'r&d'] } }, null, 2);
const DEFAULT_NET = JSON.stringify({ nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }, { id: 'E' }, { id: 'F' }, { id: 'G' }, { id: 'H' }], edges: [{ source: 'A', target: 'B' }, { source: 'A', target: 'C' }, { source: 'B', target: 'C' }, { source: 'B', target: 'D' }, { source: 'C', target: 'E' }, { source: 'D', target: 'F' }, { source: 'E', target: 'F' }, { source: 'E', target: 'G' }, { source: 'F', target: 'G' }] }, null, 2);
const DEFAULT_RISK = JSON.stringify({ alliance: { type: 'joint-venture', durationYears: 5, capital: 50_000_000, ipShared: true, marketsOverlap: 0.35, partnerExperience: 0.7 }, externalFactors: { regulatoryRisk: 'medium', technologyRisk: 'high', marketVolatility: 0.4 } }, null, 2);

export function AllianceActionPanel() {
  const [compatText, setCompatText] = useState(DEFAULT_COMPAT);
  const [netText, setNetText] = useState(DEFAULT_NET);
  const [riskText, setRiskText] = useState(DEFAULT_RISK);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [compatResult, setCompatResult] = useState<CompatResult | null>(null);
  const [netResult, setNetResult] = useState<NetResult | null>(null);
  const [riskResult, setRiskResult] = useState<RiskResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actCompat() {
    try { const parsed = JSON.parse(compatText); setBusy('compat'); setFeedback(null);
      const r = await callMacro<CompatResult>('compatibilityScore', { artifact: { data: parsed } });
      if (r.ok && r.result) { setCompatResult(r.result); ok(`${r.result.compositeScore}% · ${r.result.compatibilityLevel}`); } else err(r.error ?? 'compat failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid compat JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actNet() {
    try { const parsed = JSON.parse(netText); setBusy('net'); setFeedback(null);
      const r = await callMacro<NetResult>('networkAnalysis', { artifact: { data: parsed } });
      if (r.ok && r.result) { setNetResult(r.result); ok(`${r.result.edgeCount ?? 0} edges · density ${r.result.density?.toFixed?.(3)}`); } else err(r.error ?? 'net failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid net JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actRisk() {
    try { const parsed = JSON.parse(riskText); setBusy('risk'); setFeedback(null);
      const r = await callMacro<RiskResult>('riskAssessment', { artifact: { data: parsed } });
      if (r.ok && r.result) { setRiskResult(r.result); ok(`Risk ${r.result.overallRisk ?? '?'} · ${r.result.riskScore ?? '?'}/100`); } else err(r.error ?? 'risk failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid risk JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  function actReset() { setCompatResult(null); setNetResult(null); setRiskResult(null); setMintedDtuId(null); setPublishedDtuId(null); setAgentReply(null); ok('Cleared.'); }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Alliance brief`, tags: ['alliance', compatResult?.compatibilityLevel, riskResult?.overallRisk].filter((t): t is string => !!t), source: 'alliance:brief:mint', meta: { visibility: 'private', consent: { allowCitations: false }, alliance: { compat: compatResult, net: netResult, risk: riskResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Brief DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🤝 Alliance brief`, '', compatResult ? `Compat: ${compatResult.partnerA} × ${compatResult.partnerB} → ${compatResult.compositeScore}% (${compatResult.compatibilityLevel})` : '', netResult ? `Network: ${netResult.nodeCount ?? 0} nodes / ${netResult.edgeCount ?? 0} edges · density ${netResult.density?.toFixed?.(3)}` : '', riskResult ? `Risk: ${riskResult.overallRisk ?? '?'} (${riskResult.riskScore ?? '?'}/100)${riskResult.topRisks?.length ? ` · top: ${riskResult.topRisks.slice(0, 2).join(', ')}` : ''}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!compatResult && !netResult) { err('Compat or net first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Partnership snapshot`, tags: ['alliance', 'partnership', 'public'], source: 'alliance:partnership:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, alliance: { compat: compatResult, net: netResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Alliances director brief. ${compatResult ? `${compatResult.partnerA} × ${compatResult.partnerB}: ${compatResult.compositeScore}% (${compatResult.compatibilityLevel}); values alignment ${compatResult.componentScores.valuesAlignment}%.` : ''} ${netResult ? `Network density ${netResult.density?.toFixed?.(3)}; brokers: ${netResult.brokers?.slice(0, 2).map(b => b.id).join(', ') ?? 'none'}.` : ''} ${riskResult ? `Risk ${riskResult.overallRisk ?? '?'} (${riskResult.riskScore ?? '?'}/100); top: ${riskResult.topRisks?.slice(0, 2).join(', ') ?? 'none'}.` : ''} State the single deal-go/no-go signal + one structural recommendation. Plain text, ≤ 3 sentences.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Director brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'compat' as ActionId, label: 'Compat', desc: 'compatibilityScore', icon: Users, accent: '#22c55e', handler: actCompat },
    { id: 'net' as ActionId, label: 'Network', desc: 'networkAnalysis', icon: Network, accent: '#3b82f6', handler: actNet },
    { id: 'risk' as ActionId, label: 'Risk', desc: 'riskAssessment', icon: ShieldAlert, accent: '#ef4444', handler: actRisk },
    { id: 'reset' as ActionId, label: 'Reset', desc: 'Clear results', icon: RefreshCw, accent: '#71717a', handler: actReset },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private brief', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon snapshot', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Director', desc: 'Agent: go/no-go', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const LEVEL_COLOR: Record<string, string> = { excellent: 'text-emerald-300', good: 'text-blue-300', moderate: 'text-amber-300', low: 'text-red-300' };

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-emerald-500/10 pb-2">
        <Users className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">Alliance / partnership bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">compat · network · risk</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Compatibility JSON</label>
          <textarea value={compatText} onChange={(e) => setCompatText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Network JSON</label>
          <textarea value={netText} onChange={(e) => setNetText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">Risk JSON</label>
          <textarea value={riskText} onChange={(e) => setRiskText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
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
        {compatResult && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Compat · {compatResult.compatibilityLevel}</div>
            <div className={cn('text-3xl font-bold', LEVEL_COLOR[compatResult.compatibilityLevel])}>{compatResult.compositeScore}<span className="text-xs text-zinc-400">%</span></div>
            <div className="text-[10px] text-zinc-300">{compatResult.partnerA} × {compatResult.partnerB}</div>
            <div className="text-[10px] text-zinc-300 mt-1">Cap {compatResult.componentScores.capabilitySimilarity}% · Vals {compatResult.componentScores.valuesAlignment}% · Res {compatResult.componentScores.resourceSimilarity}% · Comp {compatResult.componentScores.complementarity}%</div>
            <div className="text-[10px] text-zinc-500 mt-1">Shared values: {compatResult.overlap.values.join(', ') || '—'}</div>
            <div className="text-[10px] text-zinc-500">Shared caps: {compatResult.overlap.capabilities.join(', ') || '—'}</div>
          </div>
        )}
        {netResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Network</div>
            <div className="text-2xl font-bold text-blue-200">{netResult.nodeCount ?? 0}<span className="text-xs text-zinc-400">/{netResult.edgeCount ?? 0}</span></div>
            <div className="text-[10px] text-zinc-300">nodes/edges · density {netResult.density?.toFixed?.(3) ?? '?'}</div>
            {netResult.clusters && <div className="text-[10px] text-zinc-500">Clusters: {netResult.clusters.count} · coeff {netResult.clusters.avgCoeff.toFixed(2)}</div>}
            {netResult.brokers?.slice(0, 3).map((b, i) => <div key={i} className="text-[10px] text-blue-200 mt-0.5">★ broker {b.id}: {b.betweenness.toFixed(3)}</div>)}
            {netResult.isolatedNodes?.slice(0, 2).map((n, i) => <div key={i} className="text-[10px] text-red-300 mt-0.5">⚠ isolated: {n}</div>)}
          </div>
        )}
        {riskResult && (
          <div className={cn('rounded-md border p-2.5 max-h-44 overflow-y-auto', riskResult.overallRisk === 'high' ? 'border-red-500/40 bg-red-500/10' : riskResult.overallRisk === 'medium' ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold">Risk · {riskResult.overallRisk ?? '?'}</div>
            <div className={cn('text-3xl font-bold', riskResult.overallRisk === 'high' ? 'text-red-300' : riskResult.overallRisk === 'medium' ? 'text-amber-300' : 'text-emerald-300')}>{riskResult.riskScore ?? '?'}</div>
            {riskResult.categories?.slice(0, 4).map((c, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span>{c.name}</span><span className="font-mono">{c.score}</span></div>)}
            {riskResult.topRisks?.slice(0, 3).map((r, i) => <div key={i} className="text-[10px] text-red-300 mt-0.5">⚠ {r}</div>)}
            {riskResult.mitigations?.slice(0, 2).map((m, i) => <div key={i} className="text-[10px] text-amber-200 mt-0.5">→ {m}</div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Alliances director</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
