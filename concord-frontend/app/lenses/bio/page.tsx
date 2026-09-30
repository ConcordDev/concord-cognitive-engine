'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ArxivPanel } from '@/components/research/ArxivPanel';
import { PubMedPanel } from '@/components/research/PubMedPanel';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import BioWorkbench from '@/components/bio/BioWorkbench';
import { MolecularWorkbench } from '@/components/bio/MolecularWorkbench';
import { SequenceAnalyzer } from '@/components/bio/SequenceAnalyzer';
import { BioActionPanel } from '@/components/bio/BioActionPanel';
import { BioResearchPanel } from '@/components/bio/BioResearchPanel';
import { PipingProvider } from '@/components/panel-polish';
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dna, Activity, Heart, Brain, Microscope, AlertTriangle, Bug, Wand2 } from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import LiveFeed, { adaptToLiveFeedArticles } from '@/components/lens/LiveFeed';

interface BioMetric {
  name: string;
  value: number;
}

interface GrowthOrgan {
  name: string;
  active: boolean;
  lastActivation?: string;
}

export default function BioLensPage() {
  useLensNav('bio');

  const [selectedSystem, setSelectedSystem] = useState('homeostasis');
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'organisms' | 'experiments' | 'sequences' | 'analyzer' | 'actions'>('organisms');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('bio');

  useLensCommand(
    [
      { id: 'tab-organisms', keys: 'o', description: 'Organisms', category: 'navigation', action: () => setActiveTab('organisms') },
      { id: 'tab-experiments', keys: 'e', description: 'Experiments', category: 'navigation', action: () => setActiveTab('experiments') },
      { id: 'tab-sequences', keys: 's', description: 'Sequences', category: 'navigation', action: () => setActiveTab('sequences') },
      { id: 'tab-analyzer', keys: 'a', description: 'Sequence analyzer', category: 'navigation', action: () => setActiveTab('analyzer') },
      { id: 'tab-actions', keys: 't', description: 'Bio actions', category: 'navigation', action: () => setActiveTab('actions') },
    ],
    { lensId: 'bio' }
  );

  const { items: bioItems, isLoading, isError: isError, error: error, refetch: refetch } = useLensData<Record<string, unknown>>('bio', 'system', { seed: [] });
  const bioData = useMemo(() => {
    if (!bioItems.length) return undefined;
    // Reconstruct the shape that templates expect from the raw API response
    const result: Record<string, unknown> = {};
    for (const item of bioItems) {
      const d = item.data as Record<string, unknown> | undefined;
      if (d) Object.assign(result, d);
    }
    return result as Record<string, unknown>;
  }, [bioItems]);

  const { data: growthData, isError: isError2, error: error2, refetch: refetch2,} = useQuery({
    queryKey: ['growth-status'],
    queryFn: () => apiHelpers.status.get().then((r) => r.data),
  });

  const systems = [
    { id: 'homeostasis', name: 'Homeostasis', icon: Heart, color: 'text-neon-pink' },
    { id: 'metabolism', name: 'Metabolism', icon: Activity, color: 'text-neon-green' },
    { id: 'neural', name: 'Neural Network', icon: Brain, color: 'text-neon-purple' },
    { id: 'genetic', name: 'Genetic Memory', icon: Dna, color: 'text-neon-blue' },
  ];


  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-pink border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError || isError2) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message} onRetry={() => { refetch(); refetch2(); }} />
      </div>
    );
  }
  return (
    <LensShell lensId="bio" asMain={false}>
      <FirstRunTour lensId="bio" />      <DepthBadge lensId="bio" size="sm" className="ml-2" />
    <div data-lens-theme="bio" className="p-6 space-y-6">
      {/* Phase 4 — REAL arXiv q-bio feed. */}
      <ArxivPanel domain="bio" title="arXiv · Quantitative Biology" />
      {/* Phase 4 — REAL PubMed (NCBI E-utilities) search. */}
      <PubMedPanel domain="bio" title="PubMed · biology" initialQuery="CRISPR" />
      {/* Disclaimer */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-200">
          Not medical advice. This lens provides biological modeling tools for educational and research purposes only. Consult qualified professionals for health decisions.
        </p>
      </div>
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🧬</span>
          <div>
            <h1 className="text-xl font-bold">Bio Lens</h1>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            <p className="text-sm text-gray-400">
              Biological system simulation and Growth OS metrics
            </p>
          </div>
        </div>
      </header>

      {/* Live arXiv papers — q-bio / bio.* categories */}
      <LiveFeed
        articles={adaptToLiveFeedArticles(realtimeData as Record<string, unknown> | null)}
        domain="research"
        isLive={isLive}
        lastUpdated={lastUpdated}
        limit={8}
      />
      <RealtimeDataPanel domain="bio" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <DTUExportButton domain="bio" data={{}} compact />

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Microscope, label: 'Bio Age', value: growthData?.bioAge || '0.00', color: 'text-neon-cyan' },
          { icon: Dna, label: 'Maturation', value: `${((growthData?.maturationLevel || 0) * 100).toFixed(1)}%`, color: 'text-neon-purple' },
          { icon: Bug, label: 'Organisms', value: String(bioItems.length), color: 'text-neon-green' },
          { icon: Activity, label: 'Active Organs', value: String(growthData?.organs?.filter((o: GrowthOrgan) => o.active).length || 0), color: 'text-neon-pink' },
        ].map((stat, i) => (
          <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="lens-card text-center">
            <stat.icon className={`w-6 h-6 mx-auto mb-2 ${stat.color}`} />
            <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            <p className="text-xs text-gray-400 mt-1">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-black/30 border border-white/10 rounded-lg p-1">
        {([
          { key: 'organisms' as const, label: 'Organisms', icon: Bug },
          { key: 'experiments' as const, label: 'Experiments', icon: Microscope },
          { key: 'sequences' as const, label: 'Sequences', icon: Dna },
          { key: 'analyzer' as const, label: 'Analyzer', icon: Dna },
          { key: 'actions' as const, label: 'Actions', icon: Wand2 },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1 justify-center ${
              activeTab === tab.key ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-400 hover:text-white'
            }`}>
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
      {activeTab === 'organisms' && (
        <motion.div key="organisms" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      {/* Bio Age Display */}
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="panel p-6 text-center">
        <Microscope className="w-12 h-12 mx-auto text-neon-cyan mb-4" />
        <p className="text-sm text-gray-400 mb-2">System Biological Age</p>
        <p className="text-5xl font-bold text-gradient-neon">
          {growthData?.bioAge || '0.00'}
        </p>
        <p className="text-sm text-gray-400 mt-2">
          Maturation: {((growthData?.maturationLevel || 0) * 100).toFixed(1)}%
        </p>
      </motion.div>

      {/* System Selector */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
        {systems.map((system, i) => {
          const Icon = system.icon;
          return (
            <motion.button
              key={system.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              onClick={() => setSelectedSystem(system.id)}
              className={`lens-card text-center ${
                selectedSystem === system.id ? 'border-neon-cyan glow-blue' : ''
              }`}
            >
              <Icon className={`w-8 h-8 mx-auto mb-2 ${system.color}`} />
              <p className="font-medium text-sm">{system.name}</p>
            </motion.button>
          );
        })}
      </div>
        </motion.div>
      )}

      {activeTab === 'experiments' && (
        <motion.div key="experiments" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          {/* NCBI/UniProt-style analysis bench — sequence alignment, gene
              expression, phylogenetics, motif scanning, organism profiling,
              pathway mapping, protocol review, gene→function, evolution
              tracing, FASTA parsing. Every tool is a real bio.* macro call,
              never a fabricated status list. */}
          <BioResearchPanel />
        </motion.div>
      )}

      {activeTab === 'sequences' && (
        <motion.div key="sequences" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          {/* Benchling/SnapGene parity — plasmid maps, MSA, in-silico cloning,
              ORF/translation, BLAST homology, CRISPR guide design, lab notebook.
              Every panel is wired to a real bio.* macro. */}
          <MolecularWorkbench />
        </motion.div>
      )}

      {activeTab === 'analyzer' && (
        <motion.div key="analyzer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <SequenceAnalyzer />
        </motion.div>
      )}

      {activeTab === 'actions' && (
        <motion.div key="actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <PipingProvider>
            <BioActionPanel />
          </PipingProvider>
        </motion.div>
      )}
      </AnimatePresence>

      {/* System Details */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Metrics */}
        <div className="panel p-4 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Activity className="w-4 h-4 text-neon-green" />
            {systems.find((s) => s.id === selectedSystem)?.name} Metrics
          </h3>

          {(bioData?.systems as Record<string, { metrics?: BioMetric[] }>)?.[selectedSystem]?.metrics?.map((metric: BioMetric) => (
            <div key={metric.name} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">{metric.name}</span>
                <span className="font-mono">{(metric.value ?? 0).toFixed(2)}</span>
              </div>
              <div className="h-2 bg-lattice-deep rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-neon-blue to-neon-cyan rounded-full transition-all"
                  style={{ width: `${Math.min(100, metric.value * 100)}%` }}
                />
              </div>
            </div>
          ))}

          {!(bioData?.systems as Record<string, { metrics?: BioMetric[] }>)?.[selectedSystem]?.metrics && (
            <p className="text-gray-400 text-center py-4">
              Loading system metrics...
            </p>
          )}
        </div>

        {/* Growth Organs */}
        <div className="panel p-4 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Dna className="w-4 h-4 text-neon-purple" />
            Active Growth Organs
          </h3>

          <div className="space-y-2">
            {growthData?.organs?.map((organ: GrowthOrgan) => (
              <div
                key={organ.name}
                className={`lens-card ${
                  organ.active ? 'border-neon-green/50' : 'opacity-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{organ.name}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      organ.active
                        ? 'bg-neon-green/20 text-neon-green'
                        : 'bg-gray-500/20 text-gray-400'
                    }`}
                  >
                    {organ.active ? 'Active' : 'Dormant'}
                  </span>
                </div>
                {organ.lastActivation && (
                  <p className="text-xs text-gray-400 mt-1">
                    Last: {new Date(organ.lastActivation).toLocaleString()}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Homeostasis Indicators */}
      <div className="panel p-4">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Heart className="w-4 h-4 text-neon-pink" />
          Homeostasis Balance
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { name: 'Energy', value: (bioData?.homeostasis as Record<string, number>)?.energy || 0.85 },
            { name: 'Coherence', value: (bioData?.homeostasis as Record<string, number>)?.coherence || 0.92 },
            { name: 'Stability', value: (bioData?.homeostasis as Record<string, number>)?.stability || 0.78 },
            { name: 'Adaptation', value: (bioData?.homeostasis as Record<string, number>)?.adaptation || 0.88 },
          ].map((indicator) => (
            <div key={indicator.name} className="lens-card text-center">
              <p className="text-3xl font-bold text-neon-cyan">
                {(indicator.value * 100).toFixed(0)}%
              </p>
              <p className="text-sm text-gray-400 mt-1">{indicator.name}</p>
            </div>
          ))}
        </div>
      </div>

    </div>
    {/* 2026 parity workbench — sequence analysis, primers, alignment, restriction, library */}
    <button
      type="button"
      onClick={() => setWorkbenchOpen(true)}
      className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-emerald-50 shadow-2xl text-sm font-medium"
      title="Bio Workbench — sequence analysis, primer design, alignment, restriction mapping"
    >
      Bio Workbench
    </button>
    <BioWorkbench open={workbenchOpen} onClose={() => setWorkbenchOpen(false)} />

          <CrossLensRecentsPanel lensId="bio" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
