'use client';

/**
 * InferenceActionPanel — logic bench.
 * forwardChain / backwardChain / unify (3 macros + reset) +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { GitMerge, Target, Link, RefreshCw, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('inference', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T; error?: string } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'forward' | 'backward' | 'unify' | 'reset' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface ForwardResult { initialFactCount: number; derivedFactCount: number; totalFactCount: number; iterations: number; fixedPointReached: boolean; derivedFacts: string[]; factsByPredicate: Record<string, number>; rulesApplied: string[] }
interface BackwardAnswer { [v: string]: string }
interface BackwardResult { goal: string; proved: boolean; answerCount: number; answers: BackwardAnswer[]; proofCount: number; nodesExplored: number }
interface UnifyResult { unified?: boolean; mgu?: Record<string, unknown>; steps?: number; explanation?: string; unifiedTerm?: string }

const DEFAULT_FACTS = JSON.stringify({ facts: [{ predicate: 'parent', args: ['alice', 'bob'] }, { predicate: 'parent', args: ['bob', 'carol'] }, { predicate: 'parent', args: ['carol', 'dan'] }, { predicate: 'male', args: ['bob'] }], rules: [{ name: 'grandparent', if: [{ predicate: 'parent', args: ['?X', '?Y'] }, { predicate: 'parent', args: ['?Y', '?Z'] }], then: { predicate: 'grandparent', args: ['?X', '?Z'] } }, { name: 'ancestor1', if: [{ predicate: 'parent', args: ['?X', '?Y'] }], then: { predicate: 'ancestor', args: ['?X', '?Y'] } }, { name: 'ancestor2', if: [{ predicate: 'ancestor', args: ['?X', '?Y'] }, { predicate: 'parent', args: ['?Y', '?Z'] }], then: { predicate: 'ancestor', args: ['?X', '?Z'] } }] }, null, 2);
const DEFAULT_GOAL = JSON.stringify({ facts: [{ predicate: 'parent', args: ['alice', 'bob'] }, { predicate: 'parent', args: ['bob', 'carol'] }, { predicate: 'parent', args: ['carol', 'dan'] }], rules: [{ name: 'ancestor1', if: [{ predicate: 'parent', args: ['?X', '?Y'] }], then: { predicate: 'ancestor', args: ['?X', '?Y'] } }, { name: 'ancestor2', if: [{ predicate: 'ancestor', args: ['?X', '?Y'] }, { predicate: 'parent', args: ['?Y', '?Z'] }], then: { predicate: 'ancestor', args: ['?X', '?Z'] } }], goal: { predicate: 'ancestor', args: ['alice', '?Who'] } }, null, 2);
const DEFAULT_UNIFY = JSON.stringify({ term1: { functor: 'f', args: ['?X', 'b', '?Y'] }, term2: { functor: 'f', args: ['a', '?Z', '?Y'] } }, null, 2);

export function InferenceActionPanel() {
  const [factsText, setFactsText] = useState(DEFAULT_FACTS);
  const [goalText, setGoalText] = useState(DEFAULT_GOAL);
  const [unifyText, setUnifyText] = useState(DEFAULT_UNIFY);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [forwardResult, setForwardResult] = useState<ForwardResult | null>(null);
  const [backwardResult, setBackwardResult] = useState<BackwardResult | null>(null);
  const [unifyResult, setUnifyResult] = useState<UnifyResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actForward() {
    try { const parsed = JSON.parse(factsText); setBusy('forward'); setFeedback(null);
      const r = await callMacro<ForwardResult>('forwardChain', { artifact: { data: parsed } });
      if (r.ok && r.result) { setForwardResult(r.result); ok(`${r.result.derivedFactCount} derived in ${r.result.iterations} iters · ${r.result.fixedPointReached ? 'fixed-point' : 'iter-cap'}`); } else err(r.error ?? 'forward failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid facts JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actBackward() {
    try { const parsed = JSON.parse(goalText); setBusy('backward'); setFeedback(null);
      const r = await callMacro<BackwardResult>('backwardChain', { artifact: { data: parsed } });
      if (r.ok && r.result) { setBackwardResult(r.result); ok(r.result.proved ? `Proved · ${r.result.answerCount} answers` : 'Not proved'); } else err(r.error ?? 'backward failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid goal JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actUnify() {
    try { const parsed = JSON.parse(unifyText); setBusy('unify'); setFeedback(null);
      const r = await callMacro<UnifyResult>('unify', { artifact: { data: parsed } });
      if (r.ok && r.result) { setUnifyResult(r.result); ok(r.result.unified ? `Unifiable in ${r.result.steps} steps` : 'Not unifiable'); } else err(r.error ?? 'unify failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid unify JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actReset() {
    setForwardResult(null); setBackwardResult(null); setUnifyResult(null); setMintedDtuId(null); setPublishedDtuId(null); setAgentReply(null); ok('Cleared.');
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Inference trace`, tags: ['inference', forwardResult?.fixedPointReached ? 'fixed-point' : 'iter-cap', backwardResult?.proved ? 'proved' : 'unproved'].filter((t): t is string => !!t), source: 'inference:trace:mint', meta: { visibility: 'private', consent: { allowCitations: false }, inference: { forward: forwardResult, backward: backwardResult, unify: unifyResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Trace DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🧠 Inference run`, '', forwardResult ? `Forward: ${forwardResult.totalFactCount} facts (${forwardResult.derivedFactCount} derived) in ${forwardResult.iterations} iters` : '', backwardResult ? `Backward: ${backwardResult.goal} · ${backwardResult.proved ? 'PROVED' : 'unproved'} · ${backwardResult.answerCount} answers, ${backwardResult.nodesExplored} nodes` : '', unifyResult ? `Unify: ${unifyResult.unified ? 'YES' : 'NO'}${unifyResult.steps ? ` (${unifyResult.steps} steps)` : ''}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!forwardResult && !backwardResult) { err('Run a chain first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Inference example`, tags: ['inference', 'logic', 'public'], source: 'inference:example:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, inference: { forward: forwardResult, backward: backwardResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Logic teacher brief. ${forwardResult ? `Forward chain produced ${forwardResult.derivedFactCount} new facts over ${forwardResult.iterations} iterations (${forwardResult.fixedPointReached ? 'reached fixed point' : 'hit iter cap'}). Rules fired: ${forwardResult.rulesApplied.join(', ') || 'none'}.` : ''} ${backwardResult ? `Backward proved goal ${backwardResult.goal}? ${backwardResult.proved}. ${backwardResult.answerCount} answer substitution(s).` : ''} ${unifyResult ? `Unification ${unifyResult.unified ? 'succeeded' : 'failed'} in ${unifyResult.steps ?? '?'} steps.` : ''} Explain the most-important insight from this run in plain language + suggest one rule to add. ≤ 3 sentences.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Teacher brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'forward' as ActionId, label: 'Forward', desc: 'forwardChain (closure)', icon: GitMerge, accent: '#3b82f6', handler: actForward },
    { id: 'backward' as ActionId, label: 'Backward', desc: 'backwardChain (goal)', icon: Target, accent: '#22c55e', handler: actBackward },
    { id: 'unify' as ActionId, label: 'Unify', desc: 'unify (MGU)', icon: Link, accent: '#a855f7', handler: actUnify },
    { id: 'reset' as ActionId, label: 'Reset', desc: 'Clear all results', icon: RefreshCw, accent: '#71717a', handler: actReset },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private trace', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send run', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public example', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Teach', desc: 'Agent: insight+rule', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-indigo-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-indigo-500/10 pb-2">
        <GitMerge className="h-4 w-4 text-indigo-400" />
        <h3 className="text-sm font-semibold text-white">Inference bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">forward · backward · unify</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Facts + Rules JSON</label>
          <textarea value={factsText} onChange={(e) => setFactsText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Goal JSON</label>
          <textarea value={goalText} onChange={(e) => setGoalText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Unify terms JSON</label>
          <textarea value={unifyText} onChange={(e) => setUnifyText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {forwardResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Forward · {forwardResult.fixedPointReached ? 'fixed-point' : 'iter-cap'}</div>
            <div className="text-2xl font-bold text-blue-200">{forwardResult.totalFactCount} <span className="text-xs text-zinc-400">facts</span></div>
            <div className="text-[10px] text-zinc-300">{forwardResult.derivedFactCount} derived in {forwardResult.iterations} iters</div>
            <div className="text-[10px] text-zinc-500">Rules: {forwardResult.rulesApplied.join(', ') || 'none'}</div>
            <div className="text-[10px] text-zinc-400 mt-1">Predicates: {Object.entries(forwardResult.factsByPredicate).map(([p, c]) => `${p}/${c}`).join(' · ')}</div>
            {forwardResult.derivedFacts.slice(0, 6).map((f, i) => <div key={i} className="text-[10px] text-blue-200 mt-0.5 font-mono">→ {f}</div>)}
          </div>
        )}
        {backwardResult && (
          <div className={cn('rounded-md border p-2.5 max-h-44 overflow-y-auto', backwardResult.proved ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Backward · {backwardResult.proved ? 'PROVED' : 'NOT PROVED'}</div>
            <div className="text-[10px] font-mono text-zinc-200 mt-1">{backwardResult.goal}</div>
            <div className="text-[10px] text-zinc-500 mt-1">{backwardResult.answerCount} answers · {backwardResult.proofCount} proofs · {backwardResult.nodesExplored} nodes</div>
            {backwardResult.answers.slice(0, 6).map((a, i) => <div key={i} className="text-[10px] text-green-200 mt-0.5 font-mono">{Object.entries(a).map(([v, x]) => `${v}=${x}`).join(', ')}</div>)}
          </div>
        )}
        {unifyResult && (
          <div className={cn('rounded-md border p-2.5 max-h-44 overflow-y-auto', unifyResult.unified ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Unify · {unifyResult.unified ? 'YES' : 'NO'}</div>
            <div className={cn('text-xl font-bold', unifyResult.unified ? 'text-emerald-300' : 'text-red-300')}>{unifyResult.unified ? 'Unifiable' : 'Not unifiable'}</div>
            {unifyResult.steps !== undefined && <div className="text-[10px] text-zinc-500">{unifyResult.steps} steps</div>}
            {unifyResult.unifiedTerm && <div className="text-[10px] text-purple-200 font-mono mt-1">= {unifyResult.unifiedTerm}</div>}
            {unifyResult.mgu && Object.entries(unifyResult.mgu).slice(0, 6).map(([v, x], i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 font-mono">{v} ↦ {String(typeof x === 'string' ? x : JSON.stringify(x))}</div>)}
            {unifyResult.explanation && <div className="text-[10px] text-zinc-400 mt-1 italic">{unifyResult.explanation}</div>}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Logic teacher</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
