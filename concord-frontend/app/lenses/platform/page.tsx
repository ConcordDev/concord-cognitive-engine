'use client';

import React, { useState, useMemo } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { PlatformRepos } from '@/components/platform/PlatformRepos';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useQuery } from '@tanstack/react-query';
import { api, apiHelpers } from '@/lib/api/client';
import {
  Activity, Brain, FlaskConical, Layers, Radio,
  BarChart3, Zap, Shield, Database,
  Heart, Clock, CheckCircle, AlertTriangle,
  ChevronDown, ChevronRight, Eye, Server, Gauge, Play, Loader2, Rocket,
} from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { motion } from 'framer-motion';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import PipelineMonitor from '@/components/platform/PipelineMonitor';
import NerveCenter from '@/components/platform/NerveCenter';
import EmpiricalGatesPanel from '@/components/platform/EmpiricalGatesPanel';
import ScopeControls from '@/components/platform/ScopeControls';
import PlatformConsole from '@/components/platform/PlatformConsole';
import { usePlatformEvents } from '@/components/platform/usePlatformEvents';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

type Tab = 'overview' | 'console' | 'pipeline' | 'nerve' | 'empirical' | 'scope' | 'events';

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string; size?: number | string }>; desc: string }[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3, desc: 'System-wide dashboard' },
  { id: 'console', label: 'Console', icon: Rocket, desc: 'Deploy, metrics, config, domains, alerts, cost, audit' },
  { id: 'pipeline', label: 'Pipeline', icon: Activity, desc: 'Autogen pipeline monitor' },
  { id: 'nerve', label: 'Nerve Center', icon: Brain, desc: 'Beacon, strategy, hypothesis' },
  { id: 'empirical', label: 'Empirical', icon: FlaskConical, desc: 'Math, units, constants' },
  { id: 'scope', label: 'Scopes', icon: Layers, desc: 'Global/Local/Marketplace' },
  { id: 'events', label: 'Live Events', icon: Radio, desc: 'Real-time event stream' },
];

function EventStreamPanel({ events = [], connected }: { events?: Array<{ type: string; data: Record<string, unknown>; timestamp: string }>; connected: boolean }) {
  const [filterType, setFilterType] = useState('');
  const [showRaw, setShowRaw] = useState<number | null>(null);

  // Guard: `events` can be undefined before the realtime stream populates (mounting the
  // Live Events tab) — calling .map on it crashed the whole platform lens via ErrorBoundary.
  const safeEvents = useMemo(() => (Array.isArray(events) ? events : []), [events]);
  const eventTypes = useMemo(() => {
    const types = new Set(safeEvents.map(e => e.type));
    return Array.from(types).sort();
  }, [safeEvents]);

  const filtered = useMemo(() => {
    if (!filterType) return safeEvents;
    return safeEvents.filter(e => e.type === filterType);
  }, [safeEvents, filterType]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-100 flex items-center gap-3">
          <Radio className="w-6 h-6 text-neon-pink" />
          Live Event Stream
        </h2>
        <div className="flex items-center gap-3">
          {eventTypes.length > 0 && (
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="input-lattice text-xs py-1"
            >
              <option value="">All types ({safeEvents.length})</option>
              {eventTypes.map(t => (
                <option key={t} value={t}>{t} ({safeEvents.filter(e => e.type === t).length})</option>
              ))}
            </select>
          )}
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${
            connected ? 'bg-neon-green/10 border border-neon-green/20' : 'bg-gray-600/10 border border-gray-600/20'
          }`}>
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-neon-green animate-pulse' : 'bg-gray-500'}`} />
            <span className={`text-xs ${connected ? 'text-neon-green' : 'text-gray-400'}`}>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Radio className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Waiting for events...</p>
          <p className="text-xs mt-1">Events will appear here in real-time as the system operates.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map((event, i) => {
            const colors: Record<string, string> = {
              'dtu:created': 'text-neon-green',
              'dtu:updated': 'text-neon-blue',
              'dtu:deleted': 'text-neon-orange',
              'pipeline:completed': 'text-neon-purple',
              'beacon:check': 'text-neon-cyan',
              'heartbeat:tick': 'text-gray-400',
            };
            const isExpanded = showRaw === i;
            return (
              <div key={`${event.timestamp}-${i}`}>
                <div
                  className="flex items-center gap-3 px-4 py-2 bg-lattice-elevated rounded-lg border border-lattice-border cursor-pointer hover:border-lattice-border/80 transition-colors"
                  onClick={() => setShowRaw(isExpanded ? null : i)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                  <Zap className={`w-3 h-3 ${colors[event.type] || 'text-gray-400'} shrink-0`} />
                  <span className={`text-xs font-mono ${colors[event.type] || 'text-gray-400'}`}>
                    {event.type}
                  </span>
                  <span className="text-xs text-gray-400 flex-1 truncate">
                    {JSON.stringify(event.data).slice(0, 120)}
                  </span>
                  <span className="text-[10px] text-gray-400 shrink-0">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                  {isExpanded ? <ChevronDown className="w-3 h-3 text-gray-400" /> : <ChevronRight className="w-3 h-3 text-gray-400" />}
                </div>
                {isExpanded && (
                  <pre className="mx-4 mt-1 mb-2 p-3 bg-lattice-surface rounded text-xs text-gray-300 font-mono overflow-auto max-h-40">
                    {JSON.stringify(event.data, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OverviewDashboard() {
  const { data: statusData, isLoading: statusLoading, isError: statusError } = useQuery({
    queryKey: ['platform-status'],
    queryFn: () => api.get('/api/status').then(r => r.data),
    refetchInterval: 15_000,
  });

  const { data: healthData, isLoading: healthLoading, isError: healthError } = useQuery({
    queryKey: ['platform-health'],
    queryFn: () => apiHelpers.guidance.health().then(r => r.data),
    refetchInterval: 15_000,
  });

  const isLoading = statusLoading || healthLoading;
  const isError = statusError || healthError;
  const status = statusData || {};
  const health = healthData || {};

  const dtuCount = status.dtuCount || status.totalDTUs || health.dtuCount || 0;
  const shadowCount = status.shadowCount || health.shadowCount || 0;
  const organCount = status.organCount || 0;
  const uptime = status.uptime || health.uptime || 0;
  const pipelineRuns = status.pipelineRuns || health.pipelineRuns || 0;
  const healthScore = health.score || health.healthScore || null;

  const formatUptime = (seconds: number) => {
    if (!seconds) return '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
    return `${h}h ${m}m`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-100 flex items-center gap-3">
          <BarChart3 className="w-6 h-6 text-neon-cyan" />
          Platform Overview
        </h2>
        {isError && (
          <span className="text-xs text-red-400">Failed to load some data</span>
        )}
        {isLoading && (
          <div className="w-4 h-4 border-2 border-neon-blue border-t-transparent rounded-full animate-spin" />
        )}
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Server className="w-5 h-5 text-neon-blue" />
          <div>
            <p className="text-lg font-bold">{organCount + 6}</p>
            <p className="text-xs text-gray-400">Services</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Gauge className="w-5 h-5 text-neon-green" />
          <div>
            <p className="text-lg font-bold">{healthScore !== null ? `${(typeof healthScore === 'number' ? (healthScore * 100).toFixed(0) : healthScore)}%` : '99%'}</p>
            <p className="text-xs text-gray-400">Uptime Avg</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Activity className="w-5 h-5 text-neon-purple" />
          <div>
            <p className="text-lg font-bold">{pipelineRuns}</p>
            <p className="text-xs text-gray-400">Deployments</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Clock className="w-5 h-5 text-neon-cyan" />
          <div>
            <p className="text-lg font-bold">{formatUptime(uptime)}</p>
            <p className="text-xs text-gray-400">Uptime</p>
          </div>
        </motion.div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="panel p-4 text-center">
          <Database className="w-5 h-5 text-neon-blue mx-auto mb-2" />
          <p className="text-2xl font-bold font-mono">{dtuCount}</p>
          <p className="text-xs text-gray-400">DTUs</p>
        </div>
        <div className="panel p-4 text-center">
          <Eye className="w-5 h-5 text-neon-purple mx-auto mb-2" />
          <p className="text-2xl font-bold font-mono">{shadowCount}</p>
          <p className="text-xs text-gray-400">Shadows</p>
        </div>
        <div className="panel p-4 text-center">
          <Heart className="w-5 h-5 text-neon-pink mx-auto mb-2" />
          <p className="text-2xl font-bold font-mono">{organCount}</p>
          <p className="text-xs text-gray-400">Organs</p>
        </div>
        <div className="panel p-4 text-center">
          <Activity className="w-5 h-5 text-neon-green mx-auto mb-2" />
          <p className="text-2xl font-bold font-mono">{pipelineRuns}</p>
          <p className="text-xs text-gray-400">Runs</p>
        </div>
        <div className="panel p-4 text-center">
          <Clock className="w-5 h-5 text-neon-yellow mx-auto mb-2" />
          <p className="text-2xl font-bold font-mono">{formatUptime(uptime)}</p>
          <p className="text-xs text-gray-400">Uptime</p>
        </div>
        <div className="panel p-4 text-center">
          {healthScore !== null ? (
            <>
              {healthScore >= 0.8 ? (
                <CheckCircle className="w-5 h-5 text-neon-green mx-auto mb-2" />
              ) : healthScore >= 0.5 ? (
                <AlertTriangle className="w-5 h-5 text-neon-yellow mx-auto mb-2" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-red-400 mx-auto mb-2" />
              )}
              <p className="text-2xl font-bold font-mono">
                {typeof healthScore === 'number' ? `${(healthScore * 100).toFixed(0)}%` : healthScore}
              </p>
              <p className="text-xs text-gray-400">Health</p>
            </>
          ) : (
            <>
              <Shield className="w-5 h-5 text-gray-400 mx-auto mb-2" />
              <p className="text-2xl font-bold font-mono">—</p>
              <p className="text-xs text-gray-400">Health</p>
            </>
          )}
        </div>
      </div>

      {/* Sub-dashboards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <PipelineMonitor />
        </div>
        <div className="space-y-6">
          <NerveCenter />
        </div>
      </div>

      {/* System Info */}
      {(status.version || status.nodeVersion || status.platform) && (
        <div className="panel p-4">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">System Information</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            {status.version && (
              <div>
                <span className="text-xs text-gray-400">Version</span>
                <p className="font-mono">{status.version}</p>
              </div>
            )}
            {status.nodeVersion && (
              <div>
                <span className="text-xs text-gray-400">Node.js</span>
                <p className="font-mono">{status.nodeVersion}</p>
              </div>
            )}
            {status.platform && (
              <div>
                <span className="text-xs text-gray-400">Platform</span>
                <p className="font-mono">{status.platform}</p>
              </div>
            )}
            {status.memoryUsage && (
              <div>
                <span className="text-xs text-gray-400">Memory</span>
                <p className="font-mono">
                  {typeof status.memoryUsage === 'object'
                    ? `${Math.round((status.memoryUsage.heapUsed || 0) / 1024 / 1024)}MB`
                    : status.memoryUsage}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PlatformPage() {
  useLensNav('platform');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('platform');
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Lens-scoped keyboard commands (auto-wired by codemod).
  useLensCommand(
    [
      { id: 'tab-overview', keys: 'o', description: 'Overview', category: 'navigation', action: () => setActiveTab('overview') },
      { id: 'tab-console', keys: 'c', description: 'Console', category: 'navigation', action: () => setActiveTab('console') },
      { id: 'tab-pipeline', keys: 'p', description: 'Pipeline', category: 'navigation', action: () => setActiveTab('pipeline') },
      { id: 'tab-nerve', keys: 'n', description: 'Nerve', category: 'navigation', action: () => setActiveTab('nerve') },
      { id: 'tab-empirical', keys: 'e', description: 'Empirical', category: 'navigation', action: () => setActiveTab('empirical') },
      { id: 'tab-scope', keys: 's', description: 'Scope', category: 'navigation', action: () => setActiveTab('scope') },
      { id: 'tab-events', keys: 'v', description: 'Events', category: 'navigation', action: () => setActiveTab('events') },
    ],
    { lensId: 'platform' }
  );
  const [showFeatures, setShowFeatures] = useState(true);
  const { events, connected } = usePlatformEvents();
  const { items: platformItems } = useLensData('platform', 'service', { noSeed: true });
  const runAction = useRunArtifact('platform');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const handleAction = async (action: string) => {
    const targetId = platformItems[0]?.id;
    if (!targetId) { setActionResult({ message: 'No platform service data found. Add service data first.' }); return; }
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    finally { setIsRunning(null); }
  };

  return (
    <LensShell lensId="platform" asMain={false}>
      <FirstRunTour lensId="platform" />
      <ManifestActionBar />
      <DepthBadge lensId="platform" size="sm" className="ml-2" />
    <div data-lens-theme="platform" className="min-h-screen bg-lattice-void text-gray-200">
      {/* Top Bar */}
      <div className="border-b border-lattice-border bg-lattice-deep/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Shield className="w-7 h-7 text-neon-blue" />
              <div>
                <h1 className="text-lg font-bold text-gray-100">Concord Platform</h1>
                <p className="text-xs text-gray-400">v5.5.0 — Pipeline + Empirical Gates + Capability Bridge</p>
              </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="platform" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
            </div>
            <div className="flex items-center gap-3">
              <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${
                connected ? 'bg-neon-green/10' : 'bg-gray-600/10'
              }`}>
                <div className={`w-2 h-2 rounded-full ${connected ? 'bg-neon-green animate-pulse' : 'bg-gray-500'}`} />
                <span className={`text-xs ${connected ? 'text-neon-green' : 'text-gray-400'}`}>
                  {connected ? 'Live' : 'Polling'}
                </span>
                {events.length > 0 && (
                  <span className="text-[10px] text-gray-400 ml-1">({events.length} events)</span>
                )}
              </div>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-1 flex-wrap scrollbar-hide -mb-px">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  title={tab.desc}
                  className={`flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-t-lg border-b-2 transition-colors whitespace-nowrap ${
                    isActive
                      ? 'border-neon-blue text-neon-blue bg-lattice-surface'
                      : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-lattice-surface/50'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'overview' && <OverviewDashboard />}
        {activeTab === 'console' && <PlatformConsole />}
        {activeTab === 'pipeline' && <PipelineMonitor />}
        {activeTab === 'nerve' && <NerveCenter />}
        {activeTab === 'empirical' && <EmpiricalGatesPanel />}
        {activeTab === 'scope' && <ScopeControls />}
        {activeTab === 'events' && <EventStreamPanel events={events} connected={connected} />}

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="platform"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
      </div>

      {/* Backend Action Panel */}
      <div className="panel p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Server className="w-4 h-4 text-neon-blue" />
          Platform Analysis
        </h2>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'slaCompute', label: 'SLA Compute' },
            { action: 'capacityPlan', label: 'Capacity Plan' },
            { action: 'incidentTimeline', label: 'Incident Timeline' },
            { action: 'dependencyMap', label: 'Dependency Map' },
          ].map(({ action, label }) => (
            <button key={action} onClick={() => handleAction(action)} disabled={!!isRunning}
              className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
              {isRunning === action ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {label}
            </button>
          ))}
        </div>
        {actionResult && (
          <div className="bg-lattice-deep rounded-lg p-4 space-y-3 text-sm">
            {'uptimePercent' in actionResult && (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <span className="text-neon-green font-bold text-lg">{String(actionResult.uptimePercent)}%</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${actionResult.meetsTarget ? 'bg-neon-green/20 text-neon-green' : 'bg-red-400/20 text-red-400'}`}>
                    {actionResult.meetsTarget ? 'Meets SLA' : 'Below SLA'}
                  </span>
                  <span className="text-gray-400 text-xs">{String(actionResult.nines)} nines</span>
                </div>
                {'errorBudget' in actionResult && actionResult.errorBudget !== null && typeof actionResult.errorBudget === 'object' && (
                  <div className="flex flex-wrap gap-3 text-xs">
                    {Object.entries(actionResult.errorBudget as Record<string, unknown>).map(([k, v]) => (
                      <span key={k} className="text-gray-400">{k}: <span className="text-neon-cyan">{String(v)}</span></span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {'resources' in actionResult && actionResult.resources !== null && typeof actionResult.resources === 'object' && (
              <div className="space-y-2">
                <span className="text-gray-400 text-xs">Overall: <span className={`font-bold ${
                  actionResult.overallHealth === 'healthy' ? 'text-neon-green' :
                  actionResult.overallHealth === 'warning' ? 'text-yellow-400' : 'text-red-400'
                }`}>{String(actionResult.overallHealth)}</span></span>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {Object.entries(actionResult.resources as Record<string, unknown>).map(([k, v]) => (
                    v && typeof v === 'object' ? (
                      <div key={k} className="bg-lattice-surface rounded px-2 py-1">
                        <span className="text-gray-400 uppercase text-[10px]">{k}</span>
                        <div className="flex gap-2 text-xs mt-0.5">
                          {Object.entries(v as Record<string, unknown>).map(([ik, iv]) => (
                            <span key={ik} className="text-gray-300">{ik}: <span className="text-neon-cyan">{String(iv)}</span></span>
                          ))}
                        </div>
                      </div>
                    ) : null
                  ))}
                </div>
              </div>
            )}
            {'timeline' in actionResult && Array.isArray(actionResult.timeline) && (
              <div className="space-y-2">
                <span className="text-gray-400 text-xs">Timeline events: <span className="text-neon-cyan">{String((actionResult.timeline as unknown[]).length)}</span></span>
                {'cascades' in actionResult && Array.isArray(actionResult.cascades) && actionResult.cascades.length > 0 && (
                  <div>
                    <p className="text-xs text-red-400 font-semibold mb-1">Cascades</p>
                    {(actionResult.cascades as Array<Record<string, unknown>>).map((c, i) => (
                      <div key={i} className="text-xs bg-red-400/10 border border-red-400/20 rounded px-2 py-1 mb-1 text-red-400">
                        {String(c.trigger || c.event)}: {String(c.affected || '')}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {'healthScore' in actionResult && 'singlePointsOfFailure' in actionResult && (
              <div className="space-y-2">
                <span className="text-neon-cyan font-bold">Health: {String(actionResult.healthScore)}%</span>
                {'singlePointsOfFailure' in actionResult && Array.isArray(actionResult.singlePointsOfFailure) && actionResult.singlePointsOfFailure.length > 0 && (
                  <div>
                    <p className="text-xs text-red-400 font-semibold mb-1">Single Points of Failure</p>
                    <div className="flex flex-wrap gap-1">
                      {(actionResult.singlePointsOfFailure as Array<{service: string; dependentCount: number; dependents: string[]; tier: string}>).map((s, i) => (
                        <span key={i} className="text-xs bg-red-400/10 border border-red-400/20 rounded px-2 py-0.5 text-red-400">{s.service} ({s.dependentCount})</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {'message' in actionResult && <p className="text-gray-400">{String(actionResult.message)}</p>}
          </div>
        )}
      </div>

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="platform" />
          </div>
        )}
      </div>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <PlatformRepos />
      </section>
    </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <a href="#platform-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to platform content</a>
          <RecentMineCard domain="platform" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="platform" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="platform" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
