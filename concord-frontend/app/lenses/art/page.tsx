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
  Brush, Grid, ShoppingBag, Layers, Landmark, Droplets, Wand2, Image as ImageIcon, Plus,
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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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

const VIEWS: { id: ArtView; label: string; keys: string; title: string; hint: string; icon: typeof Brush }[] = [
  { id: 'studio', title: 'What are we painting', label: 'Studio', keys: '1', hint: 'Layers · brushes', icon: Brush },
  { id: 'gallery', title: 'What is on the wall', label: 'Gallery', keys: '2', hint: 'Browse · upload', icon: Grid },
  { id: 'canvas', title: 'What are we sketching', label: 'Canvas', keys: '3', hint: 'Quick sketch', icon: ImageIcon },
  { id: 'marketplace', title: 'What is for sale', label: 'Market', keys: '4', hint: 'Listings', icon: ShoppingBag },
  { id: 'my-art', title: 'What you own', label: 'My art', keys: '5', hint: 'Owned pieces', icon: Layers },
  { id: 'museum', title: 'What the museums hold', label: 'Museum', keys: '6', hint: 'Met · AIC', icon: Landmark },
  { id: 'palettes', title: 'What colors go together', label: 'Palettes', keys: '7', hint: 'Harmony', icon: Droplets },
  { id: 'workbench', title: 'What the piece says', label: 'Workbench', keys: '8', hint: 'Style · score', icon: Wand2 },
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<ArtView>('studio');

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      { id: 'art-new-piece', keys: 'n', description: 'New piece (open the studio)', category: 'actions' as const, action: () => setActive('studio') },
    ],
    { lensId: 'art' },
  );

  const current = VIEWS.find((v) => v.id === active)!;

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
      <div data-lens-theme="art" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Art</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{active === 'studio' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="art" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded px-2 py-0.5 text-xs bg-yellow-500/10 text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Art views">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                aria-current={on ? 'page' : undefined}
                title={`${v.hint} (${v.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
                <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{v.keys}</kbd>
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

        <button
          type="button"
          onClick={() => setActive('studio')}
          title="New piece (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          New piece
        </button>
      </div>
    </LensShell>
  );
}
