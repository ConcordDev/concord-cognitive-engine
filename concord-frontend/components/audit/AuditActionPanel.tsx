'use client';

/**
 * AuditActionPanel — internal auditor bench.
 * complianceCheck / trailAnalysis / riskScore / samplingPlan +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { ShieldCheck, FileSearch, Activity, ListChecks, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('audit', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'comp' | 'trail' | 'risk' | 'sample' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface CompResult { complianceRate?: number; totalRequirements?: number; metRequirements?: number; gaps?: { requirement?: string; severity?: string; remediation?: string }[]; framework?: string; status?: string }
interface TrailResult { totalEvents?: number; anomalies?: { event?: string; user?: string; reason?: string }[]; userActivitySummary?: { user: string; eventCount: number }[]; suspiciousPatterns?: string[] }
interface RiskControlRow { id?: string; name?: string; adjustedEffectiveness: number; controlRisk: number; observedEffectiveness?: number | null }
interface RiskResult { controls?: RiskControlRow[]; overallControlRisk?: number; detectionRisk?: number; inherentRisk?: number; auditRisk?: number; riskLevel?: string }
interface SamplingResult { populationSize?: number; sampleSize?: number; confidenceLevel?: number; expectedErrorRate?: number; method?: string; rationale?: string }

// No seeded examples — paste real compliance, audit-trail, or risk JSON.
export function AuditActionPanel() {
  const [compText, setCompText] = useState('');
  const [trailText, setTrailText] = useState('');
  const [riskText, setRiskText] = useState('');
  const [populationSize, setPopulationSize] = useState('');
  const [confidence, setConfidence] = useState('');
  const [tolerableError, setTolerableError] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [compResult, setCompResult] = useState<CompResult | null>(null);
  const [trailResult, setTrailResult] = useState<TrailResult | null>(null);
  const [riskResult, setRiskResult] = useState<RiskResult | null>(null);
  const [samplingResult, setSamplingResult] = useState<SamplingResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  function parseJSON<T>(text: string): T | null { try { return JSON.parse(text) as T; } catch { return null; } }

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actComp() {
    if (!compText.trim()) { err('Paste compliance JSON first.'); return; }
    const parsed = parseJSON<Record<string, unknown>>(compText); if (!parsed) { err('Invalid compliance JSON.'); return; }
    setBusy('comp'); setFeedback(null);
    try {
      const r = await callMacro<CompResult>('complianceCheck', { artifact: { data: parsed } });
      if (r.ok && r.result) { setCompResult(r.result); pipe.publish('audit.comp', r.result, { label: `${r.result.framework}: ${r.result.complianceRate}%` }); ok(`${r.result.complianceRate ?? '-'}% compliance.`); } else err(r.error ?? 'comp failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actTrail() {
    if (!trailText.trim()) { err('Paste trail JSON first.'); return; }
    const parsed = parseJSON<Record<string, unknown>>(trailText); if (!parsed) { err('Invalid trail JSON.'); return; }
    setBusy('trail'); setFeedback(null);
    try {
      const r = await callMacro<TrailResult>('trailAnalysis', { artifact: { data: parsed } });
      if (r.ok && r.result) { setTrailResult(r.result); pipe.publish('audit.trail', r.result, { label: `Trail: ${r.result.anomalies?.length ?? 0} anomalies` }); ok(`${r.result.anomalies?.length ?? 0} anomalies of ${r.result.totalEvents}.`); } else err(r.error ?? 'trail failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actRisk() {
    if (!riskText.trim()) { err('Paste risk JSON first.'); return; }
    const parsed = parseJSON<Record<string, unknown>>(riskText); if (!parsed) { err('Invalid risk JSON.'); return; }
    setBusy('risk'); setFeedback(null);
    try {
      const r = await callMacro<RiskResult>('riskScore', { artifact: { data: parsed } });
      if (r.ok && r.result) { setRiskResult(r.result); pipe.publish('audit.risk', r.result, { label: `Audit risk: ${r.result.auditRisk}` }); ok(`Audit risk ${r.result.auditRisk ?? '-'}.`); } else err(r.error ?? 'risk failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actSample() {
    const N = parseInt(populationSize, 10), C = parseInt(confidence, 10), T = parseInt(tolerableError, 10);
    if (!isFinite(N) || !isFinite(C) || !isFinite(T)) { err('Fill N / Conf % / Tol % first.'); return; }
    setBusy('sample'); setFeedback(null);
    try {
      const r = await callMacro<SamplingResult>('samplingPlan', { artifact: { data: { populationSize: N, confidenceLevel: C, tolerableErrorRate: T, expectedErrorRate: 1 } } });
      if (r.ok && r.result) { setSamplingResult(r.result); pipe.publish('audit.sample', r.result, { label: `Sample n=${r.result.sampleSize}` }); ok(`Sample n=${r.result.sampleSize}.`); } else err(r.error ?? 'sample failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Audit findings`, tags: ['audit', 'findings', compResult?.framework].filter((t): t is string => !!t), source: 'audit:findings:mint', meta: { visibility: 'private', consent: { allowCitations: false }, audit: { comp: compResult, trail: trailResult, risk: riskResult, sampling: samplingResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('audit.mintedDtuId', id, { label: `Findings DTU ${id.slice(0, 8)}…` }); ok(`Findings DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`📋 Audit findings`, '',
      compResult ? `Compliance: ${compResult.complianceRate}% (${compResult.metRequirements}/${compResult.totalRequirements}) · ${compResult.framework}${(compResult.gaps?.length ?? 0) > 0 ? ` · ${compResult.gaps?.length} gaps` : ''}` : '',
      trailResult ? `Trail: ${trailResult.totalEvents} events · ${trailResult.anomalies?.length ?? 0} anomalies` : '',
      riskResult ? `Risk: audit ${riskResult.auditRisk} · control ${riskResult.overallControlRisk} · ${riskResult.riskLevel}` : '',
      samplingResult ? `Sample plan: n=${samplingResult.sampleSize} of N=${samplingResult.populationSize} @ ${samplingResult.confidenceLevel}% conf` : '',
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
    if (!compResult) { err('Run compliance first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `${compResult.framework} compliance card`, tags: ['audit', 'compliance', 'public'], source: 'audit:compliance:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, comp: compResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('audit.publishedDtuId', id, { label: `Public compliance ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Internal audit memo. ${compResult ? `${compResult.framework}: ${compResult.complianceRate}% compliance.${(compResult.gaps?.length ?? 0) > 0 ? ` Gaps: ${compResult.gaps?.map(g => g.requirement).slice(0, 3).join(', ')}.` : ''}` : ''} ${riskResult ? `Audit risk ${riskResult.auditRisk}, ${riskResult.riskLevel}.` : ''} ${trailResult?.anomalies?.length ? `${trailResult.anomalies.length} trail anomalies.` : ''} Identify single highest-priority finding for management response + suggested remediation timeline. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Memo ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'comp' as ActionId, label: 'Compliance', desc: 'complianceCheck', icon: ShieldCheck, accent: '#22c55e', handler: actComp },
    { id: 'trail' as ActionId, label: 'Audit trail', desc: 'trailAnalysis', icon: FileSearch, accent: '#3b82f6', handler: actTrail },
    { id: 'risk' as ActionId, label: 'Risk score', desc: 'riskScore (CR×DR×IR)', icon: Activity, accent: '#ef4444', handler: actRisk },
    { id: 'sample' as ActionId, label: 'Sample plan', desc: 'samplingPlan', icon: ListChecks, accent: '#a855f7', handler: actSample },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private findings DTU', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send findings', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public compliance card', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Memo', desc: 'Agent: management memo', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-emerald-500/10 pb-2">
        <ShieldCheck className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">Audit bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">SOC2 · trail · risk · sampling</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Compliance JSON</label>
          <textarea value={compText} onChange={(e) => setCompText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Audit trail JSON</label>
          <textarea value={trailText} onChange={(e) => setTrailText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">Risk JSON</label>
          <textarea value={riskText} onChange={(e) => setRiskText(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
          <div className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold mt-1">Sample plan</div>
          <div className="grid grid-cols-3 gap-1 mt-1">
            <input type="text" value={populationSize} onChange={(e) => setPopulationSize(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="N" />
            <input type="text" value={confidence} onChange={(e) => setConfidence(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Conf %" />
            <input type="text" value={tolerableError} onChange={(e) => setTolerableError(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Tol %" />
          </div>
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white mt-1" placeholder="DM recipient" />
          <div className="flex items-center gap-2 flex-wrap mt-1">
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
              <div className="text-[10px] text-zinc-500 leading-tight line-clamp-2">{act.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
        {compResult && (
          <div className={cn('rounded-md border p-2.5 max-h-48 overflow-y-auto', (compResult.complianceRate ?? 0) >= 95 ? 'border-emerald-500/30 bg-emerald-500/5' : (compResult.complianceRate ?? 0) >= 80 ? 'border-amber-500/30 bg-amber-500/5' : 'border-red-500/30 bg-red-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">{compResult.framework}</div>
            <div className={cn('text-2xl font-bold', (compResult.complianceRate ?? 0) >= 95 ? 'text-emerald-300' : (compResult.complianceRate ?? 0) >= 80 ? 'text-amber-300' : 'text-red-300')}>{compResult.complianceRate}%</div>
            <div className="text-[10px] text-zinc-500">{compResult.metRequirements}/{compResult.totalRequirements} met · {compResult.status}</div>
            {(compResult.gaps ?? []).slice(0, 4).map((g, i) => <div key={i} className="text-[10px] text-red-300 mt-0.5">⚠ {g.requirement} ({g.severity})</div>)}
          </div>
        )}
        {trailResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-48 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Trail · {trailResult.totalEvents} events</div>
            <div className="text-2xl font-bold text-blue-300">{trailResult.anomalies?.length ?? 0}<span className="text-xs text-zinc-400"> anomalies</span></div>
            {(trailResult.anomalies ?? []).slice(0, 4).map((a, i) => <div key={i} className="text-[10px] text-red-300 mt-0.5">⚠ <span className="font-mono">{a.user}</span> {a.event}: {a.reason}</div>)}
            {(trailResult.suspiciousPatterns ?? []).map((p, i) => <div key={i} className="text-[10px] text-amber-300 mt-0.5">↗ {p}</div>)}
          </div>
        )}
        {riskResult && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2.5 max-h-48 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold">Risk · {riskResult.riskLevel}</div>
            <div className="text-2xl font-bold text-red-300">{riskResult.auditRisk}<span className="text-xs text-zinc-400"> audit risk</span></div>
            <div className="text-[10px] text-zinc-500">CR {riskResult.overallControlRisk} · DR {riskResult.detectionRisk} · IR {riskResult.inherentRisk}</div>
            {(riskResult.controls ?? []).slice(0, 4).map((c, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5"><span className="font-mono text-red-200">{c.id ?? c.name}</span> eff {c.adjustedEffectiveness} · risk {c.controlRisk}</div>)}
          </div>
        )}
        {samplingResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Sample plan</div>
            <div className="text-2xl font-bold text-purple-300">n={samplingResult.sampleSize}</div>
            <div className="text-[10px] text-zinc-500">of N={samplingResult.populationSize} · {samplingResult.confidenceLevel}% confidence</div>
            <div className="text-[10px] text-zinc-500">method: {samplingResult.method}</div>
            <div className="text-[10px] text-purple-200 italic">{samplingResult.rationale}</div>
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Management memo</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
