'use client';

/**
 * Debug — one Sentry/Datadog observability console.
 *
 * Single view union (status | issues | traces | metrics | releases | events |
 * logs | inspector | context | monitoring | compute | templates | cve | test).
 * Page is a thin shell; each view owns its hooks.
 */

import { useCallback, useMemo, useState, type ComponentType } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Bug,
  Activity,
  AlertCircle,
  GitBranch,
  BarChart3,
  Tag,
  Radio,
  Terminal,
  Search,
  Eye,
  Gauge,
  Cpu,
  FileCode,
  ShieldAlert,
  Play,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { useAuth } from '@/hooks/useAuth';
import { useUIStore } from '@/store/ui';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';

import { StatusPanel } from '@/components/debug/StatusPanel';
import { IssuesPanel } from '@/components/debug/IssuesPanel';
import { TracesPanel } from '@/components/debug/TracesPanel';
import { MetricsPanel } from '@/components/debug/MetricsPanel';
import { ReleasesPanel } from '@/components/debug/ReleasesPanel';
import { EventsPanel } from '@/components/debug/EventsPanel';
import { LogsPanel } from '@/components/debug/LogsPanel';
import { InspectorPanel } from '@/components/debug/InspectorPanel';
import { ContextInspectorPanel } from '@/components/debug/ContextInspectorPanel';
import { MonitoringPanel } from '@/components/debug/MonitoringPanel';
import { ComputeDeskPanel } from '@/components/debug/ComputeDeskPanel';
import { TemplatesPanel } from '@/components/debug/TemplatesPanel';
import { CvePanel } from '@/components/debug/CvePanel';
import { TestConsolePanel } from '@/components/debug/TestConsolePanel';

type DebugView =
  | 'status'
  | 'issues'
  | 'traces'
  | 'metrics'
  | 'releases'
  | 'events'
  | 'logs'
  | 'inspector'
  | 'context'
  | 'monitoring'
  | 'compute'
  | 'templates'
  | 'cve'
  | 'test';

const VIEWS: {
  id: DebugView;
  label: string;
  keys: string;
  hint: string;
  icon: typeof Bug;
}[] = [
  { id: 'status', label: 'Status', keys: 's', hint: 'Health · AI analysis · jobs', icon: Activity },
  { id: 'issues', label: 'Issues', keys: 'g', hint: 'Sentry-style inbox', icon: AlertCircle },
  { id: 'traces', label: 'Traces', keys: 'r', hint: 'Distributed traces', icon: GitBranch },
  { id: 'metrics', label: 'Metrics', keys: 'a', hint: 'Series · alerts', icon: BarChart3 },
  { id: 'releases', label: 'Releases', keys: 'd', hint: 'Release tracker', icon: Tag },
  { id: 'events', label: 'Events', keys: 'e', hint: 'Recent system events', icon: Radio },
  { id: 'logs', label: 'Logs', keys: 'l', hint: 'Filtered event log', icon: Terminal },
  { id: 'inspector', label: 'Inspector', keys: 'i', hint: 'DTU / artifact inspect', icon: Search },
  { id: 'context', label: 'Context', keys: 'c', hint: 'Working set · pinned DTUs', icon: Eye },
  { id: 'monitoring', label: 'Monitoring', keys: 'm', hint: 'SLO · provenance · transcripts', icon: Gauge },
  { id: 'compute', label: 'Compute', keys: 'o', hint: 'Compute panel', icon: Cpu },
  { id: 'templates', label: 'Templates', keys: 't', hint: 'Lens template generator', icon: FileCode },
  { id: 'cve', label: 'CVE', keys: 'v', hint: 'NVD CVE feed', icon: ShieldAlert },
  { id: 'test', label: 'Test', keys: '0', hint: 'Admin test console', icon: Play },
];

const PANELS: Record<DebugView, ComponentType> = {
  status: StatusPanel,
  issues: IssuesPanel,
  traces: TracesPanel,
  metrics: MetricsPanel,
  releases: ReleasesPanel,
  events: EventsPanel,
  logs: LogsPanel,
  inspector: InspectorPanel,
  context: ContextInspectorPanel,
  monitoring: MonitoringPanel,
  compute: ComputeDeskPanel,
  templates: TemplatesPanel,
  cve: CvePanel,
  test: TestConsolePanel,
};

export default function DebugLensPage() {
  useLensNav('debug');
  useLensIdentity('debug');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('debug');
  const reduceMotion = useReducedMotion();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<DebugView>('status');
  const [refreshing, setRefreshing] = useState(false);

  const refreshDiagnostics = useCallback(async () => {
    setRefreshing(true);
    try {
      await queryClient.refetchQueries({ type: 'active' });
      useUIStore.getState().addToast({ type: 'success', message: 'Diagnostics refreshed.' });
    } catch (e) {
      useUIStore.getState().addToast({ type: 'error', message: (e as Error).message || 'Refresh failed.' });
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      { id: 'debug-refresh', keys: 'shift+r', description: 'Refresh diagnostics', category: 'actions' as const, action: () => void refreshDiagnostics() },
    ],
    { lensId: 'debug' },
  );

  const Panel = PANELS[active];
  const motionProps = useMemo(
    () =>
      reduceMotion
        ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
        : {
            initial: { opacity: 0, y: 8 },
            animate: { opacity: 1, y: 0 },
            exit: { opacity: 0, y: -6 },
            transition: { duration: 0.16 },
          },
    [reduceMotion],
  );

  const current = VIEWS.find((v) => v.id === active)!;

  return (
    <LensShell lensId="debug" asMain={false}>
      <FirstRunTour lensId="debug" />
      <DepthBadge lensId="debug" size="sm" className="ml-2" />
      <div data-lens-theme="debug" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Debug</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {active === 'status' ? `What is happening${who ? `, ${who}` : ''}` : current.hint}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="debug" data={realtimeData || {}} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full flex-wrap items-center gap-1 rounded-3xl border border-white/10 bg-white/[0.03] p-1" aria-label="Debug views">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                aria-current={on ? 'page' : undefined}
                title={`${v.hint} (${v.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{v.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <RealtimeDataPanel
          domain="debug"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={insights}
          compact
        />

        <main className="min-w-0 pt-4">
          <AnimatePresence mode="wait">
            <motion.div key={active} {...motionProps}>
              <Panel />
            </motion.div>
          </AnimatePresence>
        </main>

        <CrossLensRecentsPanel lensId="debug" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={() => void refreshDiagnostics()}
          disabled={refreshing}
          title="Refresh diagnostics (Shift R)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {refreshing ? 'Refreshing…' : 'Refresh diagnostics'}
        </button>
      </div>
    </LensShell>
  );
}
