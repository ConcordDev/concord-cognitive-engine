'use client';

import type { ReactNode } from 'react';

/**
 * Observability + absorbed analytics/plugins/substrate/health tab panels.
 * Extracted from system/page.tsx — macros and routes preserved.
 */

import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { MetricsPanel } from '@/components/system/MetricsPanel';
import { AlertsPanel } from '@/components/system/AlertsPanel';
import { LogViewer } from '@/components/system/LogViewer';
import { HeartbeatHealthPanel } from '@/components/system/HeartbeatHealthPanel';
import { TracesPanel } from '@/components/system/TracesPanel';
import { TrendPanel } from '@/components/system/TrendPanel';
import { CustomDashboard } from '@/components/system/CustomDashboard';
import { SystemHealthPanel } from '@/components/system/SystemHealthPanel';
import { DomainProbeCard } from '@/components/system/DomainProbeCard';
import { probesByGroup } from '@/lib/headless-probes';

const AnalyticsDashboard = dynamic(
  () => import('@/components/world-lens/AnalyticsDashboard'),
  { ssr: false },
);
const LensPluginSystem = dynamic(
  () => import('@/components/world-lens/LensPluginSystem'),
  { ssr: false },
);

type PluginCategory = 'Science' | 'Engineering' | 'Economics' | 'Social' | 'Entertainment' | 'Education';
type FrontendInstalled = {
  id: string; name: string; creator: string; category: PluginCategory; version: string;
};
type FrontendMarketplace = {
  id: string; name: string; creator: string; description: string; category: PluginCategory;
  citations: number; downloads: number; rating: number;
  status: 'draft' | 'in review' | 'published'; royaltyRate?: number; installed?: boolean;
};
type LoaderPlugin = {
  id: string; name: string; version?: string; creator?: string; category?: string;
  description?: string; citations?: number; downloads?: number; rating?: number; status?: string;
};
type PersonalStats = {
  totalCitations: number; totalRoyalties: number;
  mostCitedDTU: { name: string; citations: number };
  mostUsedMaterial: { name: string; uses: number };
  reputationByDomain: Record<string, number>;
  buildCount: number; playtime: number; loginStreak: number;
};
type WorldStats = {
  worldId: string; population: number; buildingCount: number; infraCoverage: number;
  envScore: number; economicActivity: number; visitorCount: number;
  timeseries?: { date: string; visitors: number; buildings: number }[];
};
type GlobalStats = {
  activeDistricts: number; totalBuildings: number; totalCitations: number;
  activeUsers: number; totalWorlds: number;
  trendingComponents: { name: string; creator: string; citationsThisWeek: number }[];
  topCreators: { userId: string; name: string; citations: number; rank: number }[];
};
type AnalyticsResp = {
  ok: boolean; personalStats?: PersonalStats; worldStats?: WorldStats | null; globalStats?: GlobalStats;
};

function TabChrome({ title, blurb, children }: { title: string; blurb: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-1 text-base font-semibold text-cyan-200">{title}</h2>
      <p className="mb-3 text-xs text-cyan-700">{blurb}</p>
      {children}
    </section>
  );
}

export function MetricsTabPanel({ live }: { live: boolean }) {
  return (
    <TabChrome title="Live process metrics" blurb="Real process.memoryUsage()/cpuUsage() time-series — CPU, heap, RSS, and request rate sampled every 15s.">
      <MetricsPanel live={live} />
    </TabChrome>
  );
}

export function AlertsTabPanel({ live }: { live: boolean }) {
  return (
    <TabChrome title="Prometheus alert rules" blurb="Rules from monitoring/prometheus/alerts.yml, evaluated against the live sample. Acknowledge fired alerts.">
      <AlertsPanel live={live} />
    </TabChrome>
  );
}

export function LogsTabPanel({ live }: { live: boolean }) {
  return (
    <TabChrome title="Server log viewer" blurb="Search + filter over the in-process logger ring buffer by level, source, and free text.">
      <LogViewer live={live} />
    </TabChrome>
  );
}

export function HbHealthTabPanel({ live }: { live: boolean }) {
  return (
    <TabChrome title="Per-heartbeat health" blurb="Last-run age, run / error / skipped-tick counters and a derived verdict per heartbeat module.">
      <HeartbeatHealthPanel live={live} />
    </TabChrome>
  );
}

export function TracesTabPanel({ live }: { live: boolean }) {
  return (
    <TabChrome title="Request traces & latency" blurb="Distributed-trace spans with p50/p95/p99 latency percentiles and per-route rollup.">
      <TracesPanel live={live} />
    </TabChrome>
  );
}

export function DashboardTabPanel({ live }: { live: boolean }) {
  return (
    <TabChrome title="Customizable dashboard" blurb="Build your own observability panel grid. Layout persists per-user.">
      <CustomDashboard live={live} />
    </TabChrome>
  );
}

export function TrendTabPanel() {
  return (
    <TabChrome title="Coverage & drift trend" blurb="Historical trajectory of coverage / drift / dormant-module counts, not just the current snapshot.">
      <TrendPanel />
    </TabChrome>
  );
}

export function HealthTabPanel() {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h2 className="mb-3 text-base font-semibold text-cyan-200">System Health</h2>
      <SystemHealthPanel />
    </section>
  );
}

export function SubstrateTabPanel() {
  return (
    <section aria-labelledby="substrate-heading">
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
    </section>
  );
}

export function AnalyticsTabPanel() {
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
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-cyan-200">Personal · World · Global activity</h2>
      <p className="mb-3 text-xs text-cyan-700">
        Distinct from cartograph stats above (system structure). This is per-player + per-world + global activity from /api/analytics.
      </p>
      <AnalyticsDashboard
        personalStats={analyticsQ.data?.personalStats}
        worldStats={analyticsQ.data?.worldStats ?? undefined}
        globalStats={analyticsQ.data?.globalStats}
      />
    </section>
  );
}

export function PluginsTabPanel() {
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
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-cyan-200">Lens plugin marketplace</h2>
      <p className="mb-3 text-xs text-cyan-700">
        Browse + install + create lens plugins. Backed by /api/plugins (developer-sdk loader).
      </p>
      <LensPluginSystem
        installedPlugins={pluginsQ.data?.installed ?? []}
        marketplace={pluginsQ.data?.marketplace ?? []}
        activeWidgets={[]}
      />
    </section>
  );
}
