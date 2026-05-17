'use client';

/**
 * OrganActionPanel — org-design bench.
 * orgChart / teamComposition / communicationFlow +
 * mint/DM/publish/agent (4th slot = reset).
 */

import { useState } from 'react';
import { Building, Users, Network, RefreshCw, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, payload: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('organ', action, payload);
  const data = (r as { data?: { ok: boolean; result?: T; error?: string } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'org' | 'team' | 'comm' | 'reset' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface OrgResult { rootCount?: number; totalHeadcount?: number; maxDepth?: number; spanByLevel?: Record<string, number>; widestLevel?: number; layers?: { level: number; count: number }[]; deepestPath?: string[] }
interface TeamResult { teamSize?: number; roleDistribution?: Record<string, number>; seniorityMix?: Record<string, number>; diversity?: { gender?: number; tenure?: number }; healthScore?: number; gaps?: string[]; redundancies?: string[] }
interface CommResult { totalEdges?: number; avgConnections?: number; siloRisk?: string; isolatedNodes?: string[]; brokers?: { node: string; betweenness: number }[]; densityScore?: number }

const DEFAULT_ORG = JSON.stringify({ employees: [{ id: 'e1', name: 'Alice', title: 'CEO', manager: null }, { id: 'e2', name: 'Bob', title: 'CTO', manager: 'e1' }, { id: 'e3', name: 'Carol', title: 'VP Eng', manager: 'e2' }, { id: 'e4', name: 'Dave', title: 'Eng', manager: 'e3' }, { id: 'e5', name: 'Eve', title: 'Eng', manager: 'e3' }, { id: 'e6', name: 'Frank', title: 'CFO', manager: 'e1' }, { id: 'e7', name: 'Grace', title: 'Acct', manager: 'e6' }, { id: 'e8', name: 'Heidi', title: 'CMO', manager: 'e1' }, { id: 'e9', name: 'Ivan', title: 'Marketer', manager: 'e8' }] }, null, 2);
const DEFAULT_TEAM = JSON.stringify({ members: [{ id: 'm1', role: 'eng', seniority: 'senior', tenureYears: 4, gender: 'F' }, { id: 'm2', role: 'eng', seniority: 'junior', tenureYears: 1, gender: 'M' }, { id: 'm3', role: 'pm', seniority: 'senior', tenureYears: 6, gender: 'F' }, { id: 'm4', role: 'design', seniority: 'mid', tenureYears: 3, gender: 'NB' }, { id: 'm5', role: 'eng', seniority: 'mid', tenureYears: 2, gender: 'M' }, { id: 'm6', role: 'eng', seniority: 'senior', tenureYears: 7, gender: 'M' }] }, null, 2);
const DEFAULT_COMM = JSON.stringify({ edges: [{ from: 'a', to: 'b', weight: 10 }, { from: 'a', to: 'c', weight: 8 }, { from: 'b', to: 'c', weight: 12 }, { from: 'b', to: 'd', weight: 4 }, { from: 'c', to: 'd', weight: 6 }, { from: 'e', to: 'f', weight: 14 }, { from: 'd', to: 'e', weight: 2 }], nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }, { id: 'f' }, { id: 'g' }] }, null, 2);

export function OrganActionPanel() {
  const [orgText, setOrgText] = useState(DEFAULT_ORG);
  const [teamText, setTeamText] = useState(DEFAULT_TEAM);
  const [commText, setCommText] = useState(DEFAULT_COMM);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [orgResult, setOrgResult] = useState<OrgResult | null>(null);
  const [teamResult, setTeamResult] = useState<TeamResult | null>(null);
  const [commResult, setCommResult] = useState<CommResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actOrg() {
    try { const parsed = JSON.parse(orgText); setBusy('org'); setFeedback(null);
      const r = await callMacro<OrgResult>('orgChart', { artifact: { data: parsed } });
      if (r.ok && r.result) { setOrgResult(r.result); ok(`Depth ${r.result.maxDepth ?? '?'} · ${r.result.totalHeadcount ?? '?'} HC`); } else err(r.error ?? 'org failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid org JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actTeam() {
    try { const parsed = JSON.parse(teamText); setBusy('team'); setFeedback(null);
      const r = await callMacro<TeamResult>('teamComposition', { artifact: { data: parsed } });
      if (r.ok && r.result) { setTeamResult(r.result); ok(`Health ${r.result.healthScore ?? '?'}/100`); } else err(r.error ?? 'team failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid team JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actComm() {
    try { const parsed = JSON.parse(commText); setBusy('comm'); setFeedback(null);
      const r = await callMacro<CommResult>('communicationFlow', { artifact: { data: parsed } });
      if (r.ok && r.result) { setCommResult(r.result); ok(`${r.result.totalEdges ?? 0} edges · silo ${r.result.siloRisk ?? '?'}`); } else err(r.error ?? 'comm failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid comm JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  function actReset() { setOrgResult(null); setTeamResult(null); setCommResult(null); setMintedDtuId(null); setPublishedDtuId(null); setAgentReply(null); ok('Cleared.'); }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Org snapshot`, tags: ['organ', commResult?.siloRisk].filter((t): t is string => !!t), source: 'organ:snapshot:mint', meta: { visibility: 'private', consent: { allowCitations: false }, organ: { org: orgResult, team: teamResult, comm: commResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Snapshot DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🏛 Org snapshot`, '', orgResult ? `Org: ${orgResult.totalHeadcount ?? '?'} HC · depth ${orgResult.maxDepth ?? '?'} · widest layer L${orgResult.widestLevel ?? '?'} (${orgResult.widestLevel !== undefined && orgResult.spanByLevel?.[String(orgResult.widestLevel)]} people)` : '', teamResult ? `Team: ${teamResult.teamSize ?? '?'} people · health ${teamResult.healthScore ?? '?'}/100${teamResult.gaps?.length ? ` · gaps: ${teamResult.gaps.slice(0, 2).join(', ')}` : ''}` : '', commResult ? `Comm: ${commResult.totalEdges ?? 0} edges · silo risk ${commResult.siloRisk ?? '?'}${commResult.isolatedNodes?.length ? ` · isolated: ${commResult.isolatedNodes.slice(0, 3).join(', ')}` : ''}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!orgResult && !commResult) { err('Org or comm first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Org design`, tags: ['organ', 'design', 'public'], source: 'organ:design:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, organ: { org: orgResult, team: teamResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Org design advisor brief. ${orgResult ? `Org: ${orgResult.totalHeadcount ?? '?'} HC; depth ${orgResult.maxDepth}; widest level L${orgResult.widestLevel}.` : ''} ${teamResult ? `Team: ${teamResult.teamSize ?? '?'} people, health ${teamResult.healthScore ?? '?'}/100; gaps: ${teamResult.gaps?.slice(0, 2).join(', ') ?? 'none'}.` : ''} ${commResult ? `Comm: silo risk ${commResult.siloRisk ?? '?'}; brokers: ${commResult.brokers?.slice(0, 2).map(b => b.node).join(', ') ?? 'none'}.` : ''} Recommend the top structural change + one ritual to add. Plain text, ≤ 3 sentences.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Advisor brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'org' as ActionId, label: 'Org chart', desc: 'orgChart', icon: Building, accent: '#3b82f6', handler: actOrg },
    { id: 'team' as ActionId, label: 'Team', desc: 'teamComposition', icon: Users, accent: '#22c55e', handler: actTeam },
    { id: 'comm' as ActionId, label: 'Comm', desc: 'communicationFlow', icon: Network, accent: '#a855f7', handler: actComm },
    { id: 'reset' as ActionId, label: 'Reset', desc: 'Clear results', icon: RefreshCw, accent: '#71717a', handler: actReset },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private snapshot', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send snapshot', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon design', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Advisor', desc: 'Agent: structural fix', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const SILO_COLOR: Record<string, string> = { low: 'text-emerald-300', moderate: 'text-amber-300', high: 'text-red-300' };

  return (
    <div className="rounded-lg border border-blue-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-blue-500/10 pb-2">
        <Building className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">Org design bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">chart · team · comm</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Employees JSON</label>
          <textarea value={orgText} onChange={(e) => setOrgText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Team JSON</label>
          <textarea value={teamText} onChange={(e) => setTeamText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Comm edges JSON</label>
          <textarea value={commText} onChange={(e) => setCommText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
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
        {orgResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Org</div>
            <div className="text-2xl font-bold text-blue-200">{orgResult.totalHeadcount ?? '?'}<span className="text-xs text-zinc-400"> HC</span></div>
            <div className="text-[10px] text-zinc-300">Depth {orgResult.maxDepth} · roots {orgResult.rootCount ?? '?'}</div>
            <div className="text-[10px] text-zinc-500 mt-1">Span per level:</div>
            {orgResult.layers?.slice(0, 6).map((l, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex items-center gap-2"><span className="font-mono w-8">L{l.level}</span><div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden"><div className="h-full bg-blue-400" style={{ width: `${Math.min(100, (l.count / Math.max(1, orgResult.totalHeadcount ?? 1)) * 100)}%` }} /></div><span className="font-mono text-blue-200">{l.count}</span></div>)}
          </div>
        )}
        {teamResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Team</div>
            <div className={cn('text-3xl font-bold', (teamResult.healthScore ?? 0) >= 70 ? 'text-emerald-300' : (teamResult.healthScore ?? 0) >= 40 ? 'text-amber-300' : 'text-red-300')}>{teamResult.healthScore ?? '?'}<span className="text-xs text-zinc-400">/100</span></div>
            <div className="text-[10px] text-zinc-300">{teamResult.teamSize ?? '?'} members</div>
            {teamResult.roleDistribution && <div className="text-[10px] text-zinc-500 mt-1">{Object.entries(teamResult.roleDistribution).map(([k, v]) => `${k}:${v}`).join(' · ')}</div>}
            {teamResult.gaps?.slice(0, 3).map((g, i) => <div key={i} className="text-[10px] text-red-300 mt-0.5">⚠ gap: {g}</div>)}
            {teamResult.redundancies?.slice(0, 2).map((r, i) => <div key={i} className="text-[10px] text-amber-200 mt-0.5">• {r}</div>)}
          </div>
        )}
        {commResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Comm · silo {commResult.siloRisk ?? '?'}</div>
            <div className={cn('text-2xl font-bold', SILO_COLOR[commResult.siloRisk ?? 'moderate'])}>{commResult.totalEdges ?? 0}</div>
            <div className="text-[10px] text-zinc-300">edges · avg {commResult.avgConnections?.toFixed?.(2) ?? '?'}</div>
            <div className="text-[10px] text-zinc-500">Density {commResult.densityScore?.toFixed?.(3) ?? '?'}</div>
            {commResult.brokers?.slice(0, 3).map((b, i) => <div key={i} className="text-[10px] text-purple-200 mt-0.5">★ broker {b.node}: {b.betweenness.toFixed(2)}</div>)}
            {commResult.isolatedNodes?.slice(0, 3).map((n, i) => <div key={i} className="text-[10px] text-red-300 mt-0.5">⚠ isolated: {n}</div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Org advisor</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
