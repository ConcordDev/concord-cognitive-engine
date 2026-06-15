'use client';

/**
 * ObserveActionPanel — Datadog-shape observability action surface.
 * Self-contained input for SLO + service log + incident open, runs
 * the 4 new observe.* macros plus mint/DM/publish/agent.
 */

import { useState } from 'react';
import {
  Activity, AlertTriangle, Bell, Target, Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertOctagon,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string; reason?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('observe', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'log' | 'alert' | 'incident' | 'slo' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

interface ServiceLogResult { windowMinutes?: number; count?: number; byLevel?: Record<string, number>; errorRate?: number; topService?: string; message?: string }
interface AlertSummaryResult { total?: number; firingNow?: number; resolved?: number; meanResolveMin?: number | null; byService?: Record<string, { firing: number; resolved: number }> }
interface SloResult { targetPct?: number; actualPct?: number; errorBudgetPct?: number; burnRate?: number; status?: string; remainingBudgetMinutes?: number }
interface IncidentResult { incident?: { id: string; title: string; severity: string; affectedService: string; status: string; openedAt: string }; total?: number }

export function ObserveActionPanel() {
  const [serviceLogs, setServiceLogs] = useState('');
  const [alertList, setAlertList] = useState('');
  const [incTitle, setIncTitle] = useState('');
  const [incSev, setIncSev] = useState<'sev1' | 'sev2' | 'sev3' | 'sev4'>('sev3');
  const [incService, setIncService] = useState('');
  const [sloTarget, setSloTarget] = useState('');
  const [sloActual, setSloActual] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [logResult, setLogResult] = useState<ServiceLogResult | null>(null);
  const [alertResult, setAlertResult] = useState<AlertSummaryResult | null>(null);
  const [sloResult, setSloResult] = useState<SloResult | null>(null);
  const [incidentResult, setIncidentResult] = useState<IncidentResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({
    label: 'DM',
    windowMs: 60_000,
    onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); },
  });
  const publishRecall = useRecallableAction({
    label: 'publish',
    windowMs: 30_000,
    onUndo: async (id) => {
      await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`);
      setPublishedDtuId(null);
    },
  });

  function parseLogs() {
    return serviceLogs.split('\n').map((l) => {
      const m = l.match(/^(?<level>[A-Z]+)\s+(?<ts>\S+)\s+(?<service>\S+)\s+(?<message>.+)$/);
      return m ? { level: m.groups!.level, ts: m.groups!.ts, service: m.groups!.service, message: m.groups!.message } : null;
    }).filter(Boolean);
  }
  function parseAlerts() {
    return alertList.split('\n').map((l) => {
      const parts = l.split(',').map(s => s.trim());
      if (parts.length < 3) return null;
      return { severity: parts[0], service: parts[1], fired_at: parts[2], resolved_at: parts[3] || undefined };
    }).filter(Boolean);
  }

  async function actLog() {
    const entries = parseLogs();
    if (!entries.length) { err('Add log lines (LEVEL ts service message).'); return; }
    setBusy('log'); setFeedback(null);
    try {
      const r = await callMacro<ServiceLogResult>('serviceLog', { entries, windowMinutes: 60 });
      if (r.ok && r.result) { setLogResult(r.result); pipe.publish('observe.logs', r.result, { label: `${r.result.count} lines · ${r.result.errorRate}% err` }); ok(`${r.result.count} lines, ${r.result.errorRate}% errors.`); }
      else err(r.error ?? r.reason ?? 'log failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actAlert() {
    const alerts = parseAlerts();
    if (!alerts.length) { err('Add alerts (severity,service,fired_at[,resolved_at]).'); return; }
    setBusy('alert'); setFeedback(null);
    try {
      const r = await callMacro<AlertSummaryResult>('alertSummary', { alerts });
      if (r.ok && r.result) { setAlertResult(r.result); pipe.publish('observe.alerts', r.result, { label: `${r.result.firingNow} firing` }); ok(`${r.result.firingNow} firing, ${r.result.resolved} resolved.`); }
      else err(r.error ?? 'alert summary failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actIncident() {
    if (!incTitle.trim()) { err('Incident title required.'); return; }
    setBusy('incident'); setFeedback(null);
    try {
      const r = await callMacro<IncidentResult>('incidentTrack', { title: incTitle.trim(), severity: incSev, affectedService: incService.trim() || 'unknown' });
      if (r.ok && r.result) { setIncidentResult(r.result); pipe.publish('observe.incident', r.result, { label: r.result.incident?.id ?? 'incident' }); ok(`Incident ${r.result.incident?.id}.`); }
      else err(r.error ?? 'incident open failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actSlo() {
    setBusy('slo'); setFeedback(null);
    try {
      const r = await callMacro<SloResult>('sloCheck', { targetPct: parseFloat(sloTarget), actualPct: parseFloat(sloActual), windowDays: 30 });
      if (r.ok && r.result) { setSloResult(r.result); pipe.publish('observe.slo', r.result, { label: `SLO ${r.result.status}` }); ok(`SLO ${r.result.status}.`); }
      else err(r.reason ?? r.error ?? 'SLO check failed');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: {
          title: `Observability snapshot — ${new Date().toISOString().slice(0, 10)}`,
          tags: ['observe', 'snapshot', sloResult?.status ?? 'unknown'],
          source: 'observe:snapshot:mint',
          meta: {
            visibility: 'private',
            consent: { allowCitations: false },
            observability: { logs: logResult, alerts: alertResult, slo: sloResult, incident: incidentResult },
          },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) { setMintedDtuId(id); pipe.publish('observe.mintedDtuId', id, { label: `snapshot ${id.slice(0, 8)}` }); ok(`Snapshot DTU ${id.slice(0, 8)}…`); }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actDm() {
    if (!recipient.trim()) { err('Enter a recipient.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [
      `📊 Observability snapshot — ${new Date().toLocaleString()}`,
      '',
      logResult ? `Logs (last ${logResult.windowMinutes}m): ${logResult.count} lines · ${logResult.errorRate}% errors · top: ${logResult.topService}` : '',
      alertResult ? `Alerts: ${alertResult.firingNow} firing, ${alertResult.resolved} resolved` + (alertResult.meanResolveMin != null ? ` (mean ${alertResult.meanResolveMin}m)` : '') : '',
      sloResult ? `SLO: ${sloResult.status} (target ${sloResult.targetPct}%, actual ${sloResult.actualPct}%, burn ${sloResult.burnRate}×)` : '',
      incidentResult?.incident ? `Open incident: ${incidentResult.incident.id} (${incidentResult.incident.severity})` : '',
      mintedDtuId ? `\n[DTU ${mintedDtuId}]` : '',
    ].filter(Boolean).join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { ok('Sent. 60s to recall.'); setRecipient(''); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actPublish() {
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', {
          domain: 'dtu', name: 'create',
          input: {
            title: `Public SLO report — ${new Date().toISOString().slice(0, 10)}`,
            tags: ['observe', 'slo', 'public', sloResult?.status ?? 'unknown'],
            source: 'observe:slo:publish',
            meta: { visibility: 'public', consent: { allowCitations: true }, slo: sloResult },
          },
        });
        const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
        const newId = dtu?.id ?? dtu?.dtuId;
        if (!newId) throw new Error('No DTU id returned.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish flag failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('observe.publishedDtuId', id, { label: `SLO ${id.slice(0, 8)}` }); ok(`SLO report published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = [
        `Observability state:`,
        logResult ? `logs ${logResult.count} lines, ${logResult.errorRate}% errors, top service ${logResult.topService};` : '',
        alertResult ? `alerts ${alertResult.firingNow} firing, ${alertResult.resolved} resolved;` : '',
        sloResult ? `SLO ${sloResult.status} (burn ${sloResult.burnRate}×);` : '',
        incidentResult?.incident ? `open incident ${incidentResult.incident.id} sev ${incidentResult.incident.severity};` : '',
        '',
        'Given this state, what are the top 3 actions the on-call should take in the next 30 minutes?',
        'Return plain text, one per line, with the recommended owner role next to each.',
      ].filter(Boolean).join(' ');
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 4 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Triage suggestions ready.'); }
      else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void }> = [
    { id: 'log',      label: 'Log summary',  desc: 'serviceLog over recent entries',         icon: Activity,    accent: '#06b6d4', handler: actLog },
    { id: 'alert',    label: 'Alerts',       desc: 'alertSummary group by service',          icon: Bell,        accent: '#f97316', handler: actAlert },
    { id: 'incident', label: 'Open incident', desc: 'incidentTrack + open ticket',           icon: AlertOctagon, accent: '#ef4444', handler: actIncident },
    { id: 'slo',      label: 'SLO check',    desc: 'sloCheck target vs actual + burn rate', icon: Target,      accent: '#22c55e', handler: actSlo },
    { id: 'mint',     label: mintedDtuId    ? 'Saved'     : 'Mint snapshot',  desc: mintedDtuId    ? `DTU ${mintedDtuId.slice(0, 8)}…`     : 'Private DTU of full state',     icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm',       label: 'DM on-call',   desc: 'Send snapshot to on-call user',          icon: Send,        accent: '#ec4899', handler: actDm },
    { id: 'publish',  label: publishedDtuId ? 'Published' : 'Publish SLO',    desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Public SLO report + federation', icon: Globe,    accent: '#15803d', handler: actPublish },
    { id: 'agent',    label: 'Triage agent',  desc: 'Top-3 actions for next 30 min',         icon: Wand2,        accent: '#eab308', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-cyan-500/10 pb-2">
        <Activity className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">Observability workbench</h3>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Log lines (LEVEL ts service message)</label>
            <textarea value={serviceLogs} onChange={(e) => setServiceLogs(e.target.value)} rows={4} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono focus:outline-none focus:ring-2 focus:ring-cyan-400/40 resize-none" placeholder="ERROR 2026-05-16T10:00:00Z api timeout connecting to db
INFO 2026-05-16T10:01:00Z api healthy" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Alerts (severity,service,fired_at[,resolved_at])</label>
            <textarea value={alertList} onChange={(e) => setAlertList(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono focus:outline-none focus:ring-2 focus:ring-orange-400/40 resize-none" placeholder="critical,api,2026-05-16T10:00Z,2026-05-16T10:15Z
high,db,2026-05-16T10:05Z" />
          </div>
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">SLO target %</label>
              <input type="text" value={sloTarget} onChange={(e) => setSloTarget(e.target.value.replace(/[^\d.]/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">Actual %</label>
              <input type="text" value={sloActual} onChange={(e) => setSloActual(e.target.value.replace(/[^\d.]/g, ''))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white font-mono" />
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">New incident title</label>
            <input type="text" value={incTitle} onChange={(e) => setIncTitle(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white" placeholder="api 5xx spike" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select value={incSev} onChange={(e) => setIncSev(e.target.value as typeof incSev)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white">
              {(['sev1', 'sev2', 'sev3', 'sev4'] as const).map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
            </select>
            <input type="text" value={incService} onChange={(e) => setIncService(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white" placeholder="affected service" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1 block">DM on-call (for snapshot)</label>
            <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white" placeholder="on-call user id" />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {actions.map(a => {
          const Icon = a.icon;
          const isBusy = busy === a.id;
          return (
            <button
              key={a.id} type="button"
              disabled={!!busy}
              onClick={a.handler}
              className={cn(
                'group flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all',
                'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700',
                'disabled:opacity-40 disabled:cursor-not-allowed',
              )}
            >
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: a.accent + '20', color: a.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[12px] font-semibold text-zinc-100 leading-tight">{a.label}</div>
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {logResult && (
          <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5 space-y-0.5">
            <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold flex items-center gap-1.5"><Activity className="w-3 h-3" /> Log summary</div>
            <div className="text-[11px] text-zinc-300">{logResult.count ?? 0} lines · top: {logResult.topService} · error rate: <span className={cn('font-mono', (logResult.errorRate ?? 0) > 5 ? 'text-rose-300' : 'text-emerald-300')}>{logResult.errorRate}%</span></div>
            {logResult.byLevel && Object.keys(logResult.byLevel).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {Object.entries(logResult.byLevel).map(([lvl, cnt]) => (
                  <span key={lvl} className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[10px] font-mono text-zinc-300">{lvl} {cnt}</span>
                ))}
              </div>
            )}
          </div>
        )}
        {alertResult && (
          <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-2.5 space-y-0.5">
            <div className="text-[10px] uppercase tracking-wider text-orange-300 font-semibold flex items-center gap-1.5"><Bell className="w-3 h-3" /> Alerts</div>
            <div className="text-[11px] text-zinc-300">{alertResult.firingNow} firing · {alertResult.resolved} resolved{alertResult.meanResolveMin != null && ` · MTTR ${alertResult.meanResolveMin}m`}</div>
          </div>
        )}
        {sloResult && (
          <div className={cn('rounded-md border p-2.5 space-y-0.5', sloResult.status === 'critical' ? 'border-rose-500/40 bg-rose-500/5' : sloResult.status === 'burning' ? 'border-amber-500/40 bg-amber-500/5' : sloResult.status === 'watch' ? 'border-yellow-500/40 bg-yellow-500/5' : 'border-emerald-500/40 bg-emerald-500/5')}>
            <div className={cn('text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5', sloResult.status === 'critical' ? 'text-rose-300' : sloResult.status === 'burning' ? 'text-amber-300' : sloResult.status === 'watch' ? 'text-yellow-300' : 'text-emerald-300')}>
              <Target className="w-3 h-3" /> SLO {sloResult.status}
            </div>
            <div className="text-[11px] text-zinc-300">target <span className="font-mono">{sloResult.targetPct}%</span> · actual <span className="font-mono">{sloResult.actualPct}%</span> · burn <span className="font-mono">{sloResult.burnRate}×</span></div>
            {sloResult.remainingBudgetMinutes != null && <div className="text-[10px] text-zinc-400">budget remaining: ~{sloResult.remainingBudgetMinutes} min</div>}
          </div>
        )}
        {incidentResult?.incident && (
          <div className="rounded-md border border-red-500/40 bg-red-500/5 p-2.5 space-y-0.5">
            <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold flex items-center gap-1.5"><AlertOctagon className="w-3 h-3" /> Incident {incidentResult.incident.id}</div>
            <div className="text-[11px] text-zinc-300">{incidentResult.incident.title} <span className="text-[10px] text-zinc-400">({incidentResult.incident.severity} · {incidentResult.incident.affectedService})</span></div>
          </div>
        )}
      </div>

      {agentReply && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-72 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]">
            <Wand2 className="w-3 h-3" /> Triage suggestions
          </div>
          <pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre>
        </div>
      )}

      <AnimatePresence>
        {feedback && (
          <motion.div
            key={feedback.text}
            initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }}
            className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}
          >
            {feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}
            <span>{feedback.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
