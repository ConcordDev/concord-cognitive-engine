'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  Layers, Search, AlertTriangle, Package, Eye, GitBranch, Cog, Server, Activity,
} from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
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
import { useArtifacts, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';

type TabKey = 'overview' | 'health' | 'dev-portal' | 'components' | 'lenses' | 'orphans' | 'wiring' | 'search' | 'lens-infra';

const TABS: { key: TabKey; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'health', label: 'System Health', icon: Activity },
  { key: 'dev-portal', label: 'Dev Portal', icon: Server },
  { key: 'components', label: 'Components', icon: Package },
  { key: 'lenses', label: 'Lenses', icon: Eye },
  { key: 'orphans', label: 'Orphans', icon: AlertTriangle },
  { key: 'wiring', label: 'Wiring Map', icon: GitBranch },
  { key: 'search', label: 'Search', icon: Search },
  { key: 'lens-infra', label: 'Lens Infrastructure', icon: Cog },
];

export default function MetaLensPage() {
  const viewLog = useArtifacts<{ at: string }>('meta', { type: 'view-event', limit: 5 });
  const recordView = useCreateArtifact<{ at: string }>('meta');
  void viewLog; void recordView;
  useLensNav('meta');
  useLensIdentity('meta');
  const { isLive, lastUpdated } = useRealtimeLens('meta');
  const [active, setActive] = useState<TabKey>('overview');

  useLensCommand(
    [
      { id: 'tab-overview', keys: 'o', description: 'Overview', category: 'navigation', action: () => setActive('overview') },
      { id: 'tab-health', keys: 'h', description: 'System Health', category: 'navigation', action: () => setActive('health') },
      { id: 'tab-dev-portal', keys: 'd', description: 'Dev Portal', category: 'navigation', action: () => setActive('dev-portal') },
      { id: 'tab-components', keys: 'c', description: 'Components', category: 'navigation', action: () => setActive('components') },
      { id: 'tab-lenses', keys: 'l', description: 'Lenses', category: 'navigation', action: () => setActive('lenses') },
      { id: 'tab-orphans', keys: 'r', description: 'Orphans', category: 'navigation', action: () => setActive('orphans') },
      { id: 'tab-wiring', keys: 'w', description: 'Wiring', category: 'navigation', action: () => setActive('wiring') },
      { id: 'tab-search', keys: 's', description: 'Search', category: 'navigation', action: () => setActive('search') },
      { id: 'tab-lens-infra', keys: 'e', description: 'Lens Infra', category: 'navigation', action: () => setActive('lens-infra') },
    ],
    { lensId: 'meta' },
  );

  return (
    <LensShell lensId="meta" asMain={false}>
      <FirstRunTour lensId="meta" />
      <DepthBadge lensId="meta" size="sm" className="ml-2" />
      <div data-lens-theme="meta" className="p-6 space-y-6">
        <motion.header
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between flex-wrap gap-3"
        >
          <div className="flex items-center gap-3">
            <Layers className="w-6 h-6 text-neon-purple" />
            <div>
              <h1 className="text-xl font-bold">Codebase Inventory</h1>
              <p className="text-sm text-gray-400">
                Components, lenses, wiring, and orphan analysis
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="meta" data={{}} compact />
          </div>
        </motion.header>

        <div className="flex gap-1 bg-lattice-void border border-lattice-border rounded-lg p-1 overflow-x-auto" role="tablist" aria-label="Meta catalog">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={active === tab.key}
              onClick={() => setActive(tab.key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap',
                active === tab.key
                  ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/30'
                  : 'text-gray-400 hover:text-white hover:bg-lattice-surface',
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.25 }}
          >
            {active === 'overview' && <OverviewPanel />}
            {active === 'health' && (
              <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                <SystemHealth />
              </section>
            )}
            {active === 'dev-portal' && <DevPortal />}
            {active === 'components' && <ComponentsPanel />}
            {active === 'lenses' && <LensesPanel />}
            {active === 'orphans' && <OrphansPanel />}
            {active === 'wiring' && <WiringPanel />}
            {active === 'search' && <SearchPanel />}
            {active === 'lens-infra' && <LensInfraPanel />}
          </motion.div>
        </AnimatePresence>
      </div>
      <a href="#meta-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to meta content</a>
      <CrossLensRecentsPanel lensId="meta" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
