'use client';

/**
 * Neuro lens: north-star chrome over every real neuro tool. EEG/MEG analysis
 * workbench on imported recordings, disclosed-synthetic bench mode, a toy
 * network trainer, and the research feeds (arXiv q-bio.NC, PubMed, Wikipedia).
 */

import { useCallback, useState } from 'react';
import { Activity, BookOpen, Cpu, Waves } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { NeuroFeed } from '@/components/neuro/NeuroFeed';
import { ArxivPanel } from '@/components/research/ArxivPanel';
import { PubMedPanel } from '@/components/research/PubMedPanel';
import { WikipediaSearchPanel } from '@/components/wiki/WikipediaSearchPanel';
import { NeuroActionPanel } from '@/components/neuro/NeuroActionPanel';
import { NeuroTrainPanel } from '@/components/neuro/NeuroTrainPanel';
import { EegWorkbench } from '@/components/neuro/EegWorkbench';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

type View = 'eeg' | 'bench' | 'train' | 'research';

const TITLES: Record<View, string> = {
  eeg: 'What the signal says',
  bench: 'Try it on a signal',
  train: 'Teach a small network',
  research: 'What the field is reading',
};

export default function NeuroLensPage() {
  useLensNav('neuro');
  useLensIdentity('neuro');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('neuro');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<View>('eeg');

  const importRecording = useCallback(() => {
    setView('eeg');
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-lens-theme="neuro"] input[type="file"]')?.click();
    });
  }, []);

  useLensCommand(
    [
      { id: 'view-eeg', keys: '1', description: 'EEG/MEG workbench', category: 'navigation' as const, action: () => setView('eeg') },
      { id: 'view-bench', keys: '2', description: 'Synthetic-signal bench', category: 'navigation' as const, action: () => setView('bench') },
      { id: 'view-train', keys: '3', description: 'Network trainer', category: 'navigation' as const, action: () => setView('train') },
      { id: 'view-research', keys: '4', description: 'Research references', category: 'navigation' as const, action: () => setView('research') },
      { id: 'import-recording', keys: 'n', description: 'Import a recording', category: 'actions' as const, action: importRecording },
    ],
    { lensId: 'neuro' },
  );

  return (
    <LensShell lensId="neuro" asMain={false}>
      <FirstRunTour lensId="neuro" />
      <DepthBadge lensId="neuro" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="neuro"
        crumb="Neuro"
        title={`${TITLES[view]}${view === 'eeg' && who ? `, ${who}` : ''}`}
        subtitle="EEG/MEG analysis workbench and a real, toy-scale network trainer. Every panel traces to a neuro-domain macro run on an imported recording or an explicitly disclosed synthetic signal."
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="neuro" data={realtimeData || {}} compact />
          </>
        }
        tabs={[
          { id: 'eeg', label: 'EEG / MEG', icon: Waves, keys: '1', hint: 'Import, epoch, ERP, time-frequency, source localization' },
          { id: 'bench', label: 'Bench', icon: Activity, keys: '2', hint: 'Disclosed-synthetic FFT, connectivity, ERP' },
          { id: 'train', label: 'Trainer', icon: Cpu, keys: '3', hint: 'Logistic-regression trainer on a disclosed toy dataset' },
          { id: 'research', label: 'Research', icon: BookOpen, keys: '4', hint: 'arXiv, PubMed, Wikipedia and the topic feed' },
        ]}
        activeTab={view}
        onTab={(id) => setView(id as View)}
        cta={{ label: 'Import a recording', icon: Waves, onClick: importRecording, title: 'Import a recording (N)' }}
      >
        <section key={view} className="space-y-6">
          {view === 'eeg' && <EegWorkbench />}
          {view === 'bench' && (
            <PipingProvider>
              <NeuroActionPanel />
            </PipingProvider>
          )}
          {view === 'train' && <NeuroTrainPanel />}
          {view === 'research' && (
            <>
              <div className="grid gap-5 xl:grid-cols-2">
                <ArxivPanel domain="neuro" title="arXiv · Neuroscience (q-bio.NC)" />
                <PubMedPanel domain="neuro" macro="live_pubmed_neuro" title="PubMed · neuroscience" initialQuery="brain plasticity" />
              </div>
              <div className="grid gap-5 xl:grid-cols-2">
                <WikipediaSearchPanel domain="neuro" title="Wikipedia · neuroscience" />
                <NeuroFeed />
              </div>
            </>
          )}
        </section>

        <RealtimeDataPanel domain="neuro" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      </NorthStarFrame>
    </LensShell>
  );
}
