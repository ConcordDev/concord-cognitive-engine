'use client';

/**
 * Art — one Procreate/Krita + gallery desk.
 *
 * Single view union. Former welded pile (ArtStudioSection always-on +
 * viewMode screens + accordion museum/palette/workbench) folded into
 * panels under components/art/. Macros preserved.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Brush, Grid, ShoppingBag, Layers, Landmark, Droplets, Wand2, Image as ImageIcon,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { StudioPanel } from '@/components/art/StudioPanel';
import { GalleryPanel } from '@/components/art/GalleryPanel';
import { CanvasPanel } from '@/components/art/CanvasPanel';
import { MarketplacePanel } from '@/components/art/MarketplacePanel';
import { MyArtPanel } from '@/components/art/MyArtPanel';
import { MuseumPanel } from '@/components/art/MuseumPanel';
import { PaletteWorkshopPanel } from '@/components/art/PaletteWorkshopPanel';
import { ArtWorkbenchPanel } from '@/components/art/ArtWorkbenchPanel';

type ArtView =
  | 'studio'
  | 'gallery'
  | 'canvas'
  | 'marketplace'
  | 'my-art'
  | 'museum'
  | 'palettes'
  | 'workbench';

const VIEWS: { id: ArtView; label: string; keys: string; hint: string; icon: typeof Brush }[] = [
  { id: 'studio', label: 'Studio', keys: '1', hint: 'Layers · brushes', icon: Brush },
  { id: 'gallery', label: 'Gallery', keys: '2', hint: 'Browse · upload', icon: Grid },
  { id: 'canvas', label: 'Canvas', keys: '3', hint: 'Quick sketch', icon: ImageIcon },
  { id: 'marketplace', label: 'Market', keys: '4', hint: 'Listings', icon: ShoppingBag },
  { id: 'my-art', label: 'My art', keys: '5', hint: 'Owned pieces', icon: Layers },
  { id: 'museum', label: 'Museum', keys: '6', hint: 'Met · AIC', icon: Landmark },
  { id: 'palettes', label: 'Palettes', keys: '7', hint: 'Harmony', icon: Droplets },
  { id: 'workbench', label: 'Workbench', keys: '8', hint: 'Style · score', icon: Wand2 },
];

const PANELS: Record<ArtView, ComponentType> = {
  studio: StudioPanel,
  gallery: GalleryPanel,
  canvas: CanvasPanel,
  marketplace: MarketplacePanel,
  'my-art': MyArtPanel,
  museum: MuseumPanel,
  palettes: PaletteWorkshopPanel,
  workbench: ArtWorkbenchPanel,
};

export default function ArtLensPage() {
  useLensNav('art');
  useLensIdentity('art');
  const { latestData: realtimeData, alerts: realtimeAlerts, isLive, lastUpdated } = useRealtimeLens('art');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<ArtView>('studio');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'art' },
  );

  const Panel = PANELS[active];
  const motionProps = useMemo(
    () => (reduceMotion
      ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          exit: { opacity: 0, y: -6 },
          transition: { duration: 0.16 },
        }),
    [reduceMotion],
  );

  return (
    <LensShell lensId="art" asMain={false}>
      <FirstRunTour lensId="art" />
      <DepthBadge lensId="art" size="sm" className="ml-2" />
      <div data-lens-theme="art" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <Brush className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Art</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="art" data={realtimeData || {}} compact />
                {realtimeAlerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                    {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className={ds.textMuted}>
                Procreate studio + gallery desk — one creative surface.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Art views"
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
                    ? 'border-[var(--lens-accent)] text-white'
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

        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps} className="min-h-0">
            <Panel />
          </motion.div>
        </AnimatePresence>

        <RecentMineCard domain="art" limit={10} hideWhenEmpty className="mt-4" />
        <AutoActionStrip domain="art" hideWhenEmpty className="mt-3" title="More actions" />
        <CrossLensRecentsPanel lensId="art" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
