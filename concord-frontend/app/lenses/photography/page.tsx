'use client';

/**
 * Photography: the north-star look (serif title, pill views, teal floating CTA)
 * over the Lightroom catalog + media workbench. Every view is the existing real
 * panel; the CTA opens Upload and focuses the photo title field.
 */

import { useCallback, useRef, useState } from 'react';
import {
  Camera, Grid, Upload, Aperture, Layers, Sliders, BarChart3, Image as ImageIcon, Wrench, Plus,
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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
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

const VIEWS: { id: PhotoView; label: string; keys: string; title: string; hint: string; icon: typeof Camera }[] = [
  { id: 'catalog', label: 'Catalog', keys: '1', title: 'The roll', hint: 'Lightroom library and develop', icon: Camera },
  { id: 'gallery', label: 'Gallery', keys: 'g', title: 'Every frame', hint: 'Media gallery', icon: Grid },
  { id: 'capture', label: 'Capture', keys: 'c', title: 'Take the shot', hint: 'Live camera', icon: Aperture },
  { id: 'upload', label: 'Upload', keys: 'u', title: 'Bring one in', hint: 'Import a photo', icon: Upload },
  { id: 'collections', label: 'Collections', keys: 'l', title: 'The albums', hint: 'Media albums', icon: Layers },
  { id: 'editing', label: 'Editing', keys: 'e', title: 'The edit', hint: 'Vision analysis', icon: Sliders },
  { id: 'stats', label: 'Stats', keys: 's', title: 'The numbers', hint: 'Library rollup', icon: BarChart3 },
  { id: 'stock', label: 'Stock', keys: 'p', title: 'The stock shelf', hint: 'Pexels browser', icon: ImageIcon },
  { id: 'tools', label: 'Workbench', keys: 'w', title: 'The workbench', hint: 'Exposure and composition tools', icon: Wrench },
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<PhotoView>('catalog');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const importPhoto = useCallback(() => {
    setActive('upload');
    let tries = 0;
    const focus = () => {
      const el = document.querySelector<HTMLInputElement>('[data-lens-theme="photography"] input[placeholder="Photo title"]');
      if (el) el.focus();
      else if (tries++ < 20) requestAnimationFrame(focus);
    };
    requestAnimationFrame(focus);
  }, []);

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
      {
        id: 'import-photo',
        keys: 'n',
        description: 'Import a photo',
        category: 'actions' as const,
        action: importPhoto,
      },
    ],
    { lensId: 'photography' },
  );

  const current = VIEWS.find((v) => v.id === active)!;

  return (
    <LensShell lensId="photography" asMain={false}>
      <FirstRunTour lensId="photography" />
      <DepthBadge lensId="photography" size="sm" className="ml-2" />
      <div data-lens-theme="photography" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Photography</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{active === 'catalog' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="photography" data={realtimeData || {}} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Photography views">
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
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{v.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <RealtimeDataPanel data={realtimeData} insights={realtimeInsights} />

        <div className="pt-4">
          {active === 'catalog' && <PhotographyLightroomSection />}
          {active === 'gallery' && (
            <GalleryPanel searchInputRef={searchInputRef} onRequestUpload={() => setActive('upload')} />
          )}
          {active === 'capture' && <CapturePanel />}
          {active === 'upload' && <UploadPanel />}
          {active === 'collections' && <CollectionsRoute />}
          {active === 'editing' && <EditingPanel />}
          {active === 'stats' && <StatsPanel />}
          {active === 'stock' && <StockPanel />}
          {active === 'tools' && <ToolsPanel />}
        </div>

        <section className="mt-6">
          <LensFeedButton domain="photography" label="Live photo-archive feed" />
        </section>
        <CrossLensRecentsPanel lensId="photography" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={importPhoto}
          title="Import a photo (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          Import a roll
        </button>
      </div>
    </LensShell>
  );
}
