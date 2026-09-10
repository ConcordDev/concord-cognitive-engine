'use client';

/**
 * CRI — one CRETI / quality / crisis-planning app.
 *
 * Single view union (scores | distribution | loop | crisis). Accordion
 * booleans for QualityDistribution / QualityLoop / CrisisActionPanel are
 * gone. Each view is a panel that owns its hooks. Page is a thin shell.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { BarChart3, Activity, RefreshCw, Siren } from 'lucide-react';
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
import { PipingProvider } from '@/components/panel-polish';
import { ScoresPanel, DistributionPanel } from '@/components/cri/ScoresPanel';
import { QualityLoopPanel } from '@/components/cri/QualityLoopPanel';
import { CrisisActionPanel } from '@/components/cri/CrisisActionPanel';

type CriView = 'scores' | 'distribution' | 'loop' | 'crisis';

const VIEWS: { id: CriView; label: string; keys: string; hint: string; icon: typeof BarChart3 }[] = [
  { id: 'scores', label: 'Scores', keys: '1', hint: 'CRETI scorecard', icon: BarChart3 },
  { id: 'distribution', label: 'Distribution', keys: '2', hint: 'Quality histogram', icon: Activity },
  { id: 'loop', label: 'Quality loop', keys: '3', hint: 'Trend · rules · remediate', icon: RefreshCw },
  { id: 'crisis', label: 'Crisis', keys: '4', hint: 'Severity · timeline · impact', icon: Siren },
];

function CrisisPanel() {
  return (
    <PipingProvider>
      <CrisisActionPanel />
    </PipingProvider>
  );
}

const PANELS: Record<CriView, ComponentType> = {
  scores: ScoresPanel,
  distribution: DistributionPanel,
  loop: QualityLoopPanel,
  crisis: CrisisPanel,
};

export default function CRILensPage() {
  useLensNav('cri');
  useLensIdentity('cri');
  const { latestData: realtimeData, alerts: realtimeAlerts, isLive, lastUpdated } = useRealtimeLens('cri');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<CriView>('scores');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'cri' },
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
    <LensShell lensId="cri" asMain={false}>
      <FirstRunTour lensId="cri" />
      <DepthBadge lensId="cri" size="sm" className="ml-2" />
      <div data-lens-theme="cri" className={ds.pageContainer}>
        <a href="#cri-main" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">
          Skip to cri content
        </a>

        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <BarChart3 className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>CRI — CRETI Scores</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="cri" data={realtimeData || {}} compact />
                {realtimeAlerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                    {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className={ds.textMuted}>
                Coherence, Relevance, Evidence, Timeliness, Integration — one quality desk.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="CRI views"
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

        <main id="cri-main" className="min-w-0 pt-4">
          <AnimatePresence mode="wait">
            <motion.div key={active} {...motionProps}>
              <Panel />
            </motion.div>
          </AnimatePresence>
        </main>

        <CrossLensRecentsPanel lensId="cri" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
