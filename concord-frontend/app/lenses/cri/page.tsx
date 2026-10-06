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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { PipingProvider } from '@/components/panel-polish';
import { ScoresPanel, DistributionPanel } from '@/components/cri/ScoresPanel';
import { QualityLoopPanel } from '@/components/cri/QualityLoopPanel';
import { CrisisActionPanel } from '@/components/cri/CrisisActionPanel';

type CriView = 'scores' | 'distribution' | 'loop' | 'crisis';

const VIEWS: { id: CriView; label: string; keys: string; title: string; hint: string; icon: typeof BarChart3 }[] = [
  { id: 'scores', label: 'Scores', keys: '1', title: 'The index', hint: 'CRETI scorecard', icon: BarChart3 },
  { id: 'distribution', label: 'Distribution', keys: '2', title: 'How quality is spread', hint: 'Quality histogram', icon: Activity },
  { id: 'loop', label: 'Quality loop', keys: '3', title: 'Whether quality is improving', hint: 'Trend · rules · remediate', icon: RefreshCw },
  { id: 'crisis', label: 'Crisis', keys: '4', title: 'What the crisis costs', hint: 'Severity · timeline · impact', icon: Siren },
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<CriView>('scores');
  const current = VIEWS.find((v) => v.id === active)!;

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      { id: 'assess-crisis', keys: 'c', description: 'Assess a crisis', category: 'actions' as const, action: () => setActive('crisis') },
    ],
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
      <div data-lens-theme="cri" className="relative min-h-full px-8 pb-28 pt-6">
        <a href="#cri-main" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">
          Skip to cri content
        </a>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">CRI</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{active === 'scores' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 pt-2">
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2.5 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="cri" data={realtimeData || {}} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="CRI views">
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

        <main id="cri-main" className="min-w-0">
          <AnimatePresence mode="wait">
            <motion.div key={active} {...motionProps}>
              <Panel />
            </motion.div>
          </AnimatePresence>
        </main>

        <CrossLensRecentsPanel lensId="cri" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={() => setActive('crisis')}
          title="Assess a crisis (C)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Siren className="h-4 w-4" />
          Assess a crisis
        </button>
      </div>
    </LensShell>
  );
}
