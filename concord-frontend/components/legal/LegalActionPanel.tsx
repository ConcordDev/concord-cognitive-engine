'use client';

/**
 * LegalActionPanel — Westlaw + CourtListener + contract-mgmt shape.
 * Surfaces contractRenewal / conflictCheck / complianceAudit /
 * deadlineCheck + mint/DM/publish/agent.
 */

import { useState } from 'react';
import {
  Scale, FileText, ShieldAlert, ClipboardCheck, Calendar,
  Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('legal', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'deadline' | 'renewal' | 'conflict' | 'audit' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface DeadlineResult { upcoming?: Array<{ name: string; daysUntil: number; severity: string }>; overdue?: number }
interface RenewalResult { renewals?: Array<{ contract: string; renewsOn: string; daysLeft: number }>; criticalCount?: number }
interface ConflictResult { hasConflict?: boolean; parties?: string[]; explanation?: string }
interface AuditResult { findings?: Array<{ control: string; status: string; gap?: string }>; complianceScore?: number }

export function LegalActionPanel() {
  const [caseName, setCaseName] = useState('');
  const [deadlines, setDeadlines] = useState('Motion to dismiss 2026-05-25 high\nDiscovery response 2026-06-15 medium\nExpert disclosure 2026-07-01 low');
  const [contracts, setContracts] = useState('NDA-Acme 2026-08-01\nMSA-Globex 2026-11-30\nDPA-Initech 2027-02-15');
  const [partyA, setPartyA] = useState('');
  const [partyB, setPartyB] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [deadlineResult, setDeadlineResult] = useState<DeadlineResult | null>(null);
  const [renewalResult, setRenewalResult] = useState<RenewalResult | null>(null);
  const [conflictResult, setConflictResult] = useState<ConflictResult | null>(null);
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (t: string) => setFeedback({ kind: 'ok', text: t });
  const err = (t: string) => setFeedback({ kind: 'err', text: t });

  async function actDeadline() {
    const parsed = deadlines.split('\n').map(l => { const m = l.trim().match(/^(.+?)\s+(\d{4}-\d{2}-\d{2})\s+(\S+)$/); return m ? { name: m[1], dueDate: m[2], severity: m[3] } : null; }).filter(Boolean);
    if (!parsed.length) { err('Add deadlines (name YYYY-MM-DD severity).'); return; }
    setBusy('deadline'); setFeedback(null);
    try { const r = await callMacro<DeadlineResult>('deadlineCheck', { deadlines: parsed }); if (r.ok && r.result) { setDeadlineResult(r.result); ok(`${r.result.upcoming?.length ?? 0} upcoming.`); } else err(r.error ?? 'deadline failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actRenewal() {
    const parsed = contracts.split('\n').map(l => { const m = l.trim().match(/^(.+?)\s+(\d{4}-\d{2}-\d{2})$/); return m ? { name: m[1], expiresOn: m[2] } : null; }).filter(Boolean);
    if (!parsed.length) { err('Add contracts (name YYYY-MM-DD).'); return; }
    setBusy('renewal'); setFeedback(null);
    try { const r = await callMacro<RenewalResult>('contractRenewal', { contracts: parsed }); if (r.ok && r.result) { setRenewalResult(r.result); ok(`${r.result.renewals?.length ?? 0} renewals.`); } else err(r.error ?? 'renewal failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actConflict() {
    if (!partyA.trim() || !partyB.trim()) { err('Both parties required.'); return; }
    setBusy('conflict'); setFeedback(null);
    try { const r = await callMacro<ConflictResult>('conflictCheck', { partyA: partyA.trim(), partyB: partyB.trim() }); if (r.ok && r.result) { setConflictResult(r.result); ok(r.result.hasConflict ? 'CONFLICT detected.' : 'No conflict.'); } else err(r.error ?? 'conflict failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAudit() {
    setBusy('audit'); setFeedback(null);
    try { const r = await callMacro<AuditResult>('complianceAudit', { caseName: caseName.trim() }); if (r.ok && r.result) { setAuditResult(r.result); ok(`Score: ${r.result.complianceScore ?? '—'}.`); } else err(r.error ?? 'audit failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Legal — ${caseName.trim() || 'matter'}`, tags: ['legal', 'matter', conflictResult?.hasConflict ? 'conflict' : 'clean'], source: 'legal:matter:mint', meta: { visibility: 'private', consent: { allowCitations: false }, legal: { case: caseName, deadlines: deadlineResult, renewals: renewalResult, conflict: conflictResult, audit: auditResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Matter DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`⚖ Legal brief: ${caseName || 'matter'}`, '', deadlineResult ? `Upcoming deadlines: ${deadlineResult.upcoming?.length ?? 0}` : '', renewalResult ? `Renewals: ${renewalResult.criticalCount ?? 0} critical` : '', conflictResult?.hasConflict ? `⚠ CONFLICT: ${conflictResult.explanation}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Public legal note — ${caseName.trim()}`, tags: ['legal', 'public', 'note'], source: 'legal:note:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anonymized: true, note: { case: caseName, complianceScore: auditResult?.complianceScore } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Legal matter: "${caseName || 'matter'}". ${deadlineResult ? `${deadlineResult.upcoming?.length ?? 0} upcoming deadlines.` : ''} ${conflictResult?.hasConflict ? `Conflict: ${conflictResult.explanation}` : ''} ${auditResult ? `Compliance score: ${auditResult.complianceScore}.` : ''} Identify the single highest-risk action item to address this week. Plain text.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Risk brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'deadline' as ActionId, label: 'Deadlines', desc: 'deadlineCheck upcoming', icon: Calendar, accent: '#06b6d4', handler: actDeadline },
    { id: 'renewal' as ActionId, label: 'Renewals', desc: 'contractRenewal upcoming', icon: FileText, accent: '#8b5cf6', handler: actRenewal },
    { id: 'conflict' as ActionId, label: 'Conflict', desc: 'conflictCheck party A vs B', icon: ShieldAlert, accent: '#ef4444', handler: actConflict },
    { id: 'audit' as ActionId, label: 'Audit', desc: 'complianceAudit + score', icon: ClipboardCheck, accent: '#eab308', handler: actAudit },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private matter DTU', icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send brief to counsel', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anonymized legal note + federation', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Risk', desc: 'Agent: highest-risk action this week', icon: Wand2, accent: '#f97316', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-amber-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-amber-500/10 pb-2">
        <Scale className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Legal workbench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">westlaw · courtlistener</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        <input type="text" value={caseName} onChange={(e) => setCaseName(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Case / matter name" />
        <input type="text" value={partyA} onChange={(e) => setPartyA(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Party A" />
        <input type="text" value={partyB} onChange={(e) => setPartyB(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Party B" />
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM recipient" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Deadlines (name YYYY-MM-DD severity)</label><textarea value={deadlines} onChange={(e) => setDeadlines(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-amber-200 font-mono focus:outline-none focus:ring-2 focus:ring-amber-400/40 resize-none" /></div>
        <div><label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Contracts (name YYYY-MM-DD expiry)</label><textarea value={contracts} onChange={(e) => setContracts(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-amber-200 font-mono focus:outline-none focus:ring-2 focus:ring-amber-400/40 resize-none" /></div>
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
              <div className="text-[10px] text-zinc-500 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {deadlineResult?.upcoming && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5 max-h-40 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">Deadlines ({deadlineResult.upcoming.length})</div>
            {deadlineResult.upcoming.slice(0, 8).map((d, i) => <div key={i} className="text-[11px] text-zinc-300 flex justify-between"><span>{d.name}</span><span className={cn('font-mono', d.severity === 'high' ? 'text-rose-300' : d.severity === 'medium' ? 'text-amber-300' : 'text-zinc-400')}>{d.daysUntil}d</span></div>)}
          </div>
        )}
        {renewalResult?.renewals && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-40 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Renewals ({renewalResult.criticalCount} critical)</div>
            {renewalResult.renewals.slice(0, 8).map((r, i) => <div key={i} className="text-[11px] text-zinc-300 flex justify-between"><span>{r.contract}</span><span className={cn('font-mono', r.daysLeft < 30 ? 'text-rose-300' : 'text-zinc-400')}>{r.daysLeft}d</span></div>)}
          </div>
        )}
        {conflictResult && (
          <div className={cn('rounded-md border p-2.5', conflictResult.hasConflict ? 'border-rose-500/40 bg-rose-500/5' : 'border-emerald-500/40 bg-emerald-500/5')}>
            <div className={cn('text-[10px] uppercase tracking-wider font-semibold', conflictResult.hasConflict ? 'text-rose-300' : 'text-emerald-300')}>Conflict {conflictResult.hasConflict ? 'DETECTED' : 'clear'}</div>
            {conflictResult.explanation && <p className="text-[11px] text-zinc-300 mt-1">{conflictResult.explanation}</p>}
          </div>
        )}
        {auditResult && (
          <div className={cn('rounded-md border p-2.5', (auditResult.complianceScore ?? 0) >= 80 ? 'border-emerald-500/40 bg-emerald-500/5' : (auditResult.complianceScore ?? 0) >= 50 ? 'border-amber-500/40 bg-amber-500/5' : 'border-rose-500/40 bg-rose-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-yellow-300 font-semibold">Compliance</div>
            <div className="text-2xl font-bold text-zinc-100">{auditResult.complianceScore}<span className="text-xs text-zinc-400">/100</span></div>
            {auditResult.findings?.length ? <div className="text-[10px] text-zinc-500">{auditResult.findings.length} findings</div> : null}
          </div>
        )}
      </div>

      {agentReply && (
        <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-3 max-h-60 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-orange-300 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Risk brief</div>
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
