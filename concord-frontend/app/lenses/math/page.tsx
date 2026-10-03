'use client';

/**
 * Math lens — one Wolfram/Desmos-shaped CAS.
 * Views: CAS engine, algebra lab, formula notebook, reference library.
 * All compute goes through lensRun('math', …) / useLensData. No client CAS.
 */

import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { FunctionSquare, Grid3x3, BookOpen, Library } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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
      <NorthStarFrame
        lensId="math"
        crumb="Math"
        title={`Work it out${active === 'engine' && who ? `, ${who}` : ''}`}
        subtitle="Computer algebra, plot and solve on the same engine as the macros"
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="math" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </>
        }
        tabs={VIEWS}
        activeTab={active}
        onTab={(id) => setActive(id as typeof active)}
        tabsLabel="Math views"
        cta={{ label: 'Solve something', icon: FunctionSquare, onClick: () => setActive('engine'), title: 'Open the symbolic workbench' }}
      >
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
      </NorthStarFrame>
    </LensShell>
  );
}
