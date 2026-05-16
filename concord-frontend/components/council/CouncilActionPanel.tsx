'use client';

/**
 * CouncilActionPanel — DAO + IBIS-shape governance workbench. Surfaces
 * deliberate / voteCount / generateMinutes / conflictResolution +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import {
  Gavel, MessagesSquare, Vote, FileText, Scale,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('council', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'deliberate' | 'vote' | 'minutes' | 'resolve' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface DeliberateResult { positions?: Array<{ member: string; position: string; reasoning?: string }>; consensus?: string }
interface VoteResult { yes?: number; no?: number; abstain?: number; passed?: boolean; quorum?: boolean }
interface MinutesResult { summary?: string; decisions?: string[]; actionItems?: Array<{ owner: string; task: string; due?: string }> }
interface ResolveResult { resolution?: string; nextSteps?: string[]; mediator?: string }

export function CouncilActionPanel() {
  const [motionText, setMotionText] = useState('');
  const [members, setMembers] = useState('Alice (chair)\nBob\nCarol\nDave\nEve');
  const [positions, setPositions] = useState('Alice for\nBob for\nCarol against\nDave abstain\nEve for');
  const [conflict, setConflict] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [deliberateResult, setDeliberateResult] = useState<DeliberateResult | null>(null);
  const [voteResult, setVoteResult] = useState<VoteResult | null>(null);
  const [minutesResult, setMinutesResult] = useState<MinutesResult | null>(null);
  const [resolveResult, setResolveResult] = useState<ResolveResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (t: string) => setFeedback({ kind: 'ok', text: t });
  const err = (t: string) => setFeedback({ kind: 'err', text: t });

  function parsePositions() {
    return positions.split('\n').map(l => { const m = l.trim().match(/^(\S+)\s+(for|against|abstain)$/i); return m ? { member: m[1], position: m[2].toLowerCase() } : null; }).filter(Boolean);
  }

  async function actDeliberate() {
    if (!motionText.trim()) { err('Motion required.'); return; }
    setBusy('deliberate'); setFeedback(null);
    try { const r = await callMacro<DeliberateResult>('deliberate', { motion: motionText.trim(), members: members.split('\n').filter(Boolean) }); if (r.ok && r.result) { setDeliberateResult(r.result); ok(`${r.result.positions?.length ?? 0} positions.`); } else err(r.error ?? 'deliberate failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actVote() {
    const pos = parsePositions();
    if (!pos.length) { err('Add positions (name for/against/abstain).'); return; }
    setBusy('vote'); setFeedback(null);
    try { const r = await callMacro<VoteResult>('voteCount', { motion: motionText.trim(), positions: pos }); if (r.ok && r.result) { setVoteResult(r.result); ok(r.result.passed ? 'PASSED.' : 'FAILED.'); } else err(r.error ?? 'vote failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMinutes() {
    if (!motionText.trim()) { err('Motion required.'); return; }
    setBusy('minutes'); setFeedback(null);
    try { const r = await callMacro<MinutesResult>('generateMinutes', { motion: motionText.trim(), positions: parsePositions(), vote: voteResult }); if (r.ok && r.result) { setMinutesResult(r.result); ok(`${r.result.decisions?.length ?? 0} decisions.`); } else err(r.error ?? 'minutes failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actResolve() {
    if (!conflict.trim()) { err('Conflict description required.'); return; }
    setBusy('resolve'); setFeedback(null);
    try { const r = await callMacro<ResolveResult>('conflictResolution', { conflict: conflict.trim(), members: members.split('\n').filter(Boolean) }); if (r.ok && r.result) { setResolveResult(r.result); ok('Resolution drafted.'); } else err(r.error ?? 'resolve failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Council session — ${motionText.trim().slice(0, 60) || 'meeting'}`, tags: ['council', 'governance', voteResult?.passed ? 'passed' : 'pending'], source: 'council:session:mint', meta: { visibility: 'private', consent: { allowCitations: false }, council: { motion: motionText, members: members.split('\n').filter(Boolean), positions: parsePositions(), deliberate: deliberateResult, vote: voteResult, minutes: minutesResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Session DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🏛 Council session: ${motionText}`, '', voteResult ? `Vote: ${voteResult.yes}y / ${voteResult.no}n / ${voteResult.abstain}a → ${voteResult.passed ? 'PASSED' : 'FAILED'}` : '', minutesResult?.summary ? `Summary: ${minutesResult.summary}` : '', minutesResult?.actionItems?.length ? `\nAction items:\n${minutesResult.actionItems.map(a => `  ${a.owner}: ${a.task}${a.due ? ` (${a.due})` : ''}`).join('\n')}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!minutesResult) { err('Generate minutes first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Public minutes — ${motionText.slice(0, 60)}`, tags: ['council', 'minutes', 'public'], source: 'council:minutes:publish', meta: { visibility: 'public', consent: { allowCitations: true }, minutes: { motion: motionText, summary: minutesResult.summary, decisions: minutesResult.decisions, actionItems: minutesResult.actionItems, voteOutcome: voteResult?.passed ? 'passed' : 'failed' } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Minutes published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    if (!motionText.trim()) { err('Motion required.'); return; }
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Council motion: "${motionText}". ${voteResult ? `Vote: ${voteResult.passed ? 'passed' : 'failed'} (${voteResult.yes}/${voteResult.no}/${voteResult.abstain}).` : ''} Draft a 2-sentence call-for-amendment that addresses the dissent without weakening the core proposal. Plain text.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Amendment draft ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'deliberate' as ActionId, label: 'Deliberate', desc: 'deliberate positions + consensus', icon: MessagesSquare, accent: '#06b6d4', handler: actDeliberate },
    { id: 'vote' as ActionId, label: 'Vote', desc: 'voteCount yes/no/abstain', icon: Vote, accent: '#22c55e', handler: actVote },
    { id: 'minutes' as ActionId, label: 'Minutes', desc: 'generateMinutes + action items', icon: FileText, accent: '#8b5cf6', handler: actMinutes },
    { id: 'resolve' as ActionId, label: 'Resolve', desc: 'conflictResolution draft', icon: Scale, accent: '#f97316', handler: actResolve },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private session DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send session brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public minutes DTU + federation', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Amend', desc: 'Agent: 2-sentence amendment', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-amber-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-amber-500/10 pb-2">
        <Gavel className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Council workbench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">DAO · IBIS</span>
      </header>

      <input type="text" value={motionText} onChange={(e) => setMotionText(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Motion text" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Members (one per line)</label><textarea value={members} onChange={(e) => setMembers(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-amber-200 font-mono focus:outline-none focus:ring-2 focus:ring-amber-400/40 resize-none" /></div>
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Positions (name for/against/abstain)</label><textarea value={positions} onChange={(e) => setPositions(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-amber-200 font-mono focus:outline-none focus:ring-2 focus:ring-amber-400/40 resize-none" /></div>
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Conflict description (for resolve)</label><textarea value={conflict} onChange={(e) => setConflict(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-amber-200 font-mono focus:outline-none focus:ring-2 focus:ring-amber-400/40 resize-none" placeholder="What's the disagreement?" /></div>
      </div>

      <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient (chair / secretary)" />

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
              <div className="text-[10px] text-zinc-500 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {deliberateResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5 max-h-40 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Positions</div>
            {deliberateResult.positions?.map((p, i) => <div key={i} className="text-[11px] text-zinc-300"><strong className="text-cyan-200">{p.member}:</strong> <span className="capitalize">{p.position}</span>{p.reasoning && <span className="text-zinc-500"> — {p.reasoning}</span>}</div>)}
            {deliberateResult.consensus && <div className="text-[11px] text-cyan-300 italic mt-1">Consensus: {deliberateResult.consensus}</div>}
          </div>
        )}
        {voteResult && (
          <div className={cn('rounded-md border p-2.5', voteResult.passed ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-rose-500/40 bg-rose-500/5')}>
            <div className={cn('text-[10px] uppercase tracking-wider font-semibold', voteResult.passed ? 'text-emerald-300' : 'text-rose-300')}>Vote {voteResult.passed ? 'PASSED' : 'FAILED'}{!voteResult.quorum && ' (no quorum)'}</div>
            <div className="flex gap-4 mt-1 text-sm">
              <span className="text-emerald-300 font-bold">✓ {voteResult.yes}</span>
              <span className="text-rose-300 font-bold">✗ {voteResult.no}</span>
              <span className="text-zinc-400">— {voteResult.abstain}</span>
            </div>
          </div>
        )}
        {minutesResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-40 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Minutes</div>
            {minutesResult.summary && <p className="text-[11px] text-zinc-300 mt-1">{minutesResult.summary}</p>}
            {minutesResult.decisions?.length ? <ul className="text-[11px] text-zinc-300 list-disc list-inside">{minutesResult.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul> : null}
            {minutesResult.actionItems?.length ? <div className="mt-1 text-[10px] text-purple-300 font-semibold uppercase tracking-wider">Action items</div> : null}
            {minutesResult.actionItems?.map((a, i) => <div key={i} className="text-[11px] text-zinc-300"><strong className="text-purple-200">{a.owner}:</strong> {a.task}{a.due && <span className="text-zinc-500"> · {a.due}</span>}</div>)}
          </div>
        )}
        {resolveResult && (
          <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-orange-300 font-semibold">Resolution</div>
            <p className="text-[11px] text-zinc-300 mt-1">{resolveResult.resolution}</p>
            {resolveResult.nextSteps?.length ? <ol className="text-[11px] text-zinc-300 list-decimal list-inside mt-1">{resolveResult.nextSteps.slice(0, 4).map((s, i) => <li key={i}>{s}</li>)}</ol> : null}
            {resolveResult.mediator && <div className="text-[10px] text-zinc-500">Mediator: {resolveResult.mediator}</div>}
          </div>
        )}
      </div>

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Amendment</div>
          <pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed italic">{agentReply}</pre>
        </div>
      )}

      <AnimatePresence>
        {feedback && (
          <motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }}
            className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>
            {feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}
            <span>{feedback.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
