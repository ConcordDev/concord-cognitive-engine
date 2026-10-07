'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ArxivPanel } from '@/components/research/ArxivPanel';
import { MlRepos } from '@/components/ml/MlRepos';
import { MlActionPanel } from '@/components/ml/MlActionPanel';
import { ModelHubPanel } from '@/components/ml/ModelHubPanel';
import { InferencePlayground } from '@/components/ml/InferencePlayground';
import { ExperimentTracker } from '@/components/ml/ExperimentTracker';
import { DatasetHubPanel } from '@/components/ml/DatasetHubPanel';
import { ModelComparePanel } from '@/components/ml/ModelComparePanel';
import { AutoMLPanel } from '@/components/ml/AutoMLPanel';
import { DeploymentsPanel } from '@/components/ml/DeploymentsPanel';
import { SpacesPanel } from '@/components/ml/SpacesPanel';
import { PipingProvider } from '@/components/panel-polish';
import { useState } from 'react';
import {
  Brain, TestTube, Beaker, Database, Trophy, Wand2, Rocket, Sparkles,
  BookOpen, SlidersHorizontal, GitBranch,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/store/ui';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

type Tab =
  | 'hub' | 'playground' | 'experiments' | 'datasets'
  | 'compare' | 'automl' | 'deployments' | 'spaces' | 'bench' | 'arxiv' | 'repos';

const TABS: { id: Tab; label: string; Icon: typeof Brain; key: string; title: string }[] = [
  { id: 'hub', label: 'Model Hub', Icon: Brain, key: 'm', title: 'Your models' },
  { id: 'playground', label: 'Playground', Icon: TestTube, key: 'l', title: 'Try a model' },
  { id: 'experiments', label: 'Experiments', Icon: Beaker, key: 'e', title: 'Every run, tracked' },
  { id: 'datasets', label: 'Datasets', Icon: Database, key: 'd', title: 'The data behind it' },
  { id: 'compare', label: 'Compare', Icon: Trophy, key: 'c', title: 'Which model wins' },
  { id: 'automl', label: 'AutoML', Icon: Wand2, key: 'a', title: 'Let it search for you' },
  { id: 'deployments', label: 'Deployments', Icon: Rocket, key: 'p', title: 'What is serving now' },
  { id: 'spaces', label: 'Spaces', Icon: Sparkles, key: 's', title: 'Demos you can share' },
  { id: 'bench', label: 'Analysis bench', Icon: SlidersHorizontal, key: 'b', title: 'Evaluate, profile, tune' },
  { id: 'arxiv', label: 'arXiv', Icon: BookOpen, key: 'x', title: 'New papers in cs.LG' },
  { id: 'repos', label: 'Repos', Icon: GitBranch, key: 'g', title: 'ML repositories on GitHub' },
];

export default function MLLensPage() {
  useLensNav('ml');
  const { latestData: realtimeData, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('ml');

  const [tab, setTab] = useState<Tab>('hub');
  const [playgroundModel, setPlaygroundModel] = useState('');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

  useLensCommand(
    [
      ...TABS.map((t) => ({
        id: `tab-${t.id}`, keys: t.key, description: t.label,
        category: 'navigation' as const, action: () => setTab(t.id),
      })),
      { id: 'run-model', keys: 'n', description: 'Run a model', category: 'actions' as const, action: () => setTab('playground') },
    ],
    { lensId: 'ml' },
  );
  const current = TABS.find((t) => t.id === tab)!;

  // Selecting a model anywhere routes it into the inference playground.
  const useInPlayground = (modelId: string) => {
    setPlaygroundModel(modelId);
    setTab('playground');
    useUIStore.getState().addToast({ type: 'info', message: `Loaded ${modelId} into playground` });
  };

  return (
    <LensShell lensId="ml" asMain={false}>
      <FirstRunTour lensId="ml" />
      <DepthBadge lensId="ml" size="sm" className="ml-2" />
      <div data-lens-theme="ml" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">ML</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{tab === 'hub' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="ml" data={realtimeData || {}} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="ML views">
          {TABS.map((t) => {
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={on ? 'page' : undefined}
                title={`${t.label} (${t.key})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <t.Icon className="h-3.5 w-3.5" />
                {t.label}
                <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{t.key}</kbd>
              </button>
            );
          })}
        </nav>

        {/* Tab content — every panel wired to real backend macros */}
        {tab === 'hub' && <ModelHubPanel onUseInPlayground={useInPlayground} />}
        {tab === 'playground' && <InferencePlayground initialModel={playgroundModel} />}
        {tab === 'experiments' && <ExperimentTracker />}
        {tab === 'datasets' && <DatasetHubPanel />}
        {tab === 'compare' && <ModelComparePanel />}
        {tab === 'automl' && <AutoMLPanel onUseModel={useInPlayground} />}
        {tab === 'deployments' && <DeploymentsPanel defaultModelId={playgroundModel} />}
        {tab === 'spaces' && <SpacesPanel defaultModelId={playgroundModel} />}

        {tab === 'bench' && (
          <section className="rounded-2xl border border-white/10 bg-[#111] p-5">
            <PipingProvider>
              <MlActionPanel />
            </PipingProvider>
          </section>
        )}
        {tab === 'arxiv' && (
          <section className="rounded-2xl border border-white/10 bg-[#111] p-5">
            <ArxivPanel domain="ml" title="arXiv · Machine Learning (cs.LG)" />
          </section>
        )}
        {tab === 'repos' && (
          <section className="rounded-2xl border border-white/10 bg-[#111] p-5">
            <MlRepos />
          </section>
        )}

        <div className="mt-6">
          <RealtimeDataPanel data={realtimeInsights} />
        </div>

        <CrossLensRecentsPanel lensId="ml" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={() => setTab('playground')}
          title="Run a model (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <TestTube className="h-4 w-4" />
          Run a model
        </button>
      </div>
    </LensShell>
  );
}
