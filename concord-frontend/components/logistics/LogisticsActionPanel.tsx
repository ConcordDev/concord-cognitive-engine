'use client';

/**
 * LogisticsActionPanel — fleet-dispatch bench.
 * optimizeRoute / hosCheck / maintenanceDue / fleetReport +
 * mint/DM/publish/agent.
 */

import { useState } from 'react';
import { Truck, Clock, Wrench, BarChart3, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('logistics', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T; error?: string } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'route' | 'hos' | 'maint' | 'fleet' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface RouteStop { sequence: number; name: string; distanceFromPrevious: number; cumulativeDistance: number }
interface RouteResult { stopCount: number; totalDistanceMiles: number; estimatedDriveMinutes: number; estimatedServiceMinutes: number; estimatedTotalMinutes: number; returnToOrigin: boolean; optimizedRoute: RouteStop[] }
interface HosDriver { driverId: string; name: string; today: { drivingHours: number; onDutyHours: number; drivingRemaining: number; windowRemaining: number }; cycle: { type: string; hoursUsed: number; hoursRemaining: number; restartAvailable: boolean }; violations: string[]; status: string }
interface HosResult { cycleType: string; driversChecked: number; violationCount: number; warningCount: number; drivers: HosDriver[] }
interface MaintVehicle { vehicleId: string; name: string; type: string; milesSinceService?: number; milesUntilDue?: number; daysSince?: number | null; daysUntilDue?: number | null; reason?: string; status?: string }
interface MaintResult { overdueCount?: number; upcomingCount?: number; currentCount?: number; overdue?: MaintVehicle[]; upcoming?: MaintVehicle[] }
interface FleetResult { fleetSize?: number; activeVehicles?: number; avgMileage?: number; vehiclesByType?: Record<string, number>; totalRevenue?: number; avgUtilization?: number }

const DEFAULT_ROUTE = JSON.stringify({ origin: { lat: 37.77, lng: -122.42 }, stops: [{ stopId: 'A', name: 'Mission depot', lat: 37.76, lng: -122.42, serviceMins: 20 }, { stopId: 'B', name: 'SoMa hub', lat: 37.78, lng: -122.40, serviceMins: 15 }, { stopId: 'C', name: 'Marina retail', lat: 37.80, lng: -122.44, serviceMins: 10 }, { stopId: 'D', name: 'Sunset warehouse', lat: 37.75, lng: -122.49, serviceMins: 25 }, { stopId: 'E', name: 'Embarcadero pickup', lat: 37.79, lng: -122.39, serviceMins: 12 }] }, null, 2);
const DEFAULT_HOS = JSON.stringify({ drivers: [{ driverId: 'd1', name: 'Maria Lopez', logs: [{ date: '2026-05-17', drivingHours: 8.5, onDutyHours: 11.2, offDutyHours: 8 }, { date: '2026-05-16', drivingHours: 10.5, onDutyHours: 13.5, offDutyHours: 10 }, { date: '2026-05-15', drivingHours: 11, onDutyHours: 13, offDutyHours: 10 }] }, { driverId: 'd2', name: 'Carlos Reyes', logs: [{ date: '2026-05-17', drivingHours: 11.2, onDutyHours: 14.5, offDutyHours: 9 }] }] }, null, 2);
const DEFAULT_MAINT = JSON.stringify({ vehicles: [{ vehicleId: 'v1', name: 'Truck 1', type: 'box-truck', currentMileage: 145200, lastServiceMileage: 139000, serviceIntervalMiles: 5000, lastServiceDate: '2026-02-10', serviceIntervalDays: 90 }, { vehicleId: 'v2', name: 'Van 7', type: 'cargo-van', currentMileage: 88200, lastServiceMileage: 85000, serviceIntervalMiles: 5000, lastServiceDate: '2026-04-20', serviceIntervalDays: 90 }, { vehicleId: 'v3', name: 'Truck 9', type: 'box-truck', currentMileage: 220000, lastServiceMileage: 219800, serviceIntervalMiles: 5000, lastServiceDate: '2025-12-01', serviceIntervalDays: 90 }] }, null, 2);
const DEFAULT_FLEET = JSON.stringify({ vehicles: [{ vehicleId: 'v1', type: 'box-truck', currentMileage: 145200, status: 'active', utilizationPct: 78, revenueYTD: 84000 }, { vehicleId: 'v2', type: 'cargo-van', currentMileage: 88200, status: 'active', utilizationPct: 65, revenueYTD: 42000 }, { vehicleId: 'v3', type: 'box-truck', currentMileage: 220000, status: 'maintenance', utilizationPct: 0, revenueYTD: 100000 }] }, null, 2);

export function LogisticsActionPanel() {
  const [routeText, setRouteText] = useState(DEFAULT_ROUTE);
  const [hosText, setHosText] = useState(DEFAULT_HOS);
  const [maintText, setMaintText] = useState(DEFAULT_MAINT);
  const [fleetText, setFleetText] = useState(DEFAULT_FLEET);
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [hosResult, setHosResult] = useState<HosResult | null>(null);
  const [maintResult, setMaintResult] = useState<MaintResult | null>(null);
  const [fleetResult, setFleetResult] = useState<FleetResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  async function actRoute() {
    try { const parsed = JSON.parse(routeText); setBusy('route'); setFeedback(null);
      const r = await callMacro<RouteResult>('optimizeRoute', { artifact: { data: parsed } });
      if (r.ok && r.result) { setRouteResult(r.result); ok(`${r.result.stopCount} stops · ${r.result.totalDistanceMiles}mi · ${r.result.estimatedTotalMinutes}min`); } else err(r.error ?? 'route failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid route JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actHos() {
    try { const parsed = JSON.parse(hosText); setBusy('hos'); setFeedback(null);
      const r = await callMacro<HosResult>('hosCheck', { artifact: { data: parsed } });
      if (r.ok && r.result) { setHosResult(r.result); ok(`${r.result.driversChecked} drivers · ${r.result.violationCount} viol · ${r.result.warningCount} warn`); } else err(r.error ?? 'hos failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid hos JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMaint() {
    try { const parsed = JSON.parse(maintText); setBusy('maint'); setFeedback(null);
      const r = await callMacro<MaintResult>('maintenanceDue', { artifact: { data: parsed } });
      if (r.ok && r.result) { setMaintResult(r.result); ok(`${r.result.overdueCount ?? 0} overdue · ${r.result.upcomingCount ?? 0} upcoming`); } else err(r.error ?? 'maint failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid maint JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actFleet() {
    try { const parsed = JSON.parse(fleetText); setBusy('fleet'); setFeedback(null);
      const r = await callMacro<FleetResult>('fleetReport', { artifact: { data: parsed } });
      if (r.ok && r.result) { setFleetResult(r.result); ok(`Fleet ${r.result.fleetSize ?? 0} · active ${r.result.activeVehicles ?? 0}`); } else err(r.error ?? 'fleet failed');
    } catch (e) { err(e instanceof SyntaxError ? 'Invalid fleet JSON.' : pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Dispatch brief`, tags: ['logistics', 'dispatch'].filter(Boolean), source: 'logistics:dispatch:mint', meta: { visibility: 'private', consent: { allowCitations: false }, fleet: { route: routeResult, hos: hosResult, maint: maintResult, fleet: fleetResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); ok(`Dispatch DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🚚 Dispatch brief`, '', routeResult ? `Route: ${routeResult.stopCount} stops · ${routeResult.totalDistanceMiles}mi · ${Math.round(routeResult.estimatedTotalMinutes / 60 * 10) / 10}h` : '', hosResult ? `HoS: ${hosResult.violationCount} viol · ${hosResult.warningCount} warn (${hosResult.driversChecked} drivers, ${hosResult.cycleType})` : '', maintResult ? `Maint: ${maintResult.overdueCount ?? 0} overdue · ${maintResult.upcomingCount ?? 0} upcoming` : '', fleetResult ? `Fleet: ${fleetResult.fleetSize ?? 0} vehicles · ${fleetResult.activeVehicles ?? 0} active · avg ${fleetResult.avgUtilization ?? 0}% util` : '', mintedDtuId ? `\n[DTU ${mintedDtuId}]` : ''].filter(Boolean).join('\n');
    try { const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body }); if (r.data?.ok !== false) { ok('Sent.'); setRecipient(''); } else err(r.data?.error ?? 'send failed'); }
    catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!routeResult && !fleetResult) { err('Run route or fleet first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', { domain: 'dtu', name: 'create', input: { title: `Fleet snapshot`, tags: ['logistics', 'fleet', 'public'], source: 'logistics:fleet:publish', meta: { visibility: 'public', consent: { allowCitations: true }, anon: true, fleet: { route: routeResult, fleet: fleetResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.dtu?.id ?? r.data?.result?.id;
      if (!id) { err('No DTU id.'); return; }
      const pub = await api.post(`/api/dtus/${encodeURIComponent(id)}/publish`);
      if (pub.data?.ok !== false) { setPublishedDtuId(id); ok(`Published ${id.slice(0, 8)}…`); } else err(pub.data?.error ?? 'publish failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Dispatch supervisor brief. ${routeResult ? `Route: ${routeResult.stopCount} stops, ${routeResult.totalDistanceMiles}mi, est ${routeResult.estimatedTotalMinutes}min.` : ''} ${hosResult ? `HoS: ${hosResult.violationCount} violations, ${hosResult.warningCount} warnings.` : ''} ${maintResult ? `Maintenance: ${maintResult.overdueCount ?? 0} overdue.` : ''} ${fleetResult ? `Fleet utilization avg ${fleetResult.avgUtilization ?? 0}%.` : ''} Recommend the top dispatch action for the next 24h + one safety/compliance risk. Plain text, ≤ 3 sentences.`;
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Dispatch brief ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'route' as ActionId, label: 'Route', desc: 'optimizeRoute (NN)', icon: Truck, accent: '#3b82f6', handler: actRoute },
    { id: 'hos' as ActionId, label: 'HoS', desc: 'hosCheck (FMCSA)', icon: Clock, accent: '#ef4444', handler: actHos },
    { id: 'maint' as ActionId, label: 'Maintenance', desc: 'maintenanceDue', icon: Wrench, accent: '#f59e0b', handler: actMaint },
    { id: 'fleet' as ActionId, label: 'Fleet', desc: 'fleetReport', icon: BarChart3, accent: '#22c55e', handler: actFleet },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private brief', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send brief', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Anon snapshot', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Supervisor', desc: 'Agent: next 24h', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const STATUS_COLOR: Record<string, string> = { compliant: 'text-emerald-300', warning: 'text-amber-300', violation: 'text-red-300' };

  return (
    <div className="rounded-lg border border-orange-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-orange-500/10 pb-2">
        <Truck className="h-4 w-4 text-orange-400" />
        <h3 className="text-sm font-semibold text-white">Logistics dispatch bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">route · HoS · maint · fleet</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Route JSON</label>
          <textarea value={routeText} onChange={(e) => setRouteText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">HoS drivers JSON</label>
          <textarea value={hosText} onChange={(e) => setHosText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">Maintenance JSON</label>
          <textarea value={maintText} onChange={(e) => setMaintText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Fleet JSON</label>
          <textarea value={fleetText} onChange={(e) => setFleetText(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient user-id" />
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
        {routeResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Route · {routeResult.totalDistanceMiles}mi</div>
            <div className="text-2xl font-bold text-blue-200">{Math.round(routeResult.estimatedTotalMinutes / 60 * 10) / 10}<span className="text-xs text-zinc-400">h</span></div>
            <div className="text-[10px] text-zinc-500">{routeResult.stopCount} stops · drive {routeResult.estimatedDriveMinutes}m · svc {routeResult.estimatedServiceMinutes}m</div>
            {routeResult.optimizedRoute.slice(0, 6).map((s, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span><strong>{s.sequence}.</strong> {s.name}</span><span className="font-mono text-blue-200">{s.distanceFromPrevious}mi</span></div>)}
          </div>
        )}
        {hosResult && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-red-300 font-semibold">HoS · {hosResult.cycleType}</div>
            <div className="text-2xl font-bold text-red-200">{hosResult.violationCount}<span className="text-xs text-zinc-400"> viol</span></div>
            <div className="text-[10px] text-zinc-300">{hosResult.warningCount} warn · {hosResult.driversChecked} drivers</div>
            {hosResult.drivers.slice(0, 5).map((d, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span className="truncate"><strong>{d.name}</strong>: {d.today.drivingHours}/11h</span><span className={cn('font-mono text-[9px]', STATUS_COLOR[d.status])}>{d.status}</span></div>)}
          </div>
        )}
        {maintResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Maint</div>
            <div className="text-2xl font-bold text-amber-200">{maintResult.overdueCount ?? 0}<span className="text-xs text-zinc-400"> overdue</span></div>
            <div className="text-[10px] text-zinc-300">{maintResult.upcomingCount ?? 0} upcoming · {maintResult.currentCount ?? 0} current</div>
            {(maintResult.overdue ?? []).slice(0, 4).map((v, i) => <div key={i} className="text-[10px] text-red-300 mt-0.5"><strong>{v.name}</strong>: {v.reason ?? `${-Math.round(v.milesUntilDue ?? 0)}mi overdue`}</div>)}
            {(maintResult.upcoming ?? []).slice(0, 3).map((v, i) => <div key={i} className="text-[10px] text-amber-200 mt-0.5"><strong>{v.name}</strong>: {v.milesUntilDue ? `${v.milesUntilDue}mi` : `${v.daysUntilDue}d`}</div>)}
          </div>
        )}
        {fleetResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5 max-h-44 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Fleet</div>
            <div className="text-2xl font-bold text-green-200">{fleetResult.fleetSize ?? 0}</div>
            <div className="text-[10px] text-zinc-300">{fleetResult.activeVehicles ?? 0} active · avg {fleetResult.avgUtilization ?? 0}% util</div>
            <div className="text-[10px] text-zinc-500">Avg mileage: {fleetResult.avgMileage?.toLocaleString() ?? '—'}</div>
            {fleetResult.vehiclesByType && Object.entries(fleetResult.vehiclesByType).map(([t, c], i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex justify-between"><span>{t}</span><span className="font-mono text-green-200">{c}</span></div>)}
            {fleetResult.totalRevenue !== undefined && <div className="text-[10px] text-green-200 mt-1">Revenue: ${(fleetResult.totalRevenue / 1000).toFixed(0)}k YTD</div>}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Dispatch supervisor</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
