'use client';

/**
 * SOCConsole — Splunk-style Security Operations Center surface. Wires the
 * SIEM event pipeline + correlation, the alert rules engine, playbook-driven
 * incident response, CVE-to-asset matching, badge-access audit, surveillance
 * camera tiles, and EPSS/IOC threat-intel enrichment macros. Every value is
 * real user input or computed from it — no seed/mock data.
 */

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import {
  Activity, Bell, ClipboardList, Link2, KeyRound, Camera, Radar,
  Loader2, Plus, Trash2, Play, Power, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type SocTab = 'siem' | 'rules' | 'incidents' | 'cve-match' | 'badges' | 'cameras' | 'intel';

interface SiemEvent {
  id: string; source: string; category: string; severity: string;
  message: string; srcIp: string | null; user: string | null; host: string | null;
  ts: string; correlationId: string | null;
}
interface Correlation {
  correlationId: string; pivot: string; eventCount: number; peakSeverity: string;
  firstSeen: string; lastSeen: string; eventIds: string[]; categories: string[];
}
interface Rule {
  id: string; name: string; pattern: string; field: string; minSeverity: string;
  threshold: number; windowMin: number; incidentSeverity: string; enabled: boolean;
  lastFiredAt: string | null; fireCount: number;
}
interface PlaybookStep { idx: number; text: string; done: boolean; doneAt: string | null }
interface IncidentTimeline { at: string; action: string; actor: string; detail: string }
interface Incident {
  id: string; title: string; severity: string; status: string; phase: string;
  origin: string; assignee: string | null; playbookId: string | null;
  playbookSteps?: PlaybookStep[]; matchCount: number; notes: string;
  timeline: IncidentTimeline[]; createdAt: string; closedAt: string | null;
}
interface Playbook { id: string; name: string; stepCount: number; steps: string[] }
interface CveMatch {
  vulnId: string; cveId: string | null; title: string; severity: string; cvss: number | null;
  affectedAssets: { id: string; name: string; vendor: string | null; version: string | null; critical: boolean }[];
}
interface BadgeAnomaly {
  kind: string; badgeId?: string; holder?: string | null; zone?: string;
  from?: string; to?: string; count?: number; gapSeconds?: number; ts?: string; detail: string;
}
interface Camera {
  id: string; name: string; zone: string; streamUrl: string | null; kind: string;
  status: string; motionDetection: boolean; lastMotionAt: string | null;
}
interface EpssIntel { score: number | null; percentile?: number; date?: string; exploitability?: string; note?: string }
interface IocIntel {
  value: string; sightings: number; peakSeverity: string | null;
  firstSeen: string | null; lastSeen: string | null; reputation: string;
}

const SEV_DOT: Record<string, string> = {
  info: 'bg-sky-500', low: 'bg-emerald-500', medium: 'bg-amber-500',
  high: 'bg-orange-500', critical: 'bg-rose-600',
};
const EVENT_SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];
const EVENT_FIELDS = ['message', 'srcIp', 'user', 'host', 'category', 'source'];
const INCIDENT_SEVERITIES = ['P1', 'P2', 'P3', 'P4', 'P5'];
const IR_PHASES = ['detected', 'triaged', 'investigating', 'contained', 'eradicated', 'recovered', 'closed'];

const TABS: { id: SocTab; label: string; icon: typeof Activity }[] = [
  { id: 'siem', label: 'SIEM Stream', icon: Activity },
  { id: 'rules', label: 'Alert Rules', icon: Bell },
  { id: 'incidents', label: 'Incident Response', icon: ClipboardList },
  { id: 'cve-match', label: 'CVE → Asset', icon: Link2 },
  { id: 'badges', label: 'Badge Audit', icon: KeyRound },
  { id: 'cameras', label: 'Camera Wall', icon: Camera },
  { id: 'intel', label: 'Threat Intel', icon: Radar },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function SOCConsole() {
  const [tab, setTab] = useState<SocTab>('siem');
  const [busy, setBusy] = useState(false);

  /* SIEM */
  const [events, setEvents] = useState<SiemEvent[]>([]);
  const [correlations, setCorrelations] = useState<Correlation[]>([]);
  const [evForm, setEvForm] = useState({ message: '', severity: 'info', source: '', srcIp: '', user: '', host: '', category: '' });
  const [evQuery, setEvQuery] = useState('');

  /* Rules */
  const [rules, setRules] = useState<Rule[]>([]);
  const [ruleForm, setRuleForm] = useState({ name: '', pattern: '', field: 'message', minSeverity: 'info', threshold: '1', windowMin: '60', incidentSeverity: 'P3' });
  const [ruleResult, setRuleResult] = useState<string | null>(null);

  /* Incidents */
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [incForm, setIncForm] = useState({ title: '', severity: 'P3', assignee: '' });
  const [selectedInc, setSelectedInc] = useState<string | null>(null);
  const [advNote, setAdvNote] = useState('');

  /* CVE match */
  const [cveMatches, setCveMatches] = useState<CveMatch[] | null>(null);

  /* Badges */
  const [anomalies, setAnomalies] = useState<BadgeAnomaly[] | null>(null);
  const [badgeStats, setBadgeStats] = useState<{ eventsAudited: number; denialCount: number } | null>(null);
  const [badgeForm, setBadgeForm] = useState({ badgeId: '', holder: '', zone: '', door: '', result: 'granted' });

  /* Cameras */
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [camForm, setCamForm] = useState({ name: '', zone: '', streamUrl: '', kind: 'indoor' });

  /* Intel */
  const [intelForm, setIntelForm] = useState({ cveId: '', ioc: '' });
  const [epss, setEpss] = useState<EpssIntel | null>(null);
  const [iocIntel, setIocIntel] = useState<IocIntel | null>(null);
  const [intelError, setIntelError] = useState<string | null>(null);

  /* ---- loaders ---- */
  const loadEvents = useCallback(async () => {
    const r = await lensRun('security', 'event-list', evQuery ? { query: evQuery } : {});
    if (r.data?.ok) setEvents((r.data.result as { events: SiemEvent[] }).events);
  }, [evQuery]);

  const loadRules = useCallback(async () => {
    const r = await lensRun('security', 'rule-list', {});
    if (r.data?.ok) setRules((r.data.result as { rules: Rule[] }).rules);
  }, []);

  const loadIncidents = useCallback(async () => {
    const r = await lensRun('security', 'incident-list', {});
    if (r.data?.ok) setIncidents((r.data.result as { incidents: Incident[] }).incidents);
  }, []);

  const loadPlaybooks = useCallback(async () => {
    const r = await lensRun('security', 'playbook-list', {});
    if (r.data?.ok) setPlaybooks((r.data.result as { playbooks: Playbook[] }).playbooks);
  }, []);

  const loadCameras = useCallback(async () => {
    const r = await lensRun('security', 'camera-list', {});
    if (r.data?.ok) setCameras((r.data.result as { cameras: Camera[] }).cameras);
  }, []);

  useEffect(() => { void loadEvents(); }, [loadEvents]);
  useEffect(() => { void loadRules(); }, [loadRules]);
  useEffect(() => { void loadIncidents(); void loadPlaybooks(); }, [loadIncidents, loadPlaybooks]);
  useEffect(() => { void loadCameras(); }, [loadCameras]);

  /* ---- SIEM actions ---- */
  const ingestEvent = async () => {
    if (!evForm.message.trim()) return;
    setBusy(true);
    const r = await lensRun('security', 'event-ingest', evForm);
    setBusy(false);
    if (r.data?.ok) {
      setEvForm({ message: '', severity: 'info', source: '', srcIp: '', user: '', host: '', category: '' });
      await loadEvents();
    }
  };
  const runCorrelation = async () => {
    setBusy(true);
    const r = await lensRun('security', 'event-correlate', { minEvents: 3 });
    setBusy(false);
    if (r.data?.ok) {
      setCorrelations((r.data.result as { correlations: Correlation[] }).correlations);
      await loadEvents();
    }
  };

  /* ---- Rule actions ---- */
  const addRule = async () => {
    if (!ruleForm.name.trim() || !ruleForm.pattern.trim()) return;
    setBusy(true);
    const r = await lensRun('security', 'rule-add', {
      ...ruleForm,
      threshold: Number(ruleForm.threshold) || 1,
      windowMin: Number(ruleForm.windowMin) || 60,
    });
    setBusy(false);
    if (r.data?.ok) {
      setRuleForm({ name: '', pattern: '', field: 'message', minSeverity: 'info', threshold: '1', windowMin: '60', incidentSeverity: 'P3' });
      await loadRules();
    }
  };
  const toggleRule = async (id: string) => {
    const r = await lensRun('security', 'rule-toggle', { id });
    if (r.data?.ok) await loadRules();
  };
  const deleteRule = async (id: string) => {
    const r = await lensRun('security', 'rule-delete', { id });
    if (r.data?.ok) await loadRules();
  };
  const evaluateRules = async () => {
    setBusy(true);
    const r = await lensRun('security', 'rule-evaluate', {});
    setBusy(false);
    if (r.data?.ok) {
      const res = r.data.result as { incidentsCreated: number; rulesEvaluated: number };
      setRuleResult(`Evaluated ${res.rulesEvaluated} rule(s) — ${res.incidentsCreated} incident(s) created`);
      await loadRules();
      await loadIncidents();
    }
  };

  /* ---- Incident actions ---- */
  const openIncident = async () => {
    if (!incForm.title.trim()) return;
    setBusy(true);
    const r = await lensRun('security', 'incident-open', incForm);
    setBusy(false);
    if (r.data?.ok) {
      setIncForm({ title: '', severity: 'P3', assignee: '' });
      await loadIncidents();
    }
  };
  const attachPlaybook = async (incidentId: string, playbookId: string) => {
    const r = await lensRun('security', 'incident-attach-playbook', { incidentId, playbookId });
    if (r.data?.ok) await loadIncidents();
  };
  const completeStep = async (incidentId: string, completeStepIdx: number) => {
    const r = await lensRun('security', 'incident-advance', { incidentId, completeStep: completeStepIdx });
    if (r.data?.ok) await loadIncidents();
  };
  const advancePhase = async (incidentId: string, phase: string) => {
    const r = await lensRun('security', 'incident-advance', { incidentId, phase });
    if (r.data?.ok) await loadIncidents();
  };
  const addIncidentNote = async (incidentId: string) => {
    if (!advNote.trim()) return;
    const r = await lensRun('security', 'incident-advance', { incidentId, note: advNote });
    if (r.data?.ok) { setAdvNote(''); await loadIncidents(); }
  };

  /* ---- CVE → Asset ---- */
  const runCveMatch = async () => {
    setBusy(true);
    const r = await lensRun('security', 'cve-asset-match', {});
    setBusy(false);
    if (r.data?.ok) setCveMatches((r.data.result as { matches: CveMatch[] }).matches);
  };

  /* ---- Badge audit ---- */
  const addBadgeEvent = async () => {
    if (!badgeForm.badgeId.trim() || !badgeForm.zone.trim()) return;
    setBusy(true);
    const r = await lensRun('security', 'badge-event-add', badgeForm);
    setBusy(false);
    if (r.data?.ok) setBadgeForm({ badgeId: '', holder: '', zone: '', door: '', result: 'granted' });
  };
  const runBadgeAudit = async () => {
    setBusy(true);
    const r = await lensRun('security', 'badge-audit', {});
    setBusy(false);
    if (r.data?.ok) {
      const res = r.data.result as { anomalies: BadgeAnomaly[]; eventsAudited: number; denialCount: number };
      setAnomalies(res.anomalies);
      setBadgeStats({ eventsAudited: res.eventsAudited, denialCount: res.denialCount });
    }
  };

  /* ---- Cameras ---- */
  const addCamera = async () => {
    if (!camForm.name.trim()) return;
    setBusy(true);
    const r = await lensRun('security', 'camera-add', camForm);
    setBusy(false);
    if (r.data?.ok) {
      setCamForm({ name: '', zone: '', streamUrl: '', kind: 'indoor' });
      await loadCameras();
    }
  };
  const setCameraStatus = async (id: string, status: string) => {
    const r = await lensRun('security', 'camera-update', { id, status });
    if (r.data?.ok) await loadCameras();
  };
  const deleteCamera = async (id: string) => {
    const r = await lensRun('security', 'camera-delete', { id });
    if (r.data?.ok) await loadCameras();
  };

  /* ---- Threat intel ---- */
  const runEnrichment = async () => {
    if (!intelForm.cveId.trim() && !intelForm.ioc.trim()) return;
    setBusy(true);
    setIntelError(null);
    setEpss(null);
    setIocIntel(null);
    const r = await lensRun('security', 'threat-enrich', {
      cveId: intelForm.cveId.trim() || undefined,
      ioc: intelForm.ioc.trim() || undefined,
    });
    setBusy(false);
    if (r.data?.ok) {
      const res = r.data.result as { epss?: EpssIntel; epssError?: string; iocIntel?: IocIntel };
      if (res.epss) setEpss(res.epss);
      if (res.iocIntel) setIocIntel(res.iocIntel);
      if (res.epssError) setIntelError(res.epssError);
    } else {
      setIntelError(typeof r.data?.error === 'string' ? r.data.error : 'Enrichment failed');
    }
  };

  const inp = 'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-rose-500 focus:outline-none';
  const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50';
  const selectedIncident = incidents.find((i) => i.id === selectedInc) || null;

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2">
        <Activity className="h-5 w-5 text-rose-400" />
        <h2 className="text-base font-semibold text-zinc-100">SOC Console</h2>
        <span className="text-xs text-zinc-400">SIEM · detections · playbooks · intel</span>
      </header>

      <nav className="flex flex-wrap gap-1.5 border-b border-zinc-800 pb-3">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                tab === t.id ? 'bg-rose-500/20 text-rose-300' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>

      {/* ---------------- SIEM ---------------- */}
      {tab === 'siem' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
            <h3 className="mb-2 text-sm font-semibold text-zinc-200">Ingest Event</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <input className={cn(inp, 'sm:col-span-2')} placeholder="Event message / log line" value={evForm.message} onChange={(e) => setEvForm({ ...evForm, message: e.target.value })} />
              <select className={inp} value={evForm.severity} onChange={(e) => setEvForm({ ...evForm, severity: e.target.value })}>
                {EVENT_SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <input className={inp} placeholder="Source (e.g. firewall)" value={evForm.source} onChange={(e) => setEvForm({ ...evForm, source: e.target.value })} />
              <input className={inp} placeholder="Source IP" value={evForm.srcIp} onChange={(e) => setEvForm({ ...evForm, srcIp: e.target.value })} />
              <input className={inp} placeholder="User" value={evForm.user} onChange={(e) => setEvForm({ ...evForm, user: e.target.value })} />
              <input className={inp} placeholder="Host" value={evForm.host} onChange={(e) => setEvForm({ ...evForm, host: e.target.value })} />
              <input className={inp} placeholder="Category" value={evForm.category} onChange={(e) => setEvForm({ ...evForm, category: e.target.value })} />
            </div>
            <div className="mt-2 flex gap-2">
              <button className={cn(btn, 'bg-rose-600 text-white hover:bg-rose-500')} onClick={ingestEvent} disabled={busy || !evForm.message.trim()}>
                <Plus className="h-3.5 w-3.5" /> Ingest
              </button>
              <button className={cn(btn, 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700')} onClick={runCorrelation} disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />} Correlate
              </button>
            </div>
          </div>

          {correlations.length > 0 && (
            <div className="rounded-xl border border-amber-700/40 bg-amber-950/20 p-3">
              <h3 className="mb-2 text-sm font-semibold text-amber-300">Correlations ({correlations.length})</h3>
              <ul className="space-y-1.5">
                {correlations.map((c) => (
                  <li key={c.correlationId} className="flex items-center justify-between rounded-lg bg-zinc-900/60 px-3 py-1.5 text-xs">
                    <span className="flex items-center gap-2">
                      <span className={cn('h-2 w-2 rounded-full', SEV_DOT[c.peakSeverity])} />
                      <span className="font-mono text-zinc-200">{c.pivot}</span>
                    </span>
                    <span className="text-zinc-400">{c.eventCount} events · peak {c.peakSeverity}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-zinc-200">Event Stream</h3>
              <input className={cn(inp, 'ml-auto max-w-[200px]')} placeholder="Search…" value={evQuery} onChange={(e) => setEvQuery(e.target.value)} />
            </div>
            {events.length === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-400">No events ingested yet.</p>
            ) : (
              <div className="max-h-72 space-y-1 overflow-y-auto">
                {events.map((e) => (
                  <div key={e.id} className="flex items-start gap-2 rounded-lg bg-zinc-900/60 px-2.5 py-1.5 text-xs">
                    <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', SEV_DOT[e.severity])} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-zinc-200">{e.message}</p>
                      <p className="text-[11px] text-zinc-400">
                        {e.source} · {e.srcIp || 'no-ip'} · {new Date(e.ts).toLocaleTimeString()}
                        {e.correlationId && <span className="ml-1 text-amber-400">· correlated</span>}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------------- Rules ---------------- */}
      {tab === 'rules' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
            <h3 className="mb-2 text-sm font-semibold text-zinc-200">New Detection Rule</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <input className={inp} placeholder="Rule name" value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} />
              <input className={inp} placeholder="Match pattern (substring)" value={ruleForm.pattern} onChange={(e) => setRuleForm({ ...ruleForm, pattern: e.target.value })} />
              <select className={inp} value={ruleForm.field} onChange={(e) => setRuleForm({ ...ruleForm, field: e.target.value })}>
                {EVENT_FIELDS.map((f) => <option key={f} value={f}>field: {f}</option>)}
              </select>
              <select className={inp} value={ruleForm.minSeverity} onChange={(e) => setRuleForm({ ...ruleForm, minSeverity: e.target.value })}>
                {EVENT_SEVERITIES.map((s) => <option key={s} value={s}>min severity: {s}</option>)}
              </select>
              <input className={inp} type="number" min={1} placeholder="Threshold" value={ruleForm.threshold} onChange={(e) => setRuleForm({ ...ruleForm, threshold: e.target.value })} />
              <input className={inp} type="number" min={1} placeholder="Window (minutes)" value={ruleForm.windowMin} onChange={(e) => setRuleForm({ ...ruleForm, windowMin: e.target.value })} />
              <select className={inp} value={ruleForm.incidentSeverity} onChange={(e) => setRuleForm({ ...ruleForm, incidentSeverity: e.target.value })}>
                {INCIDENT_SEVERITIES.map((s) => <option key={s} value={s}>incident: {s}</option>)}
              </select>
            </div>
            <div className="mt-2 flex gap-2">
              <button className={cn(btn, 'bg-rose-600 text-white hover:bg-rose-500')} onClick={addRule} disabled={busy || !ruleForm.name.trim() || !ruleForm.pattern.trim()}>
                <Plus className="h-3.5 w-3.5" /> Add Rule
              </button>
              <button className={cn(btn, 'bg-emerald-600 text-white hover:bg-emerald-500')} onClick={evaluateRules} disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Evaluate All
              </button>
            </div>
            {ruleResult && <p className="mt-2 text-xs text-emerald-400">{ruleResult}</p>}
          </div>

          {rules.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-400">No detection rules defined yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {rules.map((r) => (
                <li key={r.id} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm">
                  <span className={cn('h-2 w-2 rounded-full', r.enabled ? 'bg-emerald-500' : 'bg-zinc-600')} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-zinc-200">{r.name}</p>
                    <p className="text-[11px] text-zinc-400">
                      {r.field} ⊃ &quot;{r.pattern}&quot; · ≥{r.threshold} in {r.windowMin}m → {r.incidentSeverity} · fired {r.fireCount}×
                    </p>
                  </div>
                  <button className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" onClick={() => toggleRule(r.id)} title="Toggle">
                    <Power className="h-3.5 w-3.5" />
                  </button>
                  <button className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-rose-400" onClick={() => deleteRule(r.id)} title="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ---------------- Incidents ---------------- */}
      {tab === 'incidents' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
            <h3 className="mb-2 text-sm font-semibold text-zinc-200">Open Incident</h3>
            <div className="grid gap-2 sm:grid-cols-3">
              <input className={cn(inp, 'sm:col-span-2')} placeholder="Incident title" value={incForm.title} onChange={(e) => setIncForm({ ...incForm, title: e.target.value })} />
              <select className={inp} value={incForm.severity} onChange={(e) => setIncForm({ ...incForm, severity: e.target.value })}>
                {INCIDENT_SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <input className={cn(inp, 'sm:col-span-3')} placeholder="Assignee (optional)" value={incForm.assignee} onChange={(e) => setIncForm({ ...incForm, assignee: e.target.value })} />
            </div>
            <button className={cn(btn, 'mt-2 bg-rose-600 text-white hover:bg-rose-500')} onClick={openIncident} disabled={busy || !incForm.title.trim()}>
              <Plus className="h-3.5 w-3.5" /> Open Incident
            </button>
          </div>

          {incidents.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-400">No incidents. Open one above or evaluate alert rules.</p>
          ) : (
            <ul className="space-y-1.5">
              {incidents.map((i) => (
                <li key={i.id}>
                  <button
                    onClick={() => setSelectedInc(selectedInc === i.id ? null : i.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                      selectedInc === i.id ? 'border-rose-700 bg-rose-950/30' : 'border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900/70',
                    )}
                  >
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">{i.severity}</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-200">{i.title}</span>
                    <span className="text-[11px] text-zinc-400">{i.phase}</span>
                    {i.origin === 'alert-rule' && <span className="rounded bg-amber-900/50 px-1.5 py-0.5 text-[10px] text-amber-300">auto</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selectedIncident && (
            <div className="rounded-xl border border-rose-800/40 bg-zinc-900/60 p-3 text-sm">
              <h3 className="mb-2 font-semibold text-zinc-100">{selectedIncident.title}</h3>
              {selectedIncident.notes && <p className="mb-2 text-xs text-zinc-400">{selectedIncident.notes}</p>}

              {/* Phase pipeline */}
              <div className="mb-3 flex flex-wrap gap-1">
                {IR_PHASES.map((p) => (
                  <button
                    key={p}
                    onClick={() => advancePhase(selectedIncident.id, p)}
                    className={cn(
                      'rounded px-2 py-0.5 text-[11px] transition-colors',
                      selectedIncident.phase === p ? 'bg-rose-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700',
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>

              {/* Playbook */}
              {!selectedIncident.playbookId ? (
                <div className="mb-3">
                  <p className="mb-1 text-xs text-zinc-400">Attach a response playbook:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {playbooks.map((p) => (
                      <button key={p.id} onClick={() => attachPlaybook(selectedIncident.id, p.id)} className={cn(btn, 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700 text-xs')}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mb-3">
                  <p className="mb-1 text-xs font-medium text-zinc-300">Playbook steps</p>
                  <ul className="space-y-1">
                    {selectedIncident.playbookSteps?.map((s) => (
                      <li key={s.idx} className="flex items-start gap-2 text-xs">
                        <button onClick={() => !s.done && completeStep(selectedIncident.id, s.idx)} disabled={s.done}>
                          {s.done
                            ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />
                            : <span className="mt-0.5 inline-block h-4 w-4 rounded-full border border-zinc-600" />}
                        </button>
                        <span className={cn(s.done ? 'text-zinc-400 line-through' : 'text-zinc-200')}>{s.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Add note */}
              <div className="mb-3 flex gap-2">
                <input className={inp} placeholder="Investigation note…" value={advNote} onChange={(e) => setAdvNote(e.target.value)} />
                <button className={cn(btn, 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700')} onClick={() => addIncidentNote(selectedIncident.id)} disabled={!advNote.trim()}>
                  Log
                </button>
              </div>

              {/* Timeline */}
              <div>
                <p className="mb-1 text-xs font-medium text-zinc-400">Timeline</p>
                <ul className="space-y-0.5">
                  {selectedIncident.timeline.map((t, idx) => (
                    <li key={idx} className="text-[11px] text-zinc-400">
                      <span className="text-zinc-400">{new Date(t.at).toLocaleTimeString()}</span> · {t.action} {t.detail && `— ${t.detail}`}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------------- CVE → Asset ---------------- */}
      {tab === 'cve-match' && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">
            Match registered vulnerabilities against your asset inventory by vendor, name, type and version.
          </p>
          <button className={cn(btn, 'bg-rose-600 text-white hover:bg-rose-500')} onClick={runCveMatch} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />} Run CVE → Asset Match
          </button>
          {cveMatches !== null && (
            cveMatches.length === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-400">No vulnerability matched a registered asset.</p>
            ) : (
              <ul className="space-y-2">
                {cveMatches.map((m) => (
                  <li key={m.vulnId} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono text-rose-300">{m.cveId || 'no-cve'}</span>
                      <span className="text-zinc-300">{m.title}</span>
                      {m.cvss != null && <span className="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">CVSS {m.cvss}</span>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {m.affectedAssets.map((a) => (
                        <span key={a.id} className={cn('rounded px-2 py-0.5 text-xs', a.critical ? 'bg-rose-900/50 text-rose-200' : 'bg-zinc-800 text-zinc-300')}>
                          {a.name}{a.version ? ` ${a.version}` : ''}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      )}

      {/* ---------------- Badge Audit ---------------- */}
      {tab === 'badges' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
            <h3 className="mb-2 text-sm font-semibold text-zinc-200">Record Badge Access</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <input className={inp} placeholder="Badge ID" value={badgeForm.badgeId} onChange={(e) => setBadgeForm({ ...badgeForm, badgeId: e.target.value })} />
              <input className={inp} placeholder="Holder (optional)" value={badgeForm.holder} onChange={(e) => setBadgeForm({ ...badgeForm, holder: e.target.value })} />
              <input className={inp} placeholder="Zone" value={badgeForm.zone} onChange={(e) => setBadgeForm({ ...badgeForm, zone: e.target.value })} />
              <input className={inp} placeholder="Door (optional)" value={badgeForm.door} onChange={(e) => setBadgeForm({ ...badgeForm, door: e.target.value })} />
              <select className={inp} value={badgeForm.result} onChange={(e) => setBadgeForm({ ...badgeForm, result: e.target.value })}>
                <option value="granted">granted</option>
                <option value="denied">denied</option>
              </select>
            </div>
            <div className="mt-2 flex gap-2">
              <button className={cn(btn, 'bg-rose-600 text-white hover:bg-rose-500')} onClick={addBadgeEvent} disabled={busy || !badgeForm.badgeId.trim() || !badgeForm.zone.trim()}>
                <Plus className="h-3.5 w-3.5" /> Record
              </button>
              <button className={cn(btn, 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700')} onClick={runBadgeAudit} disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />} Run Audit
              </button>
            </div>
          </div>

          {badgeStats && (
            <p className="text-xs text-zinc-400">
              Audited {badgeStats.eventsAudited} access event(s) · {badgeStats.denialCount} denial(s)
            </p>
          )}
          {anomalies !== null && (
            anomalies.length === 0 ? (
              <p className="py-6 text-center text-sm text-emerald-400">No anomalous access detected.</p>
            ) : (
              <ul className="space-y-1.5">
                {anomalies.map((a, idx) => (
                  <li key={idx} className="flex items-center gap-2 rounded-lg border border-amber-700/40 bg-amber-950/20 px-3 py-2 text-sm">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                    <span className="text-zinc-300">{a.detail}</span>
                    <span className="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400">{a.kind}</span>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      )}

      {/* ---------------- Camera Wall ---------------- */}
      {tab === 'cameras' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
            <h3 className="mb-2 text-sm font-semibold text-zinc-200">Register Camera</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <input className={inp} placeholder="Camera name" value={camForm.name} onChange={(e) => setCamForm({ ...camForm, name: e.target.value })} />
              <input className={inp} placeholder="Zone" value={camForm.zone} onChange={(e) => setCamForm({ ...camForm, zone: e.target.value })} />
              <input className={cn(inp, 'sm:col-span-2')} placeholder="Stream URL (your own MJPEG/snapshot endpoint, optional)" value={camForm.streamUrl} onChange={(e) => setCamForm({ ...camForm, streamUrl: e.target.value })} />
              <select className={inp} value={camForm.kind} onChange={(e) => setCamForm({ ...camForm, kind: e.target.value })}>
                <option value="indoor">indoor</option>
                <option value="outdoor">outdoor</option>
                <option value="ptz">ptz</option>
                <option value="thermal">thermal</option>
              </select>
            </div>
            <button className={cn(btn, 'mt-2 bg-rose-600 text-white hover:bg-rose-500')} onClick={addCamera} disabled={busy || !camForm.name.trim()}>
              <Plus className="h-3.5 w-3.5" /> Add Camera
            </button>
          </div>

          {cameras.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-400">No cameras registered yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {cameras.map((c) => (
                <div key={c.id} className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
                  <div className="relative aspect-video bg-zinc-950">
                    {c.streamUrl ? (
                      <Image
                        src={c.streamUrl}
                        alt={c.name}
                        fill
                        unoptimized
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-zinc-700">
                        <Camera className="h-8 w-8" />
                      </div>
                    )}
                    <span className={cn(
                      'absolute right-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium',
                      c.status === 'online' ? 'bg-emerald-900/80 text-emerald-300'
                        : c.status === 'offline' ? 'bg-rose-900/80 text-rose-300'
                        : 'bg-amber-900/80 text-amber-300',
                    )}>
                      {c.status}
                    </span>
                  </div>
                  <div className="p-2">
                    <p className="truncate text-sm font-medium text-zinc-200">{c.name}</p>
                    <p className="text-[11px] text-zinc-400">{c.zone} · {c.kind}</p>
                    <div className="mt-1.5 flex gap-1">
                      <select
                        className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-[11px] text-zinc-300"
                        value={c.status}
                        onChange={(e) => setCameraStatus(c.id, e.target.value)}
                      >
                        <option value="online">online</option>
                        <option value="offline">offline</option>
                        <option value="maintenance">maintenance</option>
                      </select>
                      <button className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-rose-400" onClick={() => deleteCamera(c.id)} title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------------- Threat Intel ---------------- */}
      {tab === 'intel' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
            <h3 className="mb-2 text-sm font-semibold text-zinc-200">Enrich Indicator</h3>
            <p className="mb-2 text-xs text-zinc-400">
              EPSS exploit-probability from FIRST.org · IOC reputation derived from your SIEM event stream.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input className={inp} placeholder="CVE id (e.g. CVE-2021-44228)" value={intelForm.cveId} onChange={(e) => setIntelForm({ ...intelForm, cveId: e.target.value })} />
              <input className={inp} placeholder="IOC (IP / host / token)" value={intelForm.ioc} onChange={(e) => setIntelForm({ ...intelForm, ioc: e.target.value })} />
            </div>
            <button className={cn(btn, 'mt-2 bg-rose-600 text-white hover:bg-rose-500')} onClick={runEnrichment} disabled={busy || (!intelForm.cveId.trim() && !intelForm.ioc.trim())}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radar className="h-3.5 w-3.5" />} Enrich
            </button>
          </div>

          {intelError && <p className="text-xs text-amber-400">{intelError}</p>}

          {epss && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
              <h3 className="mb-1.5 text-sm font-semibold text-zinc-200">EPSS Exploit Probability</h3>
              {epss.score == null ? (
                <p className="text-xs text-zinc-400">{epss.note || 'No EPSS data.'}</p>
              ) : (
                <div className="space-y-1 text-sm">
                  <p className="text-zinc-300">Score: <span className="font-mono text-rose-300">{(epss.score * 100).toFixed(1)}%</span></p>
                  {epss.percentile != null && <p className="text-zinc-400">Percentile: {(epss.percentile * 100).toFixed(1)}%</p>}
                  <p className="text-zinc-400">
                    Exploitability:{' '}
                    <span className={cn(
                      epss.exploitability === 'high' ? 'text-rose-400'
                        : epss.exploitability === 'moderate' ? 'text-amber-400' : 'text-emerald-400',
                    )}>
                      {epss.exploitability}
                    </span>
                  </p>
                </div>
              )}
            </div>
          )}

          {iocIntel && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
              <h3 className="mb-1.5 text-sm font-semibold text-zinc-200">IOC Intel — {iocIntel.value}</h3>
              <div className="space-y-1 text-sm">
                <p className="text-zinc-300">
                  Reputation:{' '}
                  <span className={cn(
                    iocIntel.reputation === 'malicious' ? 'text-rose-400'
                      : iocIntel.reputation === 'suspicious' ? 'text-amber-400' : 'text-zinc-400',
                  )}>
                    {iocIntel.reputation}
                  </span>
                </p>
                <p className="text-zinc-400">Sightings in event stream: {iocIntel.sightings}</p>
                {iocIntel.peakSeverity && <p className="text-zinc-400">Peak severity: {iocIntel.peakSeverity}</p>}
                {iocIntel.lastSeen && <p className="text-zinc-400">Last seen: {new Date(iocIntel.lastSeen).toLocaleString()}</p>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
