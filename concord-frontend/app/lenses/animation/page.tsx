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
import { Wrench, Image as ImageIcon, RefreshCw, Film, Layers, Sparkles, Plus } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';

interface AnimDashboard {
  animations: number;
  totalFrames: number;
  latestAnimation: { id: string; title: string } | null;
}

type TabId = 'studio' | 'toolkit' | 'reference';

const TABS: { id: TabId; label: string; title: string; icon: typeof Film; hotkey: string }[] = [
  { id: 'studio', label: 'Studio', title: 'The shot', icon: Film, hotkey: '1' },
  { id: 'toolkit', label: 'Motion Toolkit', title: 'The motion', icon: Wrench, hotkey: '2' },
  { id: 'reference', label: 'Reference', title: 'The reference', icon: ImageIcon, hotkey: '3' },
];

export default function AnimationPage() {
  useLensNav('animation');
  const { contextDTUs } = useLensDTUs({ lens: 'animation' });
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [tab, setTab] = useState<TabId>('studio');

  const stats = useMacroDispatchFeedback<AnimDashboard>();
  const loadStats = useCallback(() => { void stats.dispatch('animation', 'anim-dashboard', {}); }, [stats]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadStats(); }, []);

  const newShot = useCallback(() => {
    setTab('studio');
    let tries = 0;
    const focus = () => {
      const el = document.querySelector<HTMLInputElement>('[data-lens-theme="animation"] input[placeholder="Title"]');
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); return; }
      if (++tries < 20) requestAnimationFrame(focus);
    };
    requestAnimationFrame(focus);
  }, []);

  useLensCommand(
    [
      ...TABS.map((t) => ({
        id: `tab-${t.id}`, keys: t.hotkey, description: t.label, category: 'navigation' as const,
        action: () => setTab(t.id),
      })),
      { id: 'new-shot', keys: 'n', description: 'New shot', category: 'actions' as const, action: newShot },
      { id: 'refresh-stats', keys: 'r', description: 'Refresh dashboard', category: 'actions' as const, action: loadStats },
    ],
    { lensId: 'animation' }
  );

  const dash = stats.status === 'done' ? stats.result : null;
  const statsLoading = stats.status === 'dispatched' || stats.status === 'running';
  const current = TABS.find((t) => t.id === tab)!;

  return (
    <LensShell lensId="animation" asMain={false}>
      <FirstRunTour lensId="animation" />
      <DepthBadge lensId="animation" size="sm" className="ml-2" />
      <div data-lens-theme="animation" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Animation</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{tab === 'studio' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-2">
            <DensityToggle variant="dropdown" />
            <button
              type="button"
              onClick={loadStats}
              disabled={statsLoading}
              className="rounded-full border border-white/10 p-2 text-zinc-400 transition-colors hover:text-zinc-100 disabled:opacity-50"
              aria-label="Refresh dashboard"
              title="Refresh dashboard (R)"
            >
              <RefreshCw className={cn('h-4 w-4', statsLoading && 'animate-spin')} />
            </button>
            <DTUExportButton domain="animation" data={dash || {}} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Animation views">
          {TABS.map((t) => {
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
                <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{t.hotkey}</kbd>
              </button>
            );
          })}
        </nav>

        <div className="mb-6">
          {statsLoading && !dash ? (
            <StatTileGrid columns={4}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-2xl border border-white/10 bg-[#111] p-3">
                  <Skeleton variant="line" lines={2} />
                </div>
              ))}
            </StatTileGrid>
          ) : stats.status === 'error' ? (
            <ErrorState message={stats.error || 'Failed to load dashboard.'} onRetry={loadStats} retrying={statsLoading} variant="inline" />
          ) : dash ? (
            <StatTileGrid columns={4}>
              <StatTile label="Animations" value={dash.animations} icon={<Film className="h-3.5 w-3.5" />} />
              <StatTile label="Total frames" value={dash.totalFrames} icon={<Layers className="h-3.5 w-3.5" />} />
              <StatTile label="Latest" value={dash.latestAnimation?.title || '--'} />
              <StatTile label="DTUs" value={contextDTUs.length} icon={<Sparkles className="h-3.5 w-3.5" />} />
            </StatTileGrid>
          ) : null}
        </div>

        {tab === 'studio' && <AnimationStudioSection />}
        {tab === 'toolkit' && <AnimationMotionToolkit />}
        {tab === 'reference' && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <AnimationReferenceImages />
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <AnimationReference />
            </div>
          </div>
        )}

        <CrossLensRecentsPanel lensId="animation" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={newShot}
          title="New shot (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          New shot
        </button>
      </div>
    </LensShell>
  );
}
