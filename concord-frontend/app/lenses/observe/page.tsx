'use client';

/**
 * /lenses/observe — Observer mode: compose empirical reports.
 *
 * Phase 9.2 #10. Wraps observer.compose_report. Generates a citable
 * kind='empirical_report' DTU from the world's ripple state in the
 * last hour. Currency: CC (royalty cascade flows from citers to
 * the observer).
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { Activity, Eye, FileText, GitBranch, Wrench } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { useLensNav } from '@/hooks/useLensNav';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ObservabilityRepos } from '@/components/observe/ObservabilityRepos';
import { ObserveActionPanel } from '@/components/observe/ObserveActionPanel';
import { ObservePlatform } from '@/components/observe/ObservePlatform';
import { PipingProvider } from '@/components/panel-polish';

interface Report {
  ok: boolean;
  dtuId?: string;
  ripple?: unknown;
  error?: string;
  reason?: string;
}

async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  }).catch(() => null);
  const j = r ? await r.json().catch(() => null) : null;
  // POST /api/lens/run always answers { ok: true, result: PAYLOAD } where
  // `ok` is just the transport flag — PAYLOAD (the macro's own { ok, ... })
  // carries the real success/failure + fields. Unwrap it here so `report.ok`
  // / `report.dtuId` / `report.ripple` read the macro's own verdict, not the
  // always-true transport flag.
  return j ? (j.result ?? j) : null;
}

type ObserveView = 'compose' | 'platform' | 'ops' | 'tooling';

const VIEWS: { id: ObserveView; label: string; keys: string; hint: string; title: string; icon: typeof Eye }[] = [
  { id: 'compose', label: 'Compose', keys: '1', title: 'Watch, do not intervene', hint: 'Compose a citable empirical report from a world', icon: FileText },
  { id: 'platform', label: 'Telemetry', keys: '2', title: 'What the system is doing', hint: 'Live metrics, logs, traces, monitors and on-call', icon: Activity },
  { id: 'ops', label: 'Ops actions', keys: '3', title: 'Run an ops action', hint: 'Service log, alerts, SLO and incident actions', icon: Wrench },
  { id: 'tooling', label: 'Tooling', keys: '4', title: 'Observability tooling', hint: 'Open-source observability repos on GitHub', icon: GitBranch },
];

export default function ObservePage() {
  useLensNav('observe');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('observe');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<ObserveView>('compose');
  const [worldId, setWorldId] = useState('concordia-hub');
  const [focus, setFocus] = useState('');
  const [composing, setComposing] = useState(false);
  const [report, setReport] = useState<Report | null>(null);

  useLensCommand(
    VIEWS.map((v) => ({
      id: `observe-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setView(v.id),
    })),
    { lensId: 'observe' },
  );

  const compose = async () => {
    setComposing(true);
    const r = await macro('observer', 'compose_report', { worldId, focus: focus || null });
    setReport(r);
    setComposing(false);
  };

  const current = VIEWS.find((v) => v.id === view)!;

  return (
    <LensShell lensId="observe" asMain={false}>
      <FirstRunTour lensId="observe" />
      <DepthBadge lensId="observe" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="observe"
        crumb="Observer"
        title={`${current.title}${view === 'compose' && who ? `, ${who}` : ''}`}
        subtitle="Every composition becomes a citable empirical-report DTU. Royalties flow to you when others cite it."
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="observe" data={{}} compact />
          </>
        }
        tabs={VIEWS}
        activeTab={view}
        onTab={(id) => setView(id as ObserveView)}
        tabsLabel="Observer views"
        cta={{ label: 'Observe a world', icon: Eye, onClick: () => setView('compose'), title: 'Open the observer composer (1)' }}
      >
        {view === 'compose' && (
          <div className="max-w-3xl">
            <section className="mb-4 space-y-3 rounded-2xl border border-white/10 bg-[#111] p-5">
              <p className="text-sm text-zinc-400">
                Don&apos;t intervene, report. Reads the world&apos;s ripple state from the last hour and writes it as a{' '}
                <code className="text-cyan-300">kind=&apos;empirical_report&apos;</code> DTU. <strong>Currency: CC.</strong>
              </p>
              <input
                type="text" placeholder="World id"
                value={worldId} onChange={(e) => setWorldId(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              />
              <input
                type="text" placeholder="Focus (optional, e.g. 'faction Concord stance')"
                value={focus} onChange={(e) => setFocus(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              />
              <button
                type="button" onClick={compose} disabled={composing || !worldId}
                className="w-full rounded-xl bg-cyan-700 py-2 text-sm text-white hover:bg-cyan-600 disabled:opacity-50"
              >
                {composing ? 'Composing report…' : 'Compose Report'}
              </button>
            </section>

            {report && (
              <div className={`rounded-2xl border p-4 text-sm ${report.ok ? 'border-emerald-700/40 bg-emerald-950/30 text-emerald-100' : 'border-rose-700/40 bg-rose-950/30 text-rose-100'}`}>
                {report.ok ? (
                  <>
                    <p className="font-bold">✓ Report composed.</p>
                    <p className="mt-1 break-all font-mono text-xs">DTU id: {report.dtuId}</p>
                    {report.ripple ? (
                      <pre className="mt-2 overflow-x-auto rounded border border-zinc-800 bg-zinc-950 p-2 text-[10px]">
                        {JSON.stringify(report.ripple, null, 2).slice(0, 800)}…
                      </pre>
                    ) : null}
                  </>
                ) : (
                  <p>Failed: {report.error || report.reason || 'unknown'}</p>
                )}
              </div>
            )}
          </div>
        )}

        {view === 'platform' && <ObservePlatform />}

        {view === 'ops' && (
          <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <PipingProvider>
              <ObserveActionPanel />
            </PipingProvider>
          </section>
        )}

        {view === 'tooling' && (
          <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <ObservabilityRepos />
          </section>
        )}

        <RealtimeDataPanel domain="observe" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      </NorthStarFrame>
    </LensShell>
  );
}
