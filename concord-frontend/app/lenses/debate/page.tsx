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
import { GitBranch, MessageSquare, Timer } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { SessionRail } from '@/components/lens/SessionRail';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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

type DebateView = 'floor' | 'map' | 'cmv';

const VIEWS: { id: DebateView; label: string; keys: string; hint: string; icon: typeof Timer }[] = [
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<DebateView>('floor');
  const [shareToken, setShareToken] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    void Promise.resolve(new URLSearchParams(window.location.search).get('share')).then((t) => {
      if (!cancelled && t) setShareToken(t);
    });
    return () => { cancelled = true; };
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
      <NorthStarFrame
        lensId="debate"
        crumb="Debate"
        title={`Argue it out${active === 'floor' && who ? `, ${who}` : ''}`}
        subtitle="Kialo-style claim tree plus a timed debate floor: one argumentation desk."
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="debate" data={realtimeData || {}} compact />
          </>
        }
        tabs={shareToken ? undefined : VIEWS}
        activeTab={active}
        onTab={(id) => setActive(id as DebateView)}
        tabsLabel="Debate views"
        cta={{ label: 'Open the floor', icon: Timer, onClick: () => { exitShare(); setActive('floor'); }, title: 'Open the timed debate floor (1)' }}
      >
        {shareToken ? (
          <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <SharedDebateView shareToken={shareToken} onExit={exitShare} />
          </section>
        ) : (
          <>
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
      </NorthStarFrame>
    </LensShell>
  );
}
