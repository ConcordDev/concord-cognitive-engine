'use client';

/**
 * Debate — one argumentation app.
 *
 * Reference: Kialo (async claim tree) + timed oratory floor (complementary).
 * Single view union (floor | map | cmv). Accordion booleans for argument-map /
 * CMV are gone. Share links (?share=) open SharedDebateView as an overlay.
 * Page is a thin shell.
 */

import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { GitBranch, MessageSquare, Scale, Timer } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { SessionRail } from '@/components/lens/SessionRail';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { SharedDebateView } from '@/components/debate/SharedDebateView';
import { LiveFloorPanel } from '@/components/debate/LiveFloorPanel';
import { ArgumentMapPanel } from '@/components/debate/ArgumentMapPanel';
import { CmvPanel } from '@/components/debate/CmvPanel';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

type DebateView = 'floor' | 'map' | 'cmv';

const VIEWS: { id: DebateView; label: string; keys: string; hint: string; icon: typeof Scale }[] = [
  { id: 'floor', label: 'Floor', keys: '1', hint: 'Timed oratory debate', icon: Timer },
  { id: 'map', label: 'Argument map', keys: '2', hint: 'Kialo claim tree', icon: GitBranch },
  { id: 'cmv', label: 'Discussion', keys: '3', hint: 'CMV-shape feed', icon: MessageSquare },
];

const PANELS: Record<DebateView, ComponentType> = {
  floor: LiveFloorPanel,
  map: ArgumentMapPanel,
  cmv: CmvPanel,
};

export default function DebateLensPage() {
  useLensNav('debate');
  useLensIdentity('debate');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('debate');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<DebateView>('floor');
  const [shareToken, setShareToken] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = new URLSearchParams(window.location.search).get('share');
    if (t) setShareToken(t);
  }, []);

  const exitShare = useCallback(() => {
    setShareToken(null);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('share');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'debate' },
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
    <LensShell lensId="debate" asMain={false}>
      <FirstRunTour lensId="debate" />
      <DepthBadge lensId="debate" size="sm" className="ml-2" />
      <div data-lens-theme="debate" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <Scale className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Debate</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="debate" data={realtimeData || {}} compact />
              </div>
              <p className={ds.textMuted}>
                Kialo claim tree + timed debate floor — one argumentation desk.
              </p>
            </div>
          </div>
        </header>

        {shareToken ? (
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <SharedDebateView shareToken={shareToken} onExit={exitShare} />
          </section>
        ) : (
          <>
            <nav
              className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
              aria-label="Debate views"
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
              <motion.div key={active} {...motionProps}>
                <Panel />
              </motion.div>
            </AnimatePresence>
          </>
        )}

        <RealtimeDataPanel domain="debate" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

        <section className="mt-3">
          <SessionRail lensId="debate" hideWhenEmpty />
        </section>
        <CrossLensRecentsPanel lensId="debate" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
