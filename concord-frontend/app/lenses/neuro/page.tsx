'use client';

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NeuroFeed } from '@/components/neuro/NeuroFeed';
import { ArxivPanel } from '@/components/research/ArxivPanel';
import { PubMedPanel } from '@/components/research/PubMedPanel';
import { WikipediaSearchPanel } from '@/components/wiki/WikipediaSearchPanel';
import { NeuroActionPanel } from '@/components/neuro/NeuroActionPanel';
import { NeuroTrainPanel } from '@/components/neuro/NeuroTrainPanel';
import { EegWorkbench } from '@/components/neuro/EegWorkbench';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { ds } from '@/lib/design-system';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

export default function NeuroLensPage() {
  useLensNav('neuro');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('neuro');
  const [showResearch, setShowResearch] = useState(false);
  const [showFeed, setShowFeed] = useState(false);

  return (
    <LensShell lensId="neuro" asMain={false}>
      <FirstRunTour lensId="neuro" />      <DepthBadge lensId="neuro" size="sm" className="ml-2" />
      <div data-lens-theme="neuro" className="space-y-6 p-6">
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <button
            type="button"
            onClick={() => setShowResearch(v => !v)}
            className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
          >
            <span>Research references (arXiv · PubMed · Wikipedia)</span>
            {showResearch ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {showResearch && (
            <div className="mt-3 space-y-4">
              {/* REAL arXiv q-bio.NC (neural computation) feed. */}
              <ArxivPanel domain="neuro" title="arXiv · Neuroscience (q-bio.NC)" />
              {/* REAL PubMed (neuroscience-filtered). */}
              <PubMedPanel domain="neuro" macro="live_pubmed_neuro" title="PubMed · neuroscience" initialQuery="brain plasticity" />
              {/* REAL Wikipedia neuroscience reference. */}
              <WikipediaSearchPanel domain="neuro" title="Wikipedia · neuroscience" />
            </div>
          )}
        </section>

        <header className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className={ds.heading1}>Neuro</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
              </div>
              <p className={ds.textMuted}>
                EEG/MEG analysis workbench + a real (if toy-scale) network trainer — every panel below
                traces to a neuro-domain macro run on either an imported recording or an explicitly
                disclosed synthetic signal.
              </p>
            </div>
          </div>
          <DTUExportButton domain="neuro" data={realtimeData || {}} compact />
        </header>

        <RealtimeDataPanel domain="neuro" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

        {/* EEGLAB / MNE-Python parity — real EEG/MEG analysis workbench on
            user-imported recordings: import, waveform window, topographic
            map, preprocessing pipeline, epoching, ERP, time-frequency,
            source localization, statistical testing. */}
        <EegWorkbench />

        {/* Bench mode — synthetic-signal FFT band power / connectivity / ERP,
            explicitly disclosed as synthetic, with mint/DM/publish/agent-
            interpretation actions. */}
        <PipingProvider>
          <NeuroActionPanel />
        </PipingProvider>

        {/* Network training — the one macro (`neuro.train`) neither of the
            above panels reaches: real logistic-regression training on a
            disclosed toy dataset, or an honestly-labelled hyperparameter
            projection when no dataset is attached. */}
        <NeuroTrainPanel />

        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <button
            type="button"
            onClick={() => setShowFeed(v => !v)}
            className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
          >
            <span>arXiv topic feed</span>
            {showFeed ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {showFeed && (
            <div className="mt-3">
              <NeuroFeed />
            </div>
          )}
        </section>
      </div>

      <a href="#neuro-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">
        Skip to neuro content
      </a>      <CrossLensRecentsPanel lensId="neuro" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
