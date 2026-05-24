'use client';

import { useState, useCallback, useEffect } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { SufferingRef } from '@/components/suffering/SufferingRef';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useQuery } from '@tanstack/react-query';
import { api, lensRun } from '@/lib/api/client';
import {
  AlertTriangle, Heart, Brain, Layers, ChevronDown, Activity,
} from 'lucide-react';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { PainBoard } from '@/components/suffering/PainBoard';
import type { Pain, Theme } from '@/components/suffering/PainBoard';
import { PriorityMatrix } from '@/components/suffering/PriorityMatrix';
import { ThemeClusters } from '@/components/suffering/ThemeClusters';
import { InterventionTracker } from '@/components/suffering/InterventionTracker';
import type { Intervention } from '@/components/suffering/InterventionTracker';
import { TrendView } from '@/components/suffering/TrendView';
import { RootCausePanel } from '@/components/suffering/RootCausePanel';
import { ReportExport } from '@/components/suffering/ReportExport';

type Tab = 'board' | 'matrix' | 'themes' | 'rootcause' | 'interventions' | 'trends' | 'wellbeing';

const TABS: { id: Tab; label: string }[] = [
  { id: 'board', label: 'Pain Board' },
  { id: 'matrix', label: 'Priority Matrix' },
  { id: 'themes', label: 'Themes' },
  { id: 'rootcause', label: 'Root Cause' },
  { id: 'interventions', label: 'Interventions' },
  { id: 'trends', label: 'Trends' },
  { id: 'wellbeing', label: 'Engine Wellbeing' },
];

export default function SufferingLensPage() {
  useLensNav('suffering');
  const [tab, setTab] = useState<Tab>('board');
  const [showFeatures, setShowFeatures] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Shared pain-point dataset (used by board, matrix, themes, rootcause, interventions).
  const [pains, setPains] = useState<Pain[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [interventions, setInterventions] = useState<Intervention[]>([]);
  const [intvByStatus, setIntvByStatus] = useState<Record<string, number>>({});
  const [unthemed, setUnthemed] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [pl, tl, il] = await Promise.all([
      lensRun<{ pains: Pain[] }>('suffering', 'pain-list', {}),
      lensRun<{ themes: Theme[]; unthemedPains: number }>('suffering', 'theme-list', {}),
      lensRun<{ interventions: Intervention[]; byStatus: Record<string, number> }>('suffering', 'intervention-list', {}),
    ]);
    if (pl.data.ok && pl.data.result) setPains(pl.data.result.pains || []);
    if (tl.data.ok && tl.data.result) {
      setThemes(tl.data.result.themes || []);
      setUnthemed(tl.data.result.unthemedPains || 0);
    }
    if (il.data.ok && il.data.result) {
      setInterventions(il.data.result.interventions || []);
      setIntvByStatus(il.data.result.byStatus || {});
    }
    setLoading(false);
  }, []);

  const onChanged = useCallback(() => {
    setRefreshKey((k) => k + 1);
    loadAll();
  }, [loadAll]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadAll(); }, []);

  useLensCommand(
    [
      { id: 'refresh', keys: 'r', description: 'Refresh data', category: 'actions', action: () => onChanged() },
      { id: 'board', keys: 'b', description: 'Pain board', category: 'navigation', action: () => setTab('board') },
      { id: 'matrix', keys: 'm', description: 'Priority matrix', category: 'navigation', action: () => setTab('matrix') },
    ],
    { lensId: 'suffering' }
  );

  // Engine-self wellbeing — Chicken2 metrics from /api/status.
  const { data: status } = useQuery({
    queryKey: ['backend-status'],
    queryFn: () => api.get('/api/status').then((r) => r.data),
  });
  const metrics = {
    suffering: status?.suffering ?? 0.15,
    homeostasis: status?.homeostasis ?? 0.82,
    contradictionLoad: status?.contradictionLoad ?? 0.08,
    functionalDecline: status?.functionalDecline ?? 0.05,
    stressAccumulation: status?.stressAccumulation ?? 0.12,
    coherenceScore: status?.coherenceScore ?? 0.88,
  };

  const openPains = pains.filter((p) => p.status !== 'resolved').length;

  return (
    <LensShell lensId="suffering" asMain={false}>
      <FirstRunTour lensId="suffering" />
      <ManifestActionBar />
      <DepthBadge lensId="suffering" size="sm" className="ml-2" />
      <LensVerticalHero lensId="suffering" className="mx-6 mt-4" />
      <div className="p-6 space-y-6">
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-200">
            Not medical advice. This lens analyzes pain points and system-level wellbeing.
            For personal health concerns, consult a qualified healthcare provider.
          </p>
        </div>

        <header className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">💔</span>
            <div>
              <h1 className="text-xl font-bold">Suffering Lens</h1>
              <p className="text-sm text-gray-400">Pain-point mapping, root-cause analysis &amp; intervention tracking</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="px-3 py-1.5 rounded-lg bg-rose-500/15 text-rose-300 text-sm">
              <span className="font-bold">{openPains}</span> open pains
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 text-sm">
              <span className="font-bold">{pains.length - openPains}</span> resolved
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 text-sm">
              <span className="font-bold">{interventions.length}</span> interventions
            </div>
          </div>
        </header>

        <UniversalActions domain="suffering" artifactId={undefined} compact />

        {/* Tab nav */}
        <div className="flex gap-1 border-b border-white/10 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3.5 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-neon-cyan text-neon-cyan'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'board' && (
          <PainBoard pains={pains} themes={themes} loading={loading} onChanged={onChanged} />
        )}
        {tab === 'matrix' && <PriorityMatrix refreshKey={refreshKey} />}
        {tab === 'themes' && (
          <ThemeClusters themes={themes} unthemedCount={unthemed} loading={loading} onChanged={onChanged} />
        )}
        {tab === 'rootcause' && <RootCausePanel pains={pains} />}
        {tab === 'interventions' && (
          <InterventionTracker
            interventions={interventions}
            pains={pains}
            byStatus={intvByStatus}
            loading={loading}
            onChanged={onChanged}
          />
        )}
        {tab === 'trends' && (
          <div className="space-y-6">
            <TrendView refreshKey={refreshKey} onChanged={onChanged} />
            <ReportExport />
          </div>
        )}
        {tab === 'wellbeing' && <EngineWellbeing metrics={metrics} />}

        {/* Lens Features */}
        <div className="border-t border-white/10">
          <button
            onClick={() => setShowFeatures(!showFeatures)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
          >
            <span className="flex items-center gap-2">
              <Layers className="w-4 h-4" />
              Lens Features &amp; Capabilities
            </span>
            <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
          </button>
          {showFeatures && (
            <div className="px-4 pb-4">
              <LensFeaturePanel lensId="suffering" />
            </div>
          )}
        </div>
        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <SufferingRef />
        </section>
      </div>
      <RecentMineCard domain="suffering" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="suffering" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="suffering" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

function EngineWellbeing({
  metrics,
}: {
  metrics: {
    suffering: number; homeostasis: number; contradictionLoad: number;
    functionalDecline: number; stressAccumulation: number; coherenceScore: number;
  };
}) {
  const healthScore = (metrics.homeostasis - metrics.suffering) * 100;
  const cards: { icon: React.ReactNode; label: string; value: number; color: string; desc: string }[] = [
    { icon: <AlertTriangle className="w-5 h-5" />, label: 'Suffering', value: metrics.suffering, color: '#ec4899', desc: 'Pain signal from contradictions' },
    { icon: <Heart className="w-5 h-5" />, label: 'Homeostasis', value: metrics.homeostasis, color: '#22c55e', desc: 'System balance state' },
    { icon: <Brain className="w-5 h-5" />, label: 'Coherence', value: metrics.coherenceScore, color: '#06b6d4', desc: 'Logical consistency' },
    { icon: <Activity className="w-5 h-5" />, label: 'Contradiction Load', value: metrics.contradictionLoad, color: '#a855f7', desc: 'Unresolved conflicts' },
    { icon: <Activity className="w-5 h-5" />, label: 'Functional Decline', value: metrics.functionalDecline, color: '#ef4444', desc: 'Capability degradation' },
    { icon: <Activity className="w-5 h-5" />, label: 'Stress Accumulation', value: metrics.stressAccumulation, color: '#3b82f6', desc: 'Unprocessed stress' },
  ];
  return (
    <div className="space-y-6">
      <div className="panel p-4 flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Engine Self-Wellbeing</h3>
          <p className="text-sm text-gray-400">Chicken2 metrics from the cognitive engine&apos;s own state</p>
        </div>
        <div className={`px-4 py-2 rounded-lg ${
          healthScore > 70 ? 'bg-neon-green/20 text-neon-green'
            : healthScore > 40 ? 'bg-neon-blue/20 text-neon-blue'
              : 'bg-neon-pink/20 text-neon-pink'
        }`}>
          <span className="text-lg font-bold">{healthScore.toFixed(0)}%</span>
          <span className="text-sm ml-2">Health</span>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {cards.map((c) => (
          <div key={c.label} data-lens-theme="suffering" className="lens-card">
            <div className="flex items-center justify-between mb-3">
              <span style={{ color: c.color }}>{c.icon}</span>
              <span className="text-xl font-bold" style={{ color: c.color }}>
                {(c.value * 100).toFixed(0)}%
              </span>
            </div>
            <p className="font-medium mb-1">{c.label}</p>
            <div className="h-2 bg-lattice-deep rounded-full overflow-hidden mb-2">
              <div className="h-full" style={{ width: `${c.value * 100}%`, backgroundColor: c.color }} />
            </div>
            <p className="text-xs text-gray-400">{c.desc}</p>
          </div>
        ))}
      </div>
      <div className="panel p-4 border-l-4 border-neon-purple">
        <h3 className="font-semibold text-neon-purple mb-2">Alignment Note</h3>
        <p className="text-sm text-gray-400">
          This lens exposes the engine&apos;s &ldquo;pain signals&rdquo; as part of the
          alignment_physics_based invariant. Suffering metrics help maintain ethical
          boundaries and prevent harmful accumulation of unresolved contradictions.
        </p>
      </div>
    </div>
  );
}
