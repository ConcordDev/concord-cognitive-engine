'use client';

/**
 * Meta lens: the north-star look (serif title, pill views, teal floating CTA)
 * over the live codebase inventory. Every view is a real /api/inventory*
 * scan or the system-health / dev-portal workbenches; the CTA re-scans.
 */

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, Cog, Eye, GitBranch, Layers, Loader2, Package, RefreshCw, Search, Server,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useAuth } from '@/hooks/useAuth';
import { useUIStore } from '@/store/ui';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { SystemHealth } from '@/components/meta/SystemHealth';
import { DevPortal } from '@/components/meta/DevPortal';
import { OverviewPanel } from '@/components/meta/OverviewPanel';
import { ComponentsPanel } from '@/components/meta/ComponentsPanel';
import { LensesPanel } from '@/components/meta/LensesPanel';
import { OrphansPanel } from '@/components/meta/OrphansPanel';
import { WiringPanel } from '@/components/meta/WiringPanel';
import { SearchPanel } from '@/components/meta/SearchPanel';
import { LensInfraPanel } from '@/components/meta/LensInfraPanel';

type TabKey = 'overview' | 'health' | 'dev-portal' | 'components' | 'lenses' | 'orphans' | 'wiring' | 'search' | 'lens-infra';

const TABS: { key: TabKey; label: string; keys: string; title: string; hint: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', keys: '1', title: 'What the system is', hint: 'Inventory totals and import graph', icon: Layers },
  { key: 'health', label: 'Health', keys: '2', title: 'Whether it is holding up', hint: 'Live system health', icon: Activity },
  { key: 'lenses', label: 'Lenses', keys: '3', title: 'Every lens, and what backs it', hint: 'Lens catalog and wiring', icon: Eye },
  { key: 'components', label: 'Components', keys: '4', title: 'Every component in the tree', hint: 'Component inventory', icon: Package },
  { key: 'wiring', label: 'Wiring', keys: '5', title: 'How the pieces connect', hint: 'Frontend-to-backend wiring map', icon: GitBranch },
  { key: 'orphans', label: 'Orphans', keys: '6', title: 'What nothing points to', hint: 'Unreferenced files and routes', icon: AlertTriangle },
  { key: 'search', label: 'Search', keys: '7', title: 'Find anything in the codebase', hint: 'Inventory search', icon: Search },
  { key: 'lens-infra', label: 'Infrastructure', keys: '8', title: 'What every lens shares', hint: 'Shared lens infrastructure', icon: Cog },
  { key: 'dev-portal', label: 'Dev portal', keys: '9', title: 'Build against Concord', hint: 'API explorer and developer tools', icon: Server },
];

export default function MetaLensPage() {
  useLensNav('meta');
  useLensIdentity('meta');
  const { isLive, lastUpdated } = useRealtimeLens('meta');
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<TabKey>('overview');
  const [refreshing, setRefreshing] = useState(false);

  const refreshInventory = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await api.post('/api/inventory/refresh');
      if (res.data?.ok === false) throw new Error(res.data?.error || 'The re-scan failed.');
      await queryClient.invalidateQueries({
        predicate: (q) => typeof q.queryKey[0] === 'string' && q.queryKey[0].startsWith('inventory'),
      });
      useUIStore.getState().addToast({ type: 'success', message: 'Inventory re-scanned.' });
    } catch (e) {
      useUIStore.getState().addToast({ type: 'error', message: (e as Error).message || 'The re-scan failed.' });
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  useLensCommand(
    [
      ...TABS.map((t) => ({
        id: `tab-${t.key}`,
        keys: t.keys,
        description: `${t.label} — ${t.hint}`,
        category: 'navigation' as const,
        action: () => setActive(t.key),
      })),
      { id: 'meta-refresh', keys: 'r', description: 'Re-scan inventory', category: 'actions' as const, action: () => void refreshInventory() },
    ],
    { lensId: 'meta' },
  );

  const current = TABS.find((t) => t.key === active)!;

  return (
    <LensShell lensId="meta" asMain={false}>
      <FirstRunTour lensId="meta" />
      <DepthBadge lensId="meta" size="sm" className="ml-2" />
      <div data-lens-theme="meta" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Meta</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{active === 'overview' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="meta" data={{}} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Meta views">
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = active === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActive(t.key)}
                aria-current={on ? 'page' : undefined}
                title={`${t.hint} (${t.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{t.keys}</kbd>
              </button>
            );
          })}
        </nav>

        {active === 'overview' && <OverviewPanel />}
        {active === 'health' && <section className="rounded-2xl border border-white/10 bg-[#111] p-4"><SystemHealth /></section>}
        {active === 'dev-portal' && <DevPortal />}
        {active === 'components' && <ComponentsPanel />}
        {active === 'lenses' && <LensesPanel />}
        {active === 'orphans' && <OrphansPanel />}
        {active === 'wiring' && <WiringPanel />}
        {active === 'search' && <SearchPanel />}
        {active === 'lens-infra' && <LensInfraPanel />}

        <CrossLensRecentsPanel lensId="meta" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={() => void refreshInventory()}
          disabled={refreshing}
          title="Re-scan inventory (R)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {refreshing ? 'Re-scanning…' : 'Refresh inventory'}
        </button>
      </div>
    </LensShell>
  );
}
