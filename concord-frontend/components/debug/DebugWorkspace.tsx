'use client';

import { useCallback, useMemo, useState, type ComponentType } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Activity,
  AlertCircle,
  BarChart3,
  Bug,
  Cpu,
  Eye,
  FileCode,
  Gauge,
  GitBranch,
  Loader2,
  Radio,
  RefreshCw,
  Search,
  ShieldAlert,
  Tag,
  Terminal,
  Play,
  Satellite,
} from 'lucide-react';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useLensStatePersistence } from '@/lib/lens-state-persistence';
import { useUIStore } from '@/store/ui';
import { cn } from '@/lib/utils';
import { StatusPanel } from './StatusPanel';
import { IssuesPanel } from './IssuesPanel';
import { TracesPanel } from './TracesPanel';
import { MetricsPanel } from './MetricsPanel';
import { ReleasesPanel } from './ReleasesPanel';
import { EventsPanel } from './EventsPanel';
import { LogsPanel } from './LogsPanel';
import { InspectorPanel } from './InspectorPanel';
import { ContextInspectorPanel } from './ContextInspectorPanel';
import { MonitoringPanel } from './MonitoringPanel';
import { ComputeDeskPanel } from './ComputeDeskPanel';
import { TemplatesPanel } from './TemplatesPanel';
import { CvePanel } from './CvePanel';
import { TestConsolePanel } from './TestConsolePanel';

type DebugTool =
  | 'overview'
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
  | 'test'
  | 'live';

type ToolGroup = 'Observe' | 'Investigate' | 'Operate';

const TOOLS: {
  id: DebugTool;
  label: string;
  description: string;
  group: ToolGroup;
  key: string;
  icon: typeof Bug;
}[] = [
  { id: 'overview', label: 'Overview', description: 'Runtime health and artifact analysis', group: 'Observe', key: '1', icon: Activity },
  { id: 'issues', label: 'Issues', description: 'Authored exception registry', group: 'Observe', key: '2', icon: AlertCircle },
  { id: 'traces', label: 'Traces', description: 'Measured request waterfalls', group: 'Observe', key: '3', icon: GitBranch },
  { id: 'metrics', label: 'Metrics', description: 'Runtime samples and alert rules', group: 'Observe', key: '4', icon: BarChart3 },
  { id: 'releases', label: 'Releases', description: 'Deploy and linked-issue tracking', group: 'Observe', key: '5', icon: Tag },
  { id: 'events', label: 'Events', description: 'Recent platform events', group: 'Investigate', key: '6', icon: Radio },
  { id: 'logs', label: 'Logs', description: 'Filtered event log', group: 'Investigate', key: '7', icon: Terminal },
  { id: 'inspector', label: 'Inspector', description: 'Inspect a known object ID', group: 'Investigate', key: '8', icon: Search },
  { id: 'context', label: 'Context', description: 'Working set and pinned DTUs', group: 'Investigate', key: '9', icon: Eye },
  { id: 'monitoring', label: 'Inference', description: 'Transcripts, SLOs, provenance', group: 'Investigate', key: '0', icon: Gauge },
  { id: 'cve', label: 'CVE feed', description: 'Live NVD vulnerability data', group: 'Investigate', key: 'v', icon: ShieldAlert },
  { id: 'compute', label: 'Compute', description: 'Compute diagnostics', group: 'Operate', key: 'c', icon: Cpu },
  { id: 'templates', label: 'Templates', description: 'Lens template generator', group: 'Operate', key: 't', icon: FileCode },
  { id: 'test', label: 'Diagnostics', description: 'Named privileged diagnostics', group: 'Operate', key: 'd', icon: Play },
  { id: 'live', label: 'Live feed', description: 'Debug-domain platform events', group: 'Operate', key: 'l', icon: Satellite },
];

const TOOL_IDS = new Set(TOOLS.map((tool) => tool.id));
const GROUPS: ToolGroup[] = ['Observe', 'Investigate', 'Operate'];

const PANELS: Partial<Record<DebugTool, ComponentType>> = {
  overview: StatusPanel,
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

function isDebugTool(value: unknown): value is DebugTool {
  return typeof value === 'string' && TOOL_IDS.has(value as DebugTool);
}

export function DebugWorkspace({ who }: { who: string }) {
  useLensIdentity('debug');
  const { restore, persist } = useLensStatePersistence('debug');
  const [initialState] = useState(() => restore());
  const [tool, setTool] = useState<DebugTool>(() => isDebugTool(initialState?.tool) ? initialState.tool : 'overview');
  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const { latestData, isLive, lastUpdated, insights } = useRealtimeLens('debug');

  const selectTool = useCallback((next: DebugTool) => {
    setTool(next);
    persist({ tool: next });
  }, [persist]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await queryClient.refetchQueries({ type: 'active' });
      useUIStore.getState().addToast({ type: 'success', message: 'Diagnostics refreshed.' });
    } catch (error) {
      useUIStore.getState().addToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Refresh failed.',
      });
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  useLensCommand(
    [
      ...TOOLS.map((item) => ({
        id: `debug-${item.id}`,
        keys: item.key,
        description: `Open Debug ${item.label}`,
        category: 'navigation' as const,
        action: () => selectTool(item.id),
      })),
      {
        id: 'debug-refresh',
        keys: 'shift+r',
        description: 'Refresh active diagnostics',
        category: 'actions' as const,
        action: () => void refresh(),
      },
    ],
    { lensId: 'debug' },
  );

  const active = TOOLS.find((item) => item.id === tool) ?? TOOLS[0];
  const Panel = PANELS[tool];
  const transition = useMemo(
    () => reduceMotion
      ? { initial: false as const, animate: { opacity: 1 }, transition: { duration: 0 } }
      : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.16 } },
    [reduceMotion],
  );

  return (
    <div data-lens-theme="debug" className="min-h-full bg-[#080a0c] px-4 pb-24 pt-5 sm:px-7">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <p className="text-sm text-zinc-600">Debug</p>
          <h1 className="font-vault mt-1 text-4xl leading-tight text-zinc-100 sm:text-5xl">
            Observe the system{who ? `, ${who}` : ''}
          </h1>
          <p className="mt-2 text-sm text-zinc-500">{active.description}</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-300 hover:bg-white/[0.08] disabled:opacity-60"
        >
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
          <kbd aria-hidden="true" className="font-mono text-[10px] text-white/30">⇧R</kbd>
        </button>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <nav aria-label="Debug tools" className="flex gap-2 overflow-x-auto border-b border-white/10 pb-3 lg:block lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4">
          {GROUPS.map((group) => (
            <div key={group} className="flex shrink-0 gap-1 lg:mb-5 lg:block">
              <p className="hidden px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-700 lg:block">{group}</p>
              {TOOLS.filter((item) => item.group === group).map((item) => {
                const Icon = item.icon;
                const selected = item.id === tool;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectTool(item.id)}
                    aria-current={selected ? 'page' : undefined}
                    title={item.description}
                    className={cn(
                      'flex w-full shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                      selected ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                    <kbd aria-hidden="true" className="ml-auto hidden font-mono text-[10px] text-white/25 lg:inline">{item.key}</kbd>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <motion.main key={tool} {...transition} className="min-w-0">
          {tool === 'live' ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-zinc-200">Debug-domain event feed</p>
                  <p className="text-xs text-zinc-500">Platform events only; this is not an external APM collector.</p>
                </div>
                <div className="flex items-center gap-2">
                  <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                  <DTUExportButton domain="debug" data={latestData || {}} compact />
                </div>
              </div>
              <RealtimeDataPanel domain="debug" data={latestData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
            </div>
          ) : Panel ? <Panel /> : null}
        </motion.main>
      </div>
    </div>
  );
}
