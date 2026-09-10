'use client';

/**
 * Lock — one sovereignty + concurrency-profiler app.
 *
 * Single view union (sovereignty | profiler | security). Profiler and
 * SecurityRepos accordion folded into active. Page is a thin shell.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Lock, Activity, ShieldAlert } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { SovereigntyPanel } from '@/components/lock/SovereigntyPanel';
import { LockProfiler } from '@/components/lock/LockProfiler';
import { SecurityRepos } from '@/components/lock/SecurityRepos';

type LockView = 'sovereignty' | 'profiler' | 'security';

const VIEWS: { id: LockView; label: string; keys: string; hint: string; icon: typeof Lock }[] = [
  { id: 'sovereignty', label: 'Sovereignty', keys: '1', hint: '70% lock + invariants', icon: Lock },
  { id: 'profiler', label: 'Profiler', keys: '2', hint: 'Concurrency lock traces', icon: Activity },
  { id: 'security', label: 'Security', keys: '3', hint: 'External tooling reference', icon: ShieldAlert },
];

export default function LockLensPage() {
  useLensNav('lock');
  const { latestData: realtimeData, alerts: realtimeAlerts, isLive, lastUpdated } = useRealtimeLens('lock');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<LockView>('sovereignty');

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      { id: 'open-setup', keys: 's', description: 'Open sovereignty setup', category: 'actions' as const, action: () => setActive('sovereignty') },
    ],
    { lensId: 'lock' },
  );

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

  let body: ReactNode = null;
  if (active === 'sovereignty') body = <SovereigntyPanel />;
  else if (active === 'profiler') body = <LockProfiler />;
  else body = <SecurityRepos />;

  return (
    <LensShell lensId="lock" asMain={false}>
      <FirstRunTour lensId="lock" />
      <DepthBadge lensId="lock" size="sm" className="ml-2" />
      <div data-lens-theme="lock" className={ds.pageContainer}>
        <a href="#lock-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">
          Skip to lock content
        </a>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-amber-500/40 bg-amber-500/10">
              <Lock className="w-6 h-6 text-amber-300" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Lock</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="lock" data={realtimeData || {}} compact />
                {realtimeAlerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                    {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className={ds.textMuted}>
                70% sovereignty lock + JFR-style concurrency profiler
              </p>
            </div>
          </div>
        </header>

        <nav
          id="lock-skip"
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Lock views"
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
                    ? 'border-amber-400 text-amber-200'
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
            {body}
          </motion.div>
        </AnimatePresence>

        <CrossLensRecentsPanel lensId="lock" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
