'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { MetalearningFeed } from '@/components/metalearning/MetalearningFeed';
import { SpacedRepetitionPanel } from '@/components/metalearning/SpacedRepetitionPanel';
import { LearningPlanPanel } from '@/components/metalearning/LearningPlanPanel';
import { TechniqueLibraryPanel } from '@/components/metalearning/TechniqueLibraryPanel';
import { ProgressAnalyticsPanel } from '@/components/metalearning/ProgressAnalyticsPanel';
import { GoalTrackerPanel } from '@/components/metalearning/GoalTrackerPanel';
import { StrategyExperimentPanel } from '@/components/metalearning/StrategyExperimentPanel';
import { StudyJournalPanel } from '@/components/metalearning/StudyJournalPanel';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers, lensRun } from '@/lib/api/client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { useLensBridge } from '@/lib/hooks/use-lens-bridge';
import {
  GraduationCap, Plus, TrendingUp, Award,
  ArrowRight, BarChart3, Zap, BookOpen,
  Brain, Target, Lightbulb, Puzzle, Sparkles, Waypoints,
  Play, Loader2, ThumbsUp, ThumbsDown, History, Wand2,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';

interface Strategy {
  id: string;
  name: string;
  domain: string;
  avgPerformance?: number;
  uses?: number;
}

interface Adaptation {
  strategyId: string;
  strategyName: string;
  adaptations: string[];
  triggerPerformance: number;
  adaptedAt: string;
}

export default function MetalearningLensPage() {
  useLensNav('metalearning');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('metalearning');

  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newDomain, setNewDomain] = useState('general');
  const [curriculumTopic, setCurriculumTopic] = useState('');
  const [results, setResults] = useState<unknown>(null);
  const [strategySearch, setStrategySearch] = useState('');
  const [strategyTypeFilter, setStrategyTypeFilter] = useState<string>('all');
  const [showMetalearningFeed, setShowMetalearningFeed] = useState(false);
  const [outcomeBusyId, setOutcomeBusyId] = useState<string | null>(null);
  const newNameInputRef = useRef<HTMLInputElement>(null);
  const curriculumInputRef = useRef<HTMLInputElement>(null);
  const strategySearchInputRef = useRef<HTMLInputElement>(null);

  // --- Lens Bridge ---
  const bridge = useLensBridge('metalearning', 'strategy');

  const { data: status, isLoading, isError: isError, error: error, refetch: refetch,} = useQuery({
    queryKey: ['metalearning-status'],
    queryFn: () => apiHelpers.metalearning.status().then((r) => r.data),
    refetchInterval: 15000,
  });

  const { data: strategies, isError: isError2, error: error2, refetch: refetch2,} = useQuery({
    queryKey: ['metalearning-strategies'],
    queryFn: () => apiHelpers.metalearning.strategies().then((r) => r.data),
  });

  const { data: best, isError: isError3, error: error3, refetch: refetch3,} = useQuery({
    queryKey: ['metalearning-best'],
    queryFn: () => apiHelpers.metalearning.bestStrategy().then((r) => r.data),
  });

  const createStrategy = useMutation({
    mutationFn: () => apiHelpers.metalearning.createStrategy({ name: newName, domain: newDomain || 'general' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metalearning-strategies'] });
      setNewName('');
    },
    onError: (err) => console.error('createStrategy failed:', err instanceof Error ? err.message : err),
  });

  const runCurriculum = useMutation({
    mutationFn: () => apiHelpers.metalearning.curriculum({ topic: curriculumTopic }),
    onSuccess: (res) => {
      setResults(res.data);
      setCurriculumTopic('');
    },
    onError: (err) => console.error('runCurriculum failed:', err instanceof Error ? err.message : err),
  });

  // Record a real outcome for a strategy — feeds the backend's running
  // avgPerformance + triggers auto-adaptation once `uses` crosses the
  // server's minSamples threshold (server.js `recordStrategyOutcome`).
  const recordOutcome = useMutation({
    mutationFn: ({ strategyId, success }: { strategyId: string; success: boolean }) =>
      apiHelpers.metalearning.recordOutcome(strategyId, { success, performance: success ? 0.85 : 0.25 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metalearning-strategies'] });
      queryClient.invalidateQueries({ queryKey: ['metalearning-adaptations'] });
      queryClient.invalidateQueries({ queryKey: ['metalearning-status'] });
    },
    onSettled: () => setOutcomeBusyId(null),
  });

  // Force an adaptation pass now (the server also auto-adapts once a
  // strategy's uses crosses config.minSamples, but this lets a user pull
  // the trigger manually to see the parameter changes immediately).
  const adaptStrategyMut = useMutation({
    mutationFn: (strategyId: string) => apiHelpers.metalearning.adaptStrategy(strategyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metalearning-strategies'] });
      queryClient.invalidateQueries({ queryKey: ['metalearning-adaptations'] });
    },
    onSettled: () => setOutcomeBusyId(null),
  });

  const { data: adaptationsData } = useQuery({
    queryKey: ['metalearning-adaptations'],
    queryFn: () => apiHelpers.metalearning.adaptations().then((r) => r.data),
    refetchInterval: 20000,
  });
  const adaptationLog: Adaptation[] = adaptationsData?.adaptations || [];

  // Analysis-engine inputs. These three macros are real (server-side k-NN
  // meta-learning, Jaccard domain-transfer scoring, difficulty-curve
  // profiling) but need structured input the user's saved strategies don't
  // carry — so they're driven by dedicated small forms and called directly
  // via lensRun (which passes the input straight through as the macro's
  // `artifact.data`), not against an unrelated generic artifact.
  const [analysisTab, setAnalysisTab] = useState<'strategySelection' | 'transferAnalysis' | 'performanceProfile'>('strategySelection');
  const [taskFeatures, setTaskFeatures] = useState({ complexity: 0.5, dimensionality: 0.5, noise: 0.3, sampleSize: 0.6, nonlinearity: 0.4 });
  const [sourceDomain, setSourceDomain] = useState({ name: '', concepts: '', skills: '' });
  const [targetDomain, setTargetDomain] = useState({ name: '', concepts: '', skills: '' });
  const [assessments, setAssessments] = useState<{ skill: string; difficulty: number; score: number }[]>([]);
  const [newAssessment, setNewAssessment] = useState({ skill: '', difficulty: 0.5, score: 0.7 });
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const splitCsv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

  const handleAction = async (action: 'strategySelection' | 'transferAnalysis' | 'performanceProfile') => {
    let input: Record<string, unknown> = {};
    if (action === 'strategySelection') {
      input = { taskFeatures };
    } else if (action === 'transferAnalysis') {
      if (!sourceDomain.name.trim() || !targetDomain.name.trim()) {
        setActionResult({ message: 'Both source and target domain need a name.' });
        return;
      }
      input = {
        sourceDomain: { name: sourceDomain.name, concepts: splitCsv(sourceDomain.concepts), skills: splitCsv(sourceDomain.skills) },
        targetDomain: { name: targetDomain.name, concepts: splitCsv(targetDomain.concepts), skills: splitCsv(targetDomain.skills) },
      };
    } else {
      if (assessments.length === 0) {
        setActionResult({ message: 'Add at least one assessment below first.' });
        return;
      }
      input = { assessments };
    }
    setIsRunning(action);
    try {
      const res = await lensRun('metalearning', action, input);
      if (res.data.ok === false) { setActionResult({ message: `Action failed: ${res.data.error || 'Unknown error'}` }); } else { setActionResult(res.data.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    finally { setIsRunning(null); }
  };

  const strategyList: Strategy[] = useMemo(() => strategies?.strategies || strategies || [], [strategies]);
  const statusInfo = status?.status || status || {};
  const bestStrategy = best?.strategy || best || null;

  // Filtered strategies — search by name + domain filter.
  const visibleStrategies = useMemo(() => {
    let arr = strategyList;
    if (strategyTypeFilter !== 'all') arr = arr.filter((s) => s.domain === strategyTypeFilter);
    const q = strategySearch.trim().toLowerCase();
    if (q) arr = arr.filter((s) => (s.name || '').toLowerCase().includes(q));
    return arr;
  }, [strategyList, strategySearch, strategyTypeFilter]);

  const strategyTypes = useMemo(() => {
    const set = new Set<string>();
    strategyList.forEach((s) => set.add(s.domain));
    return Array.from(set);
  }, [strategyList]);

  useLensCommand(
    [
      { id: 'focus-search',     keys: '/',         description: 'Search strategies', category: 'navigation', action: () => strategySearchInputRef.current?.focus() },
      { id: 'new-strategy',     keys: 'n',         description: 'New strategy',      category: 'actions',    action: () => newNameInputRef.current?.focus() },
      { id: 'focus-curriculum', keys: 'c',         description: 'Curriculum topic',  category: 'actions',    action: () => curriculumInputRef.current?.focus() },
      { id: 'create-strategy',  keys: 'mod+enter', description: 'Create strategy',   category: 'actions',    action: () => { if (newName.trim() && !createStrategy.isPending) createStrategy.mutate(); }, global: true },
    ],
    { lensId: 'metalearning' }
  );

  // Bridge strategies into lens artifacts
  useEffect(() => {
    bridge.syncList(strategyList, (s) => {
      const strat = s as Strategy;
      return { title: strat.name, data: s as Record<string, unknown>, meta: { type: strat.domain } };
    });
  }, [strategyList, bridge]);


  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError || isError2 || isError3) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message || error3?.message} onRetry={() => { refetch(); refetch2(); refetch3(); }} />
      </div>
    );
  }
  return (
    <LensShell lensId="metalearning" asMain={false}>
      <FirstRunTour lensId="metalearning" />
      <ManifestActionBar />
      <DepthBadge lensId="metalearning" size="sm" className="ml-2" />
    <div data-lens-theme="metalearning" className="p-6 space-y-6">
      <header className="flex items-center gap-3">
        <span className="text-2xl">🎓</span>
        <div>
          <h1 className="text-xl font-bold">Meta-Learning Lens</h1>
          <p className="text-sm text-gray-400">
            Learning to learn — strategies, curriculum generation, and adaptation
          </p>
        </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="metalearning" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      </header>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="lens-card">
          <Sparkles className="w-5 h-5 text-neon-purple mb-2" />
          <p className="text-2xl font-bold">{strategyList.length}</p>
          <p className="text-sm text-gray-400">Strategies</p>
        </div>
        <div className="lens-card">
          <Waypoints className="w-5 h-5 text-neon-cyan mb-2" />
          <p className="text-2xl font-bold">{strategyList.length > 0 ? (strategyList.reduce((s, st) => s + (st.avgPerformance || 0), 0) / strategyList.length * 100).toFixed(0) : 0}%</p>
          <p className="text-sm text-gray-400">Avg Performance</p>
        </div>
        <div className="lens-card">
          <Brain className="w-5 h-5 text-neon-green mb-2" />
          <p className="text-2xl font-bold">{strategyList.reduce((s, st) => s + (st.uses || 0), 0)}</p>
          <p className="text-sm text-gray-400">Recorded Outcomes</p>
        </div>
        <div className="lens-card">
          <TrendingUp className="w-5 h-5 text-yellow-400 mb-2" />
          <p className="text-2xl font-bold">{statusInfo.adaptations || 0}</p>
          <p className="text-sm text-gray-400">Adaptations</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="lens-card">
          <Award className="w-5 h-5 text-neon-yellow mb-2" />
          <p className="text-lg font-bold truncate">
            {bestStrategy ? bestStrategy.name || '—' : '—'}
          </p>
          <p className="text-sm text-gray-400">Best Strategy{bestStrategy?.domain ? ` · ${bestStrategy.domain}` : ''}</p>
        </div>
        <div className="lens-card">
          <BookOpen className="w-5 h-5 text-neon-cyan mb-2" />
          <p className="text-2xl font-bold">{statusInfo.curricula || 0}</p>
          <p className="text-sm text-gray-400">Curricula Generated</p>
        </div>
        <div className="lens-card">
          <Puzzle className="w-5 h-5 text-neon-purple mb-2" />
          <p className="text-2xl font-bold">{statusInfo.performance || 0}</p>
          <p className="text-sm text-gray-400">Outcomes Logged</p>
        </div>
        <div className="lens-card">
          <History className="w-5 h-5 text-neon-green mb-2" />
          <p className="text-2xl font-bold">{adaptationLog.length}</p>
          <p className="text-sm text-gray-400">Adaptation Events</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create Strategy */}
        <div className="panel p-4 space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Plus className="w-4 h-4 text-neon-purple" /> New Strategy
          </h2>
          <input
            ref={newNameInputRef}
            type="text" value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && newName.trim() && !createStrategy.isPending) { e.preventDefault(); createStrategy.mutate(); } }}
            placeholder="Strategy name…  ⌘⏎ creates"
            className="input-lattice w-full"
          />
          <input
            type="text" value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder="Subject domain…  e.g. math, language, general"
            className="input-lattice w-full text-sm"
          />
          <p className="text-[11px] text-gray-400 -mt-1">
            Domain groups strategies for best-strategy lookup — the server tunes
            learning rate / exploration / batch size per strategy as outcomes come in.
          </p>
          <button
            onClick={() => createStrategy.mutate()}
            disabled={!newName || createStrategy.isPending}
            className="btn-neon purple w-full"
          >
            {createStrategy.isPending ? 'Creating...' : 'Create Strategy'}
          </button>

          <div className="border-t border-lattice-border pt-3 mt-3">
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              <Zap className="w-3 h-3 text-neon-cyan" /> Curriculum
            </h3>
            <input
              ref={curriculumInputRef}
              type="text" value={curriculumTopic}
              onChange={(e) => setCurriculumTopic(e.target.value)}
              placeholder="Topic to learn…"
              className="input-lattice w-full"
            />
            <button
              onClick={() => runCurriculum.mutate()}
              disabled={!curriculumTopic || runCurriculum.isPending}
              className="btn-neon w-full mt-2"
            >
              {runCurriculum.isPending ? 'Generating...' : 'Generate Curriculum'}
            </button>
          </div>
        </div>

        {/* Strategy List */}
        <div className="panel p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-neon-blue" /> Strategies
              {(strategySearch || strategyTypeFilter !== 'all') && (
                <span className="text-xs text-gray-400 font-normal">
                  ({visibleStrategies.length} of {strategyList.length})
                </span>
              )}
            </h2>
          </div>
          <div className="space-y-2 mb-3">
            <input
              ref={strategySearchInputRef}
              type="text"
              value={strategySearch}
              onChange={(e) => setStrategySearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setStrategySearch(''); strategySearchInputRef.current?.blur(); } }}
              placeholder="Filter by name…  / focuses"
              className="input-lattice w-full text-sm"
            />
            {strategyTypes.length > 1 && (
              <div className="flex gap-1 flex-wrap text-xs">
                <button
                  onClick={() => setStrategyTypeFilter('all')}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    strategyTypeFilter === 'all'
                      ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/40'
                      : 'bg-white/5 text-gray-400 border border-white/10 hover:text-white'
                  }`}
                >
                  all
                </button>
                {strategyTypes.map((t) => (
                  <button
                    key={t}
                    onClick={() => setStrategyTypeFilter(t)}
                    className={`px-2 py-0.5 rounded transition-colors ${
                      strategyTypeFilter === t
                        ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/40'
                        : 'bg-white/5 text-gray-400 border border-white/10 hover:text-white'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {visibleStrategies.map((s, index) => (
              <motion.div key={s.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="lens-card">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{s.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-lattice-surface text-gray-400">{s.domain}</span>
                </div>
                {s.avgPerformance != null && (
                  <div className="mt-2">
                    <div className="h-1.5 bg-lattice-deep rounded-full overflow-hidden">
                      <div className="h-full bg-neon-green" style={{ width: `${Math.round(s.avgPerformance * 100)}%` }} />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{(s.avgPerformance * 100).toFixed(0)}% avg performance · {s.uses || 0} outcomes</p>
                  </div>
                )}
                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    onClick={() => { setOutcomeBusyId(s.id); recordOutcome.mutate({ strategyId: s.id, success: true }); }}
                    disabled={outcomeBusyId === s.id}
                    title="Record a successful outcome for this strategy"
                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-neon-green/10 text-neon-green border border-neon-green/20 hover:bg-neon-green/20 disabled:opacity-40"
                  >
                    <ThumbsUp className="w-3 h-3" /> Success
                  </button>
                  <button
                    onClick={() => { setOutcomeBusyId(s.id); recordOutcome.mutate({ strategyId: s.id, success: false }); }}
                    disabled={outcomeBusyId === s.id}
                    title="Record a failed outcome for this strategy"
                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-red-400/10 text-red-400 border border-red-400/20 hover:bg-red-400/20 disabled:opacity-40"
                  >
                    <ThumbsDown className="w-3 h-3" /> Failure
                  </button>
                  <button
                    onClick={() => { setOutcomeBusyId(s.id); adaptStrategyMut.mutate(s.id); }}
                    disabled={outcomeBusyId === s.id}
                    title="Force an adaptation pass now based on recent outcomes"
                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-neon-purple/10 text-neon-purple border border-neon-purple/20 hover:bg-neon-purple/20 disabled:opacity-40 ml-auto"
                  >
                    {outcomeBusyId === s.id && adaptStrategyMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />} Adapt
                  </button>
                </div>
              </motion.div>
            ))}
            {strategyList.length === 0 && (
              <p className="text-center py-4 text-gray-400 text-sm">No strategies yet</p>
            )}
            {strategyList.length > 0 && visibleStrategies.length === 0 && (
              <p className="text-center py-4 text-gray-400 text-sm">No matches</p>
            )}
          </div>
        </div>

        {/* Results */}
        <div className="panel p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <ArrowRight className="w-4 h-4 text-neon-green" /> Results
          </h2>
          {results ? (
            <pre className="bg-lattice-surface p-3 rounded-lg whitespace-pre-wrap text-xs text-gray-300 font-mono max-h-96 overflow-y-auto">
              {JSON.stringify(results, null, 2)}
            </pre>
          ) : (
            <p className="text-center py-12 text-gray-400 text-sm">
              Generate a curriculum or adapt a strategy to see results
            </p>
          )}
        </div>

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="metalearning"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
      </div>

      {/* Adaptation log — real record of parameter changes the server made
          in response to recorded outcomes (server.js `adaptStrategy`). */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <History className="w-4 h-4 text-neon-purple" /> Adaptation Log
        </h2>
        {adaptationLog.length === 0 ? (
          <p className="text-center py-6 text-gray-400 text-sm">
            No adaptations yet — record a few outcomes on a strategy (5+ triggers auto-adaptation), or click Adapt.
          </p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {adaptationLog.slice().reverse().map((a, i) => (
              <div key={`${a.strategyId}-${a.adaptedAt}-${i}`} className="bg-lattice-deep rounded-lg p-3 border border-white/5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-neon-cyan">{a.strategyName}</span>
                  <span className="text-gray-400">{new Date(a.adaptedAt).toLocaleString()}</span>
                </div>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Trigger performance: {(a.triggerPerformance * 100).toFixed(0)}%
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {a.adaptations.map((change, j) => (
                    <li key={j} className="text-xs text-gray-300 flex items-start gap-1.5">
                      <span className="text-neon-purple">·</span> {change}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Learning Strategy Dashboard */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Brain className="w-4 h-4 text-neon-cyan" />
          Learning Strategy Dashboard
        </h2>

        {/* Strategy Performance Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-lattice-deep rounded-lg p-4 border border-white/5">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-4 h-4 text-neon-purple" />
              <h3 className="text-sm font-semibold">Active Strategy</h3>
            </div>
            <p className="text-lg font-bold text-neon-cyan">
              {bestStrategy?.name || 'None Selected'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {bestStrategy?.type || 'No strategy active'} mode
            </p>
            {bestStrategy?.successRate != null && (
              <div className="mt-2">
                <div className="h-1.5 bg-lattice-void rounded-full overflow-hidden">
                  <div className="h-full bg-neon-green rounded-full" style={{ width: `${(bestStrategy.successRate as number) * 100}%` }} />
                </div>
                <p className="text-[10px] text-gray-400 mt-1">{((bestStrategy.successRate as number) * 100).toFixed(0)}% success rate</p>
              </div>
            )}
          </div>

          <div className="bg-lattice-deep rounded-lg p-4 border border-white/5">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-neon-green" />
              <h3 className="text-sm font-semibold">Learning Velocity</h3>
            </div>
            <p className="text-lg font-bold text-neon-green">
              {statusInfo.adaptations || 0}
            </p>
            <p className="text-xs text-gray-400 mt-1">adaptations this cycle</p>
            <div className="mt-2 flex items-center gap-1 text-xs text-neon-cyan">
              <Brain className="w-3 h-3" />
              <span>{strategyList.length} strategies tracked</span>
            </div>
          </div>

          <div className="bg-lattice-deep rounded-lg p-4 border border-white/5">
            <div className="flex items-center gap-2 mb-2">
              <Lightbulb className="w-4 h-4 text-neon-cyan" />
              <h3 className="text-sm font-semibold">Insight Generation</h3>
            </div>
            <p className="text-lg font-bold text-neon-cyan">
              {statusInfo.curricula || 0}
            </p>
            <p className="text-xs text-gray-400 mt-1">curricula generated</p>
            <div className="mt-2 flex items-center gap-1 text-xs text-neon-purple">
              <Puzzle className="w-3 h-3" />
              <span>{strategyList.length} strategies available</span>
            </div>
          </div>
        </div>

      </div>

      {/* Learning-science practice substrate — daily practice tools */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="panel p-4"><SpacedRepetitionPanel /></div>
        <div className="panel p-4"><ProgressAnalyticsPanel /></div>
        <div className="panel p-4"><LearningPlanPanel /></div>
        <div className="panel p-4"><GoalTrackerPanel /></div>
        <div className="panel p-4"><StrategyExperimentPanel /></div>
        <div className="panel p-4"><StudyJournalPanel /></div>
      </div>
      <div className="panel p-4"><TechniqueLibraryPanel /></div>

      {/* Backend Action Panel — real k-NN / Jaccard / difficulty-curve engines,
          each driven by a small purpose-built form (not a generic button wall). */}
      <div className="panel p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-neon-cyan" />
          Metalearning Analysis
        </h2>
        <div className="flex gap-1 text-xs border-b border-white/10 pb-2">
          {([
            ['strategySelection', 'Strategy Selection'],
            ['transferAnalysis', 'Transfer Analysis'],
            ['performanceProfile', 'Performance Profile'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setAnalysisTab(id)}
              className={`px-3 py-1.5 rounded-t transition-colors ${analysisTab === id ? 'bg-neon-cyan/10 text-neon-cyan border-b-2 border-neon-cyan' : 'text-gray-400 hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {analysisTab === 'strategySelection' && (
          <div className="space-y-2">
            <p className="text-xs text-gray-400">
              Feature-based k-NN meta-learning: describe the task, get the recommended model family.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {(Object.keys(taskFeatures) as Array<keyof typeof taskFeatures>).map((k) => (
                <label key={k} className="text-[11px] text-gray-400 space-y-1">
                  <span className="capitalize">{k}</span>
                  <input
                    type="number" min={0} max={1} step={0.05}
                    value={taskFeatures[k]}
                    onChange={(e) => setTaskFeatures((prev) => ({ ...prev, [k]: Math.max(0, Math.min(1, Number(e.target.value) || 0)) }))}
                    className="input-lattice w-full text-xs"
                  />
                </label>
              ))}
            </div>
            <button onClick={() => handleAction('strategySelection')} disabled={!!isRunning}
              className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
              {isRunning === 'strategySelection' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              Select Strategy
            </button>
          </div>
        )}

        {analysisTab === 'transferAnalysis' && (
          <div className="space-y-2">
            <p className="text-xs text-gray-400">
              Jaccard concept/skill/vocabulary overlap — how much of what you know transfers.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide text-neon-cyan">Source domain</p>
                <input value={sourceDomain.name} onChange={(e) => setSourceDomain((p) => ({ ...p, name: e.target.value }))} placeholder="name (e.g. Python)" className="input-lattice w-full text-xs" />
                <input value={sourceDomain.concepts} onChange={(e) => setSourceDomain((p) => ({ ...p, concepts: e.target.value }))} placeholder="concepts, comma-separated" className="input-lattice w-full text-xs" />
                <input value={sourceDomain.skills} onChange={(e) => setSourceDomain((p) => ({ ...p, skills: e.target.value }))} placeholder="skills, comma-separated" className="input-lattice w-full text-xs" />
              </div>
              <div className="space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide text-neon-purple">Target domain</p>
                <input value={targetDomain.name} onChange={(e) => setTargetDomain((p) => ({ ...p, name: e.target.value }))} placeholder="name (e.g. Rust)" className="input-lattice w-full text-xs" />
                <input value={targetDomain.concepts} onChange={(e) => setTargetDomain((p) => ({ ...p, concepts: e.target.value }))} placeholder="concepts, comma-separated" className="input-lattice w-full text-xs" />
                <input value={targetDomain.skills} onChange={(e) => setTargetDomain((p) => ({ ...p, skills: e.target.value }))} placeholder="skills, comma-separated" className="input-lattice w-full text-xs" />
              </div>
            </div>
            <button onClick={() => handleAction('transferAnalysis')} disabled={!!isRunning}
              className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
              {isRunning === 'transferAnalysis' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              Analyze Transfer
            </button>
          </div>
        )}

        {analysisTab === 'performanceProfile' && (
          <div className="space-y-2">
            <p className="text-xs text-gray-400">
              Add a few (skill, difficulty, score) assessments to build a strengths/weaknesses radar
              and find your zone-of-proximal-development difficulty target.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[11px] text-gray-400 space-y-1">
                <span>Skill</span>
                <input value={newAssessment.skill} onChange={(e) => setNewAssessment((p) => ({ ...p, skill: e.target.value }))} placeholder="e.g. recursion" className="input-lattice text-xs w-32" />
              </label>
              <label className="text-[11px] text-gray-400 space-y-1">
                <span>Difficulty (0-1)</span>
                <input type="number" min={0} max={1} step={0.1} value={newAssessment.difficulty} onChange={(e) => setNewAssessment((p) => ({ ...p, difficulty: Math.max(0, Math.min(1, Number(e.target.value) || 0)) }))} className="input-lattice text-xs w-20" />
              </label>
              <label className="text-[11px] text-gray-400 space-y-1">
                <span>Score (0-1)</span>
                <input type="number" min={0} max={1} step={0.1} value={newAssessment.score} onChange={(e) => setNewAssessment((p) => ({ ...p, score: Math.max(0, Math.min(1, Number(e.target.value) || 0)) }))} className="input-lattice text-xs w-20" />
              </label>
              <button
                onClick={() => { if (newAssessment.skill.trim()) { setAssessments((p) => [...p, { ...newAssessment, skill: newAssessment.skill.trim() }]); setNewAssessment((p) => ({ ...p, skill: '' })); } }}
                className="btn-secondary text-xs flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            {assessments.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {assessments.map((a, i) => (
                  <span key={i} className="text-[11px] bg-lattice-surface rounded px-2 py-1 flex items-center gap-1.5">
                    {a.skill} · diff {a.difficulty} · score {a.score}
                    <button onClick={() => setAssessments((p) => p.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-400">×</button>
                  </span>
                ))}
              </div>
            )}
            <button onClick={() => handleAction('performanceProfile')} disabled={!!isRunning}
              className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
              {isRunning === 'performanceProfile' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              Build Profile
            </button>
          </div>
        )}
        {actionResult && (
          <div className="bg-lattice-deep rounded-lg p-4 space-y-3 text-sm">
            {'recommended' in actionResult && 'method' in actionResult && (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <span className="text-gray-400 text-xs">Method: <span className="text-neon-cyan font-bold">{String(actionResult.method)}</span></span>
                  <span className="text-gray-400 text-xs">Recommended: <span className="text-neon-green font-bold">{String(actionResult.recommended)}</span></span>
                  <span className="text-gray-400 text-xs">Confidence: <span className="text-yellow-400">{String(actionResult.confidence)}</span></span>
                </div>
                {'rankings' in actionResult && Array.isArray(actionResult.rankings) && actionResult.rankings.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-gray-400 uppercase tracking-wider">Rankings</p>
                    {(actionResult.rankings as Array<Record<string, unknown>>).slice(0, 5).map((r, i) => (
                      <div key={i} className="flex justify-between text-xs bg-lattice-surface rounded px-2 py-1">
                        <span className="text-gray-300">{String(r.strategy || r.name)}</span>
                        <span className="text-neon-cyan">{String(r.score || r.rank || i + 1)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {'transferability' in actionResult && (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <span className="text-gray-400 text-xs">Transferability: <span className="text-neon-green font-bold">{String(actionResult.transferability)}</span></span>
                </div>
                {'sharedConcepts' in actionResult && Array.isArray(actionResult.sharedConcepts) && actionResult.sharedConcepts.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {(actionResult.sharedConcepts as string[]).map((c, i) => (
                      <span key={i} className="text-xs bg-neon-cyan/10 border border-neon-cyan/20 rounded px-2 py-0.5 text-neon-cyan">{c}</span>
                    ))}
                  </div>
                )}
                {'recommendation' in actionResult && <p className="text-xs text-gray-300">{String(actionResult.recommendation)}</p>}
              </div>
            )}
            {'overallScore' in actionResult && (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <span className="text-neon-cyan font-bold text-xl">{String(actionResult.overallScore)}</span>
                  <span className="text-gray-400 text-xs">Style: <span className="text-neon-purple">{String(actionResult.learningStyle)}</span></span>
                </div>
                {'strengths' in actionResult && Array.isArray(actionResult.strengths) && actionResult.strengths.length > 0 && (
                  <div>
                    <p className="text-xs text-neon-green font-semibold mb-1">Strengths</p>
                    <div className="flex flex-wrap gap-1">
                      {(actionResult.strengths as Array<{skill: string; score: number}>).map((s, i) => (
                        <span key={i} className="text-xs bg-neon-green/10 border border-neon-green/20 rounded px-2 py-0.5 text-neon-green">{s.skill}</span>
                      ))}
                    </div>
                  </div>
                )}
                {'weaknesses' in actionResult && Array.isArray(actionResult.weaknesses) && actionResult.weaknesses.length > 0 && (
                  <div>
                    <p className="text-xs text-red-400 font-semibold mb-1">Weaknesses</p>
                    <div className="flex flex-wrap gap-1">
                      {(actionResult.weaknesses as Array<{skill: string; score: number}>).map((w, i) => (
                        <span key={i} className="text-xs bg-red-400/10 border border-red-400/20 rounded px-2 py-0.5 text-red-400">{w.skill}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {'message' in actionResult && <p className="text-gray-400">{String(actionResult.message)}</p>}
          </div>
        )}
      </div>

      <ConnectiveTissueBar lensId="metalearning" />

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <button
          type="button"
          onClick={() => setShowMetalearningFeed(v => !v)}
          className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
        >
          <span>Meta-learning research (external reference)</span>
          {showMetalearningFeed ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {showMetalearningFeed && (
          <div className="mt-3">
            <MetalearningFeed />
          </div>
        )}
      </section>
    </div>

      <a href="#metalearning-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to metalearning content</a>
          <RecentMineCard domain="metalearning" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="metalearning" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="metalearning" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
