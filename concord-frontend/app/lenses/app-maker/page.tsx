'use client';

/**
 * App Maker — one Bubble / Glide / Retool-shaped no-code desk.
 *
 * Single `active` union. Former stacked scroll (studio + compute actions +
 * apps list + template deploy + NPM accordion) is folded into panels under
 * components/app-maker/.
 */

import { useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Boxes, Layout, Zap, Package } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { StudioPanel } from '@/components/app-maker/StudioPanel';
import { ActionsPanel } from '@/components/app-maker/ActionsPanel';
import { AppsPanel } from '@/components/app-maker/AppsPanel';
import { PackagesPanel } from '@/components/app-maker/PackagesPanel';

type AppMakerView = 'studio' | 'actions' | 'apps' | 'packages';

const VIEWS: { id: AppMakerView; label: string; keys: string; hint: string; icon: typeof Boxes }[] = [
  { id: 'studio', label: 'Studio', keys: 's', hint: 'No-code builder', icon: Layout },
  { id: 'actions', label: 'Compute', keys: 'c', hint: 'Scaffold · complexity · wireframe', icon: Zap },
  { id: 'apps', label: 'Apps', keys: 'a', hint: 'Create · deploy · promote', icon: Boxes },
  { id: 'packages', label: 'Packages', keys: 'p', hint: 'NPM search', icon: Package },
];

const PANELS: Record<AppMakerView, ComponentType> = {
  studio: StudioPanel,
  actions: ActionsPanel,
  apps: AppsPanel,
  packages: PackagesPanel,
};

export default function AppMakerLens() {
  useLensNav('app-maker');
  useLensIdentity('app-maker');
  const { latestData: realtimeData, alerts: realtimeAlerts, isLive, lastUpdated } = useRealtimeLens('app-maker');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<AppMakerView>('studio');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'app-maker' },
  );

  const Panel = PANELS[active];

  return (
    <LensShell lensId="app-maker" asMain={false}>
      <FirstRunTour lensId="app-maker" />
      <DepthBadge lensId="app-maker" size="sm" className="ml-2" />
      <div data-lens-theme="app-maker" className={cn(ds.pageContainer, 'max-w-4xl mx-auto')}>
        <header className={cn(ds.sectionHeader, 'gap-3 flex-wrap')}>
          <div className="flex items-center gap-3 min-w-0">
            <Boxes className="w-6 h-6 text-neon-cyan shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>App Maker</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="app-maker" data={realtimeData || {}} compact />
                {realtimeAlerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                    {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className={ds.textMuted}>
                Compose apps from primitives — Bubble/Glide desk, one view machine.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="App Maker views"
        >
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                  on
                    ? 'border-neon-cyan text-white'
                    : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="w-4 h-4" />
                {v.label}
                <kbd className="hidden sm:inline-block text-[10px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5 font-mono">
                  {v.keys}
                </kbd>
              </button>
            );
          })}
        </nav>

        <main className="py-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
              transition={{ duration: reduceMotion ? 0 : 0.16 }}
            >
              <Panel />
            </motion.div>
          </AnimatePresence>
        </main>

        <ConnectiveTissueBar lensId="app_maker" />
        <CrossLensRecentsPanel lensId="app-maker" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
