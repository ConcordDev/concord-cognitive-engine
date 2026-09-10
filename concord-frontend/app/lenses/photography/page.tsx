'use client';

/**
 * Photography — one Lightroom-shaped catalog + media workbench.
 *
 * Single `active` union. Accordion booleans for Pexels/ActionPanel and the
 * inline gallery/capture/upload piles are gone. Each view is a panel.
 * Page is a thin shell (paper/government gold).
 */

import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Camera, Grid, Upload, Aperture, Layers, Sliders, BarChart3, Image as ImageIcon, Wrench,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { PhotographyLightroomSection } from '@/components/photography/PhotographyLightroomSection';
import { PexelsBrowser } from '@/components/photography/PexelsBrowser';
import { PhotographyActionPanel } from '@/components/photography/PhotographyActionPanel';
import { GalleryPanel } from '@/components/photography/GalleryPanel';
import { CapturePanel } from '@/components/photography/CapturePanel';
import { UploadPanel } from '@/components/photography/UploadPanel';
import { MediaCollectionsPanel } from '@/components/photography/MediaCollectionsPanel';
import { EditingPanel } from '@/components/photography/EditingPanel';
import { StatsPanel } from '@/components/photography/StatsPanel';
import { useLensData } from '@/lib/hooks/use-lens-data';
import type { PhotoItem, PhotoView } from '@/components/photography/photo-types';

const VIEWS: { id: PhotoView; label: string; keys: string; hint: string; icon: typeof Camera }[] = [
  { id: 'catalog', label: 'Catalog', keys: '1', hint: 'Lightroom library/develop', icon: Camera },
  { id: 'gallery', label: 'Gallery', keys: 'g', hint: 'Media gallery', icon: Grid },
  { id: 'capture', label: 'Capture', keys: 'c', hint: 'Live camera', icon: Aperture },
  { id: 'upload', label: 'Upload', keys: 'u', hint: 'Import photo', icon: Upload },
  { id: 'collections', label: 'Collections', keys: 'l', hint: 'Media albums', icon: Layers },
  { id: 'editing', label: 'Editing', keys: 'e', hint: 'Vision analyze', icon: Sliders },
  { id: 'stats', label: 'Stats', keys: 's', hint: 'Library rollup', icon: BarChart3 },
  { id: 'stock', label: 'Stock', keys: 'p', hint: 'Pexels browser', icon: ImageIcon },
  { id: 'tools', label: 'Workbench', keys: 'w', hint: 'Exposure/composition tools', icon: Wrench },
];

function StockPanel() {
  return <PexelsBrowser />;
}

function ToolsPanel() {
  return (
    <PipingProvider>
      <PhotographyActionPanel />
    </PipingProvider>
  );
}

function CollectionsRoute() {
  const { items } = useLensData<PhotoItem>('photography', 'photo', { seed: [] });
  return <MediaCollectionsPanel photoCount={items.length} />;
}

export default function PhotographyPage() {
  useLensNav('photography');
  useLensIdentity('photography');
  const { latestData: realtimeData, insights: realtimeInsights, isLive, lastUpdated } =
    useRealtimeLens('photography');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<PhotoView>('catalog');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      {
        id: 'focus-search',
        keys: '/',
        description: 'Focus search',
        category: 'navigation' as const,
        action: () => {
          setActive('gallery');
          queueMicrotask(() => searchInputRef.current?.focus());
        },
      },
    ],
    { lensId: 'photography' },
  );

  const motionProps = useMemo(
    () =>
      reduceMotion
        ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
        : {
            initial: { opacity: 0, y: 8 },
            animate: { opacity: 1, y: 0 },
            exit: { opacity: 0, y: -6 },
            transition: { duration: 0.16 },
          },
    [reduceMotion],
  );

  return (
    <LensShell lensId="photography" asMain={false}>
      <FirstRunTour lensId="photography" />
      <DepthBadge lensId="photography" size="sm" className="ml-2" />
      <div data-lens-theme="photography" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <Camera className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Photography</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="photography" data={realtimeData || {}} compact />
              </div>
              <p className={ds.textMuted}>
                Lightroom catalog + media gallery — one photo desk.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActive('upload')}
            className="px-3 py-1.5 text-xs bg-sky-500/20 border border-sky-500/30 rounded-lg hover:bg-sky-500/30 flex items-center gap-1"
          >
            <Upload className="w-3 h-3" /> Upload
          </button>
        </header>

        <RealtimeDataPanel data={realtimeData} insights={realtimeInsights} />

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Photography views"
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
          <motion.div key={active} {...motionProps} className="pt-4">
            {active === 'catalog' && <PhotographyLightroomSection />}
            {active === 'gallery' && (
              <GalleryPanel
                searchInputRef={searchInputRef}
                onRequestUpload={() => setActive('upload')}
              />
            )}
            {active === 'capture' && <CapturePanel />}
            {active === 'upload' && <UploadPanel />}
            {active === 'collections' && <CollectionsRoute />}
            {active === 'editing' && <EditingPanel />}
            {active === 'stats' && <StatsPanel />}
            {active === 'stock' && <StockPanel />}
            {active === 'tools' && <ToolsPanel />}
          </motion.div>
        </AnimatePresence>

        <section className="mt-4">
          <LensFeedButton domain="photography" label="Live photo-archive feed" />
        </section>
        <CrossLensRecentsPanel
          lensId="photography"
          sinceDays={7}
          limit={6}
          hideWhenEmpty
          className="mt-3"
        />
      </div>
    </LensShell>
  );
}
