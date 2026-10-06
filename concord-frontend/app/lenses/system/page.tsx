'use client';

/**
 * System — one Grafana/Datadog observability + cartograph desk.
 *
 * Single `active` union drives the tab bar. SystemHealth accordion is
 * folded into the union as `health`. Each view is a panel.
 */

import { useMemo, useState } from 'react';
import {
  Activity, LineChart, Bell, ScrollText, Heart, Gauge, LayoutDashboard,
  TrendingUp, AlertTriangle, Map as MapIcon, GitBranch, BarChart3, Puzzle,
  Layers, Shield, Play, Pause, RefreshCw, type LucideIcon,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { useLiveStatus } from '@/components/system/useLiveStatus';
import { useSystemCartograph } from '@/components/system/cartographShared';
import {
  OverviewPanel,
  HeartbeatsInventoryPanel,
  GapsPanel,
  CoveragePanel,
  DriftPanelView,
} from '@/components/system/CartographPanels';
import {
  MetricsTabPanel,
  AlertsTabPanel,
  LogsTabPanel,
  HbHealthTabPanel,
  TracesTabPanel,
  DashboardTabPanel,
  TrendTabPanel,
  HealthTabPanel,
  SubstrateTabPanel,
  AnalyticsTabPanel,
  PluginsTabPanel,
} from '@/components/system/ObservabilityTabPanels';

type SysView =
  | 'overview' | 'metrics' | 'alerts' | 'logs' | 'hbhealth' | 'traces' | 'dashboard'
  | 'trend' | 'heartbeats' | 'gaps' | 'coverage' | 'drift' | 'analytics' | 'plugins'
  | 'substrate' | 'health';

export default function SystemLensPage() {
  useLensNav('system');
  useLensIdentity('system');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<SysView>('overview');
  const { live, setLive, status: liveStatus } = useLiveStatus();
  const { heartbeats, coveragePct, data, handleRefresh, isFetching } = useSystemCartograph();

  useLensCommand(
    [
      { id: 'tab-overview', keys: 'o', description: 'Overview', category: 'navigation', action: () => setActive('overview') },
      { id: 'tab-metrics', keys: 'm', description: 'Metrics', category: 'navigation', action: () => setActive('metrics') },
      { id: 'tab-alerts', keys: 'l', description: 'Alerts', category: 'navigation', action: () => setActive('alerts') },
      { id: 'tab-logs', keys: 'v', description: 'Logs', category: 'navigation', action: () => setActive('logs') },
      { id: 'tab-hbhealth', keys: 'h', description: 'Heartbeat health', category: 'navigation', action: () => setActive('hbhealth') },
      { id: 'tab-traces', keys: 't', description: 'Traces', category: 'navigation', action: () => setActive('traces') },
      { id: 'tab-dashboard', keys: 'k', description: 'Dashboard', category: 'navigation', action: () => setActive('dashboard') },
      { id: 'tab-trend', keys: 'r', description: 'Trend', category: 'navigation', action: () => setActive('trend') },
      { id: 'tab-gaps', keys: 'g', description: 'Gaps', category: 'navigation', action: () => setActive('gaps') },
      { id: 'tab-coverage', keys: 'c', description: 'Coverage', category: 'navigation', action: () => setActive('coverage') },
      { id: 'tab-drift', keys: 'd', description: 'Drift', category: 'navigation', action: () => setActive('drift') },
      { id: 'tab-analytics', keys: 'a', description: 'Analytics', category: 'navigation', action: () => setActive('analytics') },
      { id: 'tab-plugins', keys: 'p', description: 'Plugins', category: 'navigation', action: () => setActive('plugins') },
      { id: 'tab-substrate', keys: 's', description: 'Substrate', category: 'navigation', action: () => setActive('substrate') },
      { id: 'tab-health', keys: 'shift+h', description: 'System health', category: 'navigation', action: () => setActive('health') },
      { id: 'toggle-live', keys: 'shift+l', description: 'Toggle live polling', category: 'actions', action: () => setLive((v) => !v) },
    ],
    { lensId: 'system' },
  );

  const tabs = useMemo(() => ([
    { key: 'overview' as const, label: 'Overview', icon: Activity as LucideIcon },
    { key: 'metrics' as const, label: 'Metrics', icon: LineChart as LucideIcon },
    { key: 'alerts' as const, label: liveStatus ? `Alerts (${liveStatus.alerts.firing})` : 'Alerts', icon: Bell as LucideIcon },
    { key: 'logs' as const, label: 'Logs', icon: ScrollText as LucideIcon },
    { key: 'hbhealth' as const, label: liveStatus ? `HB Health (${liveStatus.heartbeats.ok}/${liveStatus.heartbeats.total})` : 'HB Health', icon: Heart as LucideIcon },
    { key: 'traces' as const, label: 'Traces', icon: Gauge as LucideIcon },
    { key: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard as LucideIcon },
    { key: 'trend' as const, label: 'Trend', icon: TrendingUp as LucideIcon },
    { key: 'heartbeats' as const, label: `Heartbeats (${heartbeats.length})`, icon: Heart as LucideIcon },
    { key: 'gaps' as const, label: data ? `Gaps (${data.crossRef.dormantModules.length + data.crossRef.headlessBackends.length})` : 'Gaps', icon: AlertTriangle as LucideIcon },
    { key: 'coverage' as const, label: `Coverage (${coveragePct}%)`, icon: MapIcon as LucideIcon },
    { key: 'drift' as const, label: data ? `Drift (${data.drift.length})` : 'Drift', icon: GitBranch as LucideIcon },
    { key: 'analytics' as const, label: 'Analytics', icon: BarChart3 as LucideIcon },
    { key: 'plugins' as const, label: 'Plugins', icon: Puzzle as LucideIcon },
    { key: 'substrate' as const, label: 'Substrate', icon: Layers as LucideIcon },
    { key: 'health' as const, label: 'Health', icon: Shield as LucideIcon },
  ]), [liveStatus, heartbeats.length, data, coveragePct]);

  const pane = (() => {
    switch (active) {
      case 'overview': return <OverviewPanel />;
      case 'metrics': return <MetricsTabPanel live={live} />;
      case 'alerts': return <AlertsTabPanel live={live} />;
      case 'logs': return <LogsTabPanel live={live} />;
      case 'hbhealth': return <HbHealthTabPanel live={live} />;
      case 'traces': return <TracesTabPanel live={live} />;
      case 'dashboard': return <DashboardTabPanel live={live} />;
      case 'trend': return <TrendTabPanel />;
      case 'heartbeats': return <HeartbeatsInventoryPanel />;
      case 'gaps': return <GapsPanel />;
      case 'coverage': return <CoveragePanel />;
      case 'drift': return <DriftPanelView />;
      case 'analytics': return <AnalyticsTabPanel />;
      case 'plugins': return <PluginsTabPanel />;
      case 'substrate': return <SubstrateTabPanel />;
      case 'health': return <HealthTabPanel />;
      default: return <OverviewPanel />;
    }
  })();

  const TITLES: Record<SysView, string> = {
    overview: `Read the system${who ? `, ${who}` : ''}`,
    metrics: 'Watch the metrics',
    alerts: 'Triage the alerts',
    logs: 'Read the logs',
    hbhealth: 'Check the heartbeats',
    traces: 'Follow the traces',
    dashboard: 'Build your dashboard',
    trend: 'See the trend',
    heartbeats: 'Inventory the heartbeats',
    gaps: 'Find the gaps',
    coverage: 'Measure the coverage',
    drift: 'Catch the drift',
    analytics: 'Analyze usage',
    plugins: 'Manage the plugins',
    substrate: 'Inspect the substrate',
    health: 'Check system health',
  };

  return (
    <LensShell lensId="system" asMain={false}>
      <FirstRunTour lensId="system" />
      <DepthBadge lensId="system" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="system"
        crumb="System"
        title={TITLES[active]}
        subtitle="Cartograph + live telemetry"
        actions={(
          <button
            type="button"
            onClick={() => setLive((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-zinc-300 transition-colors hover:text-white"
            title="Toggle live polling (shift+L)"
          >
            {live ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            {live ? 'Live' : 'Paused'}
          </button>
        )}
        tabs={tabs.map((t) => ({ id: t.key, label: t.label, icon: t.icon }))}
        activeTab={active}
        onTab={(id) => setActive(id as SysView)}
        tabsLabel="System Lens sections"
        cta={{ label: isFetching ? 'Refreshing…' : 'Refresh', icon: RefreshCw, onClick: handleRefresh, disabled: isFetching, title: 'Re-read the cartograph' }}
      >
        {pane}
      </NorthStarFrame>
    </LensShell>
  );
}
