'use client';

/**
 * System Lens — surfaces the cognitive OS internals that the cartographer
 * inventoried but were previously headless (no UI). Calls the
 * `system.cartograph` macro to fetch the latest SYSTEMS.json + crossRef
 * arrays and renders them as a live operational dashboard.
 *
 * Phase 3 wire-the-Lost: the `system` macro domain has 7 macros but no
 * UI surface; this lens is its frontend.
 *
 * Frontend Parity: loading/empty/error/populated/realtime; Framer Motion
 * entry animations; mobile-responsive grid; ARIA-labelled tables; dark
 * mode via design system; tooltips on stat cards.
 */

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { SystemHealthPanel } from '@/components/system/SystemHealthPanel';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';

// Absorbed UX components — analytics dashboard + plugin marketplace
// surface, mounted as new tabs in the system lens. Using empty/default
// inputs until /api/analytics and /api/plugins macros land.
const AnalyticsDashboard = dynamic(
  () => import('@/components/world-lens/AnalyticsDashboard'),
  { ssr: false },
);
const LensPluginSystem = dynamic(
  () => import('@/components/world-lens/LensPluginSystem'),
  { ssr: false },
);
import { DomainProbeCard } from '@/components/system/DomainProbeCard';
import { probesByGroup } from '@/lib/headless-probes';
import { MetricsPanel } from '@/components/system/MetricsPanel';
import { AlertsPanel } from '@/components/system/AlertsPanel';
import { LogViewer } from '@/components/system/LogViewer';
import { HeartbeatHealthPanel } from '@/components/system/HeartbeatHealthPanel';
import { TracesPanel } from '@/components/system/TracesPanel';
import { TrendPanel } from '@/components/system/TrendPanel';
import { CustomDashboard } from '@/components/system/CustomDashboard';
import { useLiveStatus } from '@/components/system/useLiveStatus';
import {
  Activity, Database, Globe, Heart, Layers, Map as MapIcon,
  RefreshCw, AlertTriangle, CheckCircle2, XCircle, Loader2,
  Zap, BookOpen, GitBranch, BarChart3, Puzzle,
  LineChart, Bell, ScrollText, Gauge, LayoutDashboard, TrendingUp,
  Play, Pause,
  type LucideIcon,
} from 'lucide-react';

interface CartographStats {
  tableCount: number;
  routeCount: number;
  macroCount: number;
  macroDomainCount: number;
  heartbeatCount: number;
  lensCount: number;
  moduleCount: number;
  deadTableCount: number;
  orphanModuleCount: number;
  dormantModuleCount: number;
  coverageInScope: number;
  coveragePresent: number;
}

interface HeartbeatEntry { id: string; frequency: number; neverDisable?: boolean }
interface DriftEntry { file: string; line: number; claim: string; actual: number; delta: number }
interface CoverageEntry {
  category: string;
  status: 'present' | 'partial' | 'missing';
  scope: 'in' | 'out';
  matchedManifests: string[];
  matchedMacroDomains: string[];
  matchedRoutes: string[];
  proposedTargetLens: string | null;
  priority: number | null;
}

interface SystemsReport {
  generatedAt: string;
  stats: CartographStats;
  static: { heartbeatCallsites?: HeartbeatEntry[] };
  runtime: { booted: boolean; heartbeats: HeartbeatEntry[]; reason?: string };
  crossRef: {
    deadTables: { name: string; migration: string }[];
    dormantModules: { id: string; subsystem: string | null; importedBy: number }[];
    headlessBackends: { domain: string; macroCount: number }[];
    orphanLenses: { frontendDir: string; reason: string }[];
  };
  coverage: CoverageEntry[];
  drift: DriftEntry[];
}

export default function SystemLensPage() {
  useLensNav('system');

  const [activeTab, setActiveTab] = useState<
    'overview' | 'metrics' | 'alerts' | 'logs' | 'hbhealth' | 'traces' | 'dashboard'
    | 'trend' | 'heartbeats' | 'gaps' | 'coverage' | 'drift' | 'analytics' | 'plugins' | 'substrate'
  >('overview');

  // Live-poll loop — shared `live` flag pauses every realtime panel at once.
  const { live, setLive, status: liveStatus } = useLiveStatus();

  // Lens-scoped keyboard commands.
  useLensCommand(
    [
      { id: 'tab-overview', keys: 'o', description: 'Overview', category: 'navigation', action: () => setActiveTab('overview') },
      { id: 'tab-metrics', keys: 'm', description: 'Metrics', category: 'navigation', action: () => setActiveTab('metrics') },
      { id: 'tab-alerts', keys: 'l', description: 'Alerts', category: 'navigation', action: () => setActiveTab('alerts') },
      { id: 'tab-logs', keys: 'v', description: 'Logs', category: 'navigation', action: () => setActiveTab('logs') },
      { id: 'tab-hbhealth', keys: 'h', description: 'Heartbeat health', category: 'navigation', action: () => setActiveTab('hbhealth') },
      { id: 'tab-traces', keys: 't', description: 'Traces', category: 'navigation', action: () => setActiveTab('traces') },
      { id: 'tab-dashboard', keys: 'k', description: 'Dashboard', category: 'navigation', action: () => setActiveTab('dashboard') },
      { id: 'tab-trend', keys: 'r', description: 'Trend', category: 'navigation', action: () => setActiveTab('trend') },
      { id: 'tab-gaps', keys: 'g', description: 'Gaps', category: 'navigation', action: () => setActiveTab('gaps') },
      { id: 'tab-coverage', keys: 'c', description: 'Coverage', category: 'navigation', action: () => setActiveTab('coverage') },
      { id: 'tab-drift', keys: 'd', description: 'Drift', category: 'navigation', action: () => setActiveTab('drift') },
      { id: 'tab-analytics', keys: 'a', description: 'Analytics', category: 'navigation', action: () => setActiveTab('analytics') },
      { id: 'tab-plugins', keys: 'p', description: 'Plugins', category: 'navigation', action: () => setActiveTab('plugins') },
      { id: 'tab-substrate', keys: 's', description: 'Substrate', category: 'navigation', action: () => setActiveTab('substrate') },
      { id: 'toggle-live', keys: 'shift+l', description: 'Toggle live polling', category: 'actions', action: () => setLive((v) => !v) },
    ],
    { lensId: 'system' }
  );
  const [coverageFilter, setCoverageFilter] = useState<'all' | 'present' | 'partial' | 'missing'>('all');
  const [refreshKey, setRefreshKey] = useState(0);

  // Plugins query — list installed/marketplace plugins from the
  // developer-sdk loader. Maps the loader's flat `plugins` array onto
  // the LensPluginSystem prop split (installed vs marketplace) by
  // status: enabled plugins → installed; status='registered' → still
  // a draft, not surfaced; everything else → marketplace.
  type LoaderPlugin = {
    id: string;
    name: string;
    version?: string;
    creator?: string;
    category?: string;
    description?: string;
    citations?: number;
    downloads?: number;
    rating?: number;
    status?: string;
  };
  // Mirror the LensPluginSystem prop subtypes — Parameters<typeof X>
  // breaks on dynamic-imported components.
  type PluginCategory = 'Science' | 'Engineering' | 'Economics' | 'Social' | 'Entertainment' | 'Education';
  type FrontendInstalled = {
    id: string;
    name: string;
    creator: string;
    category: PluginCategory;
    version: string;
  };
  type FrontendMarketplace = {
    id: string;
    name: string;
    creator: string;
    description: string;
    category: PluginCategory;
    citations: number;
    downloads: number;
    rating: number;
    status: 'draft' | 'in review' | 'published';
    royaltyRate?: number;
    installed?: boolean;
  };

  // Analytics types mirrored locally — Parameters<typeof X> breaks on
  // dynamic-imported components.
  type PersonalStats = {
    totalCitations: number;
    totalRoyalties: number;
    mostCitedDTU: { name: string; citations: number };
    mostUsedMaterial: { name: string; uses: number };
    reputationByDomain: Record<string, number>;
    buildCount: number;
    playtime: number;
    loginStreak: number;
  };
  type WorldStats = {
    worldId: string;
    population: number;
    buildingCount: number;
    infraCoverage: number;
    envScore: number;
    economicActivity: number;
    visitorCount: number;
    timeseries?: { date: string; visitors: number; buildings: number }[];
  };
  type GlobalStats = {
    activeDistricts: number;
    totalBuildings: number;
    totalCitations: number;
    activeUsers: number;
    totalWorlds: number;
    trendingComponents: { name: string; creator: string; citationsThisWeek: number }[];
    topCreators: { userId: string; name: string; citations: number; rank: number }[];
  };
  type AnalyticsResp = {
    ok: boolean;
    personalStats?: PersonalStats;
    worldStats?: WorldStats | null;
    globalStats?: GlobalStats;
  };
  const analyticsQ = useQuery({
    queryKey: ['system-analytics'],
    queryFn: async () => {
      try {
        const r = await fetch('/api/analytics', { credentials: 'same-origin' });
        if (!r.ok) return null;
        return (await r.json()) as AnalyticsResp;
      } catch {
        return null;
      }
    },
  });

  const pluginsQ = useQuery({
    queryKey: ['system-plugins'],
    queryFn: async () => {
      try {
        const r = await fetch('/api/plugins', { credentials: 'same-origin' });
        if (!r.ok) return { installed: [] as FrontendInstalled[], marketplace: [] as FrontendMarketplace[] };
        const j = (await r.json()) as { plugins?: LoaderPlugin[] };
        const all = j.plugins ?? [];
        const VALID_CATS: ReadonlySet<PluginCategory> = new Set(['Science','Engineering','Economics','Social','Entertainment','Education']);
        const normalizeCat = (raw?: string): PluginCategory => {
          if (!raw) return 'Engineering';
          const titled = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
          return (VALID_CATS.has(titled as PluginCategory) ? titled : 'Engineering') as PluginCategory;
        };
        const installed: FrontendInstalled[] = all
          .filter((p) => p.status === 'active' || p.status === 'enabled')
          .map((p) => ({
            id: p.id,
            name: p.name,
            creator: p.creator ?? 'unknown',
            category: normalizeCat(p.category),
            version: p.version ?? '1.0.0',
          }));
        const VALID_STATUS = new Set<FrontendMarketplace['status']>(['draft','in review','published']);
        const normalizeStatus = (raw?: string): FrontendMarketplace['status'] => {
          if (raw && VALID_STATUS.has(raw as FrontendMarketplace['status'])) {
            return raw as FrontendMarketplace['status'];
          }
          return 'draft';
        };
        const marketplace: FrontendMarketplace[] = all
          .filter((p) => p.status !== 'active' && p.status !== 'enabled')
          .map((p) => ({
            id: p.id,
            name: p.name,
            creator: p.creator ?? 'unknown',
            description: p.description ?? '',
            category: normalizeCat(p.category),
            citations: p.citations ?? 0,
            downloads: p.downloads ?? 0,
            rating: p.rating ?? 0,
            status: normalizeStatus(p.status),
          }));
        return { installed, marketplace };
      } catch {
        return { installed: [] as FrontendInstalled[], marketplace: [] as FrontendMarketplace[] };
      }
    },
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['system-cartograph', refreshKey],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('system', 'cartograph', {});
      const payload = (r.data?.result ?? r.data) as { ok: boolean; systems?: SystemsReport; reason?: string };
      if (!payload?.ok) throw new Error(payload?.reason ?? 'cartograph_unavailable');
      return payload.systems as SystemsReport;
    },
    refetchInterval: 60_000,
    retry: 0,
  });

  const heartbeats = useMemo(() => {
    if (!data) return [];
    const src = data.runtime.booted && data.runtime.heartbeats?.length
      ? data.runtime.heartbeats
      : (data.static.heartbeatCallsites ?? []);
    return [...src].sort((a, b) => a.frequency - b.frequency);
  }, [data]);

  const filteredCoverage = useMemo(() => {
    if (!data) return [];
    return data.coverage.filter(c => {
      if (c.scope !== 'in') return false;
      if (coverageFilter !== 'all' && c.status !== coverageFilter) return false;
      return true;
    });
  }, [data, coverageFilter]);

  const handleRefresh = () => {
    setRefreshKey(k => k + 1);
    setTimeout(() => refetch(), 100);
  };

  // ── Loading state ──────────────────────────────────────────────────────
  if (isLoading && !data) {
    return (
      <div
        data-testid="system-overview-loading"
        role="status"
        aria-busy="true"
        className="flex h-screen items-center justify-center bg-black text-cyan-400"
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
        >
          <Loader2 className="h-8 w-8" aria-label="Loading cartographer data" />
        </motion.div>
        <span className="ml-3 font-mono text-sm">Reading SYSTEMS.json…</span>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────
  if (isError || !data) {
    const reason = (error as Error)?.message ?? 'cartograph_unavailable';
    const isStale = reason === 'cartograph_not_run';
    return (
      <div className="flex h-screen items-center justify-center bg-black px-6">
        <motion.div
          data-testid="system-overview-error"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-lg rounded-lg border border-yellow-500/40 bg-yellow-950/20 p-6 text-yellow-200"
          role="alert"
        >
          <AlertTriangle className="mb-3 h-6 w-6" aria-hidden />
          <h2 className="mb-2 text-lg font-semibold">
            {isStale ? 'Cartographer not yet run' : 'Cartograph unavailable'}
          </h2>
          <p className="mb-4 text-sm text-yellow-300/80">
            {isStale
              ? 'Run npm run cartograph:static from the server directory to generate audit/cartograph/SYSTEMS.json. The System Lens reads from that file.'
              : `Reason: ${reason}`}
          </p>
          <button
            onClick={handleRefresh}
            className="inline-flex items-center gap-2 rounded border border-yellow-500/50 bg-yellow-500/10 px-3 py-1.5 text-sm font-medium hover:bg-yellow-500/20 focus:outline-none focus:ring-2 focus:ring-yellow-400"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry
          </button>
        </motion.div>
      </div>
    );
  }

  const coveragePct = data.stats.coverageInScope
    ? Math.round((data.stats.coveragePresent / data.stats.coverageInScope) * 100)
    : 0;

  return (
    <LensShell lensId="system" asMain={false}>
      <FirstRunTour lensId="system" />
      <ManifestActionBar />
      <DepthBadge lensId="system" size="sm" className="ml-2" />
    <div className="min-h-screen bg-black pb-12 text-cyan-50">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-cyan-900/50 bg-black/95 px-4 py-3 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Activity className="h-6 w-6 text-cyan-400" aria-hidden />
            <div>
              <h1 className="font-mono text-lg font-semibold tracking-wide">System Lens</h1>
              <p className="text-xs text-cyan-700">Cognitive OS internals · cartographer ground truth</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-cyan-700" title={data.generatedAt}>
              Last cartograph: {new Date(data.generatedAt).toLocaleTimeString()}
            </span>
            <button
              onClick={() => setLive((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-cyan-400 ${
                live
                  ? 'border-emerald-700/50 bg-emerald-900/20 text-emerald-300'
                  : 'border-cyan-800/50 bg-cyan-950/30 text-cyan-600'
              }`}
              aria-label={live ? 'Pause live polling' : 'Resume live polling'}
              aria-pressed={live}
            >
              {live ? <Pause className="h-3 w-3" aria-hidden /> : <Play className="h-3 w-3" aria-hidden />}
              {live ? 'Live' : 'Paused'}
            </button>
            <button
              onClick={handleRefresh}
              className="inline-flex items-center gap-2 rounded border border-cyan-700/50 bg-cyan-900/20 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-800/40 focus:outline-none focus:ring-2 focus:ring-cyan-400"
              aria-label="Refresh cartographer data"
            >
              <RefreshCw className="h-3 w-3" aria-hidden /> Refresh
            </button>
          </div>
        </div>
        {liveStatus && (
          <div className="mx-auto mt-2 flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-cyan-600">
            <span>CPU <span className="text-cyan-300">{liveStatus.sample.cpuPct}%</span></span>
            <span>Heap <span className="text-cyan-300">{liveStatus.sample.heapUsedMB}MB ({liveStatus.sample.heapPct}%)</span></span>
            <span>RSS <span className="text-cyan-300">{liveStatus.sample.rssMB}MB</span></span>
            <span>Req <span className="text-cyan-300">{liveStatus.sample.requestRate}/s</span></span>
            <span>HB <span className={liveStatus.heartbeats.unhealthy > 0 ? 'text-yellow-400' : 'text-emerald-400'}>{liveStatus.heartbeats.ok}/{liveStatus.heartbeats.total}</span></span>
            <span>Alerts <span className={liveStatus.alerts.firing > 0 ? 'text-rose-400' : 'text-emerald-400'}>{liveStatus.alerts.firing} firing</span></span>
            <span className="ml-auto">poll {new Date(liveStatus.pollAt).toLocaleTimeString()}</span>
          </div>
        )}
      </header>

      {/* Tabs */}
      <nav className="border-b border-cyan-900/30 px-4 md:px-8" aria-label="System Lens sections">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto">
          {([
            { key: 'overview', label: 'Overview', icon: Activity as LucideIcon },
            { key: 'metrics', label: 'Metrics', icon: LineChart as LucideIcon },
            { key: 'alerts', label: liveStatus ? `Alerts (${liveStatus.alerts.firing})` : 'Alerts', icon: Bell as LucideIcon },
            { key: 'logs', label: 'Logs', icon: ScrollText as LucideIcon },
            { key: 'hbhealth', label: liveStatus ? `HB Health (${liveStatus.heartbeats.ok}/${liveStatus.heartbeats.total})` : 'HB Health', icon: Heart as LucideIcon },
            { key: 'traces', label: 'Traces', icon: Gauge as LucideIcon },
            { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard as LucideIcon },
            { key: 'trend', label: 'Trend', icon: TrendingUp as LucideIcon },
            { key: 'heartbeats', label: `Heartbeats (${heartbeats.length})`, icon: Heart as LucideIcon },
            { key: 'gaps', label: `Gaps (${data.crossRef.dormantModules.length + data.crossRef.headlessBackends.length})`, icon: AlertTriangle as LucideIcon },
            { key: 'coverage', label: `Coverage (${coveragePct}%)`, icon: MapIcon as LucideIcon },
            { key: 'drift', label: `Drift (${data.drift.length})`, icon: GitBranch as LucideIcon },
            { key: 'analytics', label: 'Analytics', icon: BarChart3 as LucideIcon },
            { key: 'plugins', label: 'Plugins', icon: Puzzle as LucideIcon },
            { key: 'substrate', label: 'Substrate', icon: Layers as LucideIcon },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 ${
                activeTab === key
                  ? 'border-cyan-400 text-cyan-200'
                  : 'border-transparent text-cyan-700 hover:text-cyan-400'
              }`}
              aria-pressed={activeTab === key}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.section
              key="overview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              aria-labelledby="overview-heading"
            >
              <h2 id="overview-heading" className="sr-only">Overview</h2>
              {data.stats.tableCount === 0
                && data.stats.routeCount === 0
                && data.stats.macroCount === 0
                && data.stats.lensCount === 0 ? (
                <div
                  data-testid="system-overview-empty"
                  className="rounded-lg border border-cyan-900/30 bg-cyan-950/10 px-4 py-10 text-center text-sm text-cyan-600"
                >
                  No cartograph data yet. Run <code className="text-cyan-400">npm run cartograph:static</code> to inventory the monolith.
                </div>
              ) : (
              <>
              <div data-testid="system-overview-grid" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                <StatCard label="Tables" value={data.stats.tableCount} sub={`${data.stats.deadTableCount} dead`} icon={Database} />
                <StatCard label="Routes" value={data.stats.routeCount} icon={Globe} />
                <StatCard label="Macros" value={data.stats.macroCount} sub={`${data.stats.macroDomainCount} domains`} icon={Zap} />
                <StatCard label="Heartbeats" value={data.stats.heartbeatCount} icon={Heart} />
                <StatCard label="Lenses" value={data.stats.lensCount} icon={BookOpen} />
                <StatCard label="Modules" value={data.stats.moduleCount} icon={Layers} />
                <StatCard label="Dormant" value={data.stats.dormantModuleCount} sub="modules without heartbeat or macros" icon={AlertTriangle} tone={data.stats.dormantModuleCount > 0 ? 'warn' : 'ok'} />
                <StatCard label="Coverage" value={`${coveragePct}%`} sub={`${data.stats.coveragePresent}/${data.stats.coverageInScope} categories`} icon={CheckCircle2} tone={coveragePct >= 90 ? 'ok' : coveragePct >= 70 ? 'warn' : 'bad'} />
              </div>

              <div className="mt-6 rounded-lg border border-cyan-900/40 bg-cyan-950/10 p-4">
                <h3 className="mb-2 text-sm font-semibold text-cyan-300">Cartographer status</h3>
                <dl className="grid grid-cols-1 gap-1 text-xs text-cyan-500 md:grid-cols-2">
                  <div><dt className="inline text-cyan-700">Runtime introspect:</dt> <dd className="inline">{data.runtime.booted ? <span className="text-emerald-400">booted</span> : <span className="text-yellow-400">{data.runtime.reason ?? 'static-only'}</span>}</dd></div>
                  <div><dt className="inline text-cyan-700">Headless backends:</dt> <dd className="inline">{data.crossRef.headlessBackends.length}</dd></div>
                  <div><dt className="inline text-cyan-700">Orphan lenses:</dt> <dd className="inline">{data.crossRef.orphanLenses.length}</dd></div>
                  <div><dt className="inline text-cyan-700">Drift entries:</dt> <dd className="inline">{data.drift.length}</dd></div>
                </dl>
              </div>
              </>
              )}
            </motion.section>
          )}

          {activeTab === 'metrics' && (
            <motion.section
              key="metrics"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              aria-labelledby="metrics-heading"
            >
              <h2 id="metrics-heading" className="mb-1 text-base font-semibold text-cyan-200">Live process metrics</h2>
              <p className="mb-3 text-xs text-cyan-700">
                Real process.memoryUsage()/cpuUsage() time-series — CPU, heap, RSS, and request rate sampled every 15s.
              </p>
              <MetricsPanel live={live} />
            </motion.section>
          )}

          {activeTab === 'alerts' && (
            <motion.section
              key="alerts"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              aria-labelledby="alerts-heading"
            >
              <h2 id="alerts-heading" className="mb-1 text-base font-semibold text-cyan-200">Prometheus alert rules</h2>
              <p className="mb-3 text-xs text-cyan-700">
                Rules from monitoring/prometheus/alerts.yml, evaluated against the live sample. Acknowledge fired alerts.
              </p>
              <AlertsPanel live={live} />
            </motion.section>
          )}

          {activeTab === 'logs' && (
            <motion.section
              key="logs"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              aria-labelledby="logs-heading"
            >
              <h2 id="logs-heading" className="mb-1 text-base font-semibold text-cyan-200">Server log viewer</h2>
              <p className="mb-3 text-xs text-cyan-700">
                Search + filter over the in-process logger ring buffer by level, source, and free text.
              </p>
              <LogViewer live={live} />
            </motion.section>
          )}

          {activeTab === 'hbhealth' && (
            <motion.section
              key="hbhealth"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              aria-labelledby="hbhealth-heading"
            >
              <h2 id="hbhealth-heading" className="mb-1 text-base font-semibold text-cyan-200">Per-heartbeat health</h2>
              <p className="mb-3 text-xs text-cyan-700">
                Last-run age, run / error / skipped-tick counters and a derived verdict per heartbeat module.
              </p>
              <HeartbeatHealthPanel live={live} />
            </motion.section>
          )}

          {activeTab === 'traces' && (
            <motion.section
              key="traces"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              aria-labelledby="traces-heading"
            >
              <h2 id="traces-heading" className="mb-1 text-base font-semibold text-cyan-200">Request traces & latency</h2>
              <p className="mb-3 text-xs text-cyan-700">
                Distributed-trace spans with p50/p95/p99 latency percentiles and per-route rollup.
              </p>
              <TracesPanel live={live} />
            </motion.section>
          )}

          {activeTab === 'dashboard' && (
            <motion.section
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              aria-labelledby="dashboard-heading"
            >
              <h2 id="dashboard-heading" className="mb-1 text-base font-semibold text-cyan-200">Customizable dashboard</h2>
              <p className="mb-3 text-xs text-cyan-700">
                Build your own observability panel grid. Layout persists per-user.
              </p>
              <CustomDashboard live={live} />
            </motion.section>
          )}

          {activeTab === 'trend' && (
            <motion.section
              key="trend"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              aria-labelledby="trend-heading"
            >
              <h2 id="trend-heading" className="mb-1 text-base font-semibold text-cyan-200">Coverage & drift trend</h2>
              <p className="mb-3 text-xs text-cyan-700">
                Historical trajectory of coverage / drift / dormant-module counts, not just the current snapshot.
              </p>
              <TrendPanel />
            </motion.section>
          )}

          {activeTab === 'heartbeats' && (
            <motion.section
              key="heartbeats"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              aria-labelledby="heartbeats-heading"
            >
              <h2 id="heartbeats-heading" className="mb-3 text-base font-semibold text-cyan-200">
                Heartbeat-registered modules
              </h2>
              {heartbeats.length === 0 ? (
                <EmptyHint text="No heartbeats found. Cartographer may need a fresh run." />
              ) : (
                <div className="overflow-x-auto rounded-lg border border-cyan-900/40">
                  <table className="w-full font-mono text-xs">
                    <thead className="bg-cyan-950/40 text-cyan-400">
                      <tr>
                        <th className="px-3 py-2 text-left">ID</th>
                        <th className="px-3 py-2 text-right">Frequency</th>
                        <th className="px-3 py-2 text-right">Approx interval</th>
                      </tr>
                    </thead>
                    <tbody>
                      {heartbeats.map(hb => (
                        <tr key={hb.id} className="border-t border-cyan-900/20 hover:bg-cyan-950/20">
                          <td className="px-3 py-2 text-cyan-200">{hb.id}</td>
                          <td className="px-3 py-2 text-right text-cyan-500">{hb.frequency}</td>
                          <td className="px-3 py-2 text-right text-cyan-700">{intervalLabel(hb.frequency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.section>
          )}

          {activeTab === 'gaps' && (
            <motion.section
              key="gaps"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <h2 className="mb-3 text-base font-semibold text-cyan-200">Wire-the-Lost candidates</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <GapCard
                  title="Dormant modules"
                  count={data.crossRef.dormantModules.length}
                  rows={data.crossRef.dormantModules.slice(0, 20).map(m => ({ key: m.id, primary: m.id, secondary: `${m.subsystem ?? '-'} · importedBy ${m.importedBy}` }))}
                />
                <GapCard
                  title="Headless backend domains"
                  count={data.crossRef.headlessBackends.length}
                  rows={data.crossRef.headlessBackends.slice(0, 20).map(h => ({ key: h.domain, primary: h.domain, secondary: `${h.macroCount} macros — needs UI lens` }))}
                />
                <GapCard
                  title="Orphan lens dirs"
                  count={data.crossRef.orphanLenses.length}
                  rows={data.crossRef.orphanLenses.slice(0, 20).map(o => ({ key: o.frontendDir, primary: o.frontendDir, secondary: o.reason }))}
                />
                <GapCard
                  title="Dead tables"
                  count={data.crossRef.deadTables.length}
                  rows={data.crossRef.deadTables.slice(0, 20).map(d => ({ key: d.name, primary: d.name, secondary: d.migration }))}
                />
              </div>
            </motion.section>
          )}

          {activeTab === 'coverage' && (
            <motion.section
              key="coverage"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-cyan-200">Software-universe coverage</h2>
                <div className="flex gap-1 rounded border border-cyan-900/40 bg-cyan-950/20 p-0.5 text-xs">
                  {(['all', 'present', 'partial', 'missing'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setCoverageFilter(f)}
                      className={`rounded px-2 py-1 ${coverageFilter === f ? 'bg-cyan-700/30 text-cyan-200' : 'text-cyan-600 hover:text-cyan-400'}`}
                      aria-pressed={coverageFilter === f}
                    >{f}</button>
                  ))}
                </div>
              </div>
              {filteredCoverage.length === 0 ? (
                <EmptyHint text="No categories match the current filter." />
              ) : (
                <ul className="space-y-1.5">
                  {filteredCoverage.map(c => (
                    <li key={c.category} className="flex items-center gap-3 rounded border border-cyan-900/30 bg-cyan-950/10 px-3 py-2 text-sm">
                      <CoverageBadge status={c.status} />
                      <span className="font-mono text-cyan-200">{c.category}</span>
                      {c.priority != null && <span className="rounded bg-cyan-700/20 px-1.5 py-0.5 text-[10px] font-medium text-cyan-300">P{c.priority}</span>}
                      <span className="ml-auto text-xs text-cyan-600">
                        {c.proposedTargetLens ?? '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </motion.section>
          )}

          {activeTab === 'drift' && (
            <motion.section
              key="drift"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <h2 className="mb-3 text-base font-semibold text-cyan-200">Comment-vs-truth drift</h2>
              {data.drift.length === 0 ? (
                <EmptyHint text="✓ No comment drifts detected. Documentation matches reality." />
              ) : (
                <div className="overflow-x-auto rounded-lg border border-yellow-700/40">
                  <table className="w-full font-mono text-xs">
                    <thead className="bg-yellow-950/30 text-yellow-300">
                      <tr>
                        <th className="px-3 py-2 text-left">File</th>
                        <th className="px-3 py-2 text-right">Line</th>
                        <th className="px-3 py-2 text-left">Claim</th>
                        <th className="px-3 py-2 text-right">Actual</th>
                        <th className="px-3 py-2 text-right">Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.drift.map((d, i) => (
                        <tr key={`${d.file}:${d.line}:${i}`} className="border-t border-yellow-900/20 hover:bg-yellow-950/15">
                          <td className="px-3 py-2 text-cyan-300">{d.file}</td>
                          <td className="px-3 py-2 text-right text-cyan-600">{d.line}</td>
                          <td className="px-3 py-2 text-yellow-400">{d.claim}</td>
                          <td className="px-3 py-2 text-right text-emerald-400">{d.actual}</td>
                          <td className="px-3 py-2 text-right font-semibold">
                            <span className={d.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                              {d.delta > 0 ? '+' : ''}{d.delta}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.section>
          )}
          {activeTab === 'analytics' && (
            <motion.section
              key="analytics"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <h2 className="mb-3 text-base font-semibold text-cyan-200">Personal · World · Global activity</h2>
              <p className="mb-3 text-xs text-cyan-700">
                Distinct from cartograph stats above (system structure). This is per-player + per-world + global activity from /api/analytics.
              </p>
              <AnalyticsDashboard
                personalStats={analyticsQ.data?.personalStats}
                worldStats={analyticsQ.data?.worldStats ?? undefined}
                globalStats={analyticsQ.data?.globalStats}
              />
            </motion.section>
          )}
          {activeTab === 'plugins' && (
            <motion.section
              key="plugins"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <h2 className="mb-3 text-base font-semibold text-cyan-200">Lens plugin marketplace</h2>
              <p className="mb-3 text-xs text-cyan-700">
                Browse + install + create lens plugins. Backed by /api/plugins (developer-sdk loader).
              </p>
              <LensPluginSystem
                installedPlugins={pluginsQ.data?.installed ?? []}
                marketplace={pluginsQ.data?.marketplace ?? []}
                activeWidgets={[]}
              />
            </motion.section>
          )}
          {activeTab === 'substrate' && (
            <motion.section
              key="substrate"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              aria-labelledby="substrate-heading"
            >
              <h2 id="substrate-heading" className="mb-1 text-base font-semibold text-cyan-200">
                Substrate operations
              </h2>
              <p className="mb-4 text-xs text-cyan-700">
                Live diagnostics for each substrate-class macro domain. Each card calls
                its primary macro on mount and renders the result with a domain-specific
                accent. Errors here surface as dormant or misconfigured backends.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {probesByGroup('substrate').map((p) => (
                  <DomainProbeCard key={`${p.domain}.${p.macro}`} probe={p} />
                ))}
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <SystemHealthPanel />
      </section>
    </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
          <RecentMineCard domain="system" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="system" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="system" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

// ── Small helpers ────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, tone = 'ok' }: {
  label: string;
  value: number | string;
  sub?: string;
  icon: LucideIcon;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  const toneCls = tone === 'bad' ? 'border-rose-700/40 text-rose-200'
                : tone === 'warn' ? 'border-yellow-700/40 text-yellow-200'
                : 'border-cyan-900/40 text-cyan-200';
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18 }}
      className={`rounded-lg border bg-cyan-950/10 p-3 ${toneCls}`}
      title={sub}
    >
      <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wider text-cyan-700">
        <span>{label}</span>
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </div>
      <div className="font-mono text-xl font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-cyan-700">{sub}</div>}
    </motion.div>
  );
}

function GapCard({ title, count, rows }: {
  title: string;
  count: number;
  rows: { key: string; primary: string; secondary: string }[];
}) {
  return (
    <div className="rounded-lg border border-cyan-900/40 bg-cyan-950/10">
      <div className="flex items-center justify-between border-b border-cyan-900/30 px-3 py-2">
        <h3 className="text-sm font-semibold text-cyan-300">{title}</h3>
        <span className="rounded bg-cyan-800/30 px-2 py-0.5 text-xs font-mono text-cyan-300">{count}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-xs text-cyan-600">None.</p>
      ) : (
        <ul className="max-h-72 overflow-y-auto divide-y divide-cyan-900/20 text-xs">
          {rows.map(r => (
            <li key={r.key} className="px-3 py-1.5">
              <div className="font-mono text-cyan-200">{r.primary}</div>
              <div className="text-[10px] text-cyan-700">{r.secondary}</div>
            </li>
          ))}
          {rows.length >= 20 && <li className="px-3 py-1.5 text-[10px] text-cyan-600">…showing first 20</li>}
        </ul>
      )}
    </div>
  );
}

function CoverageBadge({ status }: { status: 'present' | 'partial' | 'missing' }) {
  if (status === 'present') return <span className="inline-flex items-center gap-1 rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] text-emerald-300"><CheckCircle2 className="h-2.5 w-2.5" aria-hidden />present</span>;
  if (status === 'partial') return <span className="inline-flex items-center gap-1 rounded bg-yellow-900/40 px-1.5 py-0.5 text-[10px] text-yellow-300"><AlertTriangle className="h-2.5 w-2.5" aria-hidden />partial</span>;
  return <span className="inline-flex items-center gap-1 rounded bg-rose-900/40 px-1.5 py-0.5 text-[10px] text-rose-300"><XCircle className="h-2.5 w-2.5" aria-hidden />missing</span>;
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-cyan-900/30 bg-cyan-950/10 px-4 py-6 text-center text-sm text-cyan-600">
      {text}
    </div>
  );
}

function intervalLabel(frequency: number): string {
  const sec = frequency * 15;
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${(sec / 60).toFixed(1)}min`;
  return `${(sec / 3600).toFixed(1)}h`;
}
