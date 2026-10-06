'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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
import { Dna, Activity, Heart, Brain, Microscope, AlertTriangle, Bug, Wand2, BookOpen, FlaskConical } from 'lucide-react';
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

type BioTab = 'organisms' | 'experiments' | 'sequences' | 'analyzer' | 'literature' | 'actions';

const TABS: { key: BioTab; label: string; keys: string; title: string; hint: string; icon: typeof Bug }[] = [
  { key: 'organisms', label: 'Organisms', keys: 'o', title: 'The living system', hint: 'Bio age, systems, growth organs and homeostasis', icon: Bug },
  { key: 'experiments', label: 'Experiments', keys: 'e', title: 'Run the analysis bench', hint: 'Alignment, expression, phylogenetics, motifs, pathways', icon: Microscope },
  { key: 'sequences', label: 'Sequences', keys: 's', title: 'Design and clone', hint: 'Plasmid maps, MSA, in-silico cloning, CRISPR guides', icon: Dna },
  { key: 'analyzer', label: 'Analyzer', keys: 'a', title: 'Read a sequence', hint: 'Sequence analyzer', icon: FlaskConical },
  { key: 'literature', label: 'Literature', keys: 'l', title: 'What the field is publishing', hint: 'arXiv q-bio, PubMed and live feeds', icon: BookOpen },
  { key: 'actions', label: 'Actions', keys: 't', title: 'Every bio macro', hint: 'Bio action workbench', icon: Wand2 },
];

export default function BioLensPage() {
  useLensNav('bio');

  const [selectedSystem, setSelectedSystem] = useState('homeostasis');
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [activeTab, setActiveTab] = useState<BioTab>('organisms');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('bio');

  useLensCommand(
    [
      ...TABS.map((t) => ({ id: `tab-${t.key}`, keys: t.keys, description: `${t.label} — ${t.hint}`, category: 'navigation' as const, action: () => setActiveTab(t.key) })),
      { id: 'bio-workbench', keys: 'w', description: 'Open Bio Workbench', category: 'actions' as const, action: () => setWorkbenchOpen(true) },
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
  const current = TABS.find((t) => t.key === activeTab)!;
  const card = 'rounded-2xl border border-white/10 bg-[#111] p-4';
  const homeo = bioData?.homeostasis as Record<string, number> | undefined;
  const homeoRows = (['energy', 'coherence', 'stability', 'adaptation'] as const)
    .filter((k) => typeof homeo?.[k] === 'number')
    .map((k) => ({ name: k[0].toUpperCase() + k.slice(1), value: homeo![k] }));
  const sysMetrics = (bioData?.systems as Record<string, { metrics?: BioMetric[] }> | undefined)?.[selectedSystem]?.metrics;

  return (
    <LensShell lensId="bio" asMain={false}>
      <FirstRunTour lensId="bio" />
      <DepthBadge lensId="bio" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="bio"
        crumb="Bio"
        title={`${current.title}${activeTab === 'organisms' && who ? `, ${who}` : ''}`}
        subtitle="Biological system simulation, Growth OS metrics and a full sequence-analysis bench."
        actions={
          <div className="flex items-center gap-3">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="bio" data={{}} compact />
          </div>
        }
        tabs={TABS.map((t) => ({ id: t.key, label: t.label, icon: t.icon, keys: t.keys, hint: t.hint }))}
        activeTab={activeTab}
        onTab={(id) => setActiveTab(id as BioTab)}
        tabsLabel="Bio views"
        cta={{ label: 'Bio Workbench', icon: FlaskConical, onClick: () => setWorkbenchOpen(true), title: 'Sequence analysis, primer design, alignment, restriction mapping (W)' }}
      >
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <p className="text-sm text-amber-200">
              Not medical advice. This lens provides biological modeling tools for educational and research purposes only. Consult qualified professionals for health decisions.
            </p>
          </div>

          {activeTab === 'organisms' && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  { icon: Microscope, label: 'Bio Age', value: growthData?.bioAge || '0.00', color: 'text-neon-cyan' },
                  { icon: Dna, label: 'Maturation', value: `${((growthData?.maturationLevel || 0) * 100).toFixed(1)}%`, color: 'text-neon-purple' },
                  { icon: Bug, label: 'Organisms', value: String(bioItems.length), color: 'text-neon-green' },
                  { icon: Activity, label: 'Active Organs', value: String(growthData?.organs?.filter((o: GrowthOrgan) => o.active).length || 0), color: 'text-neon-pink' },
                ].map((stat) => (
                  <div key={stat.label} className={`${card} text-center`}>
                    <stat.icon className={`mx-auto mb-2 h-6 w-6 ${stat.color}`} />
                    <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
                    <p className="mt-1 text-xs text-gray-400">{stat.label}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {systems.map((system) => {
                  const Icon = system.icon;
                  return (
                    <button
                      key={system.id}
                      type="button"
                      onClick={() => setSelectedSystem(system.id)}
                      aria-pressed={selectedSystem === system.id}
                      className={`${card} text-center transition-colors hover:border-white/25 ${selectedSystem === system.id ? 'border-neon-cyan/60' : ''}`}
                    >
                      <Icon className={`mx-auto mb-2 h-8 w-8 ${system.color}`} />
                      <p className="text-sm font-medium">{system.name}</p>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <div className={`${card} space-y-4`}>
                  <h3 className="flex items-center gap-2 font-semibold">
                    <Activity className="h-4 w-4 text-neon-green" />
                    {systems.find((s) => s.id === selectedSystem)?.name} Metrics
                  </h3>
                  {sysMetrics?.map((metric: BioMetric) => (
                    <div key={metric.name} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-400">{metric.name}</span>
                        <span className="font-mono">{(metric.value ?? 0).toFixed(2)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-gradient-to-r from-neon-blue to-neon-cyan transition-all" style={{ width: `${Math.min(100, metric.value * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                  {!sysMetrics && <p className="py-4 text-center text-gray-400">No metrics reported for this system yet.</p>}
                </div>

                <div className={`${card} space-y-3`}>
                  <h3 className="flex items-center gap-2 font-semibold">
                    <Dna className="h-4 w-4 text-neon-purple" />
                    Growth Organs
                  </h3>
                  {(growthData?.organs ?? []).length === 0 && <p className="py-4 text-center text-gray-400">No growth organs reported yet.</p>}
                  {growthData?.organs?.map((organ: GrowthOrgan) => (
                    <div key={organ.name} className={`rounded-xl border border-white/10 bg-white/[0.03] p-3 ${organ.active ? 'border-neon-green/40' : 'opacity-60'}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{organ.name}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${organ.active ? 'bg-neon-green/20 text-neon-green' : 'bg-gray-500/20 text-gray-400'}`}>
                          {organ.active ? 'Active' : 'Dormant'}
                        </span>
                      </div>
                      {organ.lastActivation && (
                        <p className="mt-1 text-xs text-gray-400">Last: {new Date(organ.lastActivation).toLocaleString()}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {homeoRows.length > 0 && (
                <div className={card}>
                  <h3 className="mb-4 flex items-center gap-2 font-semibold">
                    <Heart className="h-4 w-4 text-neon-pink" />
                    Homeostasis Balance
                  </h3>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {homeoRows.map((indicator) => (
                      <div key={indicator.name} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">
                        <p className="text-3xl font-bold text-neon-cyan">{(indicator.value * 100).toFixed(0)}%</p>
                        <p className="mt-1 text-sm text-gray-400">{indicator.name}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'experiments' && <BioResearchPanel />}
          {activeTab === 'sequences' && <MolecularWorkbench />}
          {activeTab === 'analyzer' && <SequenceAnalyzer />}

          {activeTab === 'literature' && (
            <>
              <ArxivPanel domain="bio" title="arXiv · Quantitative Biology" />
              <PubMedPanel domain="bio" title="PubMed · biology" initialQuery="CRISPR" />
              <LiveFeed
                articles={adaptToLiveFeedArticles(realtimeData as Record<string, unknown> | null)}
                domain="research"
                isLive={isLive}
                lastUpdated={lastUpdated}
                limit={8}
              />
              <RealtimeDataPanel domain="bio" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
            </>
          )}

          {activeTab === 'actions' && (
            <PipingProvider>
              <BioActionPanel />
            </PipingProvider>
          )}
        </div>
      </NorthStarFrame>
      <BioWorkbench open={workbenchOpen} onClose={() => setWorkbenchOpen(false)} />
    </LensShell>
  );
}
