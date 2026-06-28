'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * IncidentConsole — full PagerDuty-shape incident management surface.
 *
 * Wires the 2026-parity ops.* macros: live incident lifecycle, alert
 * ingestion, multi-step escalation policies, on-call calendar + overrides,
 * notification dispatch, service directory + dependency graph, MTTA/MTTR
 * analytics, and a public status page. Every value rendered is the real
 * result of a macro call — no mock data.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit, TimelineView, TreeDiagram } from '@/components/viz';
import type { TreeNode } from '@/components/viz';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, Bell, CalendarClock, GitBranch, Activity,
  Globe, Plus, Loader2, Check, Radio,
} from 'lucide-react';

// ───────────────────────── types ─────────────────────────
type Sev = 'sev1' | 'sev2' | 'sev3' | 'sev4';
type IncStatus = 'triggered' | 'acknowledged' | 'resolved';
type Channel = 'email' | 'sms' | 'push';

interface TimelineEntry { at: string; event: string; by?: string; note?: string }
interface Incident {
  id: string; number: number; title: string; severity: Sev; status: IncStatus;
  serviceId?: string | null; source?: string; summary?: string; createdAt: string;
  acknowledgedAt?: string | null; resolvedAt?: string | null; timeline: TimelineEntry[];
}
interface RawAlert {
  id: string; number: number; signature: string; message?: string; severity: Sev;
  sourceSystem?: string; serviceName?: string | null; receivedAt: string; incidentId?: string | null;
}
interface PolicyTier { level: number; afterMinutes: number; target: string; channel: Channel }
interface Policy { id: string; number: number; name: string; tiers: PolicyTier[]; createdAt: string }
interface Service {
  id: string; number: number; name: string; owner?: string | null;
  dependsOn: string[]; alertKeys: string[]; tier: string; createdAt: string;
}
interface Shift { id: string; number: number; responder: string; startsAt: string; endsAt: string; kind?: string }
interface Gap { from: string; to: string; minutes: number }
interface Notification {
  id: string; number: number; incidentId?: string | null; target: string;
  channel: Channel; tier: number; message: string; status: string; dispatchedAt: string;
}
interface Analytics {
  windowDays: number; totalIncidents: number; openIncidents: number; resolvedIncidents: number;
  mttaMinutes: number; mttrMinutes: number;
  bySeverity: Record<string, { total: number; resolved: number; mttrMin: number }>;
  weeklyTrend: Array<{ week: string; count: number }>;
}
interface StatusComponent { id: string; name: string; tier: string; status: string; openIncidents: number; uptime90dPct: number }
interface StatusPage {
  overall: string; components: StatusComponent[];
  recentIncidents: Array<{ id: string; number: number; title: string; severity: Sev; status: IncStatus; createdAt: string }>;
  activeIncidentCount: number; generatedAt: string;
}

type Tab = 'incidents' | 'alerts' | 'services' | 'oncall' | 'policies' | 'analytics' | 'status';

const SEV_COLOR: Record<Sev, string> = {
  sev1: '#ef4444', sev2: '#f97316', sev3: '#eab308', sev4: '#64748b',
};
const STATUS_COLOR: Record<IncStatus, string> = {
  triggered: '#ef4444', acknowledged: '#eab308', resolved: '#22c55e',
};

async function run<T = any>(name: string, params: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const r = await lensRun('ops', name, params);
    if (r.data?.ok) return r.data.result as T;
    return null;
  } catch {
    return null;
  }
}

// Same call, but surfaces the failure reason so the primary incidents view can
// render an honest role=alert error state with a working Retry (vs silently
// swallowing it). Returns { ok, result } | { ok:false, error }.
async function runResult<T = any>(name: string, params: Record<string, unknown> = {}): Promise<
  { ok: true; result: T } | { ok: false; error: string }
> {
  try {
    const r = await lensRun('ops', name, params);
    if (r.data?.ok) return { ok: true, result: r.data.result as T };
    return { ok: false, error: r.data?.error || 'request failed' };
  } catch (e) {
    return { ok: false, error: (e as { message?: string })?.message || 'network error' };
  }
}

// ───────────────────────── component ─────────────────────────
export function IncidentConsole() {
  const [tab, setTab] = useState<Tab>('incidents');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [alerts, setAlerts] = useState<RawAlert[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [overrides, setOverrides] = useState<Shift[]>([]);
  const [currentOnCall, setCurrentOnCall] = useState<{ name: string | null; source: string }>({ name: null, source: 'none' });
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [status, setStatus] = useState<StatusPage | null>(null);
  const [graphEdges, setGraphEdges] = useState<Array<{ from: string; to: string }>>([]);
  const [selectedIncident, setSelectedIncident] = useState<string | null>(null);
  // Primary-surface load state (incidents) → drives the four UX states.
  const [incLoading, setIncLoading] = useState(true);
  const [incError, setIncError] = useState<string | null>(null);

  const flash = (kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3200);
  };

  // ── loaders ──
  const loadIncidents = useCallback(async () => {
    setIncLoading(true);
    setIncError(null);
    const r = await runResult<{ incidents: Incident[] }>('incidentList', {});
    if (r.ok) setIncidents(r.result.incidents || []);
    else setIncError(r.error);
    setIncLoading(false);
  }, []);
  const loadAlerts = useCallback(async () => {
    const r = await run<{ alerts: RawAlert[] }>('alertList', { limit: 50 });
    if (r) setAlerts(r.alerts || []);
  }, []);
  const loadServices = useCallback(async () => {
    const r = await run<{ services: Service[] }>('serviceList', {});
    if (r) setServices(r.services || []);
    const g = await run<{ edges: Array<{ from: string; to: string }> }>('serviceGraph', {});
    if (g) setGraphEdges(g.edges || []);
  }, []);
  const loadPolicies = useCallback(async () => {
    const r = await run<{ policies: Policy[] }>('policyList', {});
    if (r) setPolicies(r.policies || []);
  }, []);
  const loadCalendar = useCallback(async () => {
    const r = await run<{
      shifts: Shift[]; overrides: Shift[]; gaps: Gap[];
      currentOnCall: string | null; currentOnCallSource: string;
    }>('calendarView', {});
    if (r) {
      setShifts(r.shifts || []);
      setOverrides(r.overrides || []);
      setGaps(r.gaps || []);
      setCurrentOnCall({ name: r.currentOnCall, source: r.currentOnCallSource });
    }
  }, []);
  const loadNotifications = useCallback(async () => {
    const r = await run<{ notifications: Notification[] }>('notifyList', {});
    if (r) setNotifications(r.notifications || []);
  }, []);
  const loadAnalytics = useCallback(async () => {
    const r = await run<Analytics>('analytics', {});
    if (r) setAnalytics(r);
  }, []);
  const loadStatus = useCallback(async () => {
    const r = await run<StatusPage>('statusPage', {});
    if (r) setStatus(r);
  }, []);

  useEffect(() => {
    loadIncidents();
    loadAlerts();
    loadServices();
    loadPolicies();
    loadCalendar();
    loadNotifications();
    loadAnalytics();
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── mutations ──
  async function createIncident(title: string, severity: Sev, serviceId: string | null) {
    setBusy('inc-create');
    const r = await run<{ incident: Incident }>('incidentCreate', { title, severity, serviceId });
    setBusy(null);
    if (r?.incident) { flash('ok', `Incident #${r.incident.number} triggered`); await loadIncidents(); await loadStatus(); }
    else flash('err', 'Failed to create incident');
  }
  async function transition(id: string, to: IncStatus) {
    setBusy(`inc-${id}`);
    const r = await run<{ incident: Incident }>('incidentTransition', { incidentId: id, to });
    setBusy(null);
    if (r?.incident) { flash('ok', `Incident moved to ${to}`); await loadIncidents(); await loadAnalytics(); await loadStatus(); }
    else flash('err', `Invalid transition to ${to}`);
  }
  async function noteIncident(id: string, note: string) {
    const r = await run<{ incident: Incident }>('incidentNote', { incidentId: id, note });
    if (r?.incident) { flash('ok', 'Note added'); await loadIncidents(); }
    else flash('err', 'Failed to add note');
  }
  async function ingestAlert(signature: string, message: string, severity: Sev, autoCreate: boolean) {
    setBusy('alert-ingest');
    const r = await run<{ alert: RawAlert; incident: Incident | null; mappedService: string | null }>('alertIngest',
      { signature, message, severity, autoCreate });
    setBusy(null);
    if (r?.alert) {
      flash('ok', r.incident ? `Alert ingested → incident #${r.incident.number}` : 'Alert ingested');
      await loadAlerts(); if (r.incident) await loadIncidents();
    } else flash('err', 'Alert ingestion failed');
  }
  async function createService(name: string, owner: string, tier: string, dependsOn: string[], alertKeys: string[]) {
    setBusy('svc-create');
    const r = await run<{ service: Service }>('serviceCreate', { name, owner, tier, dependsOn, alertKeys });
    setBusy(null);
    if (r?.service) { flash('ok', `Service "${name}" registered`); await loadServices(); await loadStatus(); }
    else flash('err', 'Failed to register service');
  }
  async function createPolicy(name: string, tiers: Array<{ afterMinutes: number; target: string; channel: Channel }>) {
    setBusy('pol-create');
    const r = await run<{ policy: Policy }>('policyCreate', { name, tiers });
    setBusy(null);
    if (r?.policy) { flash('ok', `Policy "${name}" created`); await loadPolicies(); }
    else flash('err', 'Failed to create policy');
  }
  async function createShift(responder: string, startsAt: string, endsAt: string) {
    setBusy('shift-create');
    const r = await run<{ shift: Shift }>('shiftCreate', { responder, startsAt, endsAt });
    setBusy(null);
    if (r?.shift) { flash('ok', `Shift for ${responder} added`); await loadCalendar(); }
    else flash('err', 'Failed to add shift (check times)');
  }
  async function createOverride(responder: string, startsAt: string, endsAt: string, reason: string) {
    setBusy('ovr-create');
    const r = await run<{ override: Shift }>('shiftOverride', { responder, startsAt, endsAt, reason });
    setBusy(null);
    if (r?.override) { flash('ok', `Override for ${responder} recorded`); await loadCalendar(); }
    else flash('err', 'Failed to record override');
  }
  async function dispatchNotify(incidentId: string | null, target: string, channel: Channel, message: string) {
    setBusy('notify');
    const r = await run<{ notification: Notification; deduped: boolean }>('notifyDispatch',
      { incidentId, target, channel, message });
    setBusy(null);
    if (r?.notification) {
      flash('ok', r.deduped ? 'Notification deduped (already queued)' : `Paged ${target} via ${channel}`);
      await loadNotifications(); if (incidentId) await loadIncidents();
    } else flash('err', 'Notification dispatch failed');
  }

  const open = incidents.filter((i) => i.status !== 'resolved');

  return (
    <div className="rounded-xl border border-rose-500/20 bg-zinc-950/70 p-4 space-y-4">
      <header className="flex flex-wrap items-center gap-3 border-b border-rose-500/10 pb-3">
        <Radio className="h-5 w-5 text-rose-400" />
        <h2 className="text-base font-semibold text-white">Incident Management</h2>
        <div className="ml-auto flex items-center gap-3 text-xs">
          <span className="rounded bg-rose-500/15 px-2 py-1 text-rose-300">{open.length} open</span>
          <span className="rounded bg-zinc-800 px-2 py-1 text-zinc-300">
            on-call: <strong className="text-white">{currentOnCall.name || 'none'}</strong>
          </span>
        </div>
      </header>

      <nav className="flex flex-wrap gap-1">
        {([
          ['incidents', 'Incidents', AlertTriangle],
          ['alerts', 'Alerts', Bell],
          ['services', 'Services', GitBranch],
          ['oncall', 'On-call', CalendarClock],
          ['policies', 'Escalation', Activity],
          ['analytics', 'Analytics', Activity],
          ['status', 'Status page', Globe],
        ] as Array<[Tab, string, typeof AlertTriangle]>).map(([k, label, Icon]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-rose-400/40 ${
              tab === k ? 'bg-rose-500/20 text-rose-200' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-300'
            }`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </nav>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className={`flex items-center gap-2 rounded px-3 py-2 text-xs border ${
              toast.kind === 'ok'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
            }`}
          >
            {toast.kind === 'ok' ? <Check className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>

      {tab === 'incidents' && (
        <IncidentsTab
          incidents={incidents} services={services} busy={busy}
          selected={selectedIncident} onSelect={setSelectedIncident}
          onCreate={createIncident} onTransition={transition} onNote={noteIncident}
          onNotify={dispatchNotify} notifications={notifications}
          loading={incLoading} error={incError} onRetry={loadIncidents}
        />
      )}
      {tab === 'alerts' && <AlertsTab alerts={alerts} busy={busy} onIngest={ingestAlert} />}
      {tab === 'services' && <ServicesTab services={services} edges={graphEdges} busy={busy} onCreate={createService} />}
      {tab === 'oncall' && (
        <OnCallTab
          shifts={shifts} overrides={overrides} gaps={gaps} current={currentOnCall} busy={busy}
          onShift={createShift} onOverride={createOverride}
        />
      )}
      {tab === 'policies' && <PoliciesTab policies={policies} busy={busy} onCreate={createPolicy} />}
      {tab === 'analytics' && <AnalyticsTab analytics={analytics} />}
      {tab === 'status' && <StatusTab status={status} />}
    </div>
  );
}

// ───────────────────────── incidents ─────────────────────────
function IncidentsTab({
  incidents, services, busy, selected, onSelect, onCreate, onTransition, onNote, onNotify, notifications,
  loading, error, onRetry,
}: {
  incidents: Incident[]; services: Service[]; busy: string | null;
  selected: string | null; onSelect: (id: string | null) => void;
  onCreate: (t: string, s: Sev, svc: string | null) => void;
  onTransition: (id: string, to: IncStatus) => void;
  onNote: (id: string, n: string) => void;
  onNotify: (id: string | null, t: string, c: Channel, m: string) => void;
  notifications: Notification[];
  loading: boolean; error: string | null; onRetry: () => void;
}) {
  const [title, setTitle] = useState('');
  const [sev, setSev] = useState<Sev>('sev2');
  const [svc, setSvc] = useState('');
  const [note, setNote] = useState('');
  const [pageTarget, setPageTarget] = useState('');
  const [pageChannel, setPageChannel] = useState<Channel>('push');

  const sel = incidents.find((i) => i.id === selected) || null;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-3">
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <input
            value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Incident title"
            className="min-w-[200px] flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white"
          />
          <select value={sev} onChange={(e) => setSev(e.target.value as Sev)}
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white">
            {(['sev1', 'sev2', 'sev3', 'sev4'] as Sev[]).map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
          </select>
          <select value={svc} onChange={(e) => setSvc(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white">
            <option value="">— no service —</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button
            disabled={!title.trim() || busy === 'inc-create'}
            onClick={() => { onCreate(title.trim(), sev, svc || null); setTitle(''); }}
            className="flex items-center gap-1 rounded bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-40"
          >
            {busy === 'inc-create' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Trigger
          </button>
        </div>

        {loading ? (
          <div
            data-testid="ops-incidents-loading"
            role="status"
            aria-busy="true"
            aria-live="polite"
            className="flex items-center justify-center gap-2 rounded border border-zinc-800 bg-zinc-900/30 px-4 py-8 text-xs text-zinc-400"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading incidents…
          </div>
        ) : error ? (
          <div
            data-testid="ops-incidents-error"
            role="alert"
            className="flex flex-col items-center gap-2 rounded border border-rose-500/40 bg-rose-500/10 px-4 py-8 text-center text-xs text-rose-200"
          >
            <span className="flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" aria-hidden /> Couldn&apos;t load incidents: {error}</span>
            <button
              onClick={onRetry}
              className="rounded border border-rose-400/50 bg-rose-500/20 px-3 py-1 font-medium text-rose-100 hover:bg-rose-500/30 focus:outline-none focus:ring-2 focus:ring-rose-400/50"
            >
              Retry
            </button>
          </div>
        ) : incidents.length === 0 ? (
          <p data-testid="ops-incidents-empty" className="rounded border border-zinc-800 bg-zinc-900/30 px-4 py-8 text-center text-xs text-zinc-400">
            No incidents yet. Trigger one above or ingest an alert.
          </p>
        ) : (
          <ul data-testid="ops-incidents-list" className="space-y-1.5">
            {incidents.map((i) => (
              <li key={i.id}>
                <button
                  onClick={() => onSelect(i.id === selected ? null : i.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                    i.id === selected ? 'border-rose-500/50 bg-rose-500/5' : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-bold text-black"
                      style={{ background: SEV_COLOR[i.severity] }}>{i.severity.toUpperCase()}</span>
                    <span className="font-mono text-[10px] text-zinc-400">#{i.number}</span>
                    <span className="flex-1 truncate text-xs font-medium text-zinc-100">{i.title}</span>
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                      style={{ background: STATUS_COLOR[i.status] + '22', color: STATUS_COLOR[i.status] }}>{i.status}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-zinc-400">
                    opened {new Date(i.createdAt).toLocaleString()} · {i.timeline.length} timeline events
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3">
        {sel ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-white">#{sel.number} {sel.title}</h3>
              <p className="text-[10px] text-zinc-400">source: {sel.source} · {sel.severity.toUpperCase()}</p>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(['triggered', 'acknowledged', 'resolved'] as IncStatus[])
                .filter((to) => to !== sel.status)
                .map((to) => (
                  <button key={to}
                    disabled={busy === `inc-${sel.id}`}
                    onClick={() => onTransition(sel.id, to)}
                    className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
                  >
                    → {to}
                  </button>
                ))}
            </div>

            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">Timeline</p>
              <TimelineView
                events={sel.timeline.map((t, idx) => ({
                  id: `${sel.id}-${idx}`,
                  label: t.event,
                  time: t.at,
                  detail: t.note || undefined,
                  tone: t.event === 'resolved' ? 'good' : t.event === 'triggered' ? 'bad' : t.event === 'acknowledged' ? 'warn' : 'info',
                }))}
                height={90}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex gap-1.5">
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add timeline note"
                  className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white" />
                <button
                  disabled={!note.trim()}
                  onClick={() => { onNote(sel.id, note.trim()); setNote(''); }}
                  className="rounded bg-zinc-700 px-2 py-1 text-[11px] text-white hover:bg-zinc-600 disabled:opacity-40"
                >Note</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <input value={pageTarget} onChange={(e) => setPageTarget(e.target.value)} placeholder="Page responder"
                  className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white" />
                <select value={pageChannel} onChange={(e) => setPageChannel(e.target.value as Channel)}
                  className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white">
                  {(['push', 'sms', 'email'] as Channel[]).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button
                  disabled={!pageTarget.trim() || busy === 'notify'}
                  onClick={() => { onNotify(sel.id, pageTarget.trim(), pageChannel, `Page on incident #${sel.number}: ${sel.title}`); setPageTarget(''); }}
                  className="flex items-center gap-1 rounded bg-amber-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-amber-500 disabled:opacity-40"
                >
                  <Bell className="h-3 w-3" /> Page
                </button>
              </div>
            </div>

            {notifications.filter((n) => n.incidentId === sel.id).length > 0 && (
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">Pages dispatched</p>
                <ul className="space-y-0.5">
                  {notifications.filter((n) => n.incidentId === sel.id).map((n) => (
                    <li key={n.id} className="text-[10px] text-zinc-400">
                      {n.channel} → {n.target} · <span className="text-amber-300">{n.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="rounded border border-zinc-800 bg-zinc-900/30 px-4 py-8 text-center text-xs text-zinc-400">
            Select an incident to drive its state machine, page responders, and view its timeline.
          </p>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── alerts ─────────────────────────
function AlertsTab({
  alerts, busy, onIngest,
}: {
  alerts: RawAlert[]; busy: string | null;
  onIngest: (sig: string, msg: string, sev: Sev, auto: boolean) => void;
}) {
  const [sig, setSig] = useState('');
  const [msg, setMsg] = useState('');
  const [sev, setSev] = useState<Sev>('sev3');
  const [auto, setAuto] = useState(true);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
        <input value={sig} onChange={(e) => setSig(e.target.value)} placeholder="Alert signature (e.g. db-timeout)"
          className="min-w-[180px] flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white font-mono" />
        <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message"
          className="min-w-[160px] flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white" />
        <select value={sev} onChange={(e) => setSev(e.target.value as Sev)}
          className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white">
          {(['sev1', 'sev2', 'sev3', 'sev4'] as Sev[]).map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
        </select>
        <label className="flex items-center gap-1 text-[11px] text-zinc-400">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> auto-create incident
        </label>
        <button
          disabled={!sig.trim() || busy === 'alert-ingest'}
          onClick={() => { onIngest(sig.trim(), msg.trim(), sev, auto); setSig(''); setMsg(''); }}
          className="flex items-center gap-1 rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-40"
        >
          {busy === 'alert-ingest' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bell className="h-3 w-3" />} Ingest
        </button>
      </div>
      <p className="text-[10px] text-zinc-400">
        Alerts auto-map to a service when the signature contains the service name or one of its alert keys.
      </p>
      {alerts.length === 0 ? (
        <p className="rounded border border-zinc-800 bg-zinc-900/30 px-4 py-8 text-center text-xs text-zinc-400">No alerts ingested.</p>
      ) : (
        <ul className="space-y-1">
          {alerts.map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs">
              <span className="rounded px-1.5 py-0.5 text-[10px] font-bold text-black" style={{ background: SEV_COLOR[a.severity] }}>{a.severity.toUpperCase()}</span>
              <span className="font-mono text-zinc-200">{a.signature}</span>
              {a.message && <span className="truncate text-zinc-400">{a.message}</span>}
              {a.serviceName && <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] text-indigo-300">{a.serviceName}</span>}
              {a.incidentId && <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] text-rose-300">incident</span>}
              <span className="ml-auto text-[10px] text-zinc-400">{new Date(a.receivedAt).toLocaleTimeString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────────────────────── services ─────────────────────────
function ServicesTab({
  services, edges, busy, onCreate,
}: {
  services: Service[]; edges: Array<{ from: string; to: string }>; busy: string | null;
  onCreate: (n: string, o: string, t: string, dep: string[], keys: string[]) => void;
}) {
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [tier, setTier] = useState('standard');
  const [deps, setDeps] = useState<string[]>([]);
  const [keys, setKeys] = useState('');

  // Build a dependency tree: roots are services nothing depends on.
  const byId = new Map(services.map((s) => [s.id, s]));
  const depended = new Set(edges.map((e) => e.to));
  const roots = services.filter((s) => !depended.has(s.id));
  function toNode(s: Service, seen: Set<string>): TreeNode {
    seen.add(s.id);
    const childIds = s.dependsOn.filter((d) => byId.has(d) && !seen.has(d));
    return {
      id: s.id,
      label: s.name,
      detail: `${s.tier}${s.owner ? ' · ' + s.owner : ''}`,
      tone: s.tier === 'critical' ? 'bad' : s.tier === 'high' ? 'warn' : 'default',
      children: childIds.map((d) => toNode(byId.get(d)!, new Set(seen))),
    };
  }
  const tree: TreeNode[] = (roots.length ? roots : services).map((s) => toNode(s, new Set()));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="flex flex-wrap gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Service name"
              className="min-w-[140px] flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white" />
            <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Owner"
              className="min-w-[100px] flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white" />
            <select value={tier} onChange={(e) => setTier(e.target.value)}
              className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white">
              {['critical', 'high', 'standard'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <input value={keys} onChange={(e) => setKeys(e.target.value)} placeholder="Alert keys (comma-separated)"
            className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white font-mono" />
          {services.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">Depends on</p>
              <div className="flex flex-wrap gap-1">
                {services.map((s) => (
                  <button key={s.id}
                    onClick={() => setDeps((d) => d.includes(s.id) ? d.filter((x) => x !== s.id) : [...d, s.id])}
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      deps.includes(s.id) ? 'bg-indigo-500/30 text-indigo-200' : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >{s.name}</button>
                ))}
              </div>
            </div>
          )}
          <button
            disabled={!name.trim() || busy === 'svc-create'}
            onClick={() => {
              onCreate(name.trim(), owner.trim(), tier, deps, keys.split(',').map((k) => k.trim()).filter(Boolean));
              setName(''); setOwner(''); setKeys(''); setDeps([]);
            }}
            className="flex items-center gap-1 rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            {busy === 'svc-create' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Register service
          </button>
        </div>
      </div>
      <div>
        <p className="mb-2 text-[10px] uppercase tracking-wider text-zinc-400">Dependency graph ({services.length} services · {edges.length} edges)</p>
        {services.length === 0 ? (
          <p className="rounded border border-zinc-800 bg-zinc-900/30 px-4 py-8 text-center text-xs text-zinc-400">No services registered.</p>
        ) : (
          <TreeDiagram root={tree} />
        )}
      </div>
    </div>
  );
}

// ───────────────────────── on-call ─────────────────────────
function OnCallTab({
  shifts, overrides, gaps, current, busy, onShift, onOverride,
}: {
  shifts: Shift[]; overrides: Shift[]; gaps: Gap[];
  current: { name: string | null; source: string }; busy: string | null;
  onShift: (r: string, s: string, e: string) => void;
  onOverride: (r: string, s: string, e: string, reason: string) => void;
}) {
  const [resp, setResp] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [ovrResp, setOvrResp] = useState('');
  const [ovrFrom, setOvrFrom] = useState('');
  const [ovrTo, setOvrTo] = useState('');
  const [ovrReason, setOvrReason] = useState('');

  const toIso = (local: string) => (local ? new Date(local).toISOString() : '');

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs">
        Current on-call: <strong className="text-white">{current.name || 'none'}</strong>
        <span className="ml-1 text-zinc-400">({current.source})</span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <p className="text-[10px] uppercase tracking-wider text-zinc-400">Add shift</p>
          <input value={resp} onChange={(e) => setResp(e.target.value)} placeholder="Responder"
            className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white" />
          <div className="flex gap-2">
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)}
              className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-white" />
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)}
              className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-white" />
          </div>
          <button
            disabled={!resp.trim() || !from || !to || busy === 'shift-create'}
            onClick={() => { onShift(resp.trim(), toIso(from), toIso(to)); setResp(''); setFrom(''); setTo(''); }}
            className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
          >Add shift</button>
        </div>
        <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <p className="text-[10px] uppercase tracking-wider text-zinc-400">Shift override / swap</p>
          <div className="flex gap-2">
            <input value={ovrResp} onChange={(e) => setOvrResp(e.target.value)} placeholder="Covering responder"
              className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white" />
            <input value={ovrReason} onChange={(e) => setOvrReason(e.target.value)} placeholder="Reason"
              className="w-24 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white" />
          </div>
          <div className="flex gap-2">
            <input type="datetime-local" value={ovrFrom} onChange={(e) => setOvrFrom(e.target.value)}
              className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-white" />
            <input type="datetime-local" value={ovrTo} onChange={(e) => setOvrTo(e.target.value)}
              className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] text-white" />
          </div>
          <button
            disabled={!ovrResp.trim() || !ovrFrom || !ovrTo || busy === 'ovr-create'}
            onClick={() => { onOverride(ovrResp.trim(), toIso(ovrFrom), toIso(ovrTo), ovrReason.trim() || 'swap'); setOvrResp(''); setOvrFrom(''); setOvrTo(''); setOvrReason(''); }}
            className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-40"
          >Record override</button>
        </div>
      </div>

      {gaps.length > 0 && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
          <p className="text-[10px] uppercase tracking-wider text-rose-300">Coverage gaps ({gaps.length})</p>
          <ul className="mt-1 space-y-0.5">
            {gaps.map((g, i) => (
              <li key={i} className="text-[11px] text-rose-200">
                {new Date(g.from).toLocaleString()} → {new Date(g.to).toLocaleString()} · {g.minutes}m uncovered
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">
          Schedule ({shifts.length} shifts · {overrides.length} overrides)
        </p>
        {shifts.length + overrides.length === 0 ? (
          <p className="rounded border border-zinc-800 bg-zinc-900/30 px-4 py-8 text-center text-xs text-zinc-400">No shifts scheduled.</p>
        ) : (
          <TimelineView
            events={[
              ...shifts.map((s) => ({ id: s.id, label: `${s.responder} (shift)`, time: s.startsAt, tone: 'info' as const, detail: `until ${new Date(s.endsAt).toLocaleString()}` })),
              ...overrides.map((o) => ({ id: o.id, label: `${o.responder} (override)`, time: o.startsAt, tone: 'warn' as const, detail: `until ${new Date(o.endsAt).toLocaleString()}` })),
            ]}
            height={120}
          />
        )}
      </div>
    </div>
  );
}

// ───────────────────────── policies ─────────────────────────
function PoliciesTab({
  policies, busy, onCreate,
}: {
  policies: Policy[]; busy: string | null;
  onCreate: (n: string, t: Array<{ afterMinutes: number; target: string; channel: Channel }>) => void;
}) {
  const [name, setName] = useState('');
  const [tiers, setTiers] = useState<Array<{ afterMinutes: string; target: string; channel: Channel }>>([
    { afterMinutes: '0', target: '', channel: 'push' },
  ]);
  const [evalState, setEvalState] = useState<Record<string, { minutes: string; result: any | null }>>({});

  async function evaluate(policyId: string) {
    const minutes = parseFloat(evalState[policyId]?.minutes || '0') || 0;
    const r = await run<any>('policyEvaluate', { policyId, minutesOpen: minutes });
    setEvalState((s) => ({ ...s, [policyId]: { minutes: String(minutes), result: r } }));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
        <p className="text-[10px] uppercase tracking-wider text-zinc-400">New escalation policy</p>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Policy name"
          className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-white" />
        {tiers.map((t, i) => (
          <div key={i} className="flex gap-1.5">
            <span className="self-center text-[10px] text-zinc-400">T{i + 1}</span>
            <input value={t.afterMinutes} onChange={(e) => setTiers((ts) => ts.map((x, j) => j === i ? { ...x, afterMinutes: e.target.value.replace(/[^\d.]/g, '') } : x))}
              placeholder="after min" className="w-20 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white" />
            <input value={t.target} onChange={(e) => setTiers((ts) => ts.map((x, j) => j === i ? { ...x, target: e.target.value } : x))}
              placeholder="target" className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white" />
            <select value={t.channel} onChange={(e) => setTiers((ts) => ts.map((x, j) => j === i ? { ...x, channel: e.target.value as Channel } : x))}
              className="rounded border border-zinc-800 bg-zinc-900 px-1 py-1 text-[11px] text-white">
              {(['push', 'sms', 'email'] as Channel[]).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        ))}
        <div className="flex gap-2">
          <button onClick={() => setTiers((t) => [...t, { afterMinutes: '', target: '', channel: 'push' }])}
            className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700">+ tier</button>
          <button
            disabled={!name.trim() || tiers.every((t) => !t.target.trim()) || busy === 'pol-create'}
            onClick={() => {
              onCreate(name.trim(), tiers.filter((t) => t.target.trim()).map((t) => ({
                afterMinutes: parseFloat(t.afterMinutes) || 0, target: t.target.trim(), channel: t.channel,
              })));
              setName(''); setTiers([{ afterMinutes: '0', target: '', channel: 'push' }]);
            }}
            className="rounded bg-rose-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-rose-500 disabled:opacity-40"
          >Create policy</button>
        </div>
      </div>

      <div className="space-y-2">
        {policies.length === 0 ? (
          <p className="rounded border border-zinc-800 bg-zinc-900/30 px-4 py-8 text-center text-xs text-zinc-400">No policies defined.</p>
        ) : policies.map((p) => {
          const ev = evalState[p.id];
          return (
            <div key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <h4 className="text-xs font-semibold text-white">{p.name}</h4>
              <ol className="mt-1 space-y-0.5">
                {p.tiers.map((t) => (
                  <li key={t.level} className="text-[11px] text-zinc-400">
                    T{t.level}: after {t.afterMinutes}m → <span className="text-zinc-200">{t.target}</span> via {t.channel}
                  </li>
                ))}
              </ol>
              <div className="mt-2 flex items-center gap-1.5">
                <input
                  value={ev?.minutes || ''}
                  onChange={(e) => setEvalState((s) => ({ ...s, [p.id]: { minutes: e.target.value.replace(/[^\d.]/g, ''), result: s[p.id]?.result || null } }))}
                  placeholder="min open" className="w-20 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-white" />
                <button onClick={() => evaluate(p.id)}
                  className="rounded bg-zinc-700 px-2 py-1 text-[11px] text-white hover:bg-zinc-600">Evaluate</button>
              </div>
              {ev?.result && (
                <p className="mt-1.5 text-[11px] text-zinc-300">
                  Active tier: <strong className="text-rose-300">{ev.result.currentTier?.target || '—'}</strong>
                  {ev.result.nextTier
                    ? ` · next: ${ev.result.nextTier.target} in ${ev.result.nextTierInMinutes}m`
                    : ev.result.fullyEscalated ? ' · fully escalated' : ''}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────── analytics ─────────────────────────
function AnalyticsTab({ analytics }: { analytics: Analytics | null }) {
  if (!analytics) {
    return <p className="rounded border border-zinc-800 bg-zinc-900/30 px-4 py-8 text-center text-xs text-zinc-400">Loading analytics…</p>;
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Total incidents', analytics.totalIncidents],
          ['Open', analytics.openIncidents],
          ['MTTA (min)', analytics.mttaMinutes],
          ['MTTR (min)', analytics.mttrMinutes],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
            <div className="font-mono text-xl font-semibold text-white">{value}</div>
          </div>
        ))}
      </div>

      <div>
        <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">Weekly incident trend ({analytics.windowDays}d window)</p>
        <ChartKit
          kind="bar"
          data={analytics.weeklyTrend.map((w) => ({ week: w.week, count: w.count }))}
          xKey="week"
          series={[{ key: 'count', label: 'Incidents', color: '#ef4444' }]}
          height={200}
        />
      </div>

      <div>
        <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">MTTR by severity</p>
        <ChartKit
          kind="bar"
          data={Object.entries(analytics.bySeverity).map(([sev, v]) => ({ sev: sev.toUpperCase(), mttr: v.mttrMin, total: v.total }))}
          xKey="sev"
          series={[
            { key: 'mttr', label: 'MTTR (min)', color: '#f97316' },
            { key: 'total', label: 'Count', color: '#6366f1' },
          ]}
          height={200}
        />
      </div>
    </div>
  );
}

// ───────────────────────── status page ─────────────────────────
const OVERALL_LABEL: Record<string, { text: string; color: string }> = {
  all_systems_operational: { text: 'All systems operational', color: '#22c55e' },
  degraded_performance: { text: 'Degraded performance', color: '#eab308' },
  partial_outage: { text: 'Partial outage', color: '#f97316' },
  major_outage: { text: 'Major outage', color: '#ef4444' },
};
const COMP_STATUS: Record<string, string> = {
  operational: '#22c55e', degraded: '#eab308', partial_outage: '#f97316', major_outage: '#ef4444',
};

function StatusTab({ status }: { status: StatusPage | null }) {
  if (!status) {
    return <p className="rounded border border-zinc-800 bg-zinc-900/30 px-4 py-8 text-center text-xs text-zinc-400">Loading status page…</p>;
  }
  const overall = OVERALL_LABEL[status.overall] || { text: status.overall, color: '#64748b' };
  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4" style={{ borderColor: overall.color + '55', background: overall.color + '11' }}>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ background: overall.color }} />
          <span className="text-sm font-semibold" style={{ color: overall.color }}>{overall.text}</span>
          <span className="ml-auto text-[10px] text-zinc-400">{status.activeIncidentCount} active · as of {new Date(status.generatedAt).toLocaleTimeString()}</span>
        </div>
      </div>

      <div>
        <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">Components</p>
        {status.components.length === 0 ? (
          <p className="rounded border border-zinc-800 bg-zinc-900/30 px-4 py-6 text-center text-xs text-zinc-400">No services registered yet.</p>
        ) : (
          <ul className="space-y-1">
            {status.components.map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: COMP_STATUS[c.status] || '#64748b' }} />
                <span className="font-medium text-zinc-100">{c.name}</span>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{c.tier}</span>
                <span className="ml-auto text-[10px] text-zinc-400">{c.uptime90dPct}% uptime 90d</span>
                <span className="text-[10px]" style={{ color: COMP_STATUS[c.status] }}>{c.status.replace(/_/g, ' ')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">Recent incidents</p>
        {status.recentIncidents.length === 0 ? (
          <p className="rounded border border-zinc-800 bg-zinc-900/30 px-4 py-6 text-center text-xs text-zinc-400">No incidents on record.</p>
        ) : (
          <ul className="space-y-1">
            {status.recentIncidents.map((i) => (
              <li key={i.id} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs">
                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold text-black" style={{ background: SEV_COLOR[i.severity] }}>{i.severity.toUpperCase()}</span>
                <span className="font-mono text-[10px] text-zinc-400">#{i.number}</span>
                <span className="flex-1 truncate text-zinc-200">{i.title}</span>
                <span className="text-[10px]" style={{ color: STATUS_COLOR[i.status] }}>{i.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
