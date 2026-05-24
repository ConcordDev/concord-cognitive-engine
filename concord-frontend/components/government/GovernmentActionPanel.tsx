'use client';

/**
 * GovernmentActionPanel — GovTrack + USAspending-shape civic
 * workbench. Surfaces representatives-find / bills-list / permitTimeline
 * / violationEscalation + mint/DM/publish/agent.
 */

import { useState } from 'react';
import {
  Landmark, Users, FileSearch, AlertOctagon, FileBadge,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('government', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'reps' | 'bills' | 'permit' | 'violation' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface Rep { name: string; office?: string; party?: string; phone?: string }
interface Bill { id: string; title: string; status?: string; sponsor?: string }
interface PermitResult { phases?: Array<{ name: string; weeks: number; status: string }>; estimatedWeeks?: number }
interface ViolationResult { tier?: string; escalated?: boolean; nextStep?: string }

export function GovernmentActionPanel() {
  const [zip, setZip] = useState('');
  const [billQuery, setBillQuery] = useState('');
  const [permitType, setPermitType] = useState<'building' | 'business' | 'zoning' | 'environmental'>('building');
  const [violationSeverity, setViolationSeverity] = useState<'minor' | 'moderate' | 'severe'>('moderate');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [reps, setReps] = useState<Rep[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [permitResult, setPermitResult] = useState<PermitResult | null>(null);
  const [violationResult, setViolationResult] = useState<ViolationResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (t: string) => setFeedback({ kind: 'ok', text: t });
  const err = (t: string) => setFeedback({ kind: 'err', text: t });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actReps() {
    if (zip.length !== 5) { err('5-digit ZIP required.'); return; }
    setBusy('reps'); setFeedback(null);
    try {
      const r = await callMacro<{ representatives?: Rep[] }>('representatives-find', { zip });
      if (r.ok && r.result?.representatives) { setReps(r.result.representatives); pipe.publish('gov.reps', r.result, { label: `${r.result.representatives.length} reps` }); ok(`${r.result.representatives.length} reps.`); } else err(r.error ?? 'reps failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actBills() {
    if (!billQuery.trim()) { err('Query required.'); return; }
    setBusy('bills'); setFeedback(null);
    try {
      const r = await callMacro<{ bills?: Bill[] }>('bills-list', { query: billQuery.trim(), limit: 10 });
      if (r.ok && r.result?.bills) { setBills(r.result.bills); pipe.publish('gov.bills', r.result, { label: `${r.result.bills.length} bills` }); ok(`${r.result.bills.length} bills.`); } else err(r.error ?? 'bills failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPermit() {
    setBusy('permit'); setFeedback(null);
    try {
      const r = await callMacro<PermitResult>('permitTimeline', { permitType });
      if (r.ok && r.result) { setPermitResult(r.result); pipe.publish('gov.permit', r.result, { label: `Permit ${r.result.estimatedWeeks}w` }); ok(`~${r.result.estimatedWeeks} weeks.`); } else err(r.error ?? 'permit failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actViolation() {
    setBusy('violation'); setFeedback(null);
    try {
      const r = await callMacro<ViolationResult>('violationEscalation', { severity: violationSeverity });
      if (r.ok && r.result) { setViolationResult(r.result); pipe.publish('gov.violation', r.result, { label: `Tier ${r.result.tier}` }); ok(`Tier: ${r.result.tier}.`); } else err(r.error ?? 'violation failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Civic — ZIP ${zip}`, tags: ['government', 'civic', `zip:${zip}`], source: 'government:civic:mint', meta: { visibility: 'private', consent: { allowCitations: false }, civic: { zip, reps, bills, permit: permitResult, violation: violationResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('gov.mintedDtuId', id, { label: `Civic DTU ${id.slice(0, 8)}…` }); ok(`Civic DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🏛 Civic brief — ZIP ${zip}`, '',
      reps.length ? `Reps: ${reps.slice(0, 3).map(r => r.name).join(', ')}` : '',
      bills.length ? `Bills tracking "${billQuery}": ${bills.length}` : '',
      permitResult ? `Permit timeline: ~${permitResult.estimatedWeeks} weeks` : '',
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
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Public civic guide — ZIP ${zip}`, tags: ['government', 'civic', 'public', `zip:${zip}`], source: 'government:guide:publish', meta: { visibility: 'public', consent: { allowCitations: true }, guide: { zip, repCount: reps.length, billTopic: billQuery, billCount: bills.length, permitEstimate: permitResult?.estimatedWeeks } } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('gov.publishedDtuId', id, { label: `Public guide ${id.slice(0, 8)}…` }); ok(`Guide published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Civic context: ZIP ${zip}, ${reps.length} reps known, tracking "${billQuery}" (${bills.length} bills). ${permitResult ? `Permit timeline ~${permitResult.estimatedWeeks}w.` : ''} Draft a 3-line constituent letter advocating for action on the top relevant bill. Plain text.`;
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Letter draft ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'reps' as ActionId, label: 'Reps', desc: 'representatives-find by ZIP', icon: Users, accent: '#06b6d4', handler: actReps },
    { id: 'bills' as ActionId, label: 'Bills', desc: 'bills-list by query', icon: FileSearch, accent: '#8b5cf6', handler: actBills },
    { id: 'permit' as ActionId, label: 'Permit', desc: 'permitTimeline by type', icon: FileBadge, accent: '#22c55e', handler: actPermit },
    { id: 'violation' as ActionId, label: 'Violation', desc: 'violationEscalation tier', icon: AlertOctagon, accent: '#ef4444', handler: actViolation },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private civic DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send civic brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public civic guide + federation', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Letter', desc: 'Agent: 3-line constituent letter', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-blue-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-blue-500/10 pb-2">
        <Landmark className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">Civic workbench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">govtrack · usaspending</span>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <input type="text" maxLength={5} value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="ZIP" />
        <input type="text" value={billQuery} onChange={(e) => setBillQuery(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Bill query" />
        <select value={permitType} onChange={(e) => setPermitType(e.target.value as typeof permitType)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white">
          {(['building', 'business', 'zoning', 'environmental'] as const).map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={violationSeverity} onChange={(e) => setViolationSeverity(e.target.value as typeof violationSeverity)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white">
          {(['minor', 'moderate', 'severe'] as const).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="md:col-span-5 flex items-center gap-2 flex-wrap">
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
          <RecallSlot ctl={dmRecall} />
          <RecallSlot ctl={publishRecall} />
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {reps.length > 0 && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5 max-h-40 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Representatives ({reps.length})</div>
            {reps.slice(0, 6).map((r, i) => <div key={i} className="text-[11px] text-zinc-300"><strong className="text-cyan-200">{r.name}</strong> <span className="text-zinc-400">{r.office} · {r.party}</span></div>)}
          </div>
        )}
        {bills.length > 0 && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-40 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Bills ({bills.length})</div>
            {bills.slice(0, 6).map((b, i) => <div key={i} className="text-[11px] text-zinc-300"><strong className="text-purple-200 font-mono">{b.id}</strong> {b.title.slice(0, 60)}{b.status && <span className="text-zinc-400 ml-1">({b.status})</span>}</div>)}
          </div>
        )}
        {permitResult && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">Permit timeline</div>
            <div className="text-2xl font-bold text-emerald-300">{permitResult.estimatedWeeks}w</div>
            {permitResult.phases && <div className="text-[10px] text-zinc-400">{permitResult.phases.map(p => `${p.name}(${p.weeks}w)`).join(' → ')}</div>}
          </div>
        )}
        {violationResult && (
          <div className={cn('rounded-md border p-2.5', violationResult.escalated ? 'border-rose-500/40 bg-rose-500/5' : 'border-amber-500/40 bg-amber-500/5')}>
            <div className={cn('text-[10px] uppercase tracking-wider font-semibold', violationResult.escalated ? 'text-rose-300' : 'text-amber-300')}>Violation: {violationResult.tier}</div>
            {violationResult.nextStep && <p className="text-[11px] text-zinc-300 mt-1">{violationResult.nextStep}</p>}
          </div>
        )}
      </div>

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Constituent letter</div>
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
