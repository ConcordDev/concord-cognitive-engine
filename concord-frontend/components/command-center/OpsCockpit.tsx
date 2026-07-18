'use client';

/**
 * OpsCockpit — Datadog/PagerDuty-shape operations cockpit for the
 * command-center lens. Surfaces the seven feature-parity backlog items:
 * time-series vital history, alerting rules + acknowledgement, saved
 * dashboards, incident timeline + postmortems, cross-vital correlation,
 * an at-a-glance health rollup, and one-click runbook remediation.
 *
 * Every record is real operator input or computed from it — no seed data.
 * Empty states say "no data yet".
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz/ChartKit';
import { TimelineView, type TimelineEvent } from '@/components/viz/TimelineView';
import {
  Activity, AlertTriangle, BarChart3, GitBranch, LayoutDashboard,
  Network, Play, Plus, ShieldCheck, Trash2, Check, BellOff, FileText,
  Radar, Share2, ArrowUpCircle, RefreshCw, Users, LogIn, Crown, Headphones,
  Eye, PhoneCall,
} from 'lucide-react';

// ── Domain types ─────────────────────────────────────────────────────────────

interface VitalPoint { t: number; v: number }
interface VitalMetric { metric: string; pointCount: number; latest: number | null; latestAt: string | null }
interface AlertRule {
  id: string; name: string; metric: string; comparator: string; threshold: number;
  severity: string; onCall: string | null; muted: boolean; state: string;
  acknowledged: boolean; fireCount: number; lastValue: number | null; lastFiredAt: string | null;
}
interface Dashboard { id: string; name: string; widgets: unknown[]; updatedAt: string }
interface DashboardWidgetVitalData {
  metric: string; points: VitalPoint[]; count: number;
  stats: { min: number; max: number; avg: number; latest: number } | null;
}
interface DashboardWidgetAlertData {
  ruleId: string; name: string; metric: string; comparator: string; threshold: number;
  severity: string; state: string; lastValue: number | null; lastFiredAt: string | null;
  acknowledged: boolean; fireCount: number;
}
interface DashboardWidget {
  id: string; type: string; kind?: 'vital' | 'alert-rule';
  data: DashboardWidgetVitalData | DashboardWidgetAlertData | null;
  error?: string;
}
interface DashboardData {
  dashboardId: string; name: string; widgets: DashboardWidget[];
  count: number; resolvedCount: number; unresolvedCount: number;
}
interface IncidentUpdate { id: string; status: string; message: string; at: string; by: string }
interface Postmortem { summary: string; rootCause: string | null; actionItems: string[]; writtenAt: string }
interface Incident {
  id: string; title: string; severity: string; status: string; openedAt: string;
  resolvedAt: string | null; updates: IncidentUpdate[]; postmortem: Postmortem | null;
  openedBy?: string; onCallAt?: string | null;
}
interface CorrelationPair {
  metricA: string; metricB: string; coefficient: number; strength: string;
  direction: string; samples: number;
}
interface HealthBreach {
  ruleId: string; name: string; metric: string; value: number; threshold: number;
  severity: string; acknowledged: boolean; color: string;
}
interface MetricStatus { metric: string; value: number; color: string }
interface HealthRollup {
  score: number; verdict: string; label: string; breaches: HealthBreach[];
  breachCount: number; openIncidents: number; metricStatus: MetricStatus[];
  monitoredMetrics: number; activeRules: number;
}
interface RunbookStep { label: string; action: string }
interface RunbookExecution { id: string; finishedAt: string; stepCount: number; triggeredBy: string }
interface Runbook {
  id: string; name: string; trigger: string | null; steps: RunbookStep[];
  runCount: number; lastRunAt: string | null; executions: RunbookExecution[];
}
interface FeedSeverityBreakdown { critical: number; high: number; medium: number; low: number }
interface FeedSummary {
  source: string; status: string; totalItems: number; unresolvedCount: number;
  resolvedCount: number; health: number; severityBreakdown: FeedSeverityBreakdown;
}
interface SitrepCriticalItem { id?: string; severity?: string; description?: string; source?: string }
interface SitrepResult {
  message?: string;
  overallStatus?: 'RED' | 'AMBER' | 'YELLOW' | 'GREEN';
  readinessScore?: number;
  readinessLabel?: string;
  feeds?: FeedSummary[];
  criticalItems?: { count: number; items: SitrepCriticalItem[] };
  totals?: { allItems: number; unresolved: number; resolved: number; resolutionRate: number };
  tempo?: { itemsPerHour: number; spanHours: number } | null;
  crossSourceIssues?: { sources: string[]; potentialOverlaps: number }[];
  generatedAt?: string;
}
interface IncidentCorrelationPair {
  incidentA: string; incidentB: string; correlation: number;
  matchedAttributes: string[]; timeDeltaMs: number | null;
}
interface IncidentCorrelationResult {
  message?: string;
  totalIncidents?: number;
  correlationsFound?: number;
  correlations?: IncidentCorrelationPair[];
  clusters?: { clusterId: number; memberCount: number; members: string[] }[];
  uncorrelatedCount?: number;
}
interface EscalationLevelEntry {
  level: number; label?: string; responders?: string[];
  slaMinutes?: number; thresholdMinutes?: number; triggered: boolean; triggerReason?: string | null;
}
interface EscalationResult {
  incidentId?: string;
  severity: string;
  urgencyScore: number;
  urgencyLabel: string;
  sla: { totalMinutes: number; elapsedMinutes: number; remainingMinutes: number; percentUsed: number; breached: boolean };
  escalation: { currentLevel: number; maxLevel: number; path: EscalationLevelEntry[] };
  recommendedActions: string[];
}

// ── Team / on-call types (WAVE4) ─────────────────────────────────────────────

type CcTier = 'lead' | 'responder' | 'observer';
interface TeamSummary {
  orgId: string; name: string; type: string; description: string;
  memberCount: number; orgRole: string; tier: CcTier; createdAt: string;
}
interface TeamMember { userId: string; orgRole: string; tier: CcTier }
interface OnCallEntry { userId: string; shiftIndex: number; shiftStart: string; shiftEnd: string }
interface OnCallScheduleT { orgId: string; members: string[]; shiftHours: number; startAt: number; updatedAt: string; updatedBy: string }

// ── Helpers ──────────────────────────────────────────────────────────────────

const SEV_COLOR: Record<string, string> = {
  critical: 'text-red-400 bg-red-500/10 border-red-500/30',
  high: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
  medium: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  low: 'text-sky-400 bg-sky-500/10 border-sky-500/30',
};
const DOT: Record<string, string> = { green: 'bg-emerald-400', amber: 'bg-amber-400', red: 'bg-red-400' };

async function run<T>(macro: string, params: Record<string, unknown> = {}): Promise<T | null> {
  const r = await lensRun<T>('command-center', macro, params);
  return r.data?.ok ? r.data.result : null;
}

// Team/on-call macros commonly fail with a real, user-facing reason
// (not_a_member / insufficient_role / org_not_found / unknown_member) —
// unlike `run` above (which the rest of this file uses and which only ever
// surfaces a bare truthy/null), this distinguishes a genuine handler-level
// rejection from success so the team UI can show the REAL reason instead of
// silently no-op'ing. `/api/lens/run` always wraps as `{ok:true, result}` at
// the transport layer; a handler failure surfaces as `result.ok === false`.
type ScopedResult<T> = { ok: true; data: T } | { ok: false; error: string };
async function runScoped<T>(macro: string, params: Record<string, unknown> = {}): Promise<ScopedResult<T>> {
  const r = await lensRun<Record<string, unknown>>('command-center', macro, params);
  if (!r.data?.ok) return { ok: false, error: 'request failed' };
  const inner = r.data.result as Record<string, unknown> | null;
  if (inner && typeof inner === 'object' && inner.ok === false) {
    return { ok: false, error: String(inner.error || 'failed') };
  }
  return { ok: true, data: inner as T };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-cyan-600/70">
      {label}
      {children}
    </label>
  );
}

const inputCls =
  'bg-[#0a0f18] border border-cyan-900/30 rounded-md px-2 py-1.5 text-sm text-cyan-50 ' +
  'placeholder-cyan-800/50 focus:outline-none focus:border-cyan-600/50';

// ── 0 — Team scope: create/join an ops team, roster, on-call rotation ───────
// WAVE4: command-center's ops state defaults to per-operator (unchanged).
// This panel is the frontend surface for the additive `team*`/`onCall*`
// macros in server/domains/commandcenter.js, which reuse Concord's existing
// org/roster substrate (server/lib/world-organizations.js) the same way the
// lab/supplychain lenses do — a "team" IS an org. Selecting a team here sets
// the active `orgId` that every section below is threaded with, turning the
// SAME cockpit into shared team state. No fabricated members, rosters, or
// on-call assignments — every value below comes from a real macro response.
const TIER_LABEL: Record<CcTier, string> = { lead: 'Lead', responder: 'Responder', observer: 'Observer' };
const TIER_ICON: Record<CcTier, typeof Crown> = { lead: Crown, responder: Headphones, observer: Eye };

function TeamPanel({ activeOrgId, onScopeChange }: { activeOrgId: string | null; onScopeChange: (orgId: string | null) => void }) {
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [joinOrgId, setJoinOrgId] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await runScoped<{ teams: TeamSummary[] }>('teamListMine');
    if (r.ok) {
      setTeams(r.data.teams);
      setErr(null);
      // Keep the active selection valid; drop back to Personal if the team
      // was left/no longer exists.
      if (activeOrgId && !r.data.teams.some((t) => t.orgId === activeOrgId)) onScopeChange(null);
    } else {
      setErr(r.error);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const createTeam = async () => {
    if (!newName.trim()) { setErr('team name required'); return; }
    setBusy(true);
    const r = await runScoped<{ team: { id: string } }>('teamCreate', { name: newName.trim(), description: newDesc.trim() });
    if (r.ok) { setNewName(''); setNewDesc(''); await refresh(); onScopeChange(r.data.team.id); }
    else setErr(r.error);
    setBusy(false);
  };

  const joinTeam = async () => {
    if (!joinOrgId.trim()) { setErr('team id required'); return; }
    setBusy(true);
    const r = await runScoped<{ orgId: string }>('teamJoin', { orgId: joinOrgId.trim() });
    if (r.ok) { setJoinOrgId(''); await refresh(); onScopeChange(r.data.orgId); }
    else setErr(r.error);
    setBusy(false);
  };

  const selected = teams.find((t) => t.orgId === activeOrgId) || null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-cyan-500/70 flex items-center gap-2">
          <Users className="w-3.5 h-3.5" /> Ops Team
        </h4>
        <button onClick={refresh} className="text-[10px] text-cyan-600/60 hover:text-cyan-400 flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {err && <p className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {err}</p>}

      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => onScopeChange(null)}
          className={`text-[11px] rounded-full px-2.5 py-1 border transition-colors ${
            activeOrgId === null ? 'border-cyan-500/50 text-cyan-300 bg-cyan-500/10' : 'border-cyan-900/30 text-cyan-600/70 hover:text-cyan-400'
          }`}
        >
          Personal cockpit
        </button>
        {!loading && teams.map((t) => {
          const Icon = TIER_ICON[t.tier];
          return (
            <button
              key={t.orgId}
              onClick={() => onScopeChange(t.orgId)}
              className={`flex items-center gap-1.5 text-[11px] rounded-full px-2.5 py-1 border transition-colors ${
                activeOrgId === t.orgId ? 'border-cyan-500/50 text-cyan-300 bg-cyan-500/10' : 'border-cyan-900/30 text-cyan-600/70 hover:text-cyan-400'
              }`}
            >
              <Icon className="w-3 h-3" /> {t.name} <span className="text-cyan-700/50">({TIER_LABEL[t.tier]})</span>
            </button>
          );
        })}
      </div>

      {!loading && teams.length === 0 && (
        <p className="text-xs text-cyan-700/50 py-1">
          You&apos;re not a member of any ops team yet — the cockpit is purely personal. Create a team or join one below to share it.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="flex flex-wrap items-end gap-2 bg-[#0a0f18] rounded-lg border border-cyan-900/20 p-2.5">
          <Field label="Team name"><input className={`${inputCls} w-36`} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="SRE On-Call" /></Field>
          <Field label="Description"><input className={`${inputCls} w-40`} value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="optional" /></Field>
          <button onClick={createTeam} disabled={busy || !newName.trim()} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" /> Create (you become lead)
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-2 bg-[#0a0f18] rounded-lg border border-cyan-900/20 p-2.5">
          <Field label="Team id"><input className={`${inputCls} w-48`} value={joinOrgId} onChange={(e) => setJoinOrgId(e.target.value)} placeholder="ask a teammate" /></Field>
          <button onClick={joinTeam} disabled={busy || !joinOrgId.trim()} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-40">
            <LogIn className="w-3.5 h-3.5" /> Join (enters as observer)
          </button>
        </div>
      </div>

      {selected && <TeamDetail team={selected} onChanged={refresh} />}
    </section>
  );
}

function TeamDetail({ team, onChanged }: { team: TeamSummary; onChanged: () => void }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busyUser, setBusyUser] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    const r = await runScoped<{ members: TeamMember[] }>('teamMembers', { orgId: team.orgId });
    if (r.ok) { setMembers(r.data.members); setErr(null); } else setErr(r.error);
  }, [team.orgId]);
  useEffect(() => { loadMembers(); }, [loadMembers]);

  const setTier = async (userId: string, tier: CcTier) => {
    setBusyUser(userId);
    const r = await runScoped('teamSetRole', { orgId: team.orgId, userId, tier });
    if (r.ok) { await loadMembers(); onChanged(); } else setErr(r.error);
    setBusyUser(null);
  };

  return (
    <div className="bg-[#0a0f18] rounded-lg border border-cyan-900/25 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-cyan-100 font-medium">
          {team.name} <span className="text-cyan-600/60 font-normal">· {team.memberCount} member{team.memberCount !== 1 ? 's' : ''} · you are {TIER_LABEL[team.tier]}</span>
        </p>
        <span className="text-[10px] text-cyan-700/50 font-mono">{team.orgId}</span>
      </div>
      {err && <p className="text-xs text-red-400">{err}</p>}
      <div className="space-y-1">
        {members.map((m) => {
          const Icon = TIER_ICON[m.tier];
          return (
            <div key={m.userId} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-black/20">
              <span className="font-mono text-cyan-200">{m.userId}</span>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 text-cyan-600/60"><Icon className="w-3 h-3" /> {TIER_LABEL[m.tier]}</span>
                {team.tier === 'lead' && m.orgRole !== 'leader' && (
                  <select
                    value={m.tier}
                    disabled={busyUser === m.userId}
                    onChange={(e) => setTier(m.userId, e.target.value as CcTier)}
                    className="input-lattice text-[11px] py-0.5 bg-[#0a0f18] border border-cyan-900/30 rounded"
                    aria-label={`Set role for ${m.userId}`}
                  >
                    <option value="lead">Lead</option>
                    <option value="responder">Responder</option>
                    <option value="observer">Observer</option>
                  </select>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <OnCallSection orgId={team.orgId} tier={team.tier} roster={members} />
    </div>
  );
}

// ── On-call rotation — read for everyone, edit for leads only ──────────────
function OnCallSection({ orgId, tier, roster }: { orgId: string; tier: CcTier; roster: TeamMember[] }) {
  const [schedule, setSchedule] = useState<OnCallScheduleT | null>(null);
  const [onCallNow, setOnCallNow] = useState<OnCallEntry | null>(null);
  const [upcoming, setUpcoming] = useState<OnCallEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [rotationText, setRotationText] = useState('');
  const [shiftHours, setShiftHours] = useState('24');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await runScoped<{ schedule: OnCallScheduleT | null; onCallNow: OnCallEntry | null; upcoming: OnCallEntry[] }>('onCallSchedule', { orgId });
    if (r.ok) {
      setSchedule(r.data.schedule);
      setOnCallNow(r.data.onCallNow);
      setUpcoming(r.data.upcoming);
      setErr(null);
    } else setErr(r.error);
  }, [orgId]);

  useEffect(() => {
    load();
    // Poll for the resolved on-call operator — real recomputation against
    // the wall clock each time, not a fabricated tick.
    const iv = setInterval(load, 20000);
    return () => clearInterval(iv);
  }, [load]);

  const saveSchedule = async () => {
    const members = rotationText.split(',').map((s) => s.trim()).filter(Boolean);
    if (members.length === 0) { setErr('list at least one member id, comma-separated, in rotation order'); return; }
    setBusy(true);
    const r = await runScoped('onCallScheduleSet', { orgId, members, shiftHours: Number(shiftHours) || 24 });
    if (r.ok) { setRotationText(''); await load(); } else setErr(r.error);
    setBusy(false);
  };

  return (
    <div className="space-y-2 border-t border-cyan-900/20 pt-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-500/70 flex items-center gap-1">
        <PhoneCall className="w-3.5 h-3.5" /> On-Call Rotation
      </p>
      {err && <p className="text-xs text-red-400">{err}</p>}
      {!schedule ? (
        <p className="text-xs text-cyan-700/50">No on-call schedule set for this team yet.</p>
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm">
            {onCallNow ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-cyan-50 font-medium">{onCallNow.userId}</span>
                <span className="text-[10px] text-cyan-600/60">on call now · shift ends {new Date(onCallNow.shiftEnd).toLocaleString()}</span>
              </>
            ) : (
              <span className="text-cyan-700/50 text-xs">Schedule starts {new Date(schedule.startAt).toLocaleString()}</span>
            )}
          </div>
          {upcoming.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {upcoming.map((u) => (
                <span key={u.shiftIndex} className="text-[10px] bg-black/20 border border-cyan-900/25 rounded-full px-2 py-0.5 text-cyan-300/80">
                  {u.userId} · {new Date(u.shiftStart).toLocaleDateString()}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {tier === 'lead' ? (
        <div className="flex flex-wrap items-end gap-2 mt-1">
          <Field label={`Rotation order (comma-separated userIds — roster: ${roster.map((m) => m.userId).join(', ') || 'none yet'})`}>
            <input className={`${inputCls} w-64`} value={rotationText} onChange={(e) => setRotationText(e.target.value)} placeholder="userA, userB, userC" />
          </Field>
          <Field label="Shift hours">
            <input className={`${inputCls} w-20`} type="number" min={1} value={shiftHours} onChange={(e) => setShiftHours(e.target.value)} />
          </Field>
          <button onClick={saveSchedule} disabled={busy || !rotationText.trim()} className="px-3 py-1.5 rounded-md text-xs bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-40">
            {schedule ? 'Update rotation' : 'Set rotation'}
          </button>
        </div>
      ) : (
        <p className="text-[10px] text-cyan-700/50">Only a lead can set the rotation.</p>
      )}

      <p className="text-[10px] text-amber-400/70 flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" /> Real SMS/phone paging (e.g. Twilio) is not wired — connect an external
        paging integration for that. What&apos;s real here: the on-call operator above is computed from this actual
        schedule against the real clock, and every team member sees it live inside Concord.
      </p>
    </div>
  );
}

// ── 6 — Health rollup banner ─────────────────────────────────────────────────

function HealthBanner({ health }: { health: HealthRollup | null }) {
  if (!health) return null;
  const tone =
    health.verdict === 'green' ? 'border-emerald-500/30 bg-emerald-500/5'
    : health.verdict === 'amber' ? 'border-amber-500/30 bg-amber-500/5'
    : 'border-red-500/30 bg-red-500/5';
  const ring =
    health.verdict === 'green' ? 'text-emerald-400'
    : health.verdict === 'amber' ? 'text-amber-400' : 'text-red-400';
  return (
    <div className={`rounded-xl border ${tone} p-4 flex items-center gap-4`}>
      <div className="flex flex-col items-center">
        <span className={`text-3xl font-mono font-bold ${ring}`}>{health.score}</span>
        <span className="text-[10px] uppercase tracking-wider text-cyan-600/60">health</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold capitalize ${ring}`}>{health.label}</p>
        <p className="text-xs text-cyan-600/60">
          {health.monitoredMetrics} metrics · {health.activeRules} active rules ·{' '}
          {health.breachCount} breaching · {health.openIncidents} open incidents
        </p>
        {health.metricStatus.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {health.metricStatus.map((m) => (
              <span
                key={m.metric}
                className="flex items-center gap-1 text-[10px] text-cyan-300/80 bg-[#0a0f18] border border-cyan-900/30 rounded-full px-2 py-0.5"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${DOT[m.color]}`} />
                {m.metric} {m.value}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 1 — Time-series vitals ───────────────────────────────────────────────────

function VitalsSection({ onChange, orgId, readOnly }: { onChange: () => void; orgId?: string | null; readOnly?: boolean }) {
  const [metrics, setMetrics] = useState<VitalMetric[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [points, setPoints] = useState<VitalPoint[]>([]);
  const [metric, setMetric] = useState('');
  const [value, setValue] = useState('');
  const scopeParams = orgId ? { orgId } : {};

  const loadMetrics = useCallback(async () => {
    const r = await run<{ metrics: VitalMetric[] }>('vitalMetrics', scopeParams);
    setMetrics(r?.metrics ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const loadHistory = useCallback(async (m: string) => {
    if (!m) { setPoints([]); return; }
    const r = await run<{ points: VitalPoint[] }>('vitalHistory', { metric: m, windowMinutes: 1440, ...scopeParams });
    setPoints(r?.points ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => { loadMetrics(); }, [loadMetrics]);
  useEffect(() => { loadHistory(selected); }, [selected, loadHistory]);

  const record = useCallback(async () => {
    if (!metric.trim() || value.trim() === '') return;
    const r = await run('recordVital', { metric: metric.trim(), value: Number(value), ...scopeParams });
    if (r) {
      setValue('');
      await loadMetrics();
      if (selected === metric.trim()) await loadHistory(selected);
      else setSelected(metric.trim());
      onChange();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric, value, selected, loadMetrics, loadHistory, onChange, orgId]);

  const chartData = points.map((p) => ({
    t: new Date(p.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    v: p.v,
  }));

  return (
    <section className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-cyan-500/70 flex items-center gap-2">
        <BarChart3 className="w-3.5 h-3.5" /> Vital Time-Series {orgId && <span className="text-cyan-700/50 normal-case font-normal">(team-shared)</span>}
      </h4>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Metric name">
          <input className={inputCls} value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="e.g. heap_mb" disabled={readOnly} />
        </Field>
        <Field label="Value">
          <input className={`${inputCls} w-24`} type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" disabled={readOnly} />
        </Field>
        <button
          onClick={record}
          disabled={readOnly || !metric.trim() || value.trim() === ''}
          className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" /> Record
        </button>
      </div>
      {readOnly && <p className="text-[10px] text-cyan-700/50">Observer tier is read-only — a lead or responder can record vitals for this team.</p>}

      {metrics.length === 0 ? (
        <p className="text-xs text-cyan-700/50 py-3">No vitals recorded yet — record a metric point above.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {metrics.map((m) => (
              <button
                key={m.metric}
                onClick={() => setSelected(m.metric)}
                className={`text-[11px] rounded-full px-2.5 py-1 border transition-colors ${
                  selected === m.metric
                    ? 'border-cyan-500/50 text-cyan-300 bg-cyan-500/10'
                    : 'border-cyan-900/30 text-cyan-600/70 hover:text-cyan-400'
                }`}
              >
                {m.metric} <span className="text-cyan-700/50">({m.pointCount})</span>
              </button>
            ))}
          </div>
          {selected && (
            <div className="bg-[#0a0f18] rounded-lg border border-cyan-900/20 p-2">
              <ChartKit kind="area" data={chartData} xKey="t" series={[{ key: 'v', label: selected }]} height={200} showLegend={false} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── 2 — Alerting rules ───────────────────────────────────────────────────────

function AlertsSection({ onChange, orgId, readOnly }: { onChange: () => void; orgId?: string | null; readOnly?: boolean }) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [name, setName] = useState('');
  const [metric, setMetric] = useState('');
  const [comparator, setComparator] = useState('gt');
  const [threshold, setThreshold] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [onCall, setOnCall] = useState('');
  const scopeParams = orgId ? { orgId } : {};

  const load = useCallback(async () => {
    const r = await run<{ rules: AlertRule[] }>('listAlertRules', scopeParams);
    setRules(r?.rules ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  const create = useCallback(async () => {
    if (!name.trim() || !metric.trim() || threshold.trim() === '') return;
    const r = await run('createAlertRule', {
      name: name.trim(), metric: metric.trim(), comparator,
      threshold: Number(threshold), severity, onCall: onCall.trim(), ...scopeParams,
    });
    if (r) { setName(''); setMetric(''); setThreshold(''); setOnCall(''); await load(); onChange(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, metric, comparator, threshold, severity, onCall, load, onChange, orgId]);

  const act = useCallback(async (macro: string, params: Record<string, unknown>) => {
    await run(macro, { ...params, ...scopeParams }); await load(); onChange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, onChange, orgId]);

  const CMP: Record<string, string> = { gt: '>', lt: '<', gte: '≥', lte: '≤', eq: '=' };

  return (
    <section className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-cyan-500/70 flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5" /> Alert Rules {orgId && <span className="text-cyan-700/50 normal-case font-normal">(team-shared)</span>}
      </h4>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-[#0a0f18] rounded-lg border border-cyan-900/20 p-3">
        <Field label="Rule name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Heap high" disabled={readOnly} /></Field>
        <Field label="Metric"><input className={inputCls} value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="heap_mb" disabled={readOnly} /></Field>
        <Field label="Condition">
          <div className="flex gap-1">
            <select className={`${inputCls} flex-shrink-0`} value={comparator} onChange={(e) => setComparator(e.target.value)} disabled={readOnly}>
              {Object.entries(CMP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input className={`${inputCls} w-full`} type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="100" disabled={readOnly} />
          </div>
        </Field>
        <Field label="Severity">
          <select className={inputCls} value={severity} onChange={(e) => setSeverity(e.target.value)} disabled={readOnly}>
            {['critical', 'high', 'medium', 'low'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="On-call (optional)"><input className={inputCls} value={onCall} onChange={(e) => setOnCall(e.target.value)} placeholder="team-sre" disabled={readOnly} /></Field>
        <div className="flex items-end">
          <button
            onClick={create}
            disabled={readOnly || !name.trim() || !metric.trim() || threshold.trim() === ''}
            className="w-full flex items-center justify-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" /> Add Rule
          </button>
        </div>
      </div>

      {rules.length === 0 ? (
        <p className="text-xs text-cyan-700/50 py-3">No alert rules yet — define one to monitor a vital.</p>
      ) : (
        <div className="space-y-1.5">
          {rules.map((r) => (
            <div
              key={r.id}
              className={`rounded-lg border p-2.5 ${
                r.state === 'breaching' ? 'border-red-500/30 bg-red-500/5' : 'border-cyan-900/25 bg-[#0a0f18]'
              }`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${SEV_COLOR[r.severity]}`}>{r.severity}</span>
                <span className="text-sm text-cyan-50 font-medium">{r.name}</span>
                <span className="text-xs text-cyan-600/60 font-mono">
                  {r.metric} {CMP[r.comparator]} {r.threshold}
                </span>
                {r.muted && <span className="text-[10px] text-cyan-700/60">muted</span>}
                {r.state === 'breaching' && (
                  <span className="text-[10px] text-red-400 ml-auto">
                    BREACHING (val {r.lastValue}) · fired {r.fireCount}×
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                {r.onCall && <span className="text-[10px] text-cyan-600/60">page: {r.onCall}</span>}
                {r.state === 'breaching' && !r.acknowledged && (
                  <button
                    onClick={() => act('acknowledgeAlert', { ruleId: r.id })}
                    disabled={readOnly}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-40"
                  >
                    <Check className="w-3 h-3" /> Acknowledge
                  </button>
                )}
                {r.acknowledged && r.state === 'breaching' && (
                  <span className="text-[10px] text-emerald-400">acknowledged</span>
                )}
                <button
                  onClick={() => act('muteAlertRule', { ruleId: r.id, muted: !r.muted })}
                  disabled={readOnly}
                  className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-cyan-900/30 text-cyan-400 border border-cyan-900/40 hover:bg-cyan-900/50 disabled:opacity-40"
                >
                  <BellOff className="w-3 h-3" /> {r.muted ? 'Unmute' : 'Mute'}
                </button>
                <button
                  onClick={() => act('deleteAlertRule', { ruleId: r.id })}
                  disabled={readOnly}
                  className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/25 hover:bg-red-500/20 ml-auto disabled:opacity-40"
                >
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── 4 — Incident timeline ────────────────────────────────────────────────────

function IncidentsSection({ onChange, orgId, readOnly }: { onChange: () => void; orgId?: string | null; readOnly?: boolean }) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [mttr, setMttr] = useState<number | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [updMsg, setUpdMsg] = useState('');
  const [updStatus, setUpdStatus] = useState('investigating');
  const [pmSummary, setPmSummary] = useState('');
  const [pmCause, setPmCause] = useState('');
  const scopeParams = orgId ? { orgId } : {};

  const load = useCallback(async () => {
    const r = await run<{ incidents: Incident[]; mttrMinutes: number | null; openCount: number }>('listIncidents', scopeParams);
    setIncidents(r?.incidents ?? []);
    setMttr(r?.mttrMinutes ?? null);
    setOpenCount(r?.openCount ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  // Shared incident feed: when team-scoped, poll so a teammate's opened/
  // updated incident shows up here without a manual refresh. Real refetch
  // against the actual shared state — never a fabricated tick.
  useEffect(() => {
    if (!orgId) return;
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [orgId, load]);

  const open = useCallback(async () => {
    if (!title.trim()) return;
    const r = await run('openIncident', { title: title.trim(), severity, description: description.trim(), ...scopeParams });
    if (r) { setTitle(''); setDescription(''); await load(); onChange(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, severity, description, load, onChange, orgId]);

  const addUpdate = useCallback(async (id: string) => {
    if (!updMsg.trim()) return;
    const r = await run('updateIncident', { incidentId: id, message: updMsg.trim(), status: updStatus, ...scopeParams });
    if (r) { setUpdMsg(''); await load(); onChange(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updMsg, updStatus, load, onChange, orgId]);

  const savePm = useCallback(async (id: string) => {
    if (!pmSummary.trim()) return;
    const r = await run('writePostmortem', { incidentId: id, summary: pmSummary.trim(), rootCause: pmCause.trim(), ...scopeParams });
    if (r) { setPmSummary(''); setPmCause(''); await load(); onChange(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pmSummary, pmCause, load, onChange, orgId]);

  const STATUS_TONE: Record<string, TimelineEvent['tone']> = {
    investigating: 'warn', identified: 'info', monitoring: 'default', resolved: 'good',
  };

  return (
    <section className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-cyan-500/70 flex items-center gap-2">
        <Activity className="w-3.5 h-3.5" /> Incidents {orgId && <span className="text-cyan-700/50 normal-case font-normal">(shared with team)</span>}
        <span className="text-cyan-700/50 normal-case font-normal">
          {openCount} open{mttr != null ? ` · MTTR ${mttr}m` : ''}
        </span>
      </h4>
      {!readOnly && (
        <div className="flex flex-wrap items-end gap-2 bg-[#0a0f18] rounded-lg border border-cyan-900/20 p-3">
          <Field label="Title"><input className={`${inputCls} w-48`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="DB latency spike" /></Field>
          <Field label="Severity">
            <select className={inputCls} value={severity} onChange={(e) => setSeverity(e.target.value)}>
              {['critical', 'high', 'medium', 'low'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Description"><input className={`${inputCls} w-56`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="initial summary" /></Field>
          <button
            onClick={open}
            disabled={!title.trim()}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" /> Open Incident
          </button>
        </div>
      )}

      {incidents.length === 0 ? (
        <p className="text-xs text-cyan-700/50 py-3">
          {orgId ? 'No incidents for this team yet — open one above when something breaks.' : 'No incidents — open one above when something breaks.'}
        </p>
      ) : (
        <div className="space-y-1.5">
          {incidents.map((inc) => {
            const isOpen = active === inc.id;
            return (
              <div key={inc.id} className="rounded-lg border border-cyan-900/25 bg-[#0a0f18]">
                <button
                  onClick={() => setActive(isOpen ? null : inc.id)}
                  className="w-full flex items-center gap-2 p-2.5 text-left"
                >
                  <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${SEV_COLOR[inc.severity]}`}>{inc.severity}</span>
                  <span className="text-sm text-cyan-50 font-medium flex-1 truncate">{inc.title}</span>
                  <span className={`text-[10px] capitalize ${inc.status === 'resolved' ? 'text-emerald-400' : 'text-amber-400'}`}>{inc.status}</span>
                </button>
                {isOpen && (
                  <div className="px-2.5 pb-3 space-y-3 border-t border-cyan-900/20 pt-3">
                    {orgId && (inc.openedBy || inc.onCallAt) && (
                      <p className="text-[10px] text-cyan-600/60">
                        {inc.openedBy && <>opened by <span className="font-mono">{inc.openedBy}</span></>}
                        {inc.onCallAt && <> · on-call at open time: <span className="font-mono">{inc.onCallAt}</span></>}
                      </p>
                    )}
                    <TimelineView
                      events={inc.updates.map((u) => ({
                        id: u.id, label: u.status, time: u.at, tone: STATUS_TONE[u.status], detail: u.message,
                      }))}
                      height={90}
                    />
                    <div className="space-y-1.5">
                      {inc.updates.map((u) => (
                        <div key={u.id} className="text-[11px] bg-[#070b10] rounded p-2 border border-cyan-900/20">
                          <span className="text-cyan-400 capitalize">{u.status}</span>
                          <span className="text-cyan-700/50 ml-2">{new Date(u.at).toLocaleString()}</span>
                          <p className="text-cyan-300/80 mt-0.5">{u.message}</p>
                        </div>
                      ))}
                    </div>
                    {!readOnly && (
                      <div className="flex flex-wrap items-end gap-2">
                        <Field label="Status update">
                          <select className={inputCls} value={updStatus} onChange={(e) => setUpdStatus(e.target.value)}>
                            {['investigating', 'identified', 'monitoring', 'resolved'].map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </Field>
                        <input className={`${inputCls} flex-1 min-w-[12rem]`} value={updMsg} onChange={(e) => setUpdMsg(e.target.value)} placeholder="what changed…" />
                        <button
                          onClick={() => addUpdate(inc.id)}
                          disabled={!updMsg.trim()}
                          className="px-3 py-1.5 rounded-md text-xs bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-40"
                        >
                          Post Update
                        </button>
                      </div>
                    )}
                    {inc.postmortem ? (
                      <div className="bg-[#070b10] rounded-lg p-2.5 border border-purple-500/20">
                        <p className="text-[10px] uppercase tracking-wider text-purple-400 flex items-center gap-1">
                          <FileText className="w-3 h-3" /> Postmortem
                        </p>
                        <p className="text-xs text-cyan-200/90 mt-1">{inc.postmortem.summary}</p>
                        {inc.postmortem.rootCause && (
                          <p className="text-[11px] text-cyan-500/70 mt-1">Root cause: {inc.postmortem.rootCause}</p>
                        )}
                      </div>
                    ) : !readOnly ? (
                      <div className="space-y-1.5">
                        <p className="text-[10px] uppercase tracking-wider text-purple-400">Write Postmortem</p>
                        <textarea className={`${inputCls} w-full h-16 resize-none`} value={pmSummary} onChange={(e) => setPmSummary(e.target.value)} placeholder="summary of the incident…" />
                        <input className={`${inputCls} w-full`} value={pmCause} onChange={(e) => setPmCause(e.target.value)} placeholder="root cause (optional)" />
                        <button
                          onClick={() => savePm(inc.id)}
                          disabled={!pmSummary.trim()}
                          className="px-3 py-1.5 rounded-md text-xs bg-purple-500/15 text-purple-300 border border-purple-500/30 hover:bg-purple-500/25 disabled:opacity-40"
                        >
                          Save Postmortem
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── 5 — Cross-vital correlation ──────────────────────────────────────────────

function CorrelationSection({ orgId }: { orgId?: string | null }) {
  const [pairs, setPairs] = useState<CorrelationPair[]>([]);
  const [analyzed, setAnalyzed] = useState<number | null>(null);

  const analyze = useCallback(async () => {
    const r = await run<{ pairs: CorrelationPair[]; metricsAnalyzed: number }>('correlateVitals', { windowMinutes: 1440, ...(orgId ? { orgId } : {}) });
    setPairs(r?.pairs ?? []);
    setAnalyzed(r?.metricsAnalyzed ?? 0);
  }, [orgId]);

  const STRENGTH: Record<string, string> = {
    strong: 'text-cyan-300', moderate: 'text-cyan-500/80', weak: 'text-cyan-700/60',
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-cyan-500/70 flex items-center gap-2">
          <Network className="w-3.5 h-3.5" /> Cross-Vital Correlation
        </h4>
        <button
          onClick={analyze}
          className="text-xs px-2.5 py-1 rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25"
        >
          Analyze
        </button>
      </div>
      {analyzed == null ? (
        <p className="text-xs text-cyan-700/50 py-3">Run analyze to find vitals that move together.</p>
      ) : pairs.length === 0 ? (
        <p className="text-xs text-cyan-700/50 py-3">
          No correlations found across {analyzed} metric{analyzed !== 1 ? 's' : ''} — needs at least 3 overlapping points per pair.
        </p>
      ) : (
        <div className="space-y-1.5">
          {pairs.map((p) => (
            <div key={`${p.metricA}-${p.metricB}`} className="flex items-center gap-2 text-xs bg-[#0a0f18] rounded-lg border border-cyan-900/25 p-2.5">
              <span className="text-cyan-100 font-mono">{p.metricA}</span>
              <span className="text-cyan-700/50">{p.direction === 'positive' ? '↗' : '↘'}</span>
              <span className="text-cyan-100 font-mono">{p.metricB}</span>
              <span className={`ml-auto font-mono ${STRENGTH[p.strength]}`}>r = {p.coefficient}</span>
              <span className={`text-[10px] uppercase ${STRENGTH[p.strength]}`}>{p.strength}</span>
              <span className="text-[10px] text-cyan-700/50">{p.samples} pts</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── 3 — Saved dashboards ─────────────────────────────────────────────────────

/** One live tile in the dashboard grid — real resolved data, or an honest
 * "no data available" tile for a widget id that matches no real source.
 * Never renders a fabricated graph. */
function DashboardWidgetTile({ widget }: { widget: DashboardWidget }) {
  if (widget.error || !widget.data) {
    return (
      <div className="bg-[#0a0f18] rounded-lg border border-amber-900/30 p-3 min-h-[9rem] flex flex-col items-center justify-center text-center gap-1">
        <AlertTriangle className="w-4 h-4 text-amber-500/70" />
        <p className="text-xs text-cyan-100 font-medium truncate max-w-full">{widget.id}</p>
        <p className="text-[10px] text-amber-400/80">no data available for this panel</p>
      </div>
    );
  }

  if (widget.kind === 'vital') {
    const d = widget.data as DashboardWidgetVitalData;
    const chartData = d.points.map((p) => ({
      t: new Date(p.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      v: p.v,
    }));
    return (
      <div className="bg-[#0a0f18] rounded-lg border border-cyan-900/25 p-2.5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-cyan-100 font-medium truncate">{d.metric}</span>
          {d.stats && <span className="text-[11px] font-mono text-cyan-300">{d.stats.latest}</span>}
        </div>
        {d.points.length === 0 ? (
          <p className="text-[11px] text-cyan-700/50 py-6 text-center">no data yet</p>
        ) : (
          <ChartKit kind="area" data={chartData} xKey="t" series={[{ key: 'v', label: d.metric }]} height={140} showLegend={false} showGrid={false} />
        )}
      </div>
    );
  }

  if (widget.kind === 'alert-rule') {
    const d = widget.data as DashboardWidgetAlertData;
    const breaching = d.state === 'breaching';
    return (
      <div className={`rounded-lg border p-3 min-h-[9rem] flex flex-col gap-1.5 ${breaching ? 'border-red-500/30 bg-red-500/5' : 'border-cyan-900/25 bg-[#0a0f18]'}`}>
        <div className="flex items-center justify-between">
          <span className="text-xs text-cyan-100 font-medium truncate">{d.name}</span>
          <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${SEV_COLOR[d.severity] || SEV_COLOR.medium}`}>{d.severity}</span>
        </div>
        <p className="text-[11px] text-cyan-600/60">{d.metric} {d.comparator} {d.threshold}</p>
        <p className={`text-sm font-mono ${breaching ? 'text-red-300' : 'text-emerald-300'}`}>
          {d.lastValue == null ? 'no data yet' : d.lastValue}
        </p>
        <p className="text-[10px] text-cyan-700/50 mt-auto">
          {breaching ? (d.acknowledged ? 'breaching · acknowledged' : 'breaching · unacknowledged') : 'ok'} · fired {d.fireCount}×
        </p>
      </div>
    );
  }

  return null;
}

export function DashboardsSection({ orgId, readOnly }: { orgId?: string | null; readOnly?: boolean } = {}) {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [name, setName] = useState('');
  const [widgetText, setWidgetText] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [grid, setGrid] = useState<DashboardData | null>(null);
  const [gridLoading, setGridLoading] = useState(false);
  const scopeParams = orgId ? { orgId } : {};

  const load = useCallback(async () => {
    const r = await run<{ dashboards: Dashboard[] }>('listDashboards', scopeParams);
    setDashboards(r?.dashboards ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  const save = useCallback(async () => {
    if (!name.trim()) return;
    const widgets = widgetText
      .split(',')
      .map((w) => w.trim())
      .filter(Boolean)
      .map((w) => ({ type: 'panel', id: w }));
    const r = await run('saveDashboard', { name: name.trim(), widgets, ...scopeParams });
    if (r) { setName(''); setWidgetText(''); await load(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, widgetText, load, orgId]);

  const remove = useCallback(async (id: string) => {
    await run('deleteDashboard', { dashboardId: id, ...scopeParams });
    if (selectedId === id) { setSelectedId(null); setGrid(null); }
    await load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, selectedId, orgId]);

  const view = useCallback(async (id: string) => {
    if (selectedId === id) { setSelectedId(null); setGrid(null); return; }
    setSelectedId(id);
    setGridLoading(true);
    const r = await run<DashboardData>('dashboardData', { dashboardId: id, ...scopeParams });
    setGrid(r);
    setGridLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, orgId]);

  return (
    <section className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-cyan-500/70 flex items-center gap-2">
        <LayoutDashboard className="w-3.5 h-3.5" /> Saved Dashboards {orgId && <span className="text-cyan-700/50 normal-case font-normal">(team-shared)</span>}
      </h4>
      {!readOnly && (
        <div className="flex flex-wrap items-end gap-2 bg-[#0a0f18] rounded-lg border border-cyan-900/20 p-3">
          <Field label="Dashboard name"><input className={`${inputCls} w-44`} value={name} onChange={(e) => setName(e.target.value)} placeholder="SRE morning view" /></Field>
          <Field label="Panels (comma-separated)"><input className={`${inputCls} w-64`} value={widgetText} onChange={(e) => setWidgetText(e.target.value)} placeholder="vitals, alerts, incidents" /></Field>
          <button
            onClick={save}
            disabled={!name.trim()}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" /> Save Layout
          </button>
        </div>
      )}
      {dashboards.length === 0 ? (
        <p className="text-xs text-cyan-700/50 py-3">No saved dashboards yet — capture a layout above.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {dashboards.map((d) => (
            <div key={d.id} className={`bg-[#0a0f18] rounded-lg border p-2.5 cursor-pointer ${selectedId === d.id ? 'border-cyan-500/50' : 'border-cyan-900/25 hover:border-cyan-700/40'}`} onClick={() => view(d.id)}>
              <div className="flex items-center gap-2">
                <span className="text-sm text-cyan-50 font-medium flex-1 truncate">{d.name}</span>
                {!readOnly && (
                  <button
                    onClick={(e) => { e.stopPropagation(); remove(d.id); }}
                    className="text-cyan-700/60 hover:text-red-400"
                    aria-label="Delete dashboard"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <p className="text-[11px] text-cyan-600/60 mt-1">{d.widgets.length} panel{d.widgets.length !== 1 ? 's' : ''}</p>
            </div>
          ))}
        </div>
      )}

      {selectedId && (
        <div className="rounded-lg border border-cyan-900/25 bg-black/20 p-3 space-y-2">
          {gridLoading ? (
            <p className="text-xs text-cyan-700/50 py-3">Loading live grid…</p>
          ) : !grid ? (
            <p className="text-xs text-amber-400/80 py-3">Could not load this dashboard.</p>
          ) : grid.widgets.length === 0 ? (
            <p className="text-xs text-cyan-700/50 py-3">This layout has no panels yet.</p>
          ) : (
            <>
              <p className="text-[11px] text-cyan-600/60">
                {grid.name} · {grid.resolvedCount}/{grid.count} panel{grid.count !== 1 ? 's' : ''} resolved
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {grid.widgets.map((w, i) => <DashboardWidgetTile key={`${w.id}-${i}`} widget={w} />)}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ── 7 — Runbooks ─────────────────────────────────────────────────────────────

function RunbooksSection({ orgId, readOnly }: { orgId?: string | null; readOnly?: boolean }) {
  const [runbooks, setRunbooks] = useState<Runbook[]>([]);
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState('');
  const [stepsText, setStepsText] = useState('');
  const [lastRun, setLastRun] = useState<{ id: string; count: number } | null>(null);
  const scopeParams = orgId ? { orgId } : {};

  const load = useCallback(async () => {
    const r = await run<{ runbooks: Runbook[] }>('listRunbooks', scopeParams);
    setRunbooks(r?.runbooks ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  const save = useCallback(async () => {
    const steps = stepsText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => ({ label: l, action: 'noop' }));
    if (!name.trim() || steps.length === 0) return;
    const r = await run('saveRunbook', { name: name.trim(), trigger: trigger.trim(), steps, ...scopeParams });
    if (r) { setName(''); setTrigger(''); setStepsText(''); await load(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, trigger, stepsText, load, orgId]);

  const exec = useCallback(async (id: string) => {
    const r = await run<{ runbook: { runCount: number } }>('runRunbook', { runbookId: id, ...scopeParams });
    if (r) { setLastRun({ id, count: r.runbook.runCount }); await load(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, orgId]);

  const remove = useCallback(async (id: string) => {
    await run('deleteRunbook', { runbookId: id, ...scopeParams }); await load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, orgId]);

  return (
    <section className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-cyan-500/70 flex items-center gap-2">
        <GitBranch className="w-3.5 h-3.5" /> Remediation Runbooks {orgId && <span className="text-cyan-700/50 normal-case font-normal">(team-shared)</span>}
      </h4>
      {!readOnly && (
        <div className="space-y-2 bg-[#0a0f18] rounded-lg border border-cyan-900/20 p-3">
          <div className="flex flex-wrap gap-2">
            <Field label="Runbook name"><input className={`${inputCls} w-44`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Restart stuck worker" /></Field>
            <Field label="Trigger (optional)"><input className={`${inputCls} w-48`} value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder="queue depth > 1000" /></Field>
          </div>
          <Field label="Steps (one per line)">
            <textarea className={`${inputCls} w-full h-20 resize-none`} value={stepsText} onChange={(e) => setStepsText(e.target.value)} placeholder={'drain queue\nrestart worker\nverify health'} />
          </Field>
          <button
            onClick={save}
            disabled={!name.trim() || !stepsText.trim()}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" /> Save Runbook
          </button>
        </div>
      )}
      {runbooks.length === 0 ? (
        <p className="text-xs text-cyan-700/50 py-3">No runbooks yet — author one for one-click remediation.</p>
      ) : (
        <div className="space-y-1.5">
          {runbooks.map((rb) => (
            <div key={rb.id} className="bg-[#0a0f18] rounded-lg border border-cyan-900/25 p-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-sm text-cyan-50 font-medium">{rb.name}</span>
                {rb.trigger && <span className="text-[10px] text-cyan-600/60 font-mono">{rb.trigger}</span>}
                <span className="text-[10px] text-cyan-700/50 ml-auto">
                  {rb.steps.length} steps · run {rb.runCount}×
                </span>
                <button
                  onClick={() => exec(rb.id)}
                  disabled={readOnly}
                  className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-40"
                >
                  <Play className="w-3 h-3" /> Run
                </button>
                {!readOnly && (
                  <button
                    onClick={() => remove(rb.id)}
                    className="text-cyan-700/60 hover:text-red-400"
                    aria-label="Delete runbook"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <ol className="mt-1.5 ml-5 list-decimal text-[11px] text-cyan-400/70 space-y-0.5">
                {rb.steps.map((s, i) => <li key={i}>{s.label}</li>)}
              </ol>
              {lastRun?.id === rb.id && (
                <p className="text-[10px] text-emerald-400 mt-1">Executed — {lastRun.count} total runs.</p>
              )}
              {rb.executions.length > 0 && (
                <p className="text-[10px] text-cyan-700/50 mt-1">
                  Last run {rb.lastRunAt ? new Date(rb.lastRunAt).toLocaleString() : '—'}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── 8 — Situation Room: sitrep, incident correlation, escalation analysis ──
// These three macros (situationReport / incidentCorrelation / escalationEngine)
// take structured batch input (feeds / incidents / an incident+policy) rather
// than a single record, so — unlike the sections above — they're driven from
// a REAL snapshot of this operator's own alert rules + incident timeline
// (re-fetched fresh on each run), never user-typed or fabricated numbers.

const STATUS_TONE_SITREP: Record<string, string> = {
  RED: 'text-red-400 border-red-500/30 bg-red-500/5',
  AMBER: 'text-orange-400 border-orange-500/30 bg-orange-500/5',
  YELLOW: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/5',
  GREEN: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5',
};

function SituationRoomSection({ orgId }: { orgId?: string | null }) {
  const [incidents, setIncidents] = useState<Incident[]>([]);

  const [sitrep, setSitrep] = useState<SitrepResult | null>(null);
  const [sitrepLoading, setSitrepLoading] = useState(false);

  const [correlation, setCorrelation] = useState<IncidentCorrelationResult | null>(null);
  const [correlationLoading, setCorrelationLoading] = useState(false);

  const [selectedIncidentId, setSelectedIncidentId] = useState('');
  const [escalation, setEscalation] = useState<EscalationResult | null>(null);
  const [escalationLoading, setEscalationLoading] = useState(false);
  const scopeParams = orgId ? { orgId } : {};

  // Loads the operator's (or team's, when orgId is set) live incidents +
  // alert rules — the shared source material for all three analyses below.
  // Runs on mount so the incident picker (for escalation analysis) is
  // populated without an extra click.
  const loadSources = useCallback(async () => {
    const [incRes, ruleRes] = await Promise.all([
      run<{ incidents: Incident[] }>('listIncidents', scopeParams),
      run<{ rules: AlertRule[] }>('listAlertRules', scopeParams),
    ]);
    const liveIncidents = incRes?.incidents ?? [];
    setIncidents(liveIncidents);
    // Functional update so a refresh never clobbers an operator's manual pick
    // in the escalation dropdown below (this callback is memoized once, so a
    // closed-over `selectedIncidentId` would always read its mount-time value).
    if (liveIncidents.length > 0) {
      setSelectedIncidentId((prev) => (prev && liveIncidents.some((i) => i.id === prev)) ? prev : liveIncidents[0].id);
    }
    return { liveIncidents, liveRules: ruleRes?.rules ?? [] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);
  useEffect(() => { loadSources(); }, [loadSources]);

  const generateSitrep = useCallback(async () => {
    setSitrepLoading(true);
    const { liveIncidents, liveRules } = await loadSources();
    const feeds: Array<{ source: string; status: string; items: Array<{ id: string; severity: string; description: string; timestamp?: string; resolved: boolean }> }> = [];
    if (liveRules.length > 0) {
      feeds.push({
        source: 'alert-rules',
        status: liveRules.some((r) => r.state === 'breaching' && !r.acknowledged) ? 'degraded' : 'nominal',
        items: liveRules.map((r) => ({
          id: r.id, severity: r.severity, description: `${r.name} (${r.metric} ${r.comparator} ${r.threshold})`,
          timestamp: r.lastFiredAt || undefined, resolved: r.state !== 'breaching',
        })),
      });
    }
    if (liveIncidents.length > 0) {
      feeds.push({
        source: 'incidents',
        status: liveIncidents.some((i) => i.status !== 'resolved') ? 'degraded' : 'nominal',
        items: liveIncidents.map((i) => ({
          id: i.id, severity: i.severity, description: i.title,
          timestamp: i.openedAt, resolved: i.status === 'resolved',
        })),
      });
    }
    const r = await run<SitrepResult>('situationReport', { feeds });
    setSitrep(r);
    setSitrepLoading(false);
  }, [loadSources]);

  const correlateIncidentsNow = useCallback(async () => {
    setCorrelationLoading(true);
    const { liveIncidents } = await loadSources();
    const payload = liveIncidents.map((i) => ({
      id: i.id, source: 'incidents', timestamp: i.openedAt,
      attributes: { status: i.status, severity: i.severity },
      severity: i.severity, description: i.title,
    }));
    const r = await run<IncidentCorrelationResult>('incidentCorrelation', { incidents: payload });
    setCorrelation(r);
    setCorrelationLoading(false);
  }, [loadSources]);

  const analyzeEscalation = useCallback(async () => {
    if (!selectedIncidentId) return;
    setEscalationLoading(true);
    const incident = incidents.find((i) => i.id === selectedIncidentId);
    if (!incident) { setEscalationLoading(false); return; }
    const r = await run<EscalationResult>('escalationEngine', {
      incident: { id: incident.id, severity: incident.severity, createdAt: incident.openedAt, description: incident.title },
    });
    setEscalation(r);
    setEscalationLoading(false);
  }, [selectedIncidentId, incidents]);

  return (
    <section className="space-y-5">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-cyan-500/70 flex items-center gap-2">
        <Radar className="w-3.5 h-3.5" /> Situation Room
      </h4>

      {/* Situation report */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-cyan-600/60">Rolls alert rules + incidents into one cross-source sitrep.</p>
          <button
            onClick={generateSitrep}
            disabled={sitrepLoading}
            className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-50"
          >
            {sitrepLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Radar className="w-3 h-3" />} Generate Situation Report
          </button>
        </div>
        {sitrep?.message && <p className="text-xs text-cyan-700/50 py-1">{sitrep.message}</p>}
        {sitrep?.overallStatus && (
          <div className={`rounded-lg border p-3 space-y-2 ${STATUS_TONE_SITREP[sitrep.overallStatus]}`}>
            <div className="flex items-center gap-3">
              <span className="text-xl font-mono font-bold">{sitrep.overallStatus}</span>
              <span className="text-sm">readiness {sitrep.readinessScore} — {sitrep.readinessLabel}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {(sitrep.feeds ?? []).map((f) => (
                <span key={f.source} className="text-[10px] bg-[#0a0f18] border border-cyan-900/30 rounded-full px-2 py-0.5 text-cyan-300/80">
                  {f.source}: {f.health}/100 health · {f.unresolvedCount} open
                </span>
              ))}
            </div>
            {(sitrep.criticalItems?.items?.length ?? 0) > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-cyan-600/60">Critical items</p>
                {sitrep.criticalItems!.items.slice(0, 8).map((it, i) => (
                  <div key={it.id || i} className="text-[11px] bg-[#0a0f18] rounded p-1.5 border border-cyan-900/20 flex items-center gap-2">
                    <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${SEV_COLOR[it.severity || 'medium']}`}>{it.severity}</span>
                    <span className="text-cyan-100 truncate flex-1">{it.description}</span>
                    <span className="text-cyan-700/50">{it.source}</span>
                  </div>
                ))}
              </div>
            )}
            {sitrep.tempo && (
              <p className="text-[10px] text-cyan-600/60">tempo: {sitrep.tempo.itemsPerHour} items/hr over {sitrep.tempo.spanHours}h</p>
            )}
            {(sitrep.crossSourceIssues?.length ?? 0) > 0 && (
              <p className="text-[10px] text-amber-400">
                {sitrep.crossSourceIssues!.length} possible cross-source overlap{sitrep.crossSourceIssues!.length !== 1 ? 's' : ''} detected (similar descriptions across sources).
              </p>
            )}
          </div>
        )}
      </div>

      {/* Incident correlation */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-cyan-600/60">Correlates the incidents above by time, shared attributes, and description.</p>
          <button
            onClick={correlateIncidentsNow}
            disabled={correlationLoading}
            className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-50"
          >
            {correlationLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Share2 className="w-3 h-3" />} Correlate Incidents
          </button>
        </div>
        {correlation?.message && <p className="text-xs text-cyan-700/50 py-1">{correlation.message}</p>}
        {correlation && !correlation.message && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-cyan-600/60">
              {correlation.correlationsFound} correlation{correlation.correlationsFound !== 1 ? 's' : ''} across {correlation.totalIncidents} incidents ·{' '}
              {(correlation.clusters ?? []).length} cluster{(correlation.clusters ?? []).length !== 1 ? 's' : ''} · {correlation.uncorrelatedCount} standalone
            </p>
            {(correlation.correlations ?? []).slice(0, 6).map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-xs bg-[#0a0f18] rounded-lg border border-cyan-900/25 p-2">
                <span className="text-cyan-100 font-mono truncate max-w-[8rem]">{c.incidentA}</span>
                <span className="text-cyan-700/50">↔</span>
                <span className="text-cyan-100 font-mono truncate max-w-[8rem]">{c.incidentB}</span>
                <span className="ml-auto font-mono text-cyan-300">r={c.correlation}</span>
                {c.matchedAttributes.length > 0 && <span className="text-[10px] text-cyan-700/50">{c.matchedAttributes.join(', ')}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Escalation analysis */}
      <div className="space-y-2">
        <p className="text-[11px] text-cyan-600/60">Pick an open incident and compute its SLA / escalation path.</p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Incident">
            <select
              className={inputCls}
              value={selectedIncidentId}
              onChange={(e) => setSelectedIncidentId(e.target.value)}
              disabled={incidents.length === 0}
            >
              {incidents.length === 0 && <option value="">no incidents yet</option>}
              {incidents.map((i) => (
                <option key={i.id} value={i.id}>{i.title} ({i.severity}, {i.status})</option>
              ))}
            </select>
          </Field>
          <button
            onClick={analyzeEscalation}
            disabled={escalationLoading || !selectedIncidentId}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-40"
          >
            {escalationLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ArrowUpCircle className="w-3 h-3" />} Analyze Escalation
          </button>
        </div>
        {escalation && (
          <div className="rounded-lg border border-cyan-900/25 bg-[#0a0f18] p-3 space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-lg font-mono font-bold text-cyan-100">{escalation.urgencyScore}</span>
              <span className={`text-xs uppercase px-1.5 py-0.5 rounded border ${SEV_COLOR[escalation.severity] || SEV_COLOR.medium}`}>{escalation.urgencyLabel} urgency</span>
              <span className="text-[10px] text-cyan-600/60 ml-auto">
                SLA {escalation.sla.percentUsed}% used {escalation.sla.breached ? '(BREACHED)' : `(${escalation.sla.remainingMinutes}m left)`}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {escalation.escalation.path.map((lvl, i) => (
                <span
                  key={i}
                  className={`text-[10px] rounded-full px-2 py-0.5 border ${lvl.triggered ? 'border-red-500/40 text-red-300 bg-red-500/10' : 'border-cyan-900/30 text-cyan-600/60'}`}
                >
                  L{lvl.level}{lvl.label ? ` ${lvl.label}` : ''}{lvl.triggered ? ' ●' : ''}
                </span>
              ))}
            </div>
            {escalation.recommendedActions.length > 0 && (
              <ul className="text-[11px] text-cyan-300/80 list-disc ml-4 space-y-0.5">
                {escalation.recommendedActions.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Cockpit shell ────────────────────────────────────────────────────────────

export function OpsCockpit() {
  const [health, setHealth] = useState<HealthRollup | null>(null);
  // WAVE4: null = personal cockpit (byte-identical to the pre-team behavior);
  // a real orgId = every section below reads/writes the SAME org-shared
  // state instead, via the `orgId` param threaded through each macro call.
  const [orgId, setOrgId] = useState<string | null>(null);
  const [tier, setTier] = useState<CcTier | null>(null);

  const refreshHealth = useCallback(async () => {
    const r = await run<HealthRollup>('healthRollup', orgId ? { orgId } : {});
    setHealth(r);
  }, [orgId]);
  useEffect(() => { refreshHealth(); }, [refreshHealth]);

  // Re-resolve the caller's tier for the active team whenever the scope
  // changes, so write controls can be honestly disabled for an observer
  // instead of rendering a button that would always be refused server-side.
  useEffect(() => {
    let cancelled = false;
    if (!orgId) { setTier(null); return; }
    (async () => {
      const r = await runScoped<{ teams: TeamSummary[] }>('teamListMine');
      if (cancelled) return;
      const found = r.ok ? r.data.teams.find((t) => t.orgId === orgId) : null;
      setTier(found ? found.tier : null);
    })();
    return () => { cancelled = true; };
  }, [orgId]);

  const readOnly = !!orgId && tier === 'observer';

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Ops Cockpit</h3>
      <TeamPanel activeOrgId={orgId} onScopeChange={setOrgId} />
      <HealthBanner health={health} />
      <VitalsSection onChange={refreshHealth} orgId={orgId} readOnly={readOnly} />
      <AlertsSection onChange={refreshHealth} orgId={orgId} readOnly={readOnly} />
      <IncidentsSection onChange={refreshHealth} orgId={orgId} readOnly={readOnly} />
      <CorrelationSection orgId={orgId} />
      <DashboardsSection orgId={orgId} readOnly={readOnly} />
      <RunbooksSection orgId={orgId} readOnly={readOnly} />
      <SituationRoomSection orgId={orgId} />
    </div>
  );
}
