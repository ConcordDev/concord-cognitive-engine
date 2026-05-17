'use client';

/**
 * CollabActionPanel — team facilitator bench.
 * sessionAnalytics / contributionScore / detectConsensus / balanceWorkload +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Users, Trophy, Vote, Scale, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('collab', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'session' | 'contrib' | 'consensus' | 'load' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface PStat { name: string; messages: number; wordCount: number; avgWordsPerMessage: number; sharePercent: number }
interface SessionResult { totalMessages: number; totalParticipants: number; durationMinutes: number; messagesPerMinute: number; participantStats: PStat[]; participationBalance: number; balanceRating: string }
interface Rank { name: string; totalScore: number; contributions: number }
interface ContribResult { rankings: Rank[]; totalContributions: number; topContributor: string }
interface ConsResult { totalVotes: number; tally: Record<string, number>; leadingPosition: string; consensusPercent: number; hasConsensus: boolean; hasSupermajority: boolean; status: string; dissenting?: { position: string; count: number; percent: number }[] }
interface MemberLoad { name: string; assignedTasks: number; totalHours: number; capacity: number; utilization: number; status: string }
interface LoadResult { members: MemberLoad[]; unassignedTasks: number; overloadedMembers: number; suggestions: string[]; avgUtilization: number }

const DEMO_SESSION = JSON.stringify({
  durationMinutes: 45,
  participants: ['Maya', 'Sam', 'Alex', 'Jordan'],
  messages: [
    { author: 'Maya', content: 'OK let us start with the roadmap.' },
    { author: 'Sam', content: 'I agree, Q3 has too much in flight.' },
    { author: 'Maya', content: 'We could cut two features.' },
    { author: 'Alex', content: 'Which two?' },
    { author: 'Maya', content: 'Search and notifications.' },
    { author: 'Sam', content: 'Notifications is critical though.' },
    { author: 'Jordan', content: '+1 on cutting search, agree on keeping notifications' },
    { author: 'Maya', content: 'Fine, just search then.' },
  ],
}, null, 2);

const DEMO_CONTRIBS = JSON.stringify({
  contributions: [
    { name: 'Maya', type: 'code', quality: 0.9, count: 12 },
    { name: 'Maya', type: 'review', quality: 0.85, count: 18 },
    { name: 'Sam', type: 'design', quality: 0.95, count: 8 },
    { name: 'Alex', type: 'code', quality: 0.75, count: 6 },
    { name: 'Alex', type: 'discussion', quality: 0.8, count: 15 },
    { name: 'Jordan', type: 'document', quality: 0.9, count: 4 },
  ],
}, null, 2);

const DEMO_VOTES = JSON.stringify({
  votes: [
    { voter: 'Maya', position: 'cut search' }, { voter: 'Sam', position: 'cut search' },
    { voter: 'Jordan', position: 'cut search' }, { voter: 'Alex', position: 'keep both' },
    { voter: 'Casey', position: 'cut search' }, { voter: 'Riley', position: 'cut search' },
  ],
}, null, 2);

const DEMO_LOAD = JSON.stringify({
  members: [
    { name: 'Maya', capacityHours: 40 }, { name: 'Sam', capacityHours: 40 },
    { name: 'Alex', capacityHours: 40 }, { name: 'Jordan', capacityHours: 40 },
  ],
  tasks: [
    { assignee: 'Maya', hours: 18 }, { assignee: 'Maya', hours: 14 }, { assignee: 'Maya', hours: 12 },
    { assignee: 'Sam', hours: 22 }, { assignee: 'Alex', hours: 8 },
    { assignee: 'Jordan', hours: 30 }, { hours: 6 }, { hours: 10 },
  ],
}, null, 2);

export function CollabActionPanel() {
  const [sessionText, setSessionText] = useState(DEMO_SESSION);
  const [contribText, setContribText] = useState(DEMO_CONTRIBS);
  const [votesText, setVotesText] = useState(DEMO_VOTES);
  const [loadText, setLoadText] = useState(DEMO_LOAD);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [sessionResult, setSessionResult] = useState<SessionResult | null>(null);
  const [contribResult, setContribResult] = useState<ContribResult | null>(null);
  const [consResult, setConsResult] = useState<ConsResult | null>(null);
  const [loadResult, setLoadResult] = useState<LoadResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actSession() {
    try { const parsed = JSON.parse(sessionText); setBusy('session'); setFeedback(null);
      const r = await callMacro<SessionResult>('sessionAnalytics', { artifact: { data: parsed } }); if (r.ok && r.result) { setSessionResult(r.result); ok(`${r.result.balanceRating} · Gini ${r.result.participationBalance}.`); } else err(r.error ?? 'session failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid session JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actContrib() {
    try { const parsed = JSON.parse(contribText); setBusy('contrib'); setFeedback(null);
      const r = await callMacro<ContribResult>('contributionScore', { artifact: { data: parsed } }); if (r.ok && r.result) { setContribResult(r.result); ok(`Top: ${r.result.topContributor}.`); } else err(r.error ?? 'contrib failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid contrib JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actConsensus() {
    try { const parsed = JSON.parse(votesText); setBusy('consensus'); setFeedback(null);
      const r = await callMacro<ConsResult>('detectConsensus', { artifact: { data: parsed } }); if (r.ok && r.result) { setConsResult(r.result); ok(`${r.result.status} · ${r.result.consensusPercent}%.`); } else err(r.error ?? 'consensus failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid votes JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actLoad() {
    try { const parsed = JSON.parse(loadText); setBusy('load'); setFeedback(null);
      const r = await callMacro<LoadResult>('balanceWorkload', { artifact: { data: parsed } }); if (r.ok && r.result) { setLoadResult(r.result); ok(`${r.result.overloadedMembers} overloaded · avg ${r.result.avgUtilization}%.`); } else err(r.error ?? 'load failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid load JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Team session`, tags: ['collab', 'team', sessionResult?.balanceRating].filter((t): t is string => !!t), source: 'collab:team:mint', meta: { visibility: 'private', consent: { allowCitations: false }, team: { session: sessionResult, contrib: contribResult, cons: consResult, load: loadResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Team DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`👥 Team brief`, '', sessionResult ? `Session: ${sessionResult.totalMessages} msgs / ${sessionResult.totalParticipants} ppl · ${sessionResult.balanceRating} (Gini ${sessionResult.participationBalance})` : '', contribResult ? `Top contributor: ${contribResult.topContributor} · ${contribResult.rankings[0]?.totalScore} pts` : '', consResult ? `Vote: ${consResult.leadingPosition} (${consResult.consensusPercent}%) · ${consResult.status}` : '', loadResult ? `Workload: ${loadResult.overloadedMembers} overloaded · avg ${loadResult.avgUtilization}%${loadResult.suggestions[0] ? ` · ${loadResult.suggestions[0]}` : ''}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!sessionResult) { err('Run session first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Team health card`, tags: ['collab', 'team', 'public'], source: 'collab:health:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, session: sessionResult, contrib: contribResult } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Team facilitator brief. ${sessionResult ? `Session balance: ${sessionResult.balanceRating} (Gini ${sessionResult.participationBalance}, ${sessionResult.totalMessages} msgs across ${sessionResult.totalParticipants} ppl).` : ''} ${contribResult ? `Top contributor: ${contribResult.topContributor}.` : ''} ${consResult ? `${consResult.status}.` : ''} ${loadResult ? `${loadResult.overloadedMembers} overloaded teammates.` : ''} Identify single most important facilitation move + one structural change. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'session' as ActionId, label: 'Session', desc: 'sessionAnalytics + Gini', icon: Users, accent: '#3b82f6', handler: actSession },
    { id: 'contrib' as ActionId, label: 'Score', desc: 'contributionScore', icon: Trophy, accent: '#f59e0b', handler: actContrib },
    { id: 'consensus' as ActionId, label: 'Consensus', desc: 'detectConsensus', icon: Vote, accent: '#22c55e', handler: actConsensus },
    { id: 'load' as ActionId, label: 'Workload', desc: 'balanceWorkload', icon: Scale, accent: '#a855f7', handler: actLoad },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private team DTU', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send team brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon health card', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Facilitate', desc: 'Agent: next move', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const BALANCE_COLOR: Record<string, string> = { 'well-balanced': 'text-emerald-300', 'slightly-uneven': 'text-amber-300', 'dominated-by-few': 'text-red-300' };

  return (
    <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-cyan-500/10 pb-2">
        <Users className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">Team facilitator</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">session · contrib · consensus · load</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Session JSON</label>
          <textarea value={sessionText} onChange={(e) => setSessionText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Contributions JSON</label>
          <textarea value={contribText} onChange={(e) => setContribText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Votes JSON</label>
          <textarea value={votesText} onChange={(e) => setVotesText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Workload JSON</label>
          <textarea value={loadText} onChange={(e) => setLoadText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient" />
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
        {sessionResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Session · {sessionResult.balanceRating}</div>
            <div className={cn('text-2xl font-bold', BALANCE_COLOR[sessionResult.balanceRating])}>{sessionResult.totalMessages}<span className="text-xs text-zinc-400"> msgs</span></div>
            <div className="text-[10px] text-zinc-500">Gini {sessionResult.participationBalance} · {sessionResult.messagesPerMinute}/min</div>
            {sessionResult.participantStats.slice(0, 4).map((p, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex items-center gap-2"><span className="font-mono w-12">{p.name}</span><div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden"><div className="h-full bg-blue-400" style={{ width: `${p.sharePercent}%` }} /></div><span className="font-mono text-blue-200">{p.sharePercent}%</span></div>)}
          </div>
        )}
        {contribResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Contribution · top: {contribResult.topContributor}</div>
            <div className="text-[10px] text-zinc-500">{contribResult.totalContributions} contributions</div>
            {contribResult.rankings.slice(0, 5).map((r, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5">{i + 1}. <strong>{r.name}</strong> · <span className="font-mono text-amber-200">{r.totalScore}</span> pts ({r.contributions})</div>)}
          </div>
        )}
        {consResult && (
          <div className={cn('rounded-md border p-2.5', consResult.hasSupermajority ? 'border-emerald-500/30 bg-emerald-500/5' : consResult.hasConsensus ? 'border-blue-500/30 bg-blue-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Vote · {consResult.status}</div>
            <div className={cn('text-2xl font-bold', consResult.hasSupermajority ? 'text-emerald-300' : consResult.hasConsensus ? 'text-blue-300' : 'text-amber-300')}>{consResult.consensusPercent}%</div>
            <div className="text-[10px] text-zinc-200">{consResult.leadingPosition}</div>
            {(consResult.dissenting ?? []).slice(0, 3).map((d, i) => <div key={i} className="text-[10px] text-zinc-500 mt-0.5">{d.position}: {d.count} ({d.percent}%)</div>)}
          </div>
        )}
        {loadResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Workload · avg {loadResult.avgUtilization}%</div>
            <div className="text-[10px] text-red-300">{loadResult.overloadedMembers} overloaded · {loadResult.unassignedTasks} unassigned</div>
            {loadResult.members.slice(0, 5).map((m, i) => <div key={i} className={cn('text-[10px] mt-0.5 flex items-center gap-2', m.status === 'overloaded' ? 'text-red-300' : m.status === 'near-capacity' ? 'text-amber-300' : 'text-zinc-300')}><span className="font-mono w-12">{m.name}</span><div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden"><div className="h-full" style={{ width: `${Math.min(100, m.utilization)}%`, backgroundColor: m.status === 'overloaded' ? '#f87171' : m.status === 'near-capacity' ? '#fbbf24' : '#a78bfa' }} /></div><span className="font-mono">{m.utilization}%</span></div>)}
            {loadResult.suggestions.map((s, i) => <div key={i} className="text-[10px] text-purple-200 mt-0.5">→ {s}</div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Facilitator move</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
