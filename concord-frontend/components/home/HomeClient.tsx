'use client';

/**
 * HomeClient — Client-side home page logic
 *
 * Takes over from the SSR landing content once JS hydrates.
 * Hides the SSR content and shows either:
 *   - LandingPage (interactive) for new visitors
 *   - DashboardPage for returning users
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api, apiHelpers } from '@/lib/api/client';
import dynamic from 'next/dynamic';
const KnowledgeSpace3D = dynamic(
  () =>
    import('@/components/graphs/KnowledgeSpace3DCanvas').then((mod) => ({
      default: mod.KnowledgeSpace3D,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="h-full flex items-center justify-center text-gray-500 text-sm">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          Loading 3D lattice...
        </div>
      </div>
    ),
  }
);
import { ResonanceEmpireGraph } from '@/components/graphs/ResonanceEmpireGraph';
import { DTUEmpireCard } from '@/components/dtu/DTUEmpireCard';
import { LockDashboard } from '@/components/sovereignty/LockDashboard';
import { CoherenceBadge } from '@/components/graphs/CoherenceBadge';
import { LensErrorBoundary } from '@/components/common/LensErrorBoundary';
import { LandingPage } from '@/components/landing/LandingPage';
import { EmergentPanel } from '@/components/emergent/EmergentPanel';
import { GovernanceFeed } from '@/components/emergent/GovernanceFeed';
import { LiveDTUFeed } from '@/components/live/LiveDTUFeed';
import { ScopeIndicator } from '@/components/live/ScopeIndicator';
import { InspectorDrawer } from '@/components/guidance/InspectorDrawer';
import { useUIStore } from '@/store/ui';
import { CORE_LENSES } from '@/lib/lens-registry';
import {
  Activity,
  Zap,
  Compass,
  TrendingUp,
  Heart,
  Globe,
  MessageSquare,
  Layout,
  Share2,
  Code,
  Music,
  Crown,
  Ghost,
  Archive,
  Layers,
  Moon,
} from 'lucide-react';
import { use70Lock } from '@/hooks/use70Lock';
import { MorningBrief } from '@/components/brief/MorningBrief';
import { ContextResurrection } from '@/components/common/ContextResurrection';
import { SubstrateDreams } from '@/components/dreams/SubstrateDreams';
import { MetabolismPanel } from '@/components/metabolism/MetabolismPanel';
import { EpisodicMemory } from '@/components/memory/EpisodicMemory';
import { BrainCouncil } from '@/components/council/BrainCouncil';
import { AgentPersonas } from '@/components/agents/AgentPersonas';
import { TaskDelegation } from '@/components/tasks/TaskDelegation';
import { KnowledgeGardens } from '@/components/gardens/KnowledgeGardens';
import { BountiesAndFutures } from '@/components/economy/BountiesAndFutures';
import { SubstrateWeather } from '@/components/weather/SubstrateWeather';
import { CognitiveDigitalTwin } from '@/components/twin/CognitiveDigitalTwin';
import { SwarmIntelligence } from '@/components/swarm/SwarmIntelligence';
import { TimeCrystals } from '@/components/temporal/TimeCrystals';
import { NervousSystem } from '@/components/nervous/NervousSystem';
import { UniversalImport } from '@/components/import/UniversalImport';
import { TrendingDomains } from '@/components/social/TrendingDomains';

const ENTERED_KEY = 'concord_entered';

function HomeClient() {
  const [hasEntered, setHasEntered] = useState<boolean | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const setFullPageMode = useUIStore((state) => state.setFullPageMode);
  const authCheckRef = useRef(false);

  useEffect(() => {
    // Hide SSR landing content once client takes over
    const ssrEl = document.getElementById('ssr-landing');
    if (ssrEl) ssrEl.style.display = 'none';

    const entered = localStorage.getItem(ENTERED_KEY);
    const isEntered = entered === 'true';
    setHasEntered(isEntered);
    setFullPageMode(!isEntered);

    // If user has entered before, verify they're still authenticated
    if (isEntered && !authCheckRef.current) {
      authCheckRef.current = true;

      // Race auth check against a timeout to prevent infinite loading
      const timeout = new Promise<'timeout'>((resolve) =>
        setTimeout(() => resolve('timeout'), 10_000)
      );

      const authCheck = api
        .get('/api/auth/me')
        .then(async () => {
          // Auth succeeded — eagerly fetch CSRF token for subsequent writes
          await api.get('/api/auth/csrf-token').catch(() => {});
          return 'ok' as const;
        })
        .catch(() => {
          return 'failed' as const;
        });

      Promise.race([authCheck, timeout]).then((result) => {
        if (result === 'failed') {
          // Don't redirect if user literally just logged in (race condition window)
          const loginTs = Number(localStorage.getItem('concord_login_ts') || '0');
          if (Date.now() - loginTs < 5000) {
            // Within 5s of login — retry once before giving up
            api
              .get('/api/auth/me')
              .then(() => {
                setAuthChecked(true);
              })
              .catch(() => {
                try {
                  localStorage.removeItem('concord_entered');
                } catch {}
                try {
                  localStorage.removeItem('concord_login_ts');
                } catch {}
                window.location.href = '/login';
              });
            return;
          }
          // Not authenticated — redirect to login
          try {
            localStorage.removeItem('concord_entered');
          } catch {}
          window.location.href = '/login';
          return;
        }
        if (result === 'timeout') {
          // Auth check hung — allow through so the page isn't stuck forever.
          // API calls will still get 401-redirected if session is truly dead.
          console.warn('[HomeClient] Auth check timed out after 10s');
        }
        setAuthChecked(true);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEnter = () => {
    localStorage.setItem('concord_entered', 'true');
    setHasEntered(true);
  };

  // Still loading from localStorage
  if (hasEntered === null) {
    return null; // SSR content is visible until we know
  }

  // Show landing page for new visitors
  if (!hasEntered) {
    return <LandingPage onEnter={handleEnter} />;
  }

  // Wait for auth check before rendering dashboard
  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400 animate-pulse">Loading...</div>
      </div>
    );
  }

  // Show dashboard for authenticated returning users
  return <DashboardPage />;
}

// ============================================================================
// Dashboard Page
// ============================================================================

function DreamForgettingIndicators() {
  const { data: dreamData } = useQuery({
    queryKey: ['dream-topics'],
    queryFn: () =>
      api
        .get('/api/dream/history', { params: { limit: 5 } })
        .then((r) => r.data)
        .catch(() => null),
    refetchInterval: 60000,
    retry: false,
  });
  const { data: forgettingData } = useQuery({
    queryKey: ['forgetting-status-home'],
    queryFn: () =>
      api
        .get('/api/admin/forgetting/status')
        .then((r) => r.data)
        .catch(() => null),
    refetchInterval: 60000,
    retry: false,
  });

  const dreams = (dreamData?.dreams || []) as Array<{ title?: string; tags?: string[] }>;
  const dreamTopics = dreams
    .slice(0, 3)
    .map((d) => d.title || d.tags?.[0] || 'unknown')
    .filter(Boolean);
  const forgottenCount = forgettingData?.lifetimeForgotten || 0;
  const threshold = forgettingData?.threshold || 0;

  if (!dreamTopics.length && !forgottenCount) return null;

  return (
    <div className="flex flex-wrap gap-3">
      {dreamTopics.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
          <Moon className="w-4 h-4 text-indigo-400" />
          <span className="text-xs text-indigo-300">
            Concord dreamed about: {dreamTopics.join(', ')}
          </span>
        </div>
      )}
      {forgottenCount > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
          <Archive className="w-4 h-4 text-red-400" />
          <span className="text-xs text-red-300">
            {forgottenCount} DTUs archived (low salience, threshold: {threshold})
          </span>
        </div>
      )}
    </div>
  );
}

function DashboardPage() {
  const [inspecting, setInspecting] = useState<{ type: string; id: string } | null>(null);
  const { lockPercentage, isLoading: sovereigntyLoading } = use70Lock();

  // All queries are resilient — each catches errors independently so one failure
  // doesn't crash the dashboard. Each section renders a fallback on error.
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['status'],
    queryFn: () =>
      api
        .get('/api/status')
        .then((r) => r.data)
        .catch(() => null),
    retry: 1,
  });

  const {
    data: dtusData,
    isLoading: dtusLoading,
    isError: dtusError,
  } = useQuery({
    queryKey: ['dtus-paginated'],
    queryFn: () => apiHelpers.dtus.paginated({ limit: 50, pageSize: 50 }).then((r) => r.data),
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });

  const { data: scopeMetrics } = useQuery({
    queryKey: ['scope-metrics'],
    queryFn: () =>
      apiHelpers.scope
        .metrics()
        .then((r) => r.data)
        .catch(() => null),
    refetchInterval: 30000,
    retry: false,
  });

  const { data: eventsData } = useQuery({
    queryKey: ['events'],
    queryFn: () =>
      api
        .get('/api/events')
        .then((r) => r.data)
        .catch(() => ({ events: [] })),
    retry: false,
  });

  const { data: resonanceData } = useQuery({
    queryKey: ['resonance-quick'],
    queryFn: () =>
      api
        .get('/api/lattice/resonance')
        .then((r) => r.data)
        .catch(() => null),
    refetchInterval: 30000,
    retry: false,
  });

  const { data: healthData } = useQuery({
    queryKey: ['system-health'],
    queryFn: () =>
      api
        .get('/api/system/health')
        .then((r) => r.data)
        .catch(() => null),
    refetchInterval: 60000,
    retry: false,
  });

  const { data: guidanceData } = useQuery({
    queryKey: ['guidance-suggestions'],
    queryFn: () =>
      api
        .get('/api/guidance/suggestions')
        .then((r) => r.data)
        .catch(() => null),
    retry: false,
  });

  // DTU tier stats (Feature 10)
  const { data: dtuStats, isLoading: dtuStatsLoading } = useQuery({
    queryKey: ['dtu-tier-stats'],
    queryFn: () =>
      apiHelpers.dtus
        .stats()
        .then((r) => r.data)
        .catch(() => null),
    refetchInterval: 30_000,
    retry: 1,
    staleTime: 15_000,
  });

  // Fetch graph force-directed data for the Resonance Universe
  const { data: rawGraphData, isLoading: graphLoading } = useQuery({
    queryKey: ['graph-force'],
    queryFn: () =>
      apiHelpers.graph
        .force({ maxNodes: 200 })
        .then((r) => r.data)
        .catch(() => null),
    retry: 1,
    staleTime: 30000,
  });

  // Also fetch graph visual data as fallback (uses /api/graph/visual)
  const { data: rawGraphVisualData } = useQuery({
    queryKey: ['graph-visual-home'],
    queryFn: () =>
      apiHelpers.graph
        .visual({ limit: 200 })
        .then((r) => r.data)
        .catch(() => null),
    retry: 1,
    staleTime: 30000,
    enabled: !rawGraphData?.nodes?.length,
  });

  // Normalize graph data: map 'title' -> 'label', 'links' -> 'edges', assign tier colors
  const graphData = useMemo(() => {
    const source = rawGraphData?.nodes?.length ? rawGraphData : rawGraphVisualData;
    if (!source?.nodes?.length) return null;
    const nodes = source.nodes.map((n: Record<string, unknown>) => ({
      id: n.id as string,
      label: (n.label || n.title || (n.id as string)?.slice(0, 20) || 'Untitled') as string,
      tier: (n.tier || 'regular') as string,
      resonance: (n.resonance ?? n.lineageDepth ?? 0) as number,
      scope: (n.scope || n.domain) as string | undefined,
      source: n.source as string | undefined,
    }));
    // Normalize edges: force endpoint returns 'links', visual returns 'edges'
    const rawEdges = source.edges || source.links || [];
    const edges = rawEdges.map((e: Record<string, unknown>) => ({
      source: (e.source || e.sourceId) as string,
      target: (e.target || e.targetId) as string,
      weight: (e.weight ?? 1) as number,
    }));
    return { nodes, edges };
  }, [rawGraphData, rawGraphVisualData]);

  // Normalize DTU data to handle field name variations from backend
  const rawDtus = dtusData?.dtus || dtusData?.results || [];
  const dtus = (rawDtus as Record<string, unknown>[]).map((d: Record<string, unknown>) => ({
    id: d.id as string,
    tier: ((d.tier as string) || 'regular') as 'regular' | 'mega' | 'hyper' | 'shadow',
    summary: (d.summary ||
      d.title ||
      (d.human as Record<string, unknown>)?.summary ||
      d.content ||
      'Untitled') as string,
    timestamp: (d.timestamp || d.createdAt || d.created_at || new Date().toISOString()) as string,
    resonance: (d.resonance ?? (d.machine as Record<string, unknown>)?.resonance ?? 0) as number,
    tags: (d.tags || []) as string[],
    parentId: d.parentId as string | undefined,
    childCount: ((((d.lineage as Record<string, unknown>)?.children as unknown[]) || []).length ||
      (d.childCount as number) ||
      0) as number,
  }));
  const events = eventsData?.events || [];

  // Build 3D graph nodes from DTUs for the Resonance Universe
  const graph3DNodes = useMemo(() => {
    return dtus.slice(0, 100).map(
      (
        dtu: {
          id: string;
          tier?: string;
          summary?: string;
          title?: string;
          resonance?: number;
          domain?: string;
        },
        i: number
      ) => {
        // Spiral galaxy distribution
        const t = i / Math.max(dtus.length, 1);
        const radius = 3 + t * 18;
        const angle = t * Math.PI * 10;
        const y = Math.sin(i * 0.7) * 3;

        return {
          id: dtu.id,
          label: dtu.title || dtu.summary?.slice(0, 24) || dtu.id.slice(0, 8),
          tier: (dtu.tier || 'regular') as 'regular' | 'mega' | 'hyper' | 'shadow',
          position: [Math.cos(angle) * radius, y, Math.sin(angle) * radius] as [
            number,
            number,
            number,
          ],
          connections: [] as string[],
          resonance: dtu.resonance ?? (resonanceData?.coherence || 0),
        };
      }
    );
  }, [dtus, resonanceData?.coherence]);

  // Build connections between nearby nodes
  const graph3DNodesWithEdges = useMemo(() => {
    const nodes = [...graph3DNodes];
    for (let i = 0; i < nodes.length; i++) {
      // Connect to next 1-3 nodes and some random cross-connections
      const connections: string[] = [];
      if (i + 1 < nodes.length) connections.push(nodes[i + 1].id);
      if (i + 2 < nodes.length && i % 3 === 0) connections.push(nodes[i + 2].id);
      if (i % 5 === 0 && nodes.length > 10) {
        const randomIdx = (i * 7 + 3) % nodes.length;
        if (randomIdx !== i) connections.push(nodes[randomIdx].id);
      }
      nodes[i] = { ...nodes[i], connections };
    }
    return nodes;
  }, [graph3DNodes]);

  const dtuCount = status?.counts?.dtus || dtus.length || 0;
  const coherence = resonanceData?.coherence || 0;

  return (
    <div className="px-3 py-3 sm:p-3 lg:p-4 space-y-3 sm:space-y-3 max-w-[1600px] mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-white">Concordos Dashboard</h1>
          <p className="text-gray-500 mt-1 text-sm">
            {statusLoading ? (
              <span className="animate-pulse">Connecting to lattice...</span>
            ) : (
              <>
                {status?.version || 'v5.0'} &middot; {dtuCount.toLocaleString()} DTUs &middot;{' '}
                {status?.llm?.enabled ? 'LLM Active' : 'Local Mode'} &middot;{' '}
                {healthData?.status === 'ok' ? (
                  <span className="text-neon-green">Healthy</span>
                ) : (
                  <span className="text-amber-400">Checking...</span>
                )}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ScopeIndicator />
          <CoherenceBadge score={events.length} />
          <Link
            href="/hub"
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-lattice-surface border border-lattice-border hover:border-neon-cyan/50 transition-all text-sm text-gray-400 hover:text-white"
          >
            <Compass className="w-4 h-4" />
            <span className="hidden sm:inline">Explore Lenses</span>
          </Link>
        </div>
      </header>

      {/* Context Resurrection — welcome-back cognitive context banner */}
      <LensErrorBoundary name="Context Resurrection">
        <ContextResurrection />
      </LensErrorBoundary>

      {/* Substrate Weather Report */}
      <LensErrorBoundary name="Substrate Weather">
        <SubstrateWeather />
      </LensErrorBoundary>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard
          label="My DTUs"
          value={statusLoading ? '...' : (scopeMetrics?.localCount ?? dtuCount)}
          icon={<Zap className="w-5 h-5" />}
          color="blue"
        />
        <MetricCard
          label="Global DTUs"
          value={statusLoading ? '...' : scopeMetrics?.globalCount || dtuCount}
          icon={<Globe className="w-5 h-5" />}
          color="purple"
        />
        <MetricCard
          label="Coherence"
          value={statusLoading ? '...' : `${(coherence * 100).toFixed(0)}%`}
          icon={<Activity className="w-5 h-5" />}
          color="pink"
        />
        <MetricCard
          label="Events"
          value={statusLoading ? '...' : (status?.counts?.events ?? events.length ?? 0)}
          icon={<TrendingUp className="w-5 h-5" />}
          color="pink"
        />
        <MetricCard
          label="Sovereignty"
          value={sovereigntyLoading ? '...' : `${lockPercentage}%`}
          icon={<Heart className="w-5 h-5" />}
          color="green"
          locked={lockPercentage >= 70}
        />
      </div>

      {/* DTU Tier Stats (Feature 10) */}
      {dtuStats && (
        <div className="rounded-xl border border-lattice-border bg-lattice-surface/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Layers className="w-4 h-4 text-neon-cyan" />
              DTU Tier Breakdown
            </h2>
            <span className="text-[10px] text-gray-600">Auto-refreshes every 30s</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-7 gap-2">
            <TierStatCard
              label="Total"
              value={dtuStatsLoading ? '...' : (dtuStats.totalCount ?? 0)}
              icon={<Layers className="w-4 h-4" />}
              color="cyan"
            />
            <TierStatCard
              label="Shadow"
              value={dtuStatsLoading ? '...' : (dtuStats.shadowCount ?? 0)}
              icon={<Ghost className="w-4 h-4" />}
              color="gray"
            />
            <TierStatCard
              label="Regular"
              value={dtuStatsLoading ? '...' : (dtuStats.regularCount ?? 0)}
              icon={<Zap className="w-4 h-4" />}
              color="blue"
            />
            <TierStatCard
              label="MEGA"
              value={dtuStatsLoading ? '...' : (dtuStats.megaCount ?? 0)}
              icon={<Crown className="w-4 h-4" />}
              color="purple"
            />
            <TierStatCard
              label="HYPER"
              value={dtuStatsLoading ? '...' : (dtuStats.hyperCount ?? 0)}
              icon={<Zap className="w-4 h-4" />}
              color="pink"
            />
            <TierStatCard
              label="Archived"
              value={dtuStatsLoading ? '...' : (dtuStats.archivedCount ?? 0)}
              icon={<Archive className="w-4 h-4" />}
              color="gray"
            />
            <TierStatCard
              label="Compression"
              value={dtuStatsLoading ? '...' : `${dtuStats.compressionRatio ?? 1}x`}
              icon={<Activity className="w-4 h-4" />}
              color="green"
            />
          </div>
        </div>
      )}

      {/* Morning Brief */}
      <LensErrorBoundary name="Morning Brief">
        <MorningBrief />
      </LensErrorBoundary>

      {/* Trending in [Domain] */}
      <LensErrorBoundary name="Trending Domains">
        <TrendingDomains />
      </LensErrorBoundary>

      {/* Live Feed + Emergent Council + Governance — each wrapped independently */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <LensErrorBoundary name="Live DTU Feed">
          <LiveDTUFeed limit={12} onDtuClick={(id) => setInspecting({ type: 'dtu', id })} />
        </LensErrorBoundary>
        <LensErrorBoundary name="Emergent Panel">
          <EmergentPanel />
        </LensErrorBoundary>
        <div className="space-y-3">
          <LensErrorBoundary name="Universal Import">
            <UniversalImport compact />
          </LensErrorBoundary>
          <LensErrorBoundary name="Governance Feed">
            <GovernanceFeed />
          </LensErrorBoundary>
        </div>
      </div>

      {/* Resonance Universe Graph + Sovereignty */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <LensErrorBoundary name="Resonance Universe">
          <div className="lg:col-span-2 rounded-xl border border-lattice-border bg-lattice-surface/50 overflow-hidden">
            <div className="px-4 py-3 border-b border-lattice-border flex items-center justify-between">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-neon-cyan" />
                Resonance Universe
              </h2>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span>{graphData?.nodes?.length || graph3DNodesWithEdges.length} nodes</span>
                <span className="text-neon-cyan">{(coherence * 100).toFixed(0)}% coherence</span>
              </div>
            </div>
            <div className="h-[420px]">
              {graphLoading ? (
                <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                  <div className="text-center">
                    <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                    Loading resonance graph...
                  </div>
                </div>
              ) : graphData?.nodes?.length ? (
                <ResonanceEmpireGraph
                  nodes={graphData!.nodes}
                  edges={graphData!.edges || []}
                  height={420}
                  showLabels
                  onNodeClick={(node) => setInspecting({ type: 'dtu', id: node.id })}
                />
              ) : graph3DNodesWithEdges.length > 0 ? (
                <KnowledgeSpace3D nodes={graph3DNodesWithEdges} />
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                  <div className="text-center">
                    <Activity className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p>Lattice is forming...</p>
                    <p className="text-xs text-gray-600 mt-1">
                      DTUs will appear here as they generate
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </LensErrorBoundary>
        <div className="rounded-xl border border-lattice-border bg-lattice-surface/50 p-4">
          <LockDashboard />
        </div>
      </div>

      {/* Dream & Forgetting Status Indicators */}
      <DreamForgettingIndicators />

      {/* Living Substrate — Dreams, Metabolism, Memory, Council */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <LensErrorBoundary name="Substrate Dreams">
          <SubstrateDreams />
        </LensErrorBoundary>
        <LensErrorBoundary name="DTU Metabolism">
          <MetabolismPanel />
        </LensErrorBoundary>
        <LensErrorBoundary name="Episodic Memory">
          <EpisodicMemory />
        </LensErrorBoundary>
        <LensErrorBoundary name="Brain Council">
          <BrainCouncil />
        </LensErrorBoundary>
      </div>

      {/* Multi-Agent & Economy — Personas, Tasks, Gardens, Bounties/Futures */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <LensErrorBoundary name="Agent Personas">
          <AgentPersonas />
        </LensErrorBoundary>
        <LensErrorBoundary name="Task Delegation">
          <TaskDelegation />
        </LensErrorBoundary>
        <LensErrorBoundary name="Knowledge Gardens">
          <KnowledgeGardens />
        </LensErrorBoundary>
        <LensErrorBoundary name="Bounties & Futures">
          <BountiesAndFutures />
        </LensErrorBoundary>
      </div>

      {/* Cognitive Civilization — Digital Twin, Swarms, Temporal Intelligence */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <LensErrorBoundary name="Cognitive Digital Twin">
          <CognitiveDigitalTwin />
        </LensErrorBoundary>
        <LensErrorBoundary name="DTU Swarms">
          <SwarmIntelligence />
        </LensErrorBoundary>
        <LensErrorBoundary name="Temporal Intelligence">
          <TimeCrystals />
        </LensErrorBoundary>
      </div>

      {/* Nervous System — Production Health Dashboard */}
      <LensErrorBoundary name="Nervous System">
        <NervousSystem />
      </LensErrorBoundary>

      {/* Queue Stats — collapse into a compact summary when all values are zero */}
      <QueueStatsRow status={status} statusLoading={statusLoading} />

      {/* Recent DTUs */}
      <div className="rounded-xl border border-lattice-border bg-lattice-surface/50 p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Zap className="w-4 h-4 text-neon-blue" />
            Recent DTUs
          </h2>
          <Link
            href="/lenses/graph"
            className="text-xs text-gray-500 hover:text-neon-cyan transition-colors"
          >
            View all in Graph &rarr;
          </Link>
        </div>
        {dtusLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 bg-lattice-deep animate-pulse rounded-lg" />
            ))}
          </div>
        ) : dtusError ? (
          <div className="col-span-full text-center py-10">
            <p className="text-amber-400 mb-1">Unable to load DTUs</p>
            <p className="text-gray-500 text-sm">
              Check your connection or{' '}
              <Link href="/login" className="text-neon-cyan hover:underline">
                sign in again
              </Link>
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {dtus
              .slice(0, 6)
              .map(
                (dtu: {
                  id: string;
                  tier: 'regular' | 'mega' | 'hyper' | 'shadow';
                  summary: string;
                  timestamp: string;
                  resonance?: number;
                  tags?: string[];
                }) => (
                  <DTUEmpireCard
                    key={dtu.id}
                    dtu={dtu}
                    onClick={(d) => setInspecting({ type: 'dtu', id: d.id })}
                  />
                )
              )}
            {dtus.length === 0 && (
              <div className="col-span-full text-center py-10">
                <p className="text-gray-400 mb-1">No DTUs yet</p>
                <p className="text-gray-600 text-sm">Start forging in the Chat lens</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Guidance Suggestions */}
      {guidanceData?.suggestions && guidanceData.suggestions.length > 0 && (
        <div className="rounded-xl border border-lattice-border bg-lattice-surface/50 p-4">
          <h2 className="text-sm font-semibold flex items-center gap-2 mb-3">
            <Compass className="w-4 h-4 text-neon-purple" />
            Suggestions
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {guidanceData.suggestions
              .slice(0, 4)
              .map(
                (
                  s: { id?: string; title?: string; message?: string; action?: string },
                  i: number
                ) => (
                  <div
                    key={s.id || i}
                    className="p-3 rounded-lg bg-lattice-deep border border-lattice-border/50 text-sm text-gray-300"
                  >
                    {s.title || s.message || s.action || 'Suggestion'}
                  </div>
                )
              )}
          </div>
        </div>
      )}

      {/* Core 5 Quick Access */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
        {CORE_LENSES.map((core) => {
          const coreIcons: Record<string, React.ReactNode> = {
            chat: <MessageSquare className="w-5 h-5" />,
            board: <Layout className="w-5 h-5" />,
            graph: <Share2 className="w-5 h-5" />,
            code: <Code className="w-5 h-5" />,
            studio: <Music className="w-5 h-5" />,
          };
          return (
            <Link
              key={core.id}
              href={core.path}
              className="group flex flex-col items-center gap-2 p-4 rounded-xl border border-lattice-border bg-lattice-surface/30 hover:border-neon-cyan/40 hover:bg-lattice-surface/60 transition-all"
            >
              <span className="text-gray-400 group-hover:text-neon-cyan transition-colors">
                {coreIcons[core.id]}
              </span>
              <span className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">
                {core.name}
              </span>
              <span className="text-[10px] text-gray-600">{core.tagline}</span>
            </Link>
          );
        })}
      </div>

      {/* Inspector Drawer — click a DTU card or graph node to inspect */}
      {inspecting && (
        <InspectorDrawer
          entityType={inspecting.type}
          entityId={inspecting.id}
          onClose={() => setInspecting(null)}
        />
      )}
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function MetricCard({
  label,
  value,
  icon,
  color,
  locked,
}: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  color: 'blue' | 'purple' | 'pink' | 'green';
  locked?: boolean;
}) {
  const colorMap = {
    blue: 'text-neon-blue border-neon-blue/20 bg-neon-blue/5',
    purple: 'text-neon-purple border-neon-purple/20 bg-neon-purple/5',
    pink: 'text-neon-pink border-neon-pink/20 bg-neon-pink/5',
    green: 'text-neon-green border-neon-green/20 bg-neon-green/5',
  };
  return (
    <div
      className={`rounded-xl border p-4 ${colorMap[color]} ${locked ? 'sovereignty-lock lock-70' : ''}`}
    >
      <div className="flex items-center gap-3">
        <span className="opacity-70">{icon}</span>
        <div>
          <p className="text-xs text-gray-500">{label}</p>
          <p className="text-xl font-bold">{value}</p>
        </div>
      </div>
    </div>
  );
}

function QueueStatsRow({
  status,
  statusLoading,
}: {
  status: Record<string, unknown> | null | undefined;
  statusLoading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const queues = [
    {
      label: 'Ingest Queue',
      value: ((status?.queues as Record<string, unknown>)?.ingest as number) || 0,
      color: 'blue' as const,
    },
    {
      label: 'Autocrawl',
      value: ((status?.queues as Record<string, unknown>)?.autocrawl as number) || 0,
      color: 'purple' as const,
    },
    {
      label: 'Domains',
      value: (((status?.macro as Record<string, unknown>)?.domains as unknown[]) || []).length || 0,
      color: 'cyan' as const,
    },
    {
      label: 'Wallets',
      value: ((status?.counts as Record<string, unknown>)?.wallets as number) || 0,
      color: 'green' as const,
    },
  ];
  const allZero = !statusLoading && queues.every((q) => q.value === 0);

  if (allZero && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full rounded-lg border border-lattice-border bg-lattice-surface/30 px-4 py-2 flex items-center justify-between text-xs text-gray-500 hover:bg-lattice-surface/50 transition-colors"
      >
        <span>Queues: all idle</span>
        <span className="text-gray-600">Click to expand</span>
      </button>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
      {queues.map((q) => (
        <QueueCard
          key={q.label}
          label={q.label}
          value={q.value}
          color={q.color}
          loading={statusLoading}
        />
      ))}
    </div>
  );
}

function QueueCard({
  label,
  value,
  color,
  loading,
}: {
  label: string;
  value: number;
  color: 'blue' | 'purple' | 'cyan' | 'green';
  loading?: boolean;
}) {
  const colorClasses = {
    blue: 'text-neon-blue',
    purple: 'text-neon-purple',
    cyan: 'text-neon-cyan',
    green: 'text-neon-green',
  };
  return (
    <div className="rounded-lg border border-lattice-border bg-lattice-surface/30 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-bold font-mono ${colorClasses[color]}`}>
        {loading ? <span className="animate-pulse">...</span> : value}
      </p>
    </div>
  );
}

function TierStatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  color: 'blue' | 'purple' | 'pink' | 'green' | 'cyan' | 'gray';
}) {
  const colorMap = {
    blue: 'text-neon-blue border-neon-blue/15',
    purple: 'text-neon-purple border-neon-purple/15',
    pink: 'text-neon-pink border-neon-pink/15',
    green: 'text-neon-green border-neon-green/15',
    cyan: 'text-neon-cyan border-neon-cyan/15',
    gray: 'text-gray-400 border-gray-600/15',
  };
  return (
    <div className={`rounded-lg border p-2.5 bg-lattice-deep/30 ${colorMap[color]}`}>
      <div className="flex items-center gap-2">
        <span className="opacity-60">{icon}</span>
        <div>
          <p className="text-[10px] text-gray-500 uppercase">{label}</p>
          <p className="text-base font-bold font-mono">{value}</p>
        </div>
      </div>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedHomeClient = withErrorBoundary(HomeClient);
export { _WrappedHomeClient as HomeClient };
