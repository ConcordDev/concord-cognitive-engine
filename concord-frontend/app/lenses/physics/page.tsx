'use client';

/**
 * Physics lens — one PhET / lab-notebook app.
 *
 * Single view union (lab | sandbox | solvers | notebook). The client Verlet
 * playground, server scene editor, equation solvers, and arXiv shelf are
 * separate screens — not stacked on one page.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Atom, FlaskConical, Calculator, BookOpen } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import LiveFeed, { adaptToLiveFeedArticles } from '@/components/lens/LiveFeed';
import { PhysicsLabPanel } from '@/components/physics/PhysicsLabPanel';
import { PhysicsSandboxPanel } from '@/components/physics/PhysicsSandboxPanel';
import { PhysicsSolversPanel } from '@/components/physics/PhysicsSolversPanel';
import { PhysicsNotebookPanel } from '@/components/physics/PhysicsNotebookPanel';

type PhysicsView = 'lab' | 'sandbox' | 'solvers' | 'notebook';

const VIEWS: { id: PhysicsView; label: string; keys: string; hint: string; icon: typeof Atom }[] = [
  { id: 'lab', label: 'Lab', keys: '1', hint: 'PhET scene editor', icon: FlaskConical },
  { id: 'sandbox', label: 'Sandbox', keys: '2', hint: 'Verlet playground', icon: Atom },
  { id: 'solvers', label: 'Solvers', keys: '3', hint: 'Kinematics · orbits · waves', icon: Calculator },
  { id: 'notebook', label: 'Notebook', keys: '4', hint: 'arXiv physics', icon: BookOpen },
];

const PANELS: Record<PhysicsView, ComponentType> = {
  lab: PhysicsLabPanel,
  sandbox: PhysicsSandboxPanel,
  solvers: PhysicsSolversPanel,
  notebook: PhysicsNotebookPanel,
};

export default function PhysicsLensPage() {
  useLensNav('physics');
  useLensIdentity('physics');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('physics');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<PhysicsView>('lab');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'physics' },
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
    <LensShell lensId="physics" asMain={false}>
      <FirstRunTour lensId="physics" />
      <DepthBadge lensId="physics" size="sm" className="ml-2" />
      <div data-lens-theme="physics" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <Atom className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Physics</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="physics" data={realtimeData || {}} compact />
                {realtimeAlerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                    {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className={ds.textMuted}>
                PhET lab + Algodoo sandbox — real engines, live arXiv, no toy numbers.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Physics views"
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

        <LiveFeed
          articles={adaptToLiveFeedArticles(realtimeData as Record<string, unknown> | null)}
          domain="research"
          isLive={isLive}
          lastUpdated={lastUpdated}
          limit={8}
        />
        {realtimeData && (
          <RealtimeDataPanel
            domain="physics"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}
        <CrossLensRecentsPanel lensId="physics" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
