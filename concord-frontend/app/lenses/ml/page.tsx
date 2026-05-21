'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
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
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useState } from 'react';
import {
  Brain, TestTube, Beaker, Database, Trophy, Wand2, Rocket, Sparkles, Layers, ChevronDown,
} from 'lucide-react';
import { useUIStore } from '@/store/ui';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

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
  const [showFeatures, setShowFeatures] = useState(true);

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
      <FirstRunTour lensId="ml" />
      <ManifestActionBar />
      <DepthBadge lensId="ml" size="sm" className="ml-2" />
      <div data-lens-theme="ml" className="p-6 space-y-6">
        <ArxivPanel domain="ml" title="arXiv · Machine Learning (cs.LG)" />

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
        <UniversalActions domain="ml" artifactId={null} compact />

        {/* ML analysis bench — modelEvaluate / featureImportance / datasetProfile / hyperparameterSuggest */}
        <PipingProvider>
          <section className="mt-2">
            <MlActionPanel />
          </section>
        </PipingProvider>

        {/* Lens Features */}
        <div className="border-t border-white/10">
          <button onClick={() => setShowFeatures(!showFeatures)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg">
            <span className="flex items-center gap-2">
              <Layers className="w-4 h-4" />
              Lens Features & Capabilities
            </span>
            <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
          </button>
          {showFeatures && (
            <div className="px-4 pb-4">
              <LensFeaturePanel lensId="ml" />
            </div>
          )}
        </div>

        <section className="mt-2 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <MlRepos />
        </section>
      </div>

      <RecentMineCard domain="ml" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="ml" hideWhenEmpty className="mt-3" title="More actions" />
      <CrossLensRecentsPanel lensId="ml" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
