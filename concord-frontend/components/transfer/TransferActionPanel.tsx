'use client';

/**
 * TransferActionPanel — data-migration bench.
 * schemaMapping / dataQuality / migrationPlan +
 * mint/DM/publish/agent (4th tool slot = reset).
 */

import { useState } from 'react';
import { ArrowLeftRight, Database, GitMerge, RefreshCw, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('transfer', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T; error?: string } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'map' | 'quality' | 'plan' | 'reset' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface MapEntry { source: string; target: string; combinedScore: number; confidence: string; requiresTransform: boolean }
interface MapResult { mappings: MapEntry[]; mappingCount: number; unmappedSource: { name: string; type?: string; required?: boolean }[]; unmappedTarget: { name: string; type?: string; required?: boolean }[]; coverage: { sourceFieldsMapped: string; targetFieldsMapped: string; allRequiredMapped: boolean }; averageConfidence: number; transformsRequired: number }
interface QualityResult { overallScore?: number; completeness?: number; accuracy?: number; consistency?: number; recordCount?: number; fieldsAnalyzed?: number; fieldReports?: Record<string, { completeness?: number; accuracy?: number; consistency?: number; issues?: string[] }>; recommendation?: string }
interface PlanResult { phases?: { phase: number; name: string; durationDays: number; tasks?: string[] }[]; totalDurationDays?: number; riskLevel?: string; rollbackStrategy?: string; criticalPath?: string[] }

const DEFAULT_MAP = JSON.stringify({ sourceSchema: [{ name: 'cust_id', type: 'integer', required: true }, { name: 'firstName', type: 'string' }, { name: 'last_name', type: 'string' }, { name: 'emailAddr', type: 'string' }, { name: 'createdAt', type: 'timestamp' }, { name: 'total_spent', type: 'decimal' }], targetSchema: [{ name: 'customer_id', type: 'bigint', required: true }, { name: 'first_name', type: 'varchar' }, { name: 'last_name', type: 'varchar' }, { name: 'email', type: 'varchar' }, { name: 'created_date', type: 'date' }, { name: 'lifetime_value', type: 'numeric' }, { name: 'segment', type: 'varchar', required: false }] }, null, 2);
const DEFAULT_QUALITY = JSON.stringify({ records: Array.from({ length: 12 }).map((_, i) => ({ id: i, name: i === 3 ? null : `User ${i}`, email: i === 5 ? 'invalid' : `u${i}@example.com`, age: i === 7 ? 200 : 20 + i, joined: '2024-01-15' })), schema: [{ name: 'id', type: 'integer', required: true }, { name: 'name', type: 'string', required: true }, { name: 'email', type: 'string', pattern: '^[\\w.]+@[\\w.]+$' }, { name: 'age', type: 'integer', validValues: undefined }, { name: 'joined', type: 'date' }] }, null, 2);
const DEFAULT_PLAN = JSON.stringify({ system: { name: 'legacy ERP', sizeGb: 280, modules: 8 }, target: { name: 'cloud SaaS', tenancy: 'multi-tenant' }, constraints: { downtimeHours: 4, teamSize: 6 } }, null, 2);

export function TransferActionPanel() {
  const [mapText, setMapText] = useState(DEFAULT_MAP);
  const [qualityText, setQualityText] = useState(DEFAULT_QUALITY);
  const [planText, setPlanText] = useState(DEFAULT_PLAN);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [mapResult, setMapResult] = useState<MapResult | null>(null);
  const [qualityResult, setQualityResult] = useState<QualityResult | null>(null);
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actMap() {
    try { const parsed = JSON.parse(mapText); setBusy('map'); setFeedback(null);
      const r = await callMacro<MapResult>('schemaMapping', { artifact: { data: parsed } });
      if (r.ok && r.result) { setMapResult(r.result); ok(`${r.result.mappingCount} mapped · ${r.result.transformsRequired} transforms`); } else err(r.error ?? 'map failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid schema JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actQuality() {
    try { const parsed = JSON.parse(qualityText); setBusy('quality'); setFeedback(null);
      const r = await callMacro<QualityResult>('dataQuality', { artifact: { data: parsed } });
      if (r.ok && r.result) { setQualityResult(r.result); ok(`Overall ${r.result.overallScore ?? 0}/100`); } else err(r.error ?? 'quality failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid records JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPlan() {
    try { const parsed = JSON.parse(planText); setBusy('plan'); setFeedback(null);
      const r = await callMacro<PlanResult>('migrationPlan', { artifact: { data: parsed } });
      if (r.ok && r.result) { setPlanResult(r.result); ok(`${r.result.phases?.length ?? 0} phases · ${r.result.totalDurationDays ?? '?'}d · ${r.result.riskLevel ?? 'risk?'}`); } else err(r.error ?? 'plan failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid plan JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  function actReset() { setMapResult(null); setQualityResult(null); setPlanResult(null); setMintedDtuId(null); setPublishedDtuId(null); setAgentReply(null); ok('Cleared.'); }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Migration brief`, tags: ['transfer', 'migration', planResult?.riskLevel].filter((t): t is string => !!t), source: 'transfer:brief:mint', meta: { visibility: 'private', consent: { allowCitations: false }, transfer: { map: mapResult, quality: qualityResult, plan: planResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Brief DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`↔ Migration brief`, '', mapResult ? `Schema map: ${mapResult.mappingCount} mapped (${mapResult.coverage.sourceFieldsMapped} src · ${mapResult.coverage.targetFieldsMapped} tgt) · ${mapResult.transformsRequired} need transform · req-mapped: ${mapResult.coverage.allRequiredMapped}` : '', qualityResult ? `Data quality: ${qualityResult.overallScore ?? '?'} (comp ${qualityResult.completeness ?? '?'} · acc ${qualityResult.accuracy ?? '?'} · cons ${qualityResult.consistency ?? '?'})` : '', planResult ? `Plan: ${planResult.phases?.length ?? 0} phases · ${planResult.totalDurationDays ?? '?'}d · risk ${planResult.riskLevel ?? '?'}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!mapResult && !planResult) { err('Map or plan first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Migration playbook`, tags: ['transfer', 'migration', 'playbook', 'public'], source: 'transfer:playbook:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, transfer: { map: mapResult, plan: planResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Data migration lead brief. ${mapResult ? `Schema map: ${mapResult.mappingCount}/${mapResult.mappingCount + mapResult.unmappedSource.length} mapped; required fields all mapped: ${mapResult.coverage.allRequiredMapped}; ${mapResult.transformsRequired} need transform.` : ''} ${qualityResult ? `Data quality overall ${qualityResult.overallScore ?? '?'}/100 (completeness ${qualityResult.completeness ?? '?'}).` : ''} ${planResult ? `Migration plan: ${planResult.phases?.length ?? 0} phases over ${planResult.totalDurationDays ?? '?'}d, ${planResult.riskLevel ?? '?'} risk.` : ''} Recommend the top quality remediation + one cut-over risk to plan around. Plain text, ≤ 3 sentences.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Lead brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'map' as ActionId, label: 'Schema map', desc: 'schemaMapping (fuzzy)', icon: ArrowLeftRight, accent: '#3b82f6', handler: actMap },
    { id: 'quality' as ActionId, label: 'Quality', desc: 'dataQuality', icon: Database, accent: '#f59e0b', handler: actQuality },
    { id: 'plan' as ActionId, label: 'Plan', desc: 'migrationPlan', icon: GitMerge, accent: '#22c55e', handler: actPlan },
    { id: 'reset' as ActionId, label: 'Reset', desc: 'Clear results', icon: RefreshCw, accent: '#71717a', handler: actReset },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private brief', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon playbook', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Lead', desc: 'Agent: top fix', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const CONF_COLOR: Record<string, string> = { high: 'text-emerald-300', medium: 'text-amber-300', low: 'text-red-300' };

  return (
    <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-cyan-500/10 pb-2">
        <ArrowLeftRight className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">Data migration bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">map · quality · plan</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Schemas JSON</label>
          <textarea value={mapText} onChange={(e) => setMapText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Records + schema JSON</label>
          <textarea value={qualityText} onChange={(e) => setQualityText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Plan JSON</label>
          <textarea value={planText} onChange={(e) => setPlanText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
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
        {mapResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Map · {mapResult.mappingCount}</div>
            <div className="text-2xl font-bold text-blue-200">{mapResult.averageConfidence.toFixed(2)}</div>
            <div className="text-[10px] text-zinc-300">{mapResult.coverage.sourceFieldsMapped} src · {mapResult.coverage.targetFieldsMapped} tgt</div>
            <div className={cn('text-[10px] font-semibold', mapResult.coverage.allRequiredMapped ? 'text-emerald-300' : 'text-red-300')}>{mapResult.coverage.allRequiredMapped ? '✓ all required mapped' : '✗ required gaps'}</div>
            {mapResult.mappings.slice(0, 5).map((m, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span className="truncate">{m.source} → {m.target}</span><span className={cn('font-mono text-[9px]', CONF_COLOR[m.confidence])}>{m.combinedScore.toFixed(2)}{m.requiresTransform ? ' T' : ''}</span></div>)}
            {mapResult.unmappedSource.slice(0, 2).map((u, i) => <div key={i} className="text-[10px] text-red-300 mt-0.5">⚠ unmapped src: {u.name}</div>)}
          </div>
        )}
        {qualityResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Quality</div>
            <div className={cn('text-2xl font-bold', (qualityResult.overallScore ?? 0) >= 70 ? 'text-emerald-300' : (qualityResult.overallScore ?? 0) >= 40 ? 'text-amber-300' : 'text-red-300')}>{qualityResult.overallScore ?? '?'}</div>
            <div className="text-[10px] text-zinc-300">{qualityResult.recordCount ?? 0} records · {qualityResult.fieldsAnalyzed ?? 0} fields</div>
            <div className="text-[10px] text-zinc-500">Comp {qualityResult.completeness ?? '?'} · Acc {qualityResult.accuracy ?? '?'} · Cons {qualityResult.consistency ?? '?'}</div>
            {qualityResult.fieldReports && Object.entries(qualityResult.fieldReports).slice(0, 5).map(([f, rep], i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span>{f}</span><span className="font-mono text-amber-200">{(rep.completeness ?? 0).toFixed(2)}{rep.issues?.length ? ` ⚠${rep.issues.length}` : ''}</span></div>)}
            {qualityResult.recommendation && <div className="text-[10px] text-amber-200 mt-1 italic">{qualityResult.recommendation}</div>}
          </div>
        )}
        {planResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Plan · {planResult.riskLevel ?? '?'}</div>
            <div className="text-2xl font-bold text-emerald-200">{planResult.phases?.length ?? 0}<span className="text-xs text-zinc-400"> phases</span></div>
            <div className="text-[10px] text-zinc-300">{planResult.totalDurationDays ?? '?'}d total</div>
            {(planResult.phases ?? []).slice(0, 5).map((p, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5"><strong>#{p.phase} {p.name}</strong> <span className="font-mono text-green-200">{p.durationDays}d</span></div>)}
            {planResult.rollbackStrategy && <div className="text-[10px] text-green-200 mt-1">Rollback: {planResult.rollbackStrategy}</div>}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Migration lead</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
