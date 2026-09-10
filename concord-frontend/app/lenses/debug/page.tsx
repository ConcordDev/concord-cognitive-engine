'use client';

/**
 * Debug — one Sentry/Datadog observability console.
 *
 * Single view union (status | issues | traces | metrics | releases | events |
 * logs | inspector | context | monitoring | compute | templates | cve | test).
 * Page is a thin shell; each view owns its hooks.
 */

import { useMemo, useState, type ComponentType } from 'react';
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
import { ds } from '@/lib/design-system';
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
  const [active, setActive] = useState<DebugView>('status');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
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

  return (
    <LensShell lensId="debug" asMain={false}>
      <FirstRunTour lensId="debug" />
      <DepthBadge lensId="debug" size="sm" className="ml-2" />
      <div data-lens-theme="debug" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <Bug className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Debug</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="debug" data={realtimeData || {}} compact />
              </div>
              <p className={ds.textMuted}>
                Sentry + Datadog — issues, traces, metrics, releases, diagnostics.
              </p>
            </div>
          </div>
        </header>

        <RealtimeDataPanel
          domain="debug"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={insights}
          compact
        />

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Debug views"
        >
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                  on
                    ? 'border-[var(--lens-accent)] text-white'
                    : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="w-4 h-4" />
                {v.label}
                <kbd className="hidden sm:inline-block text-[10px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5 font-mono">
                  {v.keys}
                </kbd>
              </button>
            );
          })}
        </nav>

        <main className="min-w-0 pt-4">
          <AnimatePresence mode="wait">
            <motion.div key={active} {...motionProps}>
              <Panel />
            </motion.div>
          </AnimatePresence>
        </main>

        <CrossLensRecentsPanel lensId="debug" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
