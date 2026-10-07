'use client';

/**
 * Reasoning lens — EEGLAB / Lean-infoview density.
 *
 * One view union. Screens live in components/reasoning/. Client-only
 * premise/evidence/map card walls were dropped; maps, chains, HLR traces,
 * constraint checks, and the analysis engines are the product.
 */

import { useState, type ComponentType } from 'react';
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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import { HlrTracesLab } from '@/components/reasoning/HlrTracesPanel';
import { ConstraintCheckPanel } from '@/components/reasoning/ConstraintCheckPanel';
import { ChainProofPanel } from '@/components/reasoning/ChainProofPanel';
import { AnalysisPanel } from '@/components/reasoning/AnalysisPanel';
import { ArgumentMapStudio } from '@/components/reasoning/ArgumentMapStudio';
import { ArgumentWorkbench } from '@/components/reasoning/ArgumentWorkbench';
import { ReasoningArxiv } from '@/components/reasoning/ReasoningArxiv';

type View = 'traces' | 'constraints' | 'chains' | 'maps' | 'analysis' | 'workbench' | 'library';

const TABS: { id: View; label: string; kbd: string; icon: typeof Activity; title: string }[] = [
  { id: 'traces', label: 'Traces', kbd: 't', icon: Activity, title: 'How it got there' },
  { id: 'constraints', label: 'Constraints', kbd: 'c', icon: ShieldAlert, title: 'What must hold' },
  { id: 'chains', label: 'Chains', kbd: 'h', icon: Workflow, title: 'Step by step' },
  { id: 'maps', label: 'Maps', kbd: 'm', icon: GitBranch, title: 'The argument, mapped' },
  { id: 'analysis', label: 'Analysis', kbd: 'n', icon: BarChart3, title: 'Test the reasoning' },
  { id: 'workbench', label: 'Workbench', kbd: 'w', icon: Wrench, title: 'Build an argument' },
  { id: 'library', label: 'Library', kbd: 'l', icon: BookOpen, title: 'What the literature says' },
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<View>('traces');
  const current = TABS.find((t) => t.id === active)!;
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
      <div data-lens-theme="reasoning" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Reasoning</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{active === 'traces' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2 py-0.5 text-[11px] text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
            <DensityToggle variant="dropdown" />
            <DTUExportButton domain="reasoning" data={realtimeData || {}} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Reasoning views">
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
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {tab.label}
                <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{tab.kbd}</kbd>
              </button>
            );
          })}
        </nav>

        <section key={active} className="min-h-[28rem]">
          <Panel />
        </section>

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
        <CrossLensRecentsPanel lensId="reasoning" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={() => setActive('traces')}
          title="Open the reasoning traces (T)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Activity className="h-4 w-4" />
          Open a trace
        </button>
      </div>

      <MobileTabBar
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon }))}
        active={active}
        onSelect={(id) => setActive(id as View)}
      />
    </LensShell>
  );
}
