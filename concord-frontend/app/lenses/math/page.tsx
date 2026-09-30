'use client';

/**
 * Math lens — one Wolfram/Desmos-shaped CAS.
 * Views: CAS engine, algebra lab, formula notebook, reference library.
 * All compute goes through lensRun('math', …) / useLensData. No client CAS.
 */

import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { FunctionSquare, Grid3x3, BookOpen, Library, Calculator } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { SubLensQuickNav } from '@/components/lens/SubLensQuickNav';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { SymbolicWorkbench } from '@/components/math/SymbolicWorkbench';
import { MathActionPanel } from '@/components/math/MathActionPanel';
import { FormulaNotebookPanel } from '@/components/math/FormulaNotebookPanel';
import { MathLibraryPanel } from '@/components/math/MathLibraryPanel';

const VIEWS = [
  { id: 'engine', label: 'CAS', keys: '1', icon: FunctionSquare },
  { id: 'algebra', label: 'Algebra', keys: '2', icon: Grid3x3 },
  { id: 'notebook', label: 'Notebook', keys: '3', icon: BookOpen },
  { id: 'library', label: 'Library', keys: '4', icon: Library },
] as const;

export default function MathLensPage() {
  useLensNav('math');
  useLensIdentity('math');
  const reduceMotion = useReducedMotion();
  const {
    latestData: realtimeData,
    alerts: realtimeAlerts,
    insights: realtimeInsights,
    isLive,
    lastUpdated,
  } = useRealtimeLens('math');
  const [active, setActive] = useState<'engine' | 'algebra' | 'notebook' | 'library'>('engine');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'math' },
  );

  return (
    <LensShell lensId="math" asMain={false}>
      <FirstRunTour lensId="math" />
      <DepthBadge lensId="math" size="sm" className="ml-2" />
      <div data-lens-theme="math" className={cn(ds.pageContainer, 'space-y-4')}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <Calculator className="h-7 w-7 shrink-0" style={{ color: 'var(--lens-accent)' }} />
            <div className="min-w-0">
              <h1 className={ds.heading1}>Math</h1>
              <p className={ds.textMuted}>
                Computer algebra · plot · solve. Same engine as the macros; no guessed arithmetic.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="math" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </header>

        <nav className={ds.tabBar} role="tablist" aria-label="Math views">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setActive(v.id)}
                className={on ? ds.tabActive('neon-blue') : ds.tabInactive}
              >
                <Icon className="h-4 w-4" />
                {v.label}
                <kbd className="ml-1 px-1 py-0.5 rounded bg-black/30 font-mono text-[10px] text-gray-400">{v.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
          >
            {active === 'engine' && <SymbolicWorkbench />}
            {active === 'algebra' && (
              <PipingProvider>
                <MathActionPanel />
              </PipingProvider>
            )}
            {active === 'notebook' && <FormulaNotebookPanel />}
            {active === 'library' && <MathLibraryPanel />}
          </motion.div>
        </AnimatePresence>

        <SubLensQuickNav lensId="math" />

        {realtimeData && (
          <RealtimeDataPanel
            domain="math"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}

        <CrossLensRecentsPanel lensId="math" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
