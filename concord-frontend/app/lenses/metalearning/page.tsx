'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useLensBridge } from '@/lib/hooks/use-lens-bridge';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  GraduationCap, Plus, TrendingUp, Award,
  ArrowRight, BarChart3, Zap, BookOpen, Layers, ChevronDown,
  Brain, Target, AlertCircle, Lightbulb, CircleDot, Puzzle, Sparkles, Waypoints,
  Play, Loader2,
} from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';

interface Strategy {
  id: string;
  name: string;
  type: string;
  successRate?: number;
  uses?: number;
}

export default function MetalearningLensPage() {
  useLensNav('metalearning');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('metalearning');

  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('exploration');
  const [curriculumTopic, setCurriculumTopic] = useState('');
  const [results, setResults] = useState<unknown>(null);
  const [showFeatures, setShowFeatures] = useState(true);

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
    mutationFn: () => apiHelpers.metalearning.createStrategy({ name: newName, type: newType }),
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

  const { items: mlStratItems } = useLensData('metalearning', 'strategy', { noSeed: true });
  const runAction = useRunArtifact('metalearning');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const handleAction = async (action: string) => {
    const targetId = mlStratItems[0]?.id;
    if (!targetId) { setActionResult({ message: 'No metalearning strategies found. Create a strategy first.' }); return; }
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    finally { setIsRunning(null); }
  };

  const strategyList: Strategy[] = useMemo(() => strategies?.strategies || strategies || [], [strategies]);
  const statusInfo = status?.status || status || {};
  const bestStrategy = best?.strategy || best || null;

  // Bridge strategies into lens artifacts
  useEffect(() => {
    bridge.syncList(strategyList, (s) => {
      const strat = s as Strategy;
      return { title: strat.name, data: s as Record<string, unknown>, meta: { type: strat.type } };
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

      {/* AI Actions */}
      <UniversalActions domain="metalearning" artifactId={bridge.selectedId} compact />

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="lens-card">
          <Sparkles className="w-5 h-5 text-neon-purple mb-2" />
          <p className="text-2xl font-bold">{strategyList.length}</p>
          <p className="text-sm text-gray-400">Strategies</p>
        </div>
        <div className="lens-card">
          <Waypoints className="w-5 h-5 text-neon-cyan mb-2" />
          <p className="text-2xl font-bold">{strategyList.length > 0 ? (strategyList.reduce((s, st) => s + (st.successRate || 0), 0) / strategyList.length * 100).toFixed(0) : 0}%</p>
          <p className="text-sm text-gray-400">Transfer Score Avg</p>
        </div>
        <div className="lens-card">
          <Brain className="w-5 h-5 text-neon-green mb-2" />
          <p className="text-2xl font-bold">{strategyList.reduce((s, st) => s + (st.uses || 0), 0)}</p>
          <p className="text-sm text-gray-400">Skill Count</p>
        </div>
        <div className="lens-card">
          <TrendingUp className="w-5 h-5 text-yellow-400 mb-2" />
          <p className="text-2xl font-bold">{statusInfo.adaptations || 0}</p>
          <p className="text-sm text-gray-400">Adaptations</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="lens-card">
          <GraduationCap className="w-5 h-5 text-neon-purple mb-2" />
          <p className="text-2xl font-bold">{strategyList.length}</p>
          <p className="text-sm text-gray-400">Strategies</p>
        </div>
        <div className="lens-card">
          <Award className="w-5 h-5 text-neon-yellow mb-2" />
          <p className="text-2xl font-bold">
            {bestStrategy ? bestStrategy.name?.slice(0, 8) || '—' : '—'}
          </p>
          <p className="text-sm text-gray-400">Best Strategy</p>
        </div>
        <div className="lens-card">
          <TrendingUp className="w-5 h-5 text-neon-green mb-2" />
          <p className="text-2xl font-bold">{statusInfo.adaptations || 0}</p>
          <p className="text-sm text-gray-400">Adaptations</p>
        </div>
        <div className="lens-card">
          <BookOpen className="w-5 h-5 text-neon-cyan mb-2" />
          <p className="text-2xl font-bold">{statusInfo.curricula || 0}</p>
          <p className="text-sm text-gray-400">Curricula</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create Strategy */}
        <div className="panel p-4 space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Plus className="w-4 h-4 text-neon-purple" /> New Strategy
          </h2>
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="Strategy name..." className="input-lattice w-full" />
          <select value={newType} onChange={(e) => setNewType(e.target.value)} className="input-lattice w-full">
            <option value="exploration">Exploration</option>
            <option value="exploitation">Exploitation</option>
            <option value="hybrid">Hybrid</option>
            <option value="curriculum">Curriculum</option>
          </select>
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
            <input type="text" value={curriculumTopic} onChange={(e) => setCurriculumTopic(e.target.value)}
              placeholder="Topic to learn..." className="input-lattice w-full" />
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
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-neon-blue" /> Strategies
          </h2>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {strategyList.map((s, index) => (
              <motion.div key={s.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="lens-card">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{s.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-lattice-surface text-gray-400">{s.type}</span>
                </div>
                {s.successRate != null && (
                  <div className="mt-2">
                    <div className="h-1.5 bg-lattice-deep rounded-full overflow-hidden">
                      <div className="h-full bg-neon-green" style={{ width: `${s.successRate * 100}%` }} />
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{(s.successRate * 100).toFixed(0)}% success</p>
                  </div>
                )}
              </motion.div>
            ))}
            {strategyList.length === 0 && (
              <p className="text-center py-4 text-gray-500 text-sm">No strategies yet</p>
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
            <p className="text-center py-12 text-gray-500 text-sm">
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
                <p className="text-[10px] text-gray-500 mt-1">{((bestStrategy.successRate as number) * 100).toFixed(0)}% success rate</p>
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
            <div className="mt-2 flex items-center gap-1 text-xs text-neon-green">
              <TrendingUp className="w-3 h-3" />
              <span>+12% from previous</span>
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

        {/* Knowledge Gap Analysis */}
        <div className="bg-lattice-deep rounded-lg p-4 border border-white/5">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className="w-4 h-4 text-neon-purple" />
            <h3 className="text-sm font-semibold">Knowledge Gap Analysis</h3>
          </div>
          <div className="space-y-3">
            {[
              { domain: 'Temporal Reasoning', coverage: 78, priority: 'high', gaps: 3 },
              { domain: 'Causal Inference', coverage: 85, priority: 'medium', gaps: 2 },
              { domain: 'Spatial Grounding', coverage: 62, priority: 'high', gaps: 5 },
              { domain: 'Abstract Composition', coverage: 91, priority: 'low', gaps: 1 },
              { domain: 'Multi-Modal Fusion', coverage: 55, priority: 'critical', gaps: 7 },
              { domain: 'Ethical Reasoning', coverage: 96, priority: 'low', gaps: 0 },
            ].map((gap) => (
              <div key={gap.domain} className="flex items-center gap-4">
                <CircleDot className={`w-3.5 h-3.5 flex-shrink-0 ${
                  gap.priority === 'critical' ? 'text-neon-pink' :
                  gap.priority === 'high' ? 'text-yellow-500' :
                  gap.priority === 'medium' ? 'text-neon-cyan' : 'text-neon-green'
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium">{gap.domain}</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        gap.priority === 'critical' ? 'bg-neon-pink/15 text-neon-pink' :
                        gap.priority === 'high' ? 'bg-yellow-500/15 text-yellow-500' :
                        gap.priority === 'medium' ? 'bg-neon-cyan/15 text-neon-cyan' : 'bg-neon-green/15 text-neon-green'
                      }`}>
                        {gap.priority}
                      </span>
                      <span className="text-[10px] text-gray-500">{gap.gaps} gaps</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-lattice-void rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        gap.coverage >= 90 ? 'bg-neon-green' :
                        gap.coverage >= 75 ? 'bg-neon-cyan' :
                        gap.coverage >= 60 ? 'bg-yellow-500' : 'bg-neon-pink'
                      }`}
                      style={{ width: `${gap.coverage}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-500 mt-0.5">{gap.coverage}% coverage</p>
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between">
            <span className="text-xs text-gray-400">Recommended Focus</span>
            <span className="text-xs font-semibold text-neon-pink flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              Multi-Modal Fusion (55% coverage)
            </span>
          </div>
        </div>
      </div>

      {/* Backend Action Panel */}
      <div className="panel p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-neon-cyan" />
          Metalearning Analysis
        </h2>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'strategySelection', label: 'Strategy Selection' },
            { action: 'transferAnalysis', label: 'Transfer Analysis' },
            { action: 'performanceProfile', label: 'Performance Profile' },
          ].map(({ action, label }) => (
            <button key={action} onClick={() => handleAction(action)} disabled={!!isRunning}
              className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
              {isRunning === action ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {label}
            </button>
          ))}
        </div>
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
                    <p className="text-xs text-gray-500 uppercase tracking-wider">Rankings</p>
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

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="metalearning" />
          </div>
        )}
      </div>
    </div>
  );
}
