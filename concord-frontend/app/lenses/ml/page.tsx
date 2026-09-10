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
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { useUIStore } from '@/store/ui';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

type Tab =
  | 'hub' | 'playground' | 'experiments' | 'datasets'
  | 'compare' | 'automl' | 'deployments' | 'spaces';

const TABS: { id: Tab; label: string; Icon: typeof Brain; key: string }[] = [
  { id: 'hub', label: 'Model Hub', Icon: Brain, key: 'm' },
  { id: 'playground', label: 'Playground', Icon: TestTube, key: 'l' },
  { id: 'experiments', label: 'Experiments', Icon: Beaker, key: 'e' },
  { id: 'datasets', label: 'Datasets', Icon: Database, key: 'd' },
  { id: 'compare', label: 'Compare', Icon: Trophy, key: 'c' },
  { id: 'automl', label: 'AutoML', Icon: Wand2, key: 'a' },
  { id: 'deployments', label: 'Deployments', Icon: Rocket, key: 'p' },
  { id: 'spaces', label: 'Spaces', Icon: Sparkles, key: 's' },
];

export default function MLLensPage() {
  useLensNav('ml');
  const { latestData: realtimeData, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('ml');

  const [tab, setTab] = useState<Tab>('hub');
  const [playgroundModel, setPlaygroundModel] = useState('');
  const [showArxiv, setShowArxiv] = useState(false);
  const [showActionPanel, setShowActionPanel] = useState(false);
  const [showRepos, setShowRepos] = useState(false);

  useLensCommand(
    TABS.map((t) => ({
      id: `tab-${t.id}`, keys: t.key, description: t.label,
      category: 'navigation', action: () => setTab(t.id),
    })),
    { lensId: 'ml' },
  );

  // Selecting a model anywhere routes it into the inference playground.
  const useInPlayground = (modelId: string) => {
    setPlaygroundModel(modelId);
    setTab('playground');
    useUIStore.getState().addToast({ type: 'info', message: `Loaded ${modelId} into playground` });
  };

  return (
    <LensShell lensId="ml" asMain={false}>
      <FirstRunTour lensId="ml" />      <DepthBadge lensId="ml" size="sm" className="ml-2" />
      <div data-lens-theme="ml" className="p-6 space-y-6">
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <button
            type="button"
            onClick={() => setShowArxiv(v => !v)}
            className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
          >
            <span>arXiv · Machine Learning (cs.LG)</span>
            {showArxiv ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {showArxiv && (
            <div className="mt-3">
              <ArxivPanel domain="ml" title="arXiv · Machine Learning (cs.LG)" />
            </div>
          )}
        </section>

        <header className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🤖</span>
            <div>
              <h1 className="text-xl font-bold">ML Lens</h1>
              <p className="text-sm text-gray-400">
                Model hub, inference, experiment tracking, deployment & demo spaces
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="ml" data={realtimeData || {}} compact />
          </div>
        </header>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-lattice-surface/50 p-1 rounded-lg w-fit flex-wrap">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-md flex items-center gap-2 transition-colors ${
                tab === t.id ? 'bg-neon-purple/20 text-neon-purple' : 'hover:bg-white/5'
              }`}>
              <t.Icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content — every panel wired to real backend macros */}
        {tab === 'hub' && <ModelHubPanel onUseInPlayground={useInPlayground} />}
        {tab === 'playground' && <InferencePlayground initialModel={playgroundModel} />}
        {tab === 'experiments' && <ExperimentTracker />}
        {tab === 'datasets' && <DatasetHubPanel />}
        {tab === 'compare' && <ModelComparePanel />}
        {tab === 'automl' && <AutoMLPanel onUseModel={useInPlayground} />}
        {tab === 'deployments' && <DeploymentsPanel defaultModelId={playgroundModel} />}
        {tab === 'spaces' && <SpacesPanel defaultModelId={playgroundModel} />}

        <RealtimeDataPanel data={realtimeInsights} />

        {/* ML analysis bench — modelEvaluate / featureImportance / datasetProfile / hyperparameterSuggest */}
        <section className="mt-2 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <button
            type="button"
            onClick={() => setShowActionPanel(v => !v)}
            className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
          >
            <span>Analysis bench</span>
            {showActionPanel ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {showActionPanel && (
            <div className="mt-3">
              <PipingProvider>
                <MlActionPanel />
              </PipingProvider>
            </div>
          )}
        </section>

        <section className="mt-2 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <button
            type="button"
            onClick={() => setShowRepos(v => !v)}
            className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
          >
            <span>ML repos (GitHub)</span>
            {showRepos ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {showRepos && (
            <div className="mt-3">
              <MlRepos />
            </div>
          )}
        </section>
      </div>      <CrossLensRecentsPanel lensId="ml" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
