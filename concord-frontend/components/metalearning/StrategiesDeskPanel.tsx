'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { apiHelpers } from '@/lib/api/client';
import { useLensBridge } from '@/lib/hooks/use-lens-bridge';
import { useLensCommand } from '@/hooks/useLensCommand';
import { ErrorState } from '@/components/common/EmptyState';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import {
  Plus, TrendingUp, Award, ArrowRight, BarChart3, Zap, BookOpen,
  Brain, Target, Lightbulb, Puzzle, Sparkles, Waypoints, History, Wand2,
  ThumbsUp, ThumbsDown, Loader2,
} from 'lucide-react';

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

export function StrategiesDeskPanel() {
  const { latestData: realtimeData, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('metalearning');
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newDomain, setNewDomain] = useState('general');
  const [curriculumTopic, setCurriculumTopic] = useState('');
  const [results, setResults] = useState<unknown>(null);
  const [strategySearch, setStrategySearch] = useState('');
  const [strategyTypeFilter, setStrategyTypeFilter] = useState<string>('all');
  const [outcomeBusyId, setOutcomeBusyId] = useState<string | null>(null);
  const newNameInputRef = useRef<HTMLInputElement>(null);
  const curriculumInputRef = useRef<HTMLInputElement>(null);
  const strategySearchInputRef = useRef<HTMLInputElement>(null);

  const bridge = useLensBridge('metalearning', 'strategy');

  const { data: status, isLoading, isError: isError, error: error, refetch: refetch } = useQuery({
    queryKey: ['metalearning-status'],
    queryFn: () => apiHelpers.metalearning.status().then((r) => r.data),
    refetchInterval: 15000,
  });

  const { data: strategies, isError: isError2, error: error2, refetch: refetch2 } = useQuery({
    queryKey: ['metalearning-strategies'],
    queryFn: () => apiHelpers.metalearning.strategies().then((r) => r.data),
  });

  const { data: best, isError: isError3, error: error3, refetch: refetch3 } = useQuery({
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

  const strategyList: Strategy[] = useMemo(() => strategies?.strategies || strategies || [], [strategies]);
  const statusInfo = status?.status || status || {};
  const bestStrategy = best?.strategy || best || null;

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

  useEffect(() => {
    bridge.syncList(strategyList, (s) => {
      const strat = s as Strategy;
      return { title: strat.name, data: s as Record<string, unknown>, meta: { type: strat.domain } };
    });
  }, [strategyList, bridge]);

  useLensCommand(
    [
      { id: 'focus-search', keys: '/', description: 'Search strategies', category: 'navigation', action: () => strategySearchInputRef.current?.focus() },
      { id: 'new-strategy', keys: 'n', description: 'New strategy', category: 'actions', action: () => newNameInputRef.current?.focus() },
      { id: 'focus-curriculum', keys: 'c', description: 'Curriculum topic', category: 'actions', action: () => curriculumInputRef.current?.focus() },
      { id: 'create-strategy', keys: 'mod+enter', description: 'Create strategy', category: 'actions', action: () => { if (newName.trim() && !createStrategy.isPending) createStrategy.mutate(); }, global: true },
    ],
    { lensId: 'metalearning' },
  );

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
    <div className="space-y-6">
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

      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Brain className="w-4 h-4 text-neon-cyan" />
          Learning Strategy Dashboard
        </h2>
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
              {bestStrategy?.domain || 'No strategy active'} domain
            </p>
            {bestStrategy?.avgPerformance != null && (
              <div className="mt-2">
                <div className="h-1.5 bg-lattice-void rounded-full overflow-hidden">
                  <div className="h-full bg-neon-green rounded-full" style={{ width: `${(bestStrategy.avgPerformance as number) * 100}%` }} />
                </div>
                <p className="text-[10px] text-gray-400 mt-1">{((bestStrategy.avgPerformance as number) * 100).toFixed(0)}% avg performance</p>
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
    </div>
  );
}
