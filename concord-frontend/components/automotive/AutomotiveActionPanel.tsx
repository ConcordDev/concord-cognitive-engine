'use client';

/**
 * AutomotiveActionPanel — driver + mechanic bench.
 * vin-decode (NHTSA vPIC) / recall-lookup (NHTSA) /
 * maintenanceSchedule / diagnosticLookup (OBD-II codes) +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Car, AlertOctagon, Wrench, Search, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('automotive', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'vin' | 'recall' | 'maint' | 'diag' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface VinResult { vin: string; make?: string; model?: string; year?: string; trim?: string; bodyClass?: string; driveType?: string; engineCylinders?: string; engineDisplacementL?: string; fuelType?: string; transmission?: string; gvwr?: string; manufacturer?: string; plantCountry?: string; batteryKWh?: string; electrificationLevel?: string }
interface Recall { nhtsaId?: string; component?: string; summary?: string; consequence?: string; remedy?: string; reportReceivedDate?: string }
interface RecallResult { count?: number; recalls?: Recall[]; make?: string; model?: string; year?: number }
interface MaintItem { service?: string; intervalMiles?: number; milesUntilDue?: number; status?: string; priority?: string }
interface MaintResult { services?: MaintItem[]; nextService?: string; overdueCount?: number }
interface DiagResult { code?: string; description?: string; category?: string; severity?: string; commonCauses?: string[]; estimatedCost?: string }

export function AutomotiveActionPanel() {
  const [vin, setVin] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [currentMiles, setCurrentMiles] = useState('');
  const [obdCode, setObdCode] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [vinResult, setVinResult] = useState<VinResult | null>(null);
  const [recallResult, setRecallResult] = useState<RecallResult | null>(null);
  const [maintResult, setMaintResult] = useState<MaintResult | null>(null);
  const [diagResult, setDiagResult] = useState<DiagResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actVin() {
    if (vin.trim().length !== 17) { err('VIN must be 17 chars.'); return; }
    setBusy('vin'); setFeedback(null);
    try {
      const r = await callMacro<VinResult>('vin-decode', { vin: vin.trim() });
      if (r.ok && r.result) { setVinResult(r.result); pipe.publish('auto.vin', r.result, { label: `${r.result.year} ${r.result.make} ${r.result.model}` }); ok(`${r.result.year} ${r.result.make} ${r.result.model}.`); if (r.result.make) { setMake(r.result.make); setModel(r.result.model ?? model); setYear(r.result.year ?? year); } } else err(r.error ?? 'vin failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actRecall() {
    if (!make.trim() || !model.trim() || !year.trim()) { err('Make, model, year required.'); return; }
    setBusy('recall'); setFeedback(null);
    try {
      const r = await callMacro<RecallResult>('recall-lookup', { make: make.trim(), model: model.trim(), year: parseInt(year, 10) });
      if (r.ok && r.result) { setRecallResult(r.result); pipe.publish('auto.recall', r.result, { label: `${r.result.count ?? r.result.recalls?.length ?? 0} recalls` }); ok(`${r.result.count ?? r.result.recalls?.length ?? 0} recalls.`); } else err(r.error ?? 'recall failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMaint() {
    const m = parseInt(currentMiles, 10);
    if (!Number.isFinite(m) || !make.trim() || !model.trim() || !year.trim()) { err('Current miles + make/model/year required.'); return; }
    setBusy('maint'); setFeedback(null);
    try {
      const r = await callMacro<MaintResult>('maintenanceSchedule', { artifact: { data: { currentMileage: m, vehicleAgeMonths: 24, make, model, year: parseInt(year, 10) } } });
      if (r.ok && r.result) { setMaintResult(r.result); pipe.publish('auto.maint', r.result, { label: `Maint ${r.result.overdueCount ?? 0} overdue` }); ok(`${r.result.overdueCount ?? 0} overdue items.`); } else err(r.error ?? 'maint failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDiag() {
    if (!obdCode.trim()) { err('OBD code required (e.g. P0420).'); return; }
    setBusy('diag'); setFeedback(null);
    try {
      const r = await callMacro<DiagResult>('diagnosticLookup', { code: obdCode.trim().toUpperCase() });
      if (r.ok && r.result) { setDiagResult(r.result); pipe.publish('auto.diag', r.result, { label: `${r.result.code}: ${r.result.severity}` }); ok(`${r.result.code}: ${r.result.severity}.`); } else err(r.error ?? 'diag failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Vehicle — ${year} ${make} ${model}`, tags: ['automotive', 'vehicle', make.toLowerCase()], source: 'automotive:vehicle:mint', meta: { visibility: 'private', consent: { allowCitations: false }, auto: { vin: vinResult, recalls: recallResult, maint: maintResult, diag: diagResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('auto.mintedDtuId', id, { label: `Vehicle DTU ${id.slice(0, 8)}…` }); ok(`Vehicle DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🚗 Vehicle brief`, '',
      vinResult ? `${vinResult.year} ${vinResult.make} ${vinResult.model} ${vinResult.trim ?? ''} · ${vinResult.engineDisplacementL ?? '?'}L ${vinResult.engineCylinders ?? '?'}-cyl ${vinResult.fuelType ?? ''}` : '',
      recallResult ? `Recalls: ${recallResult.count ?? recallResult.recalls?.length ?? 0}${(recallResult.recalls?.[0]?.component) ? ` · "${recallResult.recalls[0].component}"` : ''}` : '',
      maintResult ? `Maintenance: ${maintResult.overdueCount ?? 0} overdue · next ${maintResult.nextService ?? '-'}` : '',
      diagResult ? `OBD ${diagResult.code}: ${diagResult.description} (${diagResult.severity})` : '',
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
    if (!recallResult && !vinResult) { err('Run VIN or recall lookup first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `${year} ${make} ${model} reference`, tags: ['automotive', 'vehicle', 'public', make.toLowerCase()], source: 'automotive:reference:publish', meta: { visibility: 'public', consent: { allowCitations: true }, vin: vinResult, recalls: recallResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('auto.publishedDtuId', id, { label: `Public ref ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Vehicle advisory for ${year} ${make} ${model} @ ${currentMiles} mi. ${vinResult ? `${vinResult.engineDisplacementL}L ${vinResult.engineCylinders}-cyl ${vinResult.fuelType}.` : ''} ${(recallResult?.count ?? recallResult?.recalls?.length ?? 0) > 0 ? `Open recalls: ${recallResult?.recalls?.[0]?.component}.` : 'No active recalls.'} ${maintResult ? `${maintResult.overdueCount ?? 0} maintenance items overdue.` : ''} ${diagResult ? `OBD code ${diagResult.code}: ${diagResult.description}.` : ''} Identify the single most important action for the owner this month + estimated cost. Plain text, 3 sentences max.`;
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Advisory ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'vin' as ActionId, label: 'VIN', desc: 'NHTSA vPIC decode', icon: Car, accent: '#3b82f6', handler: actVin },
    { id: 'recall' as ActionId, label: 'Recalls', desc: 'NHTSA recall search', icon: AlertOctagon, accent: '#ef4444', handler: actRecall },
    { id: 'maint' as ActionId, label: 'Maint', desc: 'service schedule', icon: Wrench, accent: '#f59e0b', handler: actMaint },
    { id: 'diag' as ActionId, label: 'OBD-II', desc: 'diagnosticLookup', icon: Search, accent: '#a855f7', handler: actDiag },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private vehicle DTU', icon: Sparkles, accent: '#22c55e', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send vehicle brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public reference', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Advise', desc: 'Agent: top action', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const SEV_COLOR: Record<string, string> = { low: 'text-emerald-300', medium: 'text-amber-300', high: 'text-orange-300', critical: 'text-red-300' };

  return (
    <div className="rounded-lg border border-blue-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-blue-500/10 pb-2">
        <Car className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">Vehicle bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">NHTSA vPIC · recalls · OBD-II</span>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
        <input type="text" value={vin} onChange={(e) => setVin(e.target.value.toUpperCase().slice(0, 17))} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="VIN (17 chars)" />
        <input type="text" value={make} onChange={(e) => setMake(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="Make" />
        <input type="text" value={model} onChange={(e) => setModel(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="Model" />
        <input type="text" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="Year" />
        <input type="text" value={currentMiles} onChange={(e) => setCurrentMiles(e.target.value.replace(/\D/g, '') || '0')} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="Miles" />
        <input type="text" value={obdCode} onChange={(e) => setObdCode(e.target.value.toUpperCase())} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="OBD (P0420)" />
        <div className="md:col-span-7 flex items-center gap-2 flex-wrap">
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient" />
          <RecallSlot ctl={dmRecall} />
          <RecallSlot ctl={publishRecall} />
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
        {vinResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">{vinResult.year} {vinResult.make} {vinResult.model}</div>
            <div className="text-[11px] text-zinc-300">{vinResult.trim} · {vinResult.bodyClass}</div>
            <div className="text-[10px] text-zinc-400 mt-1">{vinResult.engineDisplacementL}L {vinResult.engineCylinders}-cyl {vinResult.fuelType} · {vinResult.transmission} · {vinResult.driveType}</div>
            <div className="text-[10px] text-zinc-400">{vinResult.manufacturer} · {vinResult.plantCountry}</div>
            {vinResult.electrificationLevel && <div className="text-[10px] text-emerald-300">⚡ {vinResult.electrificationLevel}{vinResult.batteryKWh ? ` · ${vinResult.batteryKWh} kWh` : ''}</div>}
          </div>
        )}
        {recallResult && (
          <div className={cn('rounded-md border p-2.5 max-h-48 overflow-y-auto', (recallResult.count ?? 0) > 0 ? 'border-red-500/30 bg-red-500/5' : 'border-green-500/30 bg-green-500/5')}>
            <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: (recallResult.count ?? 0) > 0 ? '#fca5a5' : '#86efac' }}>Recalls · {recallResult.count ?? recallResult.recalls?.length ?? 0}</div>
            {(recallResult.recalls ?? []).slice(0, 3).map((r, i) => <div key={i} className="text-[11px] text-zinc-300 mt-1.5 pb-1.5 border-b border-red-900/30 last:border-0"><strong className="text-red-200">{r.component}</strong> · <span className="font-mono text-zinc-400">{r.nhtsaId}</span><div className="text-[10px] text-zinc-400 line-clamp-2">{r.summary}</div></div>)}
          </div>
        )}
        {maintResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Maintenance · {maintResult.overdueCount ?? 0} overdue</div>
            <div className="text-[11px] text-zinc-300">next: <span className="text-amber-200">{maintResult.nextService}</span></div>
            {(maintResult.services ?? []).slice(0, 5).map((m, i) => <div key={i} className={cn('text-[10px] mt-0.5', m.status === 'due-now' ? 'text-red-300' : m.status === 'upcoming' ? 'text-amber-300' : 'text-zinc-400')}>{m.service} · {(m.milesUntilDue ?? m.intervalMiles)?.toLocaleString()}mi{m.priority ? ` · ${m.priority}` : ''}</div>)}
          </div>
        )}
        {diagResult && (
          <div className={cn('rounded-md border p-2.5', SEV_COLOR[diagResult.severity ?? 'medium'] === 'text-red-300' ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">OBD · {diagResult.code}</div>
            <div className={cn('text-sm font-semibold', SEV_COLOR[diagResult.severity ?? 'medium'])}>{diagResult.description}</div>
            <div className="text-[10px] text-zinc-400">{diagResult.category} · {diagResult.severity}</div>
            {(diagResult.commonCauses ?? []).slice(0, 3).map((c, i) => <div key={i} className="text-[10px] text-zinc-400 mt-0.5">→ {c}</div>)}
            {diagResult.estimatedCost && <div className="text-[10px] text-amber-300">est. {diagResult.estimatedCost}</div>}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Owner advisory</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
