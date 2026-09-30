'use client';

/**
 * Attention — one RescueTime/Sunsama focus desk.
 *
 * Single view union (focus | threads | emergent). Filter/sort for threads
 * lives inside ThreadsDeskPanel. Computational macros live with the Focus
 * Toolkit that feeds them. Page is a thin shell.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Eye, Focus, Layers, Brain } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
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
import { FocusDeskPanel } from '@/components/attention/FocusDeskPanel';
import { ThreadsDeskPanel } from '@/components/attention/ThreadsDeskPanel';
import { EmergentDeskPanel } from '@/components/attention/EmergentDeskPanel';

type AttentionView = 'focus' | 'threads' | 'emergent';

const VIEWS: { id: AttentionView; label: string; keys: string; hint: string; icon: typeof Eye }[] = [
  { id: 'focus', label: 'Focus', keys: '1', hint: 'Pomodoro · planner · macros', icon: Focus },
  { id: 'threads', label: 'Threads', keys: '2', hint: 'Cognitive threads · queue', icon: Layers },
  { id: 'emergent', label: 'Cognition', keys: '3', hint: 'Dream · forget · repair', icon: Brain },
];

const PANELS: Record<AttentionView, ComponentType> = {
  focus: FocusDeskPanel,
  threads: ThreadsDeskPanel,
  emergent: EmergentDeskPanel,
};

export default function AttentionLensPage() {
  useLensNav('attention');
  useLensIdentity('attention');
  const { latestData: realtimeData, alerts: realtimeAlerts, isLive, lastUpdated } = useRealtimeLens('attention');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<AttentionView>('focus');

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `attention-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      { id: 'attention-all', keys: 'a', description: 'All threads', category: 'view' as const, action: () => setActive('threads') },
      { id: 'attention-active', keys: 'v', description: 'Active threads', category: 'view' as const, action: () => setActive('threads') },
      { id: 'attention-pending', keys: 'p', description: 'Pending threads', category: 'view' as const, action: () => setActive('threads') },
      { id: 'attention-completed', keys: 'c', description: 'Completed threads', category: 'view' as const, action: () => setActive('threads') },
    ],
    { lensId: 'attention' },
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
    <LensShell lensId="attention" asMain={false}>
      <FirstRunTour lensId="attention" />
      <DepthBadge lensId="attention" size="sm" className="ml-2" />
      <div data-lens-theme="attention" className={ds.pageContainer}>
        <a href="#attention-main" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">
          Skip to attention content
        </a>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <Eye className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Attention</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="attention" data={realtimeData || {}} compact />
                {realtimeAlerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                    {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className={ds.textMuted}>
                RescueTime + Sunsama — focus sessions, cognitive threads, emergent cognition.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Attention views"
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

        <main id="attention-main" className="min-w-0 pt-4">
          <AnimatePresence mode="wait">
            <motion.div key={active} {...motionProps}>
              <Panel />
            </motion.div>
          </AnimatePresence>
        </main>

        <CrossLensRecentsPanel lensId="attention" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
