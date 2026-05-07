'use client';

import { useState, useEffect, useCallback } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { api } from '@/lib/api/client';
import { motion } from 'framer-motion';
import {
  Network, ArrowLeftRight, Shield, MessageSquare, Skull,
  Baby, Eye, CheckCircle2, XCircle,
  RefreshCw, ChevronDown, ChevronRight, Loader2, Search,
  Users, Zap, Activity, Layers, Radio, GitMerge, BarChart3,
} from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { DTUDetailView } from '@/components/dtu/DTUDetailView';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensData } from '@/lib/hooks/use-lens-data';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Organism {
  id: string; name: string; size: number; isOrganism: boolean;
  persona: { name?: string; personality?: string; objective?: string } | null;
  awakenedAt: string | null; topTags: string[]; lastUpdated: string;
}

interface BridgeLogEntry {
  id: string; action: string; at: string;
  dtuId?: string; swarmName?: string;
  [key: string]: unknown;
}

interface Debate {
  id: string; dtuId: string; challengerRole: string; challenge: string;
  transcript: { speaker: string; content: string }[];
  verdict: string; resolution: string; at: string;
}

interface BirthCert {
  id: string; swarmId: string; swarmName: string; approved: boolean;
  approvalRatio: string; at: string;
  governanceReviews: { role: string; approve: boolean; note: string }[];
  persona: { name?: string } | null;
}

interface EmergentRole {
  role: string;
  capabilities: { canQuery: boolean; canValidate: boolean; canDebate: boolean; canVote: boolean };
}

/* ------------------------------------------------------------------ */
/*  Data Fetching                                                      */
/* ------------------------------------------------------------------ */

async function fetchOrganisms(): Promise<Organism[]> {
  const res = await api.get('/api/bridge/organisms');
  return res?.data?.organisms || [];
}

async function fetchBridgeLog(limit = 50): Promise<BridgeLogEntry[]> {
  const res = await api.get(`/api/bridge/log?limit=${limit}`);
  return res?.data?.log || [];
}

async function fetchDebates(limit = 20): Promise<Debate[]> {
  const res = await api.get(`/api/bridge/debates?limit=${limit}`);
  return res?.data?.debates || [];
}

async function fetchBirths(): Promise<BirthCert[]> {
  const res = await api.get('/api/bridge/births');
  return res?.data?.births || [];
}

async function fetchEmergents(): Promise<EmergentRole[]> {
  const res = await api.get('/api/bridge/emergents');
  return res?.data?.emergents || [];
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const TABS = ['activity', 'organisms', 'debates', 'lifecycle', 'emergents'] as const;
type Tab = typeof TABS[number];

export default function BridgeLens() {
  useLensNav('bridge');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('bridge');

  const [showFeatures, setShowFeatures] = useState(true);
  const [tab, setTab] = useState<Tab>('activity');
  const [organisms, setOrganisms] = useState<Organism[]>([]);
  const [log, setLog] = useState<BridgeLogEntry[]>([]);
  const [debates, setDebates] = useState<Debate[]>([]);
  const [births, setBirths] = useState<BirthCert[]>([]);
  const [emergents, setEmergents] = useState<EmergentRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDebate, setExpandedDebate] = useState<string | null>(null);
  const [selectedDtuId, setSelectedDtuId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);

  const { items: bridgeItems } = useLensData('bridge', 'connection', { noSeed: true });
  const runAction = useRunArtifact('bridge');

  const handleBridgeAction = async (action: string) => {
    const targetId = bridgeItems[0]?.id;
    if (!targetId) return;
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setIsRunning(null);
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [org, lg, deb, bir, em] = await Promise.all([
        fetchOrganisms(), fetchBridgeLog(), fetchDebates(), fetchBirths(), fetchEmergents(),
      ]);
      setOrganisms(org); setLog(lg); setDebates(deb); setBirths(bir); setEmergents(em);
    } catch (e) { console.error('Bridge data load failed:', e); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const tabIcons: Record<Tab, React.ReactNode> = {
    activity: <Activity className="w-4 h-4" />,
    organisms: <Network className="w-4 h-4" />,
    debates: <MessageSquare className="w-4 h-4" />,
    lifecycle: <Baby className="w-4 h-4" />,
    emergents: <Shield className="w-4 h-4" />,
  };

  return (
    <div data-lens-theme="bridge" className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
            <ArrowLeftRight className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Organism Bridge</h1>
            <p className="text-sm text-zinc-500">Emergent ↔ Knowledge Organism Communication</p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="bridge" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <button onClick={refresh} className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors" title="Refresh">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Stat Cards — connected system health overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Organisms', value: organisms.length, icon: <Network className="w-5 h-5 text-purple-400" />, color: 'text-purple-400' },
          { label: 'Bridge Events', value: log.length, icon: <Activity className="w-5 h-5 text-cyan-400" />, color: 'text-cyan-400' },
          { label: 'Debates', value: debates.length, icon: <MessageSquare className="w-5 h-5 text-amber-400" />, color: 'text-amber-400' },
          { label: 'Emergent Roles', value: emergents.length, icon: <Radio className="w-5 h-5 text-green-400" />, color: 'text-green-400' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.35 }}
            className="p-4 bg-zinc-900 rounded-lg border border-zinc-800"
          >
            <div className="flex items-center gap-2 mb-2">{stat.icon}</div>
            <p className={`text-2xl font-bold font-mono ${stat.color}`}>{stat.value}</p>
            <p className="text-xs text-zinc-500">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Data Flow Arrows — unique visual: animated bridge connection indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="mb-6 p-3 bg-zinc-900/60 rounded-lg border border-purple-500/20 flex items-center justify-center gap-4"
      >
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <GitMerge className="w-4 h-4 text-purple-400" />
          <span>Knowledge Organisms</span>
        </div>
        <div className="flex items-center gap-1">
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              className="w-2 h-2 rounded-full bg-purple-400"
              animate={{ opacity: [0.2, 1, 0.2], x: [0, 8, 16] }}
              transition={{ duration: 1.5, delay: i * 0.3, repeat: Infinity }}
            />
          ))}
        </div>
        <ArrowLeftRight className="w-4 h-4 text-purple-400" />
        <div className="flex items-center gap-1">
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              className="w-2 h-2 rounded-full bg-cyan-400"
              animate={{ opacity: [0.2, 1, 0.2], x: [16, 8, 0] }}
              transition={{ duration: 1.5, delay: i * 0.3, repeat: Infinity }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span>Emergent Agents</span>
          <Shield className="w-4 h-4 text-cyan-400" />
        </div>
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-zinc-900 rounded-lg p-1">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
              tab === t ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>
            {tabIcons[t]}
            <span className="capitalize">{t}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-zinc-600" />
        </div>
      ) : (
        <>
          {tab === 'activity' && <ActivityTab log={log} onDtuClick={setSelectedDtuId} />}
          {tab === 'organisms' && <OrganismsTab organisms={organisms} onRefresh={refresh} />}
          {tab === 'debates' && <DebatesTab debates={debates} expanded={expandedDebate} setExpanded={setExpandedDebate} onDtuClick={setSelectedDtuId} />}
          {tab === 'lifecycle' && <LifecycleTab births={births} />}
          {tab === 'emergents' && <EmergentsTab emergents={emergents} />}
        </>
      )}

      {/* Bridge Action Panel */}
      <div className="mt-6 p-4 bg-zinc-900 rounded-lg border border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4 text-purple-400" />
          Bridge Actions
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          {[
            { action: 'connectionHealth', label: 'Connection Health', icon: <Activity className="w-4 h-4" /> },
            { action: 'dataMapping',      label: 'Data Mapping',      icon: <GitMerge className="w-4 h-4" /> },
            { action: 'syncStatus',       label: 'Sync Status',       icon: <RefreshCw className="w-4 h-4" /> },
            { action: 'throughputAnalysis', label: 'Throughput Analysis', icon: <BarChart3 className="w-4 h-4" /> },
          ].map(({ action, label, icon }) => (
            <button
              key={action}
              onClick={() => handleBridgeAction(action)}
              disabled={isRunning !== null || bridgeItems.length === 0}
              className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isRunning === action
                ? <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                : icon}
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>
        {bridgeItems.length === 0 && (
          <p className="text-xs text-zinc-600 text-center py-1">No bridge connection artifact found — actions are unavailable.</p>
        )}
        {actionResult && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="p-4 bg-zinc-800 rounded-lg border border-purple-500/30"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-purple-400" /> Action Result
              </h3>
              <button
                onClick={() => setActionResult(null)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
                title="Dismiss"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>

            {/* connectionHealth result */}
            {actionResult.overallHealth !== undefined && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className={`text-3xl font-bold font-mono ${
                    (actionResult.overallHealth as number) >= 80 ? 'text-green-400' :
                    (actionResult.overallHealth as number) >= 50 ? 'text-amber-400' :
                    'text-red-400'
                  }`}>
                    {actionResult.overallHealth as number}
                  </div>
                  <div>
                    <p className="text-xs text-zinc-400">Overall Health Score</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      (actionResult.overallHealth as number) >= 80 ? 'bg-green-500/20 text-green-400' :
                      (actionResult.overallHealth as number) >= 50 ? 'bg-amber-500/20 text-amber-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>
                      {(actionResult.overallHealth as number) >= 80 ? 'Healthy' : (actionResult.overallHealth as number) >= 50 ? 'Degraded' : 'Critical'}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-zinc-900 rounded text-center">
                    <p className="text-sm font-bold text-green-400">{actionResult.healthy as number}</p>
                    <p className="text-[10px] text-zinc-500">Healthy</p>
                  </div>
                  <div className="p-2 bg-zinc-900 rounded text-center">
                    <p className="text-sm font-bold text-amber-400">{actionResult.degraded as number}</p>
                    <p className="text-[10px] text-zinc-500">Degraded</p>
                  </div>
                  <div className="p-2 bg-zinc-900 rounded text-center">
                    <p className="text-sm font-bold text-red-400">{actionResult.critical as number}</p>
                    <p className="text-[10px] text-zinc-500">Critical</p>
                  </div>
                </div>
                {(actionResult.connections as Array<{ name: string; status: string; latencyMs: number; uptimePercent: number; errorRate: number; healthScore: number }>)?.map((conn, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-zinc-900 rounded">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        conn.status === 'healthy' ? 'bg-green-400' :
                        conn.status === 'degraded' ? 'bg-amber-400' : 'bg-red-400'
                      }`} />
                      <span className="text-sm text-zinc-200">{conn.name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-zinc-400">
                      <span>{conn.latencyMs}ms</span>
                      <span>{conn.uptimePercent}% up</span>
                      <span className={`font-bold ${
                        conn.status === 'healthy' ? 'text-green-400' :
                        conn.status === 'degraded' ? 'text-amber-400' : 'text-red-400'
                      }`}>{conn.healthScore}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* dataMapping result */}
            {actionResult.coverage !== undefined && actionResult.mappings !== undefined && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className={`text-3xl font-bold font-mono ${
                    (actionResult.coverage as number) >= 90 ? 'text-green-400' :
                    (actionResult.coverage as number) >= 60 ? 'text-amber-400' :
                    'text-red-400'
                  }`}>
                    {actionResult.coverage as number}%
                  </div>
                  <p className="text-xs text-zinc-400">Field Coverage</p>
                </div>
                <div className="w-full bg-zinc-900 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      (actionResult.coverage as number) >= 90 ? 'bg-green-400' :
                      (actionResult.coverage as number) >= 60 ? 'bg-amber-400' : 'bg-red-400'
                    }`}
                    style={{ width: `${actionResult.coverage as number}%` }}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-zinc-900 rounded text-center">
                    <p className="text-sm font-bold text-zinc-200">{actionResult.total as number}</p>
                    <p className="text-[10px] text-zinc-500">Total</p>
                  </div>
                  <div className="p-2 bg-zinc-900 rounded text-center">
                    <p className="text-sm font-bold text-green-400">{actionResult.valid as number}</p>
                    <p className="text-[10px] text-zinc-500">Valid</p>
                  </div>
                  <div className="p-2 bg-zinc-900 rounded text-center">
                    <p className="text-sm font-bold text-red-400">{actionResult.invalid as number}</p>
                    <p className="text-[10px] text-zinc-500">Invalid</p>
                  </div>
                </div>
                {(actionResult.transforms as string[])?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    <span className="text-[10px] text-zinc-500 self-center mr-1">Transforms:</span>
                    {(actionResult.transforms as string[]).map((t, i) => (
                      <span key={i} className="text-xs px-1.5 py-0.5 bg-purple-500/20 text-purple-300 rounded">{t}</span>
                    ))}
                  </div>
                )}
                {(actionResult.mappings as Array<{ sourceField: string; targetField: string; transform: string; dataType: string; valid: boolean }>)?.slice(0, 5).map((m, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs p-2 bg-zinc-900 rounded">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${m.valid ? 'bg-green-400' : 'bg-red-400'}`} />
                    <span className="text-zinc-300 font-mono">{m.sourceField}</span>
                    <ArrowLeftRight className="w-3 h-3 text-zinc-600 flex-shrink-0" />
                    <span className="text-zinc-300 font-mono">{m.targetField}</span>
                    <span className="ml-auto text-zinc-500">{m.transform}</span>
                  </div>
                ))}
              </div>
            )}

            {/* syncStatus result */}
            {actionResult.syncHealth !== undefined && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className={`text-sm font-bold px-3 py-1 rounded-full ${
                    actionResult.syncHealth === 'real-time' ? 'bg-green-500/20 text-green-400' :
                    actionResult.syncHealth === 'recent'    ? 'bg-cyan-500/20 text-cyan-400' :
                    actionResult.syncHealth === 'stale'     ? 'bg-amber-500/20 text-amber-400' :
                    'bg-red-500/20 text-red-400'
                  }`}>
                    {String(actionResult.syncHealth).toUpperCase()}
                  </span>
                  <p className="text-xs text-zinc-400">
                    {actionResult.lastSync === 'never'
                      ? 'Never synced'
                      : `Last sync ${actionResult.minutesSinceSync as number} min ago`}
                  </p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="p-2 bg-zinc-900 rounded text-center">
                    <p className="text-sm font-bold text-zinc-200">{actionResult.totalSyncs as number}</p>
                    <p className="text-[10px] text-zinc-500">Total Syncs</p>
                  </div>
                  <div className="p-2 bg-zinc-900 rounded text-center">
                    <p className="text-sm font-bold text-cyan-400">{(actionResult.totalRecordsProcessed as number).toLocaleString()}</p>
                    <p className="text-[10px] text-zinc-500">Records</p>
                  </div>
                  <div className="p-2 bg-zinc-900 rounded text-center">
                    <p className="text-sm font-bold text-red-400">{actionResult.totalErrors as number}</p>
                    <p className="text-[10px] text-zinc-500">Errors</p>
                  </div>
                  <div className="p-2 bg-zinc-900 rounded text-center">
                    <p className="text-sm font-bold text-amber-400">{actionResult.errorRate as number}%</p>
                    <p className="text-[10px] text-zinc-500">Error Rate</p>
                  </div>
                </div>
                {actionResult.lastSync !== 'never' && (
                  <p className="text-[10px] text-zinc-600 font-mono">
                    Last sync: {new Date(actionResult.lastSync as string).toLocaleString()}
                  </p>
                )}
              </div>
            )}

            {/* throughputAnalysis result */}
            {actionResult.avgRPS !== undefined && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className={`text-3xl font-bold font-mono ${
                    (actionResult.avgRPS as number) >= 100 ? 'text-green-400' :
                    (actionResult.avgRPS as number) >= 50  ? 'text-amber-400' :
                    'text-red-400'
                  }`}>
                    {actionResult.avgRPS as number}
                  </div>
                  <div>
                    <p className="text-xs text-zinc-400">Avg Records / sec</p>
                    <span className="text-xs text-zinc-500">{actionResult.dataPoints as number} data points</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-zinc-900 rounded text-center">
                    <p className="text-sm font-bold text-green-400">{actionResult.peakRPS as number}</p>
                    <p className="text-[10px] text-zinc-500">Peak RPS</p>
                  </div>
                  <div className="p-2 bg-zinc-900 rounded text-center">
                    <p className="text-sm font-bold text-cyan-400">{actionResult.avgRPS as number}</p>
                    <p className="text-[10px] text-zinc-500">Avg RPS</p>
                  </div>
                  <div className="p-2 bg-zinc-900 rounded text-center">
                    <p className="text-sm font-bold text-zinc-400">{actionResult.minRPS as number}</p>
                    <p className="text-[10px] text-zinc-500">Min RPS</p>
                  </div>
                </div>
                {!!actionResult.bottleneck && (
                  <div className={`flex items-start gap-2 text-xs p-2 rounded ${
                    String(actionResult.bottleneck).startsWith('Low')
                      ? 'bg-amber-500/10 text-amber-300'
                      : 'bg-green-500/10 text-green-300'
                  }`}>
                    <Activity className="w-3 h-3 flex-shrink-0 mt-0.5" />
                    {actionResult.bottleneck as string}
                  </div>
                )}
              </div>
            )}

            {/* Fallback: message-only result */}
            {!!actionResult.message &&
              actionResult.overallHealth === undefined &&
              actionResult.coverage === undefined &&
              actionResult.syncHealth === undefined &&
              actionResult.avgRPS === undefined && (
              <p className="text-sm text-zinc-400">{actionResult.message as string}</p>
            )}
          </motion.div>
        )}
      </div>

      <RealtimeDataPanel data={realtimeInsights} />

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
            <LensFeaturePanel lensId="bridge" />
          </div>
        )}
      </div>

      {/* DTU Detail View modal */}
      {selectedDtuId && (
        <DTUDetailView
          dtuId={selectedDtuId}
          onClose={() => setSelectedDtuId(null)}
          onNavigate={(id) => setSelectedDtuId(id)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function ActivityTab({ log, onDtuClick }: { log: BridgeLogEntry[]; onDtuClick?: (id: string) => void }) {
  if (log.length === 0) return <EmptyCard icon={<Activity />} message="No bridge activity yet" hint="Submit a DTU for validation or query an organism to see activity here." />;

  return (
    <div className="space-y-2">
      {log.slice().reverse().map(entry => (
        <div key={entry.id} className="flex items-start gap-3 p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="mt-0.5">{actionIcon(entry.action)}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-zinc-200">{formatAction(entry.action)}</span>
              <span className="text-xs text-zinc-600">{new Date(entry.at).toLocaleString()}</span>
            </div>
            {entry.dtuId && <button onClick={() => onDtuClick?.(String(entry.dtuId))} className="text-xs text-neon-cyan hover:underline cursor-pointer">DTU: {String(entry.dtuId).slice(0, 12)}...</button>}
            {entry.swarmName && <span className="text-xs text-purple-400 ml-2">{String(entry.swarmName)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function OrganismsTab({ organisms, onRefresh }: { organisms: Organism[]; onRefresh: () => void }) {
  if (organisms.length === 0) return <EmptyCard icon={<Network />} message="No organisms detected" hint="DTU swarms with 10+ members can be awakened as Knowledge Organisms." />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={onRefresh} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>
    <div className="grid gap-4 md:grid-cols-2">
      {organisms.map(org => (
        <div key={org.id} className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2 mb-2">
            {org.isOrganism ? <Zap className="w-4 h-4 text-yellow-400" /> : <Network className="w-4 h-4 text-zinc-500" />}
            <h3 className="font-semibold text-sm">{org.persona?.name || org.name}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full ${org.isOrganism ? 'bg-green-500/20 text-green-400' : 'bg-zinc-700 text-zinc-400'}`}>
              {org.isOrganism ? 'Awakened' : 'Dormant'}
            </span>
          </div>
          <div className="text-xs text-zinc-500 space-y-1">
            <div>{org.size} DTUs in swarm</div>
            {org.topTags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {org.topTags.map(tag => (
                  <span key={tag} className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400">{tag}</span>
                ))}
              </div>
            )}
            {org.persona?.objective && <div className="text-zinc-400 mt-1 italic">{org.persona.objective}</div>}
          </div>
        </div>
      ))}
    </div>
    </div>
  );
}

function DebatesTab({ debates, expanded, setExpanded, onDtuClick }: { debates: Debate[]; expanded: string | null; setExpanded: (id: string | null) => void; onDtuClick?: (id: string) => void }) {
  if (debates.length === 0) return <EmptyCard icon={<MessageSquare />} message="No debates yet" hint="Debates occur when emergent agents challenge organism DTU outputs." />;

  return (
    <div className="space-y-3">
      {debates.slice().reverse().map(debate => (
        <div key={debate.id} className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
          <button onClick={() => setExpanded(expanded === debate.id ? null : debate.id)}
            className="w-full flex items-center gap-3 p-4 text-left hover:bg-zinc-800/50 transition-colors">
            {expanded === debate.id ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium capitalize">{debate.challengerRole}</span>
                <span className="text-zinc-600">challenged</span>
                <button onClick={(e) => { e.stopPropagation(); onDtuClick?.(debate.dtuId); }} className="text-xs text-neon-cyan hover:underline cursor-pointer">{debate.dtuId.slice(0, 12)}...</button>
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">{debate.challenge.slice(0, 100)}</div>
            </div>
            <VerdictBadge verdict={debate.verdict} />
          </button>
          {expanded === debate.id && (
            <div className="px-4 pb-4 space-y-2 border-t border-zinc-800 pt-3">
              {debate.transcript.map((turn, i) => (
                <div key={i} className="flex gap-2 text-sm">
                  <span className="font-medium text-zinc-400 capitalize min-w-[80px]">{turn.speaker}:</span>
                  <span className="text-zinc-300">{turn.content}</span>
                </div>
              ))}
              {debate.resolution && (
                <div className="mt-2 p-2 bg-zinc-800 rounded text-xs text-zinc-400">
                  Resolution: {debate.resolution}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function LifecycleTab({ births }: { births: BirthCert[] }) {
  if (births.length === 0) return <EmptyCard icon={<Baby />} message="No organism lifecycle events" hint="When a DTU swarm crosses the awakening threshold, a birth ceremony convenes all nine emergent agents." />;

  return (
    <div className="space-y-3">
      {births.slice().reverse().map(cert => (
        <div key={cert.id} className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2 mb-3">
            {cert.approved ? <CheckCircle2 className="w-5 h-5 text-green-400" /> : <XCircle className="w-5 h-5 text-red-400" />}
            <h3 className="font-semibold text-sm">{cert.swarmName}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full ${cert.approved ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
              {cert.approved ? 'Approved' : 'Denied'} — {cert.approvalRatio}
            </span>
            <span className="text-xs text-zinc-600 ml-auto">{new Date(cert.at).toLocaleDateString()}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {cert.governanceReviews.map((review, i) => (
              <div key={i} className="p-2 bg-zinc-800 rounded text-xs">
                <div className="flex items-center gap-1">
                  {review.approve ? <CheckCircle2 className="w-3 h-3 text-green-400" /> : <XCircle className="w-3 h-3 text-red-400" />}
                  <span className="font-medium capitalize">{review.role}</span>
                </div>
                <div className="text-zinc-500 mt-1 line-clamp-2">{review.note}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmergentsTab({ emergents }: { emergents: EmergentRole[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {emergents.map(em => (
        <div key={em.role} className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-blue-400" />
            <h3 className="font-semibold text-sm capitalize">{em.role}</h3>
          </div>
          <div className="flex flex-wrap gap-1">
            {em.capabilities.canQuery && <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">Query</span>}
            {em.capabilities.canValidate && <span className="text-xs px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded">Validate</span>}
            {em.capabilities.canDebate && <span className="text-xs px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded">Debate</span>}
            {em.capabilities.canVote && <span className="text-xs px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded">Vote</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function EmptyCard({ icon, message, hint }: { icon: React.ReactNode; message: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center">
      <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mb-4 text-zinc-500">{icon}</div>
      <p className="text-zinc-400 font-medium">{message}</p>
      <p className="text-sm text-zinc-600 mt-1 max-w-md">{hint}</p>
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const colors: Record<string, string> = {
    accept: 'bg-green-500/20 text-green-400',
    modify: 'bg-amber-500/20 text-amber-400',
    quarantine: 'bg-red-500/20 text-red-400',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${colors[verdict] || 'bg-zinc-700 text-zinc-400'}`}>
      {verdict}
    </span>
  );
}

function actionIcon(action: string) {
  if (action.includes('debate')) return <MessageSquare className="w-4 h-4 text-amber-400" />;
  if (action.includes('birth') || action.includes('awaken')) return <Baby className="w-4 h-4 text-green-400" />;
  if (action.includes('death') || action.includes('dormant')) return <Skull className="w-4 h-4 text-red-400" />;
  if (action.includes('validation') || action.includes('submit')) return <Shield className="w-4 h-4 text-blue-400" />;
  if (action.includes('query') || action.includes('response')) return <Search className="w-4 h-4 text-purple-400" />;
  return <Eye className="w-4 h-4 text-zinc-500" />;
}

function formatAction(action: string): string {
  return action.replace(/\./g, ' → ').replace(/_/g, ' ');
}
