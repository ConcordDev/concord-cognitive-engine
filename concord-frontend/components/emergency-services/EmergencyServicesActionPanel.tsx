'use client';

/**
 * EmergencyServicesActionPanel — dispatch + EMS bench.
 * triageAssess (START triage) / dispatchOptimize / incidentLog /
 * resourceReadiness + mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Truck, Radio, Activity, ListChecks, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('emergency-services', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'triage' | 'disp' | 'log' | 'ready' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface TriageResult { triageLevel: number; triageColor: string; breathing: boolean; conscious: boolean; pulse: number; reportedSeverity: number; responseTime: string; actions: string[] }
interface Assignment { incident: string; priority: number; assignedUnit: string; eta: string }
interface DispResult { totalUnits: number; available: number; activeIncidents: number; assignments: Assignment[]; coverageGap: boolean }
interface LogResult { total24h: number; totalAllTime: number; byType: Record<string, number>; mostCommon: string; avgResponseMinutes: number; trend: string }
interface ReadyResult { vehicleReadiness: number; personnelReadiness: number; suppliesLevel: number; overallReadiness: number; status: string; shortages: string[] }

const DEMO_DISPATCH = JSON.stringify({
  units: [
    { name: 'M1', status: 'available', distanceKm: 1.8 },
    { name: 'M2', status: 'available', distanceKm: 4.2 },
    { name: 'M3', status: 'on-call', distanceKm: 0 },
    { name: 'E5', status: 'available', distanceKm: 3.1 },
  ],
  incidents: [
    { description: 'Cardiac arrest — Pine St', priority: 1 },
    { description: 'MVA — Hwy 101 N', priority: 2 },
    { description: 'Structure fire — Oak & 3rd', priority: 1 },
  ],
}, null, 2);

const DEMO_LOG = JSON.stringify({
  incidents: [
    { type: 'medical', timestamp: new Date(Date.now() - 3600000).toISOString(), responseMinutes: 7 },
    { type: 'medical', timestamp: new Date(Date.now() - 7200000).toISOString(), responseMinutes: 9 },
    { type: 'mva', timestamp: new Date(Date.now() - 14400000).toISOString(), responseMinutes: 12 },
    { type: 'fire', timestamp: new Date(Date.now() - 18000000).toISOString(), responseMinutes: 8 },
    { type: 'medical', timestamp: new Date(Date.now() - 28800000).toISOString(), responseMinutes: 6 },
  ],
}, null, 2);

export function EmergencyServicesActionPanel() {
  const [severity, setSeverity] = useState('2');
  const [breathing, setBreathing] = useState(true);
  const [conscious, setConscious] = useState(true);
  const [pulse, setPulse] = useState('118');
  const [dispText, setDispText] = useState(DEMO_DISPATCH);
  const [logText, setLogText] = useState(DEMO_LOG);
  const [vehicles, setVehicles] = useState('12');
  const [vehiclesReady, setVehiclesReady] = useState('9');
  const [personnel, setPersonnel] = useState('48');
  const [personnelOnDuty, setPersonnelOnDuty] = useState('38');
  const [suppliesPercent, setSuppliesPercent] = useState('72');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [triageResult, setTriageResult] = useState<TriageResult | null>(null);
  const [dispResult, setDispResult] = useState<DispResult | null>(null);
  const [logResult, setLogResult] = useState<LogResult | null>(null);
  const [readyResult, setReadyResult] = useState<ReadyResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actTriage() {
    setBusy('triage'); setFeedback(null);
    try { const r = await callMacro<TriageResult>('triageAssess', { artifact: { data: { severity: parseInt(severity, 10), vitals: { breathing, conscious, pulse: parseInt(pulse, 10) } } } }); if (r.ok && r.result) { setTriageResult(r.result); ok(r.result.triageColor); } else err(r.error ?? 'triage failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDisp() {
    try { const parsed = JSON.parse(dispText); setBusy('disp'); setFeedback(null);
      const r = await callMacro<DispResult>('dispatchOptimize', { artifact: { data: parsed } }); if (r.ok && r.result) { setDispResult(r.result); ok(`${r.result.activeIncidents} incidents · ${r.result.available} units${r.result.coverageGap ? ' (gap!)' : ''}.`); } else err(r.error ?? 'disp failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid dispatch JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actLog() {
    try { const parsed = JSON.parse(logText); setBusy('log'); setFeedback(null);
      const r = await callMacro<LogResult>('incidentLog', { artifact: { data: parsed } }); if (r.ok && r.result) { setLogResult(r.result); ok(`${r.result.total24h} in 24h · avg ${r.result.avgResponseMinutes}min.`); } else err(r.error ?? 'log failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid log JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actReady() {
    setBusy('ready'); setFeedback(null);
    try { const r = await callMacro<ReadyResult>('resourceReadiness', { artifact: { data: { resources: { vehicles: parseInt(vehicles, 10), vehiclesReady: parseInt(vehiclesReady, 10), personnel: parseInt(personnel, 10), personnelOnDuty: parseInt(personnelOnDuty, 10), suppliesPercent: parseFloat(suppliesPercent) } } } }); if (r.ok && r.result) { setReadyResult(r.result); ok(`${r.result.overallReadiness}% · ${r.result.status}.`); } else err(r.error ?? 'ready failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `EMS shift report`, tags: ['ems', 'dispatch', readyResult?.status].filter((t): t is string => !!t), source: 'ems:shift:mint', meta: { visibility: 'private', consent: { allowCitations: false }, ems: { triage: triageResult, disp: dispResult, log: logResult, ready: readyResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Shift DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🚑 EMS shift`, '', triageResult ? `Triage: ${triageResult.triageColor} · response ${triageResult.responseTime}` : '', dispResult ? `Dispatch: ${dispResult.activeIncidents} incidents / ${dispResult.available} units${dispResult.coverageGap ? ' (COVERAGE GAP)' : ''}` : '', logResult ? `Volume: ${logResult.total24h} in 24h (${logResult.trend}) · avg ${logResult.avgResponseMinutes}min · top: ${logResult.mostCommon}` : '', readyResult ? `Readiness: ${readyResult.overallReadiness}% (${readyResult.status})${readyResult.shortages.length ? ` · short: ${readyResult.shortages.join(', ')}` : ''}` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!logResult) { err('Run log first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `EMS volume report (anon)`, tags: ['ems', 'volume', 'public'], source: 'ems:volume:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, log: logResult } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `EMS dispatch supervisor brief. ${dispResult ? `${dispResult.activeIncidents} active incidents, ${dispResult.available} units available${dispResult.coverageGap ? ' (coverage gap)' : ''}.` : ''} ${readyResult ? `Readiness ${readyResult.overallReadiness}% (${readyResult.status})${readyResult.shortages.length ? `, shortages: ${readyResult.shortages.join(', ')}` : ''}.` : ''} ${logResult ? `${logResult.total24h} runs in 24h, avg ${logResult.avgResponseMinutes}min response.` : ''} Identify single most urgent action this shift + one staffing recommendation. Plain text, 3 sentences max.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'triage' as ActionId, label: 'Triage', desc: 'START method', icon: Activity, accent: '#ef4444', handler: actTriage },
    { id: 'disp' as ActionId, label: 'Dispatch', desc: 'dispatchOptimize', icon: Radio, accent: '#f59e0b', handler: actDisp },
    { id: 'log' as ActionId, label: 'Log', desc: 'incidentLog 24h', icon: ListChecks, accent: '#3b82f6', handler: actLog },
    { id: 'ready' as ActionId, label: 'Ready', desc: 'resourceReadiness', icon: Truck, accent: '#22c55e', handler: actReady },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private shift DTU', icon: Sparkles, accent: '#a855f7', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send shift brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon volume report', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Brief', desc: 'Agent: shift action', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const TRIAGE_COLOR: Record<number, string> = { 1: 'border-red-500/30 bg-red-500/5 text-red-300', 2: 'border-amber-500/30 bg-amber-500/5 text-amber-300', 3: 'border-green-500/30 bg-green-500/5 text-green-300', 4: 'border-green-500/30 bg-green-500/5 text-green-300', 5: 'border-zinc-500/30 bg-zinc-500/5 text-zinc-300' };

  return (
    <div className="rounded-lg border border-red-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-red-500/10 pb-2">
        <Truck className="h-4 w-4 text-red-400" />
        <h3 className="text-sm font-semibold text-white">EMS dispatch</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">START triage · dispatch · readiness</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">Triage vitals</div>
          <div className="grid grid-cols-2 gap-1">
            <input type="text" value={severity} onChange={(e) => setSeverity(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Sev 1-5" />
            <input type="text" value={pulse} onChange={(e) => setPulse(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Pulse" />
          </div>
          <div className="flex gap-2 text-[11px]">
            <label className="flex items-center gap-1 text-zinc-300"><input type="checkbox" checked={breathing} onChange={(e) => setBreathing(e.target.checked)} /> breathing</label>
            <label className="flex items-center gap-1 text-zinc-300"><input type="checkbox" checked={conscious} onChange={(e) => setConscious(e.target.checked)} /> conscious</label>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-green-400 font-semibold mt-2">Readiness</div>
          <div className="grid grid-cols-2 gap-1">
            <input type="text" value={vehicles} onChange={(e) => setVehicles(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Vehicles" />
            <input type="text" value={vehiclesReady} onChange={(e) => setVehiclesReady(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="V ready" />
            <input type="text" value={personnel} onChange={(e) => setPersonnel(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Personnel" />
            <input type="text" value={personnelOnDuty} onChange={(e) => setPersonnelOnDuty(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="P on duty" />
            <input type="text" value={suppliesPercent} onChange={(e) => setSuppliesPercent(e.target.value)} className="col-span-2 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" placeholder="Supplies %" />
          </div>
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Dispatch JSON</label>
          <textarea value={dispText} onChange={(e) => setDispText(e.target.value)} rows={9} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Incident log JSON</label>
          <textarea value={logText} onChange={(e) => setLogText(e.target.value)} rows={9} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
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
        {triageResult && (
          <div className={cn('rounded-md border p-2.5', TRIAGE_COLOR[triageResult.triageLevel])}>
            <div className="text-[10px] uppercase tracking-wider font-semibold">Triage</div>
            <div className="text-[12px] font-bold">{triageResult.triageColor}</div>
            <div className="text-[10px] text-zinc-500">response: {triageResult.responseTime}</div>
            {triageResult.actions.map((a, i) => <div key={i} className="text-[10px] mt-0.5">→ {a}</div>)}
          </div>
        )}
        {dispResult && (
          <div className={cn('rounded-md border p-2.5', dispResult.coverageGap ? 'border-red-500/30 bg-red-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Dispatch</div>
            <div className="text-2xl font-bold text-amber-300">{dispResult.activeIncidents}<span className="text-xs text-zinc-400"> / {dispResult.available} units</span></div>
            {dispResult.coverageGap && <div className="text-[10px] text-red-300 font-semibold">⚠ COVERAGE GAP</div>}
            {dispResult.assignments.slice(0, 3).map((a, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5">P{a.priority} {a.assignedUnit} → {a.eta}</div>)}
          </div>
        )}
        {logResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Log 24h · {logResult.trend}</div>
            <div className="text-2xl font-bold text-blue-300">{logResult.total24h}</div>
            <div className="text-[10px] text-zinc-500">avg {logResult.avgResponseMinutes}min · top: {logResult.mostCommon}</div>
            {Object.entries(logResult.byType).slice(0, 4).map(([t, c]) => <div key={t} className="text-[10px] text-blue-200">{t}: {c}</div>)}
          </div>
        )}
        {readyResult && (
          <div className={cn('rounded-md border p-2.5', readyResult.overallReadiness >= 80 ? 'border-emerald-500/30 bg-emerald-500/5' : readyResult.overallReadiness >= 60 ? 'border-amber-500/30 bg-amber-500/5' : 'border-red-500/30 bg-red-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Readiness · {readyResult.status}</div>
            <div className={cn('text-3xl font-bold', readyResult.overallReadiness >= 80 ? 'text-emerald-300' : readyResult.overallReadiness >= 60 ? 'text-amber-300' : 'text-red-300')}>{readyResult.overallReadiness}%</div>
            <div className="text-[10px] text-zinc-500">V {readyResult.vehicleReadiness}% · P {readyResult.personnelReadiness}% · S {readyResult.suppliesLevel}%</div>
            {readyResult.shortages.length > 0 && <div className="text-[10px] text-red-300">⚠ short: {readyResult.shortages.join(', ')}</div>}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Supervisor brief</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
