'use client';

/**
 * Reasoning lens — EEGLAB / Lean-infoview density.
 *
 * One view union. Screens live in components/reasoning/. Client-only
 * premise/evidence/map card walls were dropped; maps, chains, HLR traces,
 * constraint checks, and the analysis engines are the product.
 */

import { useState, type ComponentType } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity, ShieldAlert, GitBranch, BarChart3, Wrench, BookOpen, Workflow,
} from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import { DensityToggle } from '@/components/ui/DensityToggle';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { HlrTracesLab } from '@/components/reasoning/HlrTracesPanel';
import { ConstraintCheckPanel } from '@/components/reasoning/ConstraintCheckPanel';
import { ChainProofPanel } from '@/components/reasoning/ChainProofPanel';
import { AnalysisPanel } from '@/components/reasoning/AnalysisPanel';
import { ArgumentMapStudio } from '@/components/reasoning/ArgumentMapStudio';
import { ArgumentWorkbench } from '@/components/reasoning/ArgumentWorkbench';
import { ReasoningArxiv } from '@/components/reasoning/ReasoningArxiv';

type View = 'traces' | 'constraints' | 'chains' | 'maps' | 'analysis' | 'workbench' | 'library';

const TABS: { id: View; label: string; kbd: string; icon: typeof Activity }[] = [
  { id: 'traces', label: 'Traces', kbd: 't', icon: Activity },
  { id: 'constraints', label: 'Constraints', kbd: 'c', icon: ShieldAlert },
  { id: 'chains', label: 'Chains', kbd: 'h', icon: Workflow },
  { id: 'maps', label: 'Maps', kbd: 'm', icon: GitBranch },
  { id: 'analysis', label: 'Analysis', kbd: 'n', icon: BarChart3 },
  { id: 'workbench', label: 'Workbench', kbd: 'w', icon: Wrench },
  { id: 'library', label: 'Library', kbd: 'l', icon: BookOpen },
];

const PANELS: Record<View, ComponentType> = {
  traces: HlrTracesLab,
  constraints: ConstraintCheckPanel,
  chains: ChainProofPanel,
  maps: ArgumentMapStudio,
  analysis: AnalysisPanel,
  workbench: ArgumentWorkbench,
  library: ReasoningArxiv,
};

export default function ReasoningLensPage() {
  useLensNav('reasoning');
  useLensIdentity('reasoning');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('reasoning');
  const [active, setActive] = useState<View>('traces');
  const Panel = PANELS[active];

  useLensCommand(
    [
      { id: 'tab-traces', keys: 't', description: 'Traces', category: 'navigation', action: () => setActive('traces') },
      { id: 'tab-constraints', keys: 'c', description: 'Constraints', category: 'navigation', action: () => setActive('constraints') },
      { id: 'tab-chains', keys: 'h', description: 'Chains', category: 'navigation', action: () => setActive('chains') },
      { id: 'tab-maps', keys: 'm', description: 'Maps', category: 'navigation', action: () => setActive('maps') },
      { id: 'tab-analysis', keys: 'n', description: 'Analysis', category: 'navigation', action: () => setActive('analysis') },
      { id: 'tab-workbench', keys: 'w', description: 'Workbench', category: 'navigation', action: () => setActive('workbench') },
      { id: 'tab-library', keys: 'l', description: 'Library', category: 'navigation', action: () => setActive('library') },
    ],
    { lensId: 'reasoning' },
  );

  return (
    <LensShell lensId="reasoning" asMain={false}>
      <FirstRunTour lensId="reasoning" />
      <DepthBadge lensId="reasoning" size="sm" className="ml-2" />
      <div data-lens-theme="reasoning" className={cn(ds.pageContainer, 'p-3 md:p-4 space-y-3')}>
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--lens-accent,#4527A0)]/25 pb-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-violet-300/80">HLR lab</span>
            <h1 className="text-sm md:text-base font-semibold text-white truncate">Reasoning</h1>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            {realtimeAlerts.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <DensityToggle variant="dropdown" />
            <DTUExportButton domain="reasoning" data={realtimeData || {}} compact />
          </div>
        </header>

        <nav className="flex items-center gap-0.5 overflow-x-auto border-b border-zinc-800" aria-label="Reasoning views">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const on = active === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActive(tab.id)}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors',
                  on
                    ? 'text-violet-200 border-violet-400 bg-violet-500/10'
                    : 'text-zinc-400 border-transparent hover:text-white hover:bg-zinc-900/60',
                )}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                {tab.label}
                <kbd className="hidden md:inline ml-0.5 font-mono text-[9px] text-zinc-500">{tab.kbd}</kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14 }}
            className="min-h-[28rem]"
          >
            <Panel />
          </motion.div>
        </AnimatePresence>

        {realtimeData && (
          <RealtimeDataPanel
            domain="reasoning"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}
        <CrossLensRecentsPanel lensId="reasoning" sinceDays={7} limit={6} hideWhenEmpty className="mt-2" />
      </div>

      <MobileTabBar
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon }))}
        active={active}
        onSelect={(id) => setActive(id as View)}
      />
    </LensShell>
  );
}
