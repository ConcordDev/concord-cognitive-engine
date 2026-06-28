'use client';

/**
 * DefenseActionPanel — security ops bench.
 * threatAssessment / readinessScore / incidentResponse /
 * usaspending-dod-contracts (USAspending.gov) + mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Shield, Activity, AlertOctagon, FileText, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('defense', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'threat' | 'ready' | 'inc' | 'spend' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface Threat { threat: string; category: string; likelihood: number; impact: number; riskScore: number; severity: string; mitigation: string }
interface ThreatResult { threats: Threat[]; critical: number; total: number; overallThreatLevel: string; topThreat?: string }
interface ReadyResult { personnelReadiness: number; equipmentReadiness: number; trainingCompletion: number; supplyLevel: number; overallReadiness: number; status: string; gaps: string[] }
interface IncResult { incidentType?: string; severity?: string; responseTime?: string; escalationLevel?: string; immediateActions?: string[] }
// Field names align EXACTLY with what defense.usaspending-dod-contracts returns
// (server/domains/defense.js: placeOfPerformanceState / naicsCode / pscCode /
// startDate / endDate, and top-level count / totalAmount / totalPages). The
// prior placeOfPerformance / naics / psc / periodStart / periodEnd / totalResults
// / pageInfo names were never returned by the handler — the rendered row read
// undefined (fixed 2026-06-28, matching the live ContractSearch.tsx contract).
interface DodAward { awardId?: string; recipient?: string; amount?: number; agency?: string; subAgency?: string; description?: string; placeOfPerformanceState?: string; naicsCode?: string; pscCode?: string; startDate?: string; endDate?: string }
interface SpendResult { keyword?: string; awardType?: string; results?: DodAward[]; count?: number; totalAmount?: number; totalPages?: number; source?: string }

// No seeded data — every input starts empty.
export function DefenseActionPanel() {
  const [threatsText, setThreatsText] = useState('');
  const [personnelReady, setPersonnelReady] = useState('');
  const [personnelTotal, setPersonnelTotal] = useState('');
  const [equipReady, setEquipReady] = useState('');
  const [equipTotal, setEquipTotal] = useState('');
  const [training, setTraining] = useState('');
  const [supplies, setSupplies] = useState('');
  const [incidentType, setIncidentType] = useState('');
  const [incidentSev, setIncidentSev] = useState<'low' | 'medium' | 'high' | 'critical'>('high');
  const [contractKeyword, setContractKeyword] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [threatResult, setThreatResult] = useState<ThreatResult | null>(null);
  const [readyResult, setReadyResult] = useState<ReadyResult | null>(null);
  const [incResult, setIncResult] = useState<IncResult | null>(null);
  const [spendResult, setSpendResult] = useState<SpendResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actThreat() {
    if (!threatsText.trim()) { err('Paste threats JSON first.'); return; }
    try { const parsed = JSON.parse(threatsText); setBusy('threat'); setFeedback(null);
      const r = await callMacro<ThreatResult>('threatAssessment', { artifact: { data: parsed } });
      if (r.ok && r.result) { setThreatResult(r.result); pipe.publish('defense.threat', r.result, { label: `Threats ${r.result.critical} crit` }); ok(`${r.result.critical} critical · top: ${r.result.topThreat}.`); } else err(r.error ?? 'threat failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid threats JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actReady() {
    const pr = parseInt(personnelReady, 10), pt = parseInt(personnelTotal, 10), er = parseInt(equipReady, 10), et = parseInt(equipTotal, 10), tr = parseInt(training, 10), su = parseInt(supplies, 10);
    if (![pr, pt, er, et, tr, su].every(Number.isFinite)) { err('All 6 readiness metrics required.'); return; }
    setBusy('ready'); setFeedback(null);
    try {
      const r = await callMacro<ReadyResult>('readinessScore', { artifact: { data: { personnelReady: pr, personnelTotal: pt, equipmentOperational: er, equipmentTotal: et, trainingCompletionPercent: tr, suppliesPercent: su } } });
      if (r.ok && r.result) { setReadyResult(r.result); pipe.publish('defense.ready', r.result, { label: `Ready ${r.result.overallReadiness}%` }); ok(`${r.result.overallReadiness}% · ${r.result.status}.`); } else err(r.error ?? 'ready failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actInc() {
    if (!incidentType.trim()) { err('Incident type required.'); return; }
    setBusy('inc'); setFeedback(null);
    try {
      const r = await callMacro<IncResult>('incidentResponse', { artifact: { data: { type: incidentType.trim(), severity: incidentSev, location: 'Sector 7G', reporter: 'sentry-04' } } });
      if (r.ok && r.result) { setIncResult(r.result); pipe.publish('defense.inc', r.result, { label: `Inc ${r.result.escalationLevel}` }); ok(`Protocol: ${r.result.escalationLevel}.`); } else err(r.error ?? 'incident failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSpend() {
    if (!contractKeyword.trim()) { err('Keyword required.'); return; }
    setBusy('spend'); setFeedback(null);
    try {
      const r = await callMacro<SpendResult>('usaspending-dod-contracts', { keyword: contractKeyword.trim(), awardType: 'contracts', limit: 10 });
      if (r.ok && r.result) { setSpendResult(r.result); pipe.publish('defense.spend', r.result, { label: `DoD ${r.result.results?.length ?? 0} contracts` }); ok(`${r.result.results?.length ?? 0} DoD contracts.`); } else err(r.error ?? 'spend failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Sec ops — ${readyResult?.status ?? threatResult?.overallThreatLevel ?? 'briefing'}`, tags: ['defense', 'security', readyResult?.status].filter((t): t is string => !!t), source: 'defense:ops:mint', meta: { visibility: 'private', consent: { allowCitations: false }, def: { threats: threatResult, ready: readyResult, inc: incResult, spend: spendResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('defense.mintedDtuId', id, { label: `Sec DTU ${id.slice(0, 8)}…` }); ok(`Sec DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🛡 Sec brief`, '',
      threatResult ? `Threats: ${threatResult.critical} critical / ${threatResult.total} total · top: ${threatResult.topThreat} (${threatResult.overallThreatLevel})` : '',
      readyResult ? `Readiness: ${readyResult.overallReadiness}% · ${readyResult.status}${readyResult.gaps.length > 0 ? ` · gaps: ${readyResult.gaps.join(', ')}` : ''}` : '',
      incResult ? `Incident: ${incResult.incidentType} (${incResult.severity}) · response ${incResult.responseTime} · ${incResult.escalationLevel}` : '',
      spendResult ? `DoD contracts (${contractKeyword}): ${spendResult.results?.length} found` : '',
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
    if (!spendResult) { err('Run DoD contracts search first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `DoD contract briefing — ${contractKeyword}`, tags: ['defense', 'contracts', 'usaspending', 'public', contractKeyword], source: 'defense:contracts:publish', meta: { visibility: 'public', consent: { allowCitations: true }, contracts: spendResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('defense.publishedDtuId', id, { label: `Public DoD brief ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Defensive ops review. ${threatResult ? `Top threat: ${threatResult.topThreat} (${threatResult.overallThreatLevel}).` : ''} ${readyResult ? `Readiness ${readyResult.overallReadiness}% (${readyResult.status})${readyResult.gaps.length > 0 ? `, gaps: ${readyResult.gaps.join(', ')}` : ''}.` : ''} ${incResult ? `Active incident: ${incResult.incidentType} (${incResult.severity}).` : ''} Identify the single most urgent action for command + one 30-day strategic priority. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'threat' as ActionId, label: 'Threats', desc: 'threatAssessment', icon: AlertOctagon, accent: '#ef4444', handler: actThreat },
    { id: 'ready' as ActionId, label: 'Readiness', desc: 'P × E × T × S', icon: Activity, accent: '#22c55e', handler: actReady },
    { id: 'inc' as ActionId, label: 'Incident', desc: 'incidentResponse', icon: AlertTriangle, accent: '#f59e0b', handler: actInc },
    { id: 'spend' as ActionId, label: 'DoD $', desc: 'USAspending.gov', icon: FileText, accent: '#3b82f6', handler: actSpend },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private sec DTU', icon: Sparkles, accent: '#a855f7', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send sec brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public contracts', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Brief', desc: 'Agent: command action', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const SEV_COLOR: Record<string, string> = { low: 'text-emerald-300', medium: 'text-amber-300', high: 'text-orange-300', critical: 'text-red-300' };
  const STATUS_COLOR: Record<string, string> = { 'combat-ready': 'text-emerald-300', 'operationally-ready': 'text-blue-300', 'limited-readiness': 'text-amber-300', 'not-ready': 'text-red-300' };

  return (
    <div className="rounded-lg border border-slate-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-slate-500/10 pb-2">
        <Shield className="h-4 w-4 text-slate-300" />
        <h3 className="text-sm font-semibold text-white">Defense ops</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">threats · readiness · incident · USAspending</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">Threats JSON</label>
          <textarea value={threatsText} onChange={(e) => setThreatsText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Readiness inputs</div>
          <div className="grid grid-cols-2 gap-1">
            <input type="text" value={personnelReady} onChange={(e) => setPersonnelReady(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="P ready" />
            <input type="text" value={personnelTotal} onChange={(e) => setPersonnelTotal(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="P total" />
            <input type="text" value={equipReady} onChange={(e) => setEquipReady(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="E ready" />
            <input type="text" value={equipTotal} onChange={(e) => setEquipTotal(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="E total" />
            <input type="text" value={training} onChange={(e) => setTraining(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Training %" />
            <input type="text" value={supplies} onChange={(e) => setSupplies(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Supply %" />
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Incident + contracts</div>
          <input type="text" value={incidentType} onChange={(e) => setIncidentType(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white" placeholder="Incident type" />
          <select value={incidentSev} onChange={(e) => setIncidentSev(e.target.value as typeof incidentSev)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white">
            <option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="critical">critical</option>
          </select>
          <input type="text" value={contractKeyword} onChange={(e) => setContractKeyword(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white font-mono" placeholder="Contract keyword" />
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white" placeholder="DM recipient" />
          <div className="flex items-center gap-2 flex-wrap">
            <RecallSlot ctl={dmRecall} />
            <RecallSlot ctl={publishRecall} />
          </div>
        </div>
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
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{act.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {threatResult && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2.5 max-h-60 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold">Threats · {threatResult.critical} critical · {threatResult.overallThreatLevel.toUpperCase()}</div>
            {threatResult.threats.slice(0, 6).map((t, i) => <div key={i} className={cn('text-[11px] mt-1', SEV_COLOR[t.severity])}><div className="flex items-center gap-2"><strong>{t.threat}</strong> <span className="font-mono text-[10px]">{t.riskScore}</span></div><div className="text-[10px] text-zinc-400">L {t.likelihood}% × I {t.impact}% · {t.category}</div><div className="text-[10px] text-zinc-400 italic">→ {t.mitigation}</div></div>)}
          </div>
        )}
        {readyResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Readiness · {readyResult.status}</div>
            <div className={cn('text-3xl font-bold', STATUS_COLOR[readyResult.status])}>{readyResult.overallReadiness}%</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1 text-[10px]">
              <div className="text-zinc-400">Personnel <span className="text-green-200 font-mono">{readyResult.personnelReadiness}%</span></div>
              <div className="text-zinc-400">Equipment <span className="text-green-200 font-mono">{readyResult.equipmentReadiness}%</span></div>
              <div className="text-zinc-400">Training <span className="text-green-200 font-mono">{readyResult.trainingCompletion}%</span></div>
              <div className="text-zinc-400">Supply <span className="text-green-200 font-mono">{readyResult.supplyLevel}%</span></div>
            </div>
            {readyResult.gaps.length > 0 && <div className="text-[10px] text-red-300 mt-1">⚠ gaps: {readyResult.gaps.join(', ')}</div>}
          </div>
        )}
        {incResult && (
          <div className={cn('rounded-md border p-2.5', SEV_COLOR[incResult.severity ?? 'medium'] === 'text-red-300' ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Incident · {incResult.severity}</div>
            <div className="text-[12px] font-semibold text-zinc-200">{incResult.incidentType}</div>
            <div className="text-[10px] text-zinc-400">response {incResult.responseTime} · escalate to {incResult.escalationLevel}</div>
            {(incResult.immediateActions ?? []).slice(0, 5).map((a, i) => <div key={i} className="text-[10px] text-amber-200 mt-0.5">→ {a}</div>)}
          </div>
        )}
        {spendResult?.results && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-60 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">DoD contracts · {contractKeyword}</div>
            {spendResult.results.slice(0, 5).map((a, i) => <div key={i} className="text-[10px] text-zinc-300 mt-1 pb-1 border-b border-zinc-800 last:border-0"><strong className="text-blue-200">{a.recipient}</strong> · <span className="font-mono text-emerald-300">${a.amount?.toLocaleString()}</span><div className="text-zinc-400 line-clamp-1">{a.description}</div><div className="text-zinc-400">{a.subAgency || a.agency}{a.placeOfPerformanceState ? ` · ${a.placeOfPerformanceState}` : ''}</div></div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Command action</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
