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
import { Boxes, Layout, Package, Plus, Zap } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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
      <NorthStarFrame
        lensId="app-maker"
        crumb="App Maker"
        title={`Build an app${active === 'studio' && who ? `, ${who}` : ''}`}
        subtitle="Compose apps from primitives, one view machine"
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="app-maker" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </>
        }
        tabs={VIEWS}
        activeTab={active}
        onTab={(id) => setActive(id as AppMakerView)}
        tabsLabel="App Maker views"
        cta={{ label: 'New app', icon: Plus, onClick: () => setActive('apps'), title: 'Create and deploy an app' }}
      >
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
      </NorthStarFrame>
    </LensShell>
  );
}
