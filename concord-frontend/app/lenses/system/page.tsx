'use client';

/**
 * System — one Grafana/Datadog observability + cartograph desk.
 *
 * Single `active` union drives the tab bar. SystemHealth accordion is
 * folded into the union as `health`. Each view is a panel.
 */

import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Activity, LineChart, Bell, ScrollText, Heart, Gauge, LayoutDashboard,
  TrendingUp, AlertTriangle, Map as MapIcon, GitBranch, BarChart3, Puzzle,
  Layers, Shield, Play, Pause, RefreshCw, type LucideIcon,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
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
  const reduceMotion = useReducedMotion();
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

  return (
    <LensShell lensId="system" asMain={false}>
      <FirstRunTour lensId="system" />
      <DepthBadge lensId="system" size="sm" className="ml-2" />
      <div data-lens-theme="system" className="min-h-screen bg-black pb-12 text-cyan-50">
        <header className="sticky top-0 z-10 border-b border-cyan-900/50 bg-black/95 px-4 py-3 backdrop-blur md:px-8">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Activity className="h-6 w-6 text-cyan-400" aria-hidden />
              <div>
                <h1 className="text-lg font-semibold text-cyan-100">System</h1>
                <p className="text-xs text-cyan-700 font-mono">Grafana density · cartograph + live telemetry</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setLive((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded border border-cyan-800/60 bg-cyan-950/40 px-2.5 py-1 text-xs text-cyan-300 hover:bg-cyan-900/40"
                title="Toggle live polling"
              >
                {live ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                {live ? 'Live' : 'Paused'}
              </button>
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isFetching}
                className="inline-flex items-center gap-1.5 rounded border border-cyan-800/60 bg-cyan-950/40 px-2.5 py-1 text-xs text-cyan-300 hover:bg-cyan-900/40 disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
        </header>

        <nav className="border-b border-cyan-900/30 px-4 md:px-8" aria-label="System Lens sections">
          <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActive(key)}
                className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 ${
                  active === key
                    ? 'border-cyan-400 text-cyan-200'
                    : 'border-transparent text-cyan-700 hover:text-cyan-400'
                }`}
                aria-pressed={active === key}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
              </button>
            ))}
          </div>
        </nav>

        <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -10 }}
              transition={{ duration: reduceMotion ? 0 : 0.2 }}
            >
              {pane}
            </motion.div>
          </AnimatePresence>
        </main>

        <CrossLensRecentsPanel lensId="system" sinceDays={7} limit={6} hideWhenEmpty className="mt-3 px-4" />
      </div>
    </LensShell>
  );
}
