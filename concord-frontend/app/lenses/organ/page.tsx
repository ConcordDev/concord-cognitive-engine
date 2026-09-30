'use client';

/**
 * Organ — one ChartHop + Concord self-model app.
 *
 * Single view union (designer | analysis | self-model | anatomy). Accordion
 * booleans for OrgDesigner/AnatomyExplorer are folded into active. Page is a
 * thin shell.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Heart, Network, Activity, BookOpen } from 'lucide-react';
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
import { OrgDesigner } from '@/components/organ/OrgDesigner';
import { OrgAnalysisPanel } from '@/components/organ/OrgAnalysisPanel';
import { SelfModelPanel } from '@/components/organ/SelfModelPanel';
import { AnatomyExplorer } from '@/components/organ/AnatomyExplorer';

type OrganView = 'designer' | 'analysis' | 'self-model' | 'anatomy';

const VIEWS: { id: OrganView; label: string; keys: string; hint: string; icon: typeof Heart }[] = [
  { id: 'designer', label: 'Org designer', keys: '1', hint: 'Headcount, HRIS, comp', icon: Network },
  { id: 'analysis', label: 'Analysis', keys: '2', hint: 'Span / skills / comms', icon: Activity },
  { id: 'self-model', label: 'Self-model', keys: '3', hint: 'Concord organ registry', icon: Heart },
  { id: 'anatomy', label: 'Anatomy', keys: '4', hint: 'Wikipedia reference', icon: BookOpen },
];

const PANELS: Record<OrganView, ComponentType> = {
  designer: OrgDesigner,
  analysis: OrgAnalysisPanel,
  'self-model': SelfModelPanel,
  anatomy: AnatomyExplorer,
};

export default function OrganLensPage() {
  useLensNav('organ');
  const { latestData: realtimeData, alerts: realtimeAlerts, isLive, lastUpdated } = useRealtimeLens('organ');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<OrganView>('designer');

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      { id: 'organ-grid', keys: 'v', description: 'Self-model grid view', category: 'view' as const, action: () => setActive('self-model') },
      { id: 'organ-timeline', keys: 'g', description: 'Self-model timeline view', category: 'view' as const, action: () => setActive('self-model') },
    ],
    { lensId: 'organ' },
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
    <LensShell lensId="organ" asMain={false}>
      <FirstRunTour lensId="organ" />
      <DepthBadge lensId="organ" size="sm" className="ml-2" />
      <div data-lens-theme="organ" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <Heart className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Organ</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="organ" data={realtimeData || {}} compact />
                {realtimeAlerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                    {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className={ds.textMuted}>
                Organizational design (ChartHop-parity) + Concord&apos;s own self-model organ registry
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Organ views"
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
          <motion.div key={active} {...motionProps} className="pt-4">
            <Panel />
          </motion.div>
        </AnimatePresence>

        <CrossLensRecentsPanel lensId="organ" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
