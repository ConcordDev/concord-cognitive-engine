'use client';

/**
 * Animation Lens — FlipaClip + Pencil2D-parity frame-by-frame animator,
 * rebuilt as a real app (Frontend Rebuild Program, Wave 2, Creative/
 * design-tool archetype).
 *
 * Capability map: docs/lens-specs/animation-capability-map.md.
 *
 * The old page's "Projects" tab was a generic per-user DTU-artifact CRUD
 * (`useLensData('animation','project')`) with ZERO connection to the real
 * `anim-create`/frame/stroke/rig substrate below it — clicking a "project"
 * card just flipped a tab to a static placeholder message, and a "Advance"
 * button toggled a fake `status: draft→in-progress→rendering→complete`
 * label with no frame ever drawn and no render ever run. That entire fake
 * system is retired. `AnimationStudioSection` (real `anim-*`/frame/stroke/
 * rig/audio/export macros, `STATE.animationLens`-backed) is now the single
 * "Projects" surface — it already was the real one, just buried below a
 * fake one.
 */

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clapperboard, Wrench, Image as ImageIcon, RefreshCw, Keyboard, Film, Layers, Sparkles } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { AnimationStudioSection } from '@/components/animation/AnimationStudioSection';
import { AnimationMotionToolkit } from '@/components/animation/AnimationMotionToolkit';
import { AnimationReferenceImages } from '@/components/animation/AnimationReferenceImages';
import { AnimationReference } from '@/components/animation/AnimationReference';
import { StatTile, StatTileGrid, Skeleton, ErrorState, DensityToggle } from '@/components/ui';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useMacroDispatchFeedback } from '@/hooks/useMacroDispatchFeedback';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { cn } from '@/lib/utils';

interface AnimDashboard {
  animations: number;
  totalFrames: number;
  latestAnimation: { id: string; title: string } | null;
}

type TabId = 'studio' | 'toolkit' | 'reference';

const TABS: { id: TabId; label: string; icon: typeof Film; hotkey: string }[] = [
  { id: 'studio', label: 'Studio', icon: Film, hotkey: '1' },
  { id: 'toolkit', label: 'Motion Toolkit', icon: Wrench, hotkey: '2' },
  { id: 'reference', label: 'Reference', icon: ImageIcon, hotkey: '3' },
];

export default function AnimationPage() {
  useLensNav('animation');
  const { contextDTUs } = useLensDTUs({ lens: 'animation' });
  const [tab, setTab] = useState<TabId>('studio');

  const stats = useMacroDispatchFeedback<AnimDashboard>();
  const loadStats = useCallback(() => { void stats.dispatch('animation', 'anim-dashboard', {}); }, [stats]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadStats(); }, []);

  useLensCommand(
    [
      ...TABS.map((t) => ({
        id: `tab-${t.id}`, keys: t.hotkey, description: t.label, category: 'navigation' as const,
        action: () => setTab(t.id),
      })),
      { id: 'refresh-stats', keys: 'r', description: 'Refresh dashboard', category: 'actions', action: loadStats },
    ],
    { lensId: 'animation' }
  );

  const dash = stats.status === 'done' ? stats.result : null;
  const statsLoading = stats.status === 'dispatched' || stats.status === 'running';

  return (
    <LensShell lensId="animation" asMain={false}>
      <FirstRunTour lensId="animation" />
      <div data-lens-theme="animation" className="p-6 space-y-5">
        {/* Command bar */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-orange-500/15 border border-orange-500/30 flex items-center justify-center">
              <Clapperboard className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Animation</h1>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span>Frame-by-frame drawing, rigging &amp; export — FlipaClip + Pencil2D parity</span>
                <DepthBadge lensId="animation" size="sm" />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden md:flex items-center gap-1 text-[10px] text-gray-500" title="1-3 switch tab · r refresh dashboard">
              <Keyboard className="w-3.5 h-3.5" /> 1-3 · r
            </span>
            <DensityToggle variant="dropdown" />
            <button
              type="button"
              onClick={loadStats}
              disabled={statsLoading}
              className="p-1.5 rounded border border-lattice-border text-gray-400 hover:text-white hover:bg-lattice-elevated transition-colors disabled:opacity-50"
              aria-label="Refresh dashboard"
            >
              <RefreshCw className={cn('w-4 h-4', statsLoading && 'animate-spin')} />
            </button>
            <DTUExportButton domain="animation" data={dash || {}} compact />
          </div>
        </header>

        {/* KPI strip — real anim-dashboard macro */}
        {statsLoading && !dash ? (
          <StatTileGrid columns={4}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-md border border-white/10 bg-black/40 p-3">
                <Skeleton variant="line" lines={2} />
              </div>
            ))}
          </StatTileGrid>
        ) : stats.status === 'error' ? (
          <ErrorState message={stats.error || 'Failed to load dashboard.'} onRetry={loadStats} retrying={statsLoading} variant="inline" />
        ) : dash ? (
          <StatTileGrid columns={4}>
            <StatTile label="Animations" value={dash.animations} icon={<Film className="w-3.5 h-3.5" />} />
            <StatTile label="Total frames" value={dash.totalFrames} icon={<Layers className="w-3.5 h-3.5" />} />
            <StatTile label="Latest" value={dash.latestAnimation?.title || '--'} />
            <StatTile label="DTUs" value={contextDTUs.length} icon={<Sparkles className="w-3.5 h-3.5" />} />
          </StatTileGrid>
        ) : null}

        {/* Tab bar */}
        <nav className="flex items-center gap-1 overflow-x-auto border-b border-lattice-border pb-2" aria-label="Animation views">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs whitespace-nowrap border transition-colors',
                  active
                    ? 'bg-orange-500/15 text-orange-400 border-orange-500/30'
                    : 'text-gray-400 hover:text-white hover:bg-white/5 border-transparent'
                )}
              >
                <span className="text-[10px] text-gray-600 tabular-nums">{t.hotkey}</span>
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </nav>

        {/* Tab content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            {tab === 'studio' && <AnimationStudioSection />}
            {tab === 'toolkit' && <AnimationMotionToolkit />}
            {tab === 'reference' && (
              <div className="space-y-6">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                  <AnimationReferenceImages />
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                  <AnimationReference />
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </LensShell>
  );
}
