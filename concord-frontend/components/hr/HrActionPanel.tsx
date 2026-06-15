'use client';

/**
 * HrActionPanel — people-ops workbench.
 * Surfaces compensationBenchmark / turnoverAnalysis / interviewScorecard /
 * ptoBalance + mint/DM/publish/agent.
 */

import { useState } from 'react';
import {
  Users, DollarSign, TrendingDown, ClipboardList, Calendar,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('hr', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'comp' | 'turnover' | 'interview' | 'pto' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface CompResult { role?: string; market50?: number; market75?: number; rangeLow?: number; rangeHigh?: number; offerSuggestion?: number }
interface TurnoverResult { ratePct?: number; benchmarkPct?: number; topReason?: string; band?: string }
interface InterviewResult { totalScore?: number; passingScore?: number; recommendation?: string; topStrengths?: string[]; topWeaknesses?: string[] }
interface PtoResult { accrued?: number; used?: number; remaining?: number; rolloverDate?: string }

export function HrActionPanel() {
  const [role, setRole] = useState('');
  const [location, setLocation] = useState('');
  const [headcount, setHeadcount] = useState('');
  const [leavers, setLeavers] = useState('');
  const [candidateName, setCandidateName] = useState('');
  const [scores, setScores] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [annualPtoDays, setAnnualPtoDays] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [compResult, setCompResult] = useState<CompResult | null>(null);
  const [turnoverResult, setTurnoverResult] = useState<TurnoverResult | null>(null);
  const [interviewResult, setInterviewResult] = useState<InterviewResult | null>(null);
  const [ptoResult, setPtoResult] = useState<PtoResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (t: string) => setFeedback({ kind: 'ok', text: t });
  const err = (t: string) => setFeedback({ kind: 'err', text: t });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actComp() {
    if (!role.trim()) { err('Role required.'); return; }
    setBusy('comp'); setFeedback(null);
    try {
      const r = await callMacro<CompResult>('compensationBenchmark', { role: role.trim(), location: location.trim() });
      if (r.ok && r.result) { setCompResult(r.result); pipe.publish('hr.comp', r.result, { label: `$${r.result.market50}k median` }); ok(`$${r.result.market50}k median.`); } else err(r.error ?? 'comp failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actTurnover() {
    const h = parseInt(headcount, 10), l = parseInt(leavers, 10);
    if (![h, l].every(Number.isFinite)) { err('Headcount + leavers required.'); return; }
    setBusy('turnover'); setFeedback(null);
    try {
      const r = await callMacro<TurnoverResult>('turnoverAnalysis', { headcount: h, leaversLast12Months: l });
      if (r.ok && r.result) { setTurnoverResult(r.result); pipe.publish('hr.turnover', r.result, { label: `Turn ${r.result.ratePct}%` }); ok(`Turnover: ${r.result.ratePct}%.`); } else err(r.error ?? 'turnover failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actInterview() {
    if (!candidateName.trim()) { err('Candidate required.'); return; }
    if (!scores.trim()) { err('Scores required (one per line: dimension N).'); return; }
    const parsed: Record<string, number> = {};
    scores.split('\n').forEach(l => { const m = l.trim().match(/^(\S+)\s+(\d+)$/); if (m) parsed[m[1]] = parseInt(m[2], 10); });
    setBusy('interview'); setFeedback(null);
    try {
      const r = await callMacro<InterviewResult>('interviewScorecard', { candidate: candidateName.trim(), scores: parsed });
      if (r.ok && r.result) { setInterviewResult(r.result); pipe.publish('hr.interview', r.result, { label: `Rec: ${r.result.recommendation}` }); ok(`Rec: ${r.result.recommendation}.`); } else err(r.error ?? 'interview failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPto() {
    if (!employeeId.trim()) { err('Employee id required.'); return; }
    const a = parseInt(annualPtoDays, 10);
    if (!Number.isFinite(a)) { err('Annual PTO days required.'); return; }
    setBusy('pto'); setFeedback(null);
    try {
      const r = await callMacro<PtoResult>('ptoBalance', { employeeId: employeeId.trim(), annualDays: a });
      if (r.ok && r.result) { setPtoResult(r.result); pipe.publish('hr.pto', r.result, { label: `PTO ${r.result.remaining}d left` }); ok(`${r.result.remaining}d remaining.`); } else err(r.error ?? 'pto failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `HR snapshot — ${role || 'team'}`, tags: ['hr', role.toLowerCase().replace(/\s/g, '-')], source: 'hr:snapshot:mint', meta: { visibility: 'private', consent: { allowCitations: false }, hr: { role, location, comp: compResult, turnover: turnoverResult, interview: interviewResult, pto: ptoResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('hr.mintedDtuId', id, { label: `HR DTU ${id.slice(0, 8)}…` }); ok(`HR DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`👥 HR brief: ${role}`, '',
      compResult ? `Comp: $${compResult.market50}k median (range $${compResult.rangeLow}-${compResult.rangeHigh}k)` : '',
      turnoverResult ? `Turnover: ${turnoverResult.ratePct}% (${turnoverResult.band})` : '',
      interviewResult ? `Candidate ${candidateName}: ${interviewResult.recommendation}` : '',
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
    if (!compResult) { err('Run comp benchmark first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Public comp data — ${role} (${location})`, tags: ['hr', 'comp', 'public', role.toLowerCase().replace(/\s/g, '-')], source: 'hr:comp:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anonymized: true, comp: { role, location, market50: compResult.market50, market75: compResult.market75 } } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('hr.publishedDtuId', id, { label: `Public comp ${id.slice(0, 8)}…` }); ok(`Comp data published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `HR context: ${role} in ${location}, headcount ${headcount}. ${turnoverResult ? `Turnover ${turnoverResult.ratePct}% (${turnoverResult.band}).` : ''} ${interviewResult ? `Latest candidate: ${interviewResult.recommendation}.` : ''} Recommend the single most-leveraged retention move for this team this quarter. Plain text, concrete.`;
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Retention move ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'comp' as ActionId, label: 'Comp', desc: 'compensationBenchmark market', icon: DollarSign, accent: '#22c55e', handler: actComp },
    { id: 'turnover' as ActionId, label: 'Turnover', desc: 'turnoverAnalysis rate + band', icon: TrendingDown, accent: '#ef4444', handler: actTurnover },
    { id: 'interview' as ActionId, label: 'Interview', desc: 'interviewScorecard + recommendation', icon: ClipboardList, accent: '#8b5cf6', handler: actInterview },
    { id: 'pto' as ActionId, label: 'PTO', desc: 'ptoBalance accrued/used/remaining', icon: Calendar, accent: '#06b6d4', handler: actPto },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private HR DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send brief to hiring manager', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anonymized comp data + federation', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Retain', desc: 'Agent: most-leveraged retention move', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-blue-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-blue-500/10 pb-2">
        <Users className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">People ops workbench</h3>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <input type="text" value={role} onChange={(e) => setRole(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Role (e.g. Senior Engineer)" />
        <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Location" />
        <input type="text" value={headcount} onChange={(e) => setHeadcount(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Headcount" />
        <input type="text" value={leavers} onChange={(e) => setLeavers(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Leavers 12mo" />
        <input type="text" value={candidateName} onChange={(e) => setCandidateName(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Candidate name" />
        <input type="text" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="Employee id (PTO)" />
        <input type="text" value={annualPtoDays} onChange={(e) => setAnnualPtoDays(e.target.value.replace(/\D/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white font-mono" placeholder="PTO days/yr" />
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Interview scores (rubric score per line, 1-5)</label>
        <textarea value={scores} onChange={(e) => setScores(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-blue-200 font-mono focus:outline-none focus:ring-2 focus:ring-blue-400/40 resize-none" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient (hiring manager)" />
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
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
        {compResult && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">{compResult.role}</div>
            <div className="text-2xl font-bold text-emerald-300">${compResult.market50}k<span className="text-xs text-zinc-400 ml-1">median</span></div>
            <div className="text-[10px] text-zinc-400">range ${compResult.rangeLow}-${compResult.rangeHigh}k · 75th ${compResult.market75}k</div>
            {compResult.offerSuggestion && <div className="text-[11px] text-emerald-300">Suggested offer: ${compResult.offerSuggestion}k</div>}
          </div>
        )}
        {turnoverResult && (
          <div className={cn('rounded-md border p-2.5', (turnoverResult.ratePct ?? 0) > 20 ? 'border-rose-500/40 bg-rose-500/5' : (turnoverResult.ratePct ?? 0) > 10 ? 'border-amber-500/40 bg-amber-500/5' : 'border-emerald-500/40 bg-emerald-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-rose-300 font-semibold">Turnover ({turnoverResult.band})</div>
            <div className="text-2xl font-bold text-zinc-100">{turnoverResult.ratePct}%</div>
            <div className="text-[10px] text-zinc-400">vs benchmark {turnoverResult.benchmarkPct}%</div>
            {turnoverResult.topReason && <div className="text-[11px] text-zinc-300">Top reason: {turnoverResult.topReason}</div>}
          </div>
        )}
        {interviewResult && (
          <div className={cn('rounded-md border p-2.5', interviewResult.recommendation === 'hire' || interviewResult.recommendation === 'strong-hire' ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">{candidateName}</div>
            <div className="text-lg font-bold text-purple-300 capitalize">{interviewResult.recommendation}</div>
            <div className="text-[10px] text-zinc-400">{interviewResult.totalScore}/{interviewResult.passingScore} threshold</div>
            {interviewResult.topStrengths?.length ? <div className="text-[11px] text-emerald-300">+ {interviewResult.topStrengths.join(', ')}</div> : null}
            {interviewResult.topWeaknesses?.length ? <div className="text-[11px] text-amber-300">⚠ {interviewResult.topWeaknesses.join(', ')}</div> : null}
          </div>
        )}
        {ptoResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">PTO {employeeId}</div>
            <div className="text-2xl font-bold text-cyan-300">{ptoResult.remaining}d</div>
            <div className="text-[10px] text-zinc-400">accrued {ptoResult.accrued} · used {ptoResult.used}</div>
            {ptoResult.rolloverDate && <div className="text-[10px] text-amber-300">rollover: {ptoResult.rolloverDate}</div>}
          </div>
        )}
      </div>

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Retention move</div>
          <pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre>
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
