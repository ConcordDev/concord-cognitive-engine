'use client';

/**
 * /lenses/psyops — anomaly-detection / threat-monitoring console.
 *
 * Two layers, both real:
 *  • The legacy NPC skill-divergence reflex (server.js psyops.* macros) —
 *    a genuine statistical scan over NPC skill_revisions.
 *  • The full operator console (server/domains/psyops.js) — multi-signal
 *    scanning, alert triage, evidence drill-down, configurable rules,
 *    incident correlation, audited quarantine, critical-alert paging.
 * Every value rendered comes from a real macro or a real computation.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useCallback, useEffect, useState } from 'react';
import { Activity, Radar, Siren, SlidersHorizontal, GitMerge, BookOpen } from 'lucide-react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { lensRun, isForbidden } from '@/lib/api/client';
import { LensShell } from '@/components/lens/LensShell';
import { AdminRequiredState } from '@/components/common/EmptyState';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { PsyopsReference } from '@/components/psyops/PsyopsReference';
import { DetectionRules } from '@/components/psyops/DetectionRules';
import { SignalScanner } from '@/components/psyops/SignalScanner';
import { AlertBoard } from '@/components/psyops/AlertBoard';
import { IncidentPanel } from '@/components/psyops/IncidentPanel';
import { NotificationBell } from '@/components/psyops/NotificationBell';
import { QuarantineLog } from '@/components/psyops/QuarantineLog';
import type {
  PsyopsRule, PsyopsAlert, AlertCounts, PsyopsIncident,
  PsyopsNotification, QuarantineLogEntry,
} from '@/components/psyops/types';

interface SkillAlert {
  id: number;
  npc_id: string;
  suspect_mentor_id: string | null;
  revision_count_window: number;
  cohort_baseline: number;
  sigma_above: number;
  detected_at: number;
  quarantined: number;
}

// Legacy skill-divergence macros live in server.js, not the domain module —
// they predate lensRun unwrapping, so call /api/lens/run directly.
async function skillMacro(name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain: 'psyops', name, input }),
  }).catch(() => null);
  if (!r) return null;
  const j = await r.json().catch(() => null);
  // server.js psyops.* return their payload directly under `result`.
  return j?.result ?? j;
}

type Tab = 'console' | 'incidents' | 'rules' | 'skill' | 'reference';

const TABS: { id: Tab; label: string; title: string; hint: string; icon: typeof Siren }[] = [
  { id: 'console', label: 'Console', title: 'What is moving out of pattern', hint: 'Signal scanner, alert triage and quarantine log', icon: Siren },
  { id: 'incidents', label: 'Incidents', title: 'How the alerts connect', hint: 'Correlate selected alerts into incidents', icon: GitMerge },
  { id: 'rules', label: 'Rules', title: 'What counts as an anomaly', hint: 'Configurable detection rules', icon: SlidersHorizontal },
  { id: 'skill', label: 'Skill divergence', title: 'Who is learning wrong', hint: 'NPC skill-divergence reflex scan', icon: Activity },
  { id: 'reference', label: 'Reference', title: 'How detection works', hint: 'Signals, thresholds and methodology', icon: BookOpen },
];

export default function PsyopsPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  useLensCommand([
    ...TABS.map((t, i) => ({ id: `psyops-tab-${t.id}`, keys: String(i + 1), description: `${t.label} — ${t.hint}`, category: 'navigation' as const, action: () => setTab(t.id) })),
    { id: 'psyops-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'psyops' });

  const [tab, setTab] = useState<Tab>('console');
  const [forbidden, setForbidden] = useState(false);

  // Console state (server/domains/psyops.js).
  const [rules, setRules] = useState<PsyopsRule[]>([]);
  const [alerts, setAlerts] = useState<PsyopsAlert[]>([]);
  const [counts, setCounts] = useState<AlertCounts | null>(null);
  const [incidents, setIncidents] = useState<PsyopsIncident[]>([]);
  const [notifications, setNotifications] = useState<PsyopsNotification[]>([]);
  const [unacked, setUnacked] = useState(0);
  const [qlog, setQlog] = useState<QuarantineLogEntry[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Legacy skill-divergence state (server.js).
  const [skillAlerts, setSkillAlerts] = useState<SkillAlert[]>([]);
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const refreshConsole = useCallback(async () => {
    const [ru, al, inc, nt, ql] = await Promise.all([
      lensRun<{ rules: PsyopsRule[] }>('psyops', 'rules_list', {}),
      lensRun<{ alerts: PsyopsAlert[]; counts: AlertCounts }>('psyops', 'alerts_list', { limit: 200 }),
      lensRun<{ incidents: PsyopsIncident[] }>('psyops', 'incident_list', {}),
      lensRun<{ notifications: PsyopsNotification[]; unacknowledged: number }>('psyops', 'notifications_list', {}),
      lensRun<{ log: QuarantineLogEntry[] }>('psyops', 'quarantine_log', {}),
    ]);
    if ([ru, al, inc, nt, ql].some(r => isForbidden(r.data))) { setForbidden(true); return; }
    if (ru.data?.ok && ru.data.result) setRules(ru.data.result.rules);
    if (al.data?.ok && al.data.result) {
      setAlerts(al.data.result.alerts);
      setCounts(al.data.result.counts);
    }
    if (inc.data?.ok && inc.data.result) setIncidents(inc.data.result.incidents);
    if (nt.data?.ok && nt.data.result) {
      setNotifications(nt.data.result.notifications);
      setUnacked(nt.data.result.unacknowledged);
    }
    if (ql.data?.ok && ql.data.result) setQlog(ql.data.result.log);
  }, []);

  const refreshSkill = useCallback(async () => {
    const r = await skillMacro('list_alerts', { includeQuarantined: true });
    if (r?.ok) setSkillAlerts(r.alerts || []);
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => { void refreshConsole(); void refreshSkill(); });
  }, [refreshConsole, refreshSkill]);

  const scanSkill = async () => {
    setScanning(true);
    const r = await skillMacro('scan_skill_divergence', { sigmaThreshold: 2.5 });
    if (r?.ok) {
      setStatus(`Scanned ${r.scanned} NPCs · ${r.alerts?.length || 0} new alerts (mean ${r.mean?.toFixed?.(1) ?? '—'}, σ ${r.stddev?.toFixed?.(2) ?? '—'})`);
      await refreshSkill();
    } else {
      setStatus(`Failed: ${r?.error || r?.reason || 'unknown'}`);
    }
    setScanning(false);
    window.setTimeout(() => setStatus(null), 6000);
  };

  const quarantineSkill = async (id: number) => {
    const r = await skillMacro('quarantine', { alertId: id });
    if (r?.ok) await refreshSkill();
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  if (forbidden) return (
    <LensShell lensId="psyops">
      <AdminRequiredState roles={['admin', 'operator']} />
    </LensShell>
  );

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <LensShell lensId="psyops" asMain={false}>
      <FirstRunTour lensId="psyops" />
      <DepthBadge lensId="psyops" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="psyops"
        crumb="Psyops Watch"
        title={`${current.title}${tab === 'console' && who ? `, ${who}` : ''}`}
        subtitle="Behavioral threat-detection console: statistical anomaly scanning across skill, economy, content and network signals, with triage, incident correlation and audited quarantine."
        actions={(
          <NotificationBell
            notifications={notifications}
            unacknowledged={unacked}
            onChange={refreshConsole}
          />
        )}
        tabs={TABS.map((t, i) => ({ id: t.id, label: t.id === 'incidents' && incidents.length ? `Incidents (${incidents.length})` : t.label, icon: t.icon, keys: String(i + 1), hint: t.hint }))}
        activeTab={tab}
        onTab={(id) => setTab(id as Tab)}
        tabsLabel="Psyops views"
        cta={{ label: scanning ? 'Scanning…' : 'Scan NPC skills', icon: Radar, onClick: () => { setTab('skill'); void scanSkill(); }, disabled: scanning, title: 'Run the skill-divergence scan now' }}
      >
          {tab === 'console' && (
            <div className="space-y-6">
              <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
                <SignalScanner onScanned={refreshConsole} />
              </section>
              <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
                <AlertBoard
                  alerts={alerts}
                  counts={counts}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                  onChange={refreshConsole}
                />
              </section>
              <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
                <QuarantineLog log={qlog} />
              </section>
            </div>
          )}

          {tab === 'incidents' && (
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <IncidentPanel
                incidents={incidents}
                selectedIds={selectedIds}
                onChange={refreshConsole}
                onClearSelection={() => setSelectedIds([])}
              />
              {selectedIds.length === 0 && (
                <p className="mt-3 text-[11px] text-zinc-400">
                  Tip: select alerts on the Console tab&apos;s alert board, then return here to
                  correlate them into an incident.
                </p>
              )}
            </section>
          )}

          {tab === 'rules' && (
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <DetectionRules rules={rules} onChange={refreshConsole} />
            </section>
          )}

          {tab === 'skill' && (
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                    <Activity className="h-4 w-4 text-rose-400" /> NPC skill-divergence reflex
                  </h2>
                  <p className="mt-1 text-[11px] text-zinc-400">
                    Flags NPCs whose <code>skill_revisions</code> diverge &gt;2.5σ from the
                    cohort baseline — a signal of adversarial demonstrations.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={scanSkill}
                  disabled={scanning}
                  className="rounded bg-rose-700 px-3 py-2 text-xs font-medium text-white hover:bg-rose-600 disabled:opacity-50"
                >
                  {scanning ? 'Scanning…' : 'Run scan'}
                </button>
              </div>
              {status && (
                <div className="mb-3 rounded-lg border border-rose-700/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
                  {status}
                </div>
              )}
              {skillAlerts.length === 0 ? (
                <p className="rounded-lg border border-zinc-800 py-6 text-center text-xs italic text-zinc-400">
                  No skill-divergence alerts. Run a scan above.
                </p>
              ) : (
                <ul className="space-y-2">
                  {skillAlerts.map((a) => (
                    <li
                      key={a.id}
                      className={`rounded-lg border p-3 ${a.quarantined ? 'border-zinc-700/50 bg-zinc-900/40 opacity-60' : 'border-rose-700/40 bg-rose-950/30'}`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-bold text-zinc-100">{a.npc_id}</p>
                          <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
                            {a.revision_count_window} revs · {a.sigma_above.toFixed(2)}σ above {a.cohort_baseline.toFixed(1)} baseline
                            {a.suspect_mentor_id ? ` · mentor ${a.suspect_mentor_id.slice(0, 8)}` : ''}
                          </p>
                          <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
                            {new Date(a.detected_at * 1000).toLocaleString()}
                          </p>
                        </div>
                        {a.quarantined ? (
                          <span className="text-[10px] uppercase text-zinc-400">quarantined</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => quarantineSkill(a.id)}
                            className="rounded bg-zinc-700 px-3 py-1 text-[11px] text-white hover:bg-zinc-600"
                          >
                            Quarantine
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {tab === 'reference' && (
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <PsyopsReference />
            </section>
          )}
      </NorthStarFrame>
    </LensShell>
  );
}
