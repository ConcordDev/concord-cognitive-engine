'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useLensBridge } from '@/lib/hooks/use-lens-bridge';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  TrendingUp, AlertTriangle, CheckCircle2,
  Brain, Eye, Shield, BarChart3, Layers, ChevronDown,
  BookOpen, Target, ThumbsUp, ThumbsDown, Clock, ArrowRight, Lightbulb, Flame, CalendarDays, Zap, X,
} from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

// Mirror icon alias
const Mirror = Eye;

interface Reflection {
  id: string;
  timestamp: string;
  quality: number;
  checks: Record<string, number>;
  insights: { type: string; message: string; severity: number }[];
  corrections: string[];
}

export default function ReflectionLensPage() {
  useLensNav('reflection');
  const [showFeatures, setShowFeatures] = useState(true);
  const { items: reflectionArtifacts } = useLensData('reflection', 'entry', { seed: [] });
  const runReflectionAction = useRunArtifact('reflection');
  const [reflActionResult, setReflActionResult] = useState<Record<string, unknown> | null>(null);
  const [reflActiveAction, setReflActiveAction] = useState<string | null>(null);

  const handleReflectionAction = async (action: string) => {
    const id = reflectionArtifacts[0]?.id;
    if (!id) return;
    setReflActiveAction(action);
    try {
      const res = await runReflectionAction.mutateAsync({ id, action });
      if (res.ok === false) { setReflActionResult({ action, message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setReflActionResult({ action, ...(res.result as Record<string, unknown>) }); }
    } catch (err) { console.error('Reflection action failed:', err); }
    finally { setReflActiveAction(null); }
  };
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('reflection');

  // --- Lens Bridge ---
  const bridge = useLensBridge('reflection', 'reflection');

  const { data: status, isLoading, isError: isError, error: error, refetch: refetch,} = useQuery({
    queryKey: ['reflection-status'],
    queryFn: () => apiHelpers.reflection.status().then((r) => r.data),
    refetchInterval: 15000,
  });

  const { data: recent, isError: isError2, error: error2, refetch: refetch2,} = useQuery({
    queryKey: ['reflection-recent'],
    queryFn: () => apiHelpers.reflection.recent(20).then((r) => r.data),
  });

  const { data: selfModel, isError: isError3, error: error3, refetch: refetch3,} = useQuery({
    queryKey: ['reflection-self-model'],
    queryFn: () => apiHelpers.reflection.selfModel().then((r) => r.data),
  });

  const reflections: Reflection[] = useMemo(() => recent?.reflections || [], [recent]);
  const model = selfModel?.selfModel || status?.selfModel || {};
  const stats = status?.stats || {};

  // Bridge reflections into lens artifacts
  useEffect(() => {
    bridge.syncList(reflections, (r) => {
      const ref = r as Reflection;
      return { title: `Reflection ${ref.id}`, data: r as Record<string, unknown>, meta: { quality: String(ref.quality) } };
    });
  }, [reflections, bridge]);

  const avgQuality = reflections.length > 0
    ? reflections.reduce((s, r) => s + r.quality, 0) / reflections.length
    : 0;

  const checkNames: Record<string, string> = {
    factConsistency: 'Fact Consistency',
    relevance: 'Relevance',
    grounding: 'Evidence Grounding',
    completeness: 'Completeness',
    selfConsistency: 'Self-Consistency',
  };


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
    <div data-lens-theme="reflection" className="p-6 space-y-6">
      <header className="flex items-center gap-3">
        <span className="text-2xl">🪞</span>
        <div>
          <h1 className="text-xl font-bold">Reflection Lens</h1>
          <p className="text-sm text-gray-400">
            Self-critique loop — evaluates response quality and learns from output analysis
          </p>
        </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="reflection" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      </header>

      {/* AI Actions */}
      <UniversalActions domain="reflection" artifactId={bridge.selectedId} compact />

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="lens-card">
          <CalendarDays className="w-5 h-5 text-neon-purple mb-2" />
          <p className="text-2xl font-bold">{status?.reflections || reflections.length}</p>
          <p className="text-sm text-gray-400">Entries</p>
        </div>
        <div className="lens-card">
          <Flame className="w-5 h-5 text-orange-400 mb-2" />
          <p className="text-2xl font-bold">{stats.reflectionsRun || 0}</p>
          <p className="text-sm text-gray-400">Streak Days</p>
        </div>
        <div className="lens-card">
          <TrendingUp className="w-5 h-5 text-neon-green mb-2" />
          <p className="text-2xl font-bold">{(avgQuality * 100).toFixed(0)}%</p>
          <p className="text-sm text-gray-400">Mood Avg</p>
        </div>
        <div className="lens-card">
          <Shield className="w-5 h-5 text-neon-yellow mb-2" />
          <p className="text-2xl font-bold">{((model.confidenceCalibration || 0) * 100).toFixed(0)}%</p>
          <p className="text-sm text-gray-400">Calibration</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Self-Model */}
        <div className="panel p-4 space-y-4">
          <h2 className="font-semibold flex items-center gap-2">
            <Brain className="w-4 h-4 text-neon-purple" /> Self-Model
          </h2>

          {model.strengths?.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 uppercase mb-1">Strengths</p>
              <div className="space-y-1">
                {model.strengths.map((s: string, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-neon-green">
                    <CheckCircle2 className="w-3 h-3" /> {checkNames[s] || s}
                  </div>
                ))}
              </div>
            </div>
          )}

          {model.weaknesses?.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 uppercase mb-1">Weaknesses</p>
              <div className="space-y-1">
                {model.weaknesses.map((w: string, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-yellow-400">
                    <AlertTriangle className="w-3 h-3" /> {checkNames[w] || w}
                  </div>
                ))}
              </div>
            </div>
          )}

          {model.biases?.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 uppercase mb-1">Detected Biases</p>
              {model.biases.map((b: string, i: number) => (
                <p key={i} className="text-sm text-red-400">{b}</p>
              ))}
            </div>
          )}

          {!model.strengths?.length && !model.weaknesses?.length && (
            <p className="text-sm text-gray-500">Self-model builds over time as reflections accumulate</p>
          )}

          <div className="border-t border-lattice-border pt-3 space-y-2">
            <p className="text-xs text-gray-500 uppercase">Stats</p>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Reflections run</span>
              <span className="text-gray-300">{stats.reflectionsRun || 0}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Self-corrections</span>
              <span className="text-gray-300">{stats.selfCorrections || 0}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Quality improvements</span>
              <span className="text-neon-green">{stats.qualityImprovements || 0}</span>
            </div>
          </div>
        </div>

        {/* Quality Breakdown */}
        <div className="panel p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-neon-cyan" /> Quality Dimensions
          </h2>
          {reflections.length > 0 ? (
            <div className="space-y-3">
              {Object.entries(checkNames).map(([key, label]) => {
                const avg = reflections.reduce((s, r) => s + (r.checks[key] || 0), 0) / reflections.length;
                return (
                  <div key={key}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-300">{label}</span>
                      <span className={`${avg > 0.7 ? 'text-neon-green' : avg > 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {(avg * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2 bg-lattice-deep rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${avg > 0.7 ? 'bg-neon-green' : avg > 0.4 ? 'bg-yellow-400' : 'bg-red-400'}`}
                        style={{ width: `${avg * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-center py-8 text-gray-500 text-sm">No reflections yet — interact with the system to generate data</p>
          )}
        </div>

        {/* Recent Reflections */}
        <div className="panel p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Mirror className="w-4 h-4 text-neon-green" /> Recent Reflections
          </h2>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {reflections.map((r, index) => (
              <motion.div key={r.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="lens-card">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">{new Date(r.timestamp).toLocaleString()}</span>
                  <span className={`text-sm font-bold ${r.quality > 0.7 ? 'text-neon-green' : r.quality > 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {(r.quality * 100).toFixed(0)}%
                  </span>
                </div>
                {r.insights.length > 0 && (
                  <div className="mt-1 space-y-1">
                    {r.insights.map((ins, i) => (
                      <p key={i} className="text-xs text-yellow-400">{ins.message}</p>
                    ))}
                  </div>
                )}
                {r.corrections.length > 0 && (
                  <div className="mt-1 space-y-1">
                    {r.corrections.map((c, i) => (
                      <p key={i} className="text-xs text-red-400">{c}</p>
                    ))}
                  </div>
                )}
              </motion.div>
            ))}
            {reflections.length === 0 && (
              <p className="text-center py-4 text-gray-500 text-sm">No reflections recorded yet</p>
            )}
          </div>
        </div>

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="reflection"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
      </div>

      {/* Decision Journal — Outcome Tracking */}
      <div className="panel p-6 space-y-5">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-neon-purple" />
          Decision Journal
        </h2>
        <p className="text-sm text-gray-400">
          Track decisions, record expected outcomes, and measure results over time to improve future judgment.
        </p>

        {/* Decision Entries */}
        <div className="space-y-3">
          {[
            {
              id: 'dj-001',
              decision: 'Migrate DTU storage to graph-native format',
              date: 'Feb 22, 2026',
              expected: 'Faster graph queries, reduced join overhead by 60%',
              actual: 'Query latency reduced by 72%, storage cost up 15%',
              outcome: 'positive' as const,
              confidence: 0.8,
              tags: ['architecture', 'performance'],
            },
            {
              id: 'dj-002',
              decision: 'Implement CRETI scoring for all DTUs',
              date: 'Feb 15, 2026',
              expected: 'Higher quality marketplace listings, better trust signals',
              actual: 'Pending evaluation — 2 weeks until data is significant',
              outcome: 'pending' as const,
              confidence: 0.65,
              tags: ['quality', 'marketplace'],
            },
            {
              id: 'dj-003',
              decision: 'Switch council voting from simple majority to weighted credibility',
              date: 'Feb 8, 2026',
              expected: 'Reduce gaming, increase quality of promoted DTUs',
              actual: 'Promotion quality up 34%, but participation dropped 12%',
              outcome: 'mixed' as const,
              confidence: 0.7,
              tags: ['governance', 'council'],
            },
            {
              id: 'dj-004',
              decision: 'Enable auto-forking for high-divergence edits',
              date: 'Jan 30, 2026',
              expected: 'Prevent edit conflicts, preserve original context',
              actual: 'Conflict rate dropped 89%, fork sprawl increased',
              outcome: 'positive' as const,
              confidence: 0.9,
              tags: ['fork', 'conflict-resolution'],
            },
          ].map((entry) => (
            <div key={entry.id} className="bg-black/40 border border-white/10 rounded-lg p-4 space-y-3 hover:border-neon-purple/30 transition-colors">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  {entry.outcome === 'positive' && <ThumbsUp className="w-4 h-4 text-neon-green" />}
                  {entry.outcome === 'mixed' && <AlertTriangle className="w-4 h-4 text-yellow-400" />}
                  {entry.outcome === 'pending' && <Clock className="w-4 h-4 text-neon-cyan" />}
                  <span className="text-sm font-semibold text-white">{entry.decision}</span>
                </div>
                <span className="text-xs text-gray-500 whitespace-nowrap ml-2">{entry.date}</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <p className="text-xs text-gray-500 uppercase flex items-center gap-1">
                    <Target className="w-3 h-3" /> Expected Outcome
                  </p>
                  <p className="text-xs text-gray-300">{entry.expected}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-gray-500 uppercase flex items-center gap-1">
                    <ArrowRight className="w-3 h-3" /> Actual Result
                  </p>
                  <p className={`text-xs ${
                    entry.outcome === 'positive' ? 'text-neon-green' :
                    entry.outcome === 'mixed' ? 'text-yellow-400' : 'text-neon-cyan'
                  }`}>{entry.actual}</p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-white/5">
                <div className="flex items-center gap-2">
                  {entry.tags.map((tag) => (
                    <span key={tag} className="text-xs px-1.5 py-0.5 rounded bg-neon-purple/10 text-neon-purple">{tag}</span>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <Lightbulb className="w-3 h-3" />
                  <span>Confidence: {(entry.confidence * 100).toFixed(0)}%</span>
                  <div className="w-12 h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${entry.confidence > 0.7 ? 'bg-neon-green' : 'bg-yellow-400'}`}
                      style={{ width: `${entry.confidence * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Outcome Tracking Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-black/40 border border-white/10 rounded-lg p-3 text-center">
            <ThumbsUp className="w-4 h-4 text-neon-green mx-auto mb-1" />
            <p className="text-lg font-bold text-neon-green">12</p>
            <p className="text-xs text-gray-500">Positive</p>
          </div>
          <div className="bg-black/40 border border-white/10 rounded-lg p-3 text-center">
            <AlertTriangle className="w-4 h-4 text-yellow-400 mx-auto mb-1" />
            <p className="text-lg font-bold text-yellow-400">5</p>
            <p className="text-xs text-gray-500">Mixed</p>
          </div>
          <div className="bg-black/40 border border-white/10 rounded-lg p-3 text-center">
            <ThumbsDown className="w-4 h-4 text-red-400 mx-auto mb-1" />
            <p className="text-lg font-bold text-red-400">2</p>
            <p className="text-xs text-gray-500">Negative</p>
          </div>
          <div className="bg-black/40 border border-white/10 rounded-lg p-3 text-center">
            <Clock className="w-4 h-4 text-neon-cyan mx-auto mb-1" />
            <p className="text-lg font-bold text-neon-cyan">3</p>
            <p className="text-xs text-gray-500">Pending</p>
          </div>
        </div>
      </div>

      {/* Reflection Domain Actions */}
      <div className="panel p-4 space-y-3">
        <h3 className="text-sm font-semibold text-neon-blue flex items-center gap-2"><Brain className="w-4 h-4" /> Reflection Analysis</h3>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'insightExtraction', label: 'Extract Insights' },
            { action: 'growthMetrics', label: 'Growth Metrics' },
            { action: 'habitTracking', label: 'Habit Tracking' },
          ].map(({ action, label }) => (
            <button key={action} onClick={() => handleReflectionAction(action)} disabled={reflActiveAction === action || !reflectionArtifacts[0]?.id}
              className="px-3 py-1.5 text-xs bg-neon-blue/10 border border-neon-blue/20 rounded-lg hover:bg-neon-blue/20 disabled:opacity-50 flex items-center gap-1.5">
              {reflActiveAction === action ? <div className="w-3 h-3 border border-neon-blue border-t-transparent rounded-full animate-spin" /> : <Zap className="w-3 h-3 text-neon-blue" />}
              {label}
            </button>
          ))}
        </div>
        {reflActionResult && (
          <div className="p-3 bg-black/40 rounded-lg border border-neon-blue/20 text-xs space-y-2">
            {reflActionResult.action === 'insightExtraction' && (
              <div className="space-y-1">
                <div className="flex gap-4 flex-wrap">
                  <span className="text-gray-400">Entries: <span className="text-white font-mono">{String(reflActionResult.entriesAnalyzed ?? '')}</span></span>
                  <span className="text-gray-400">Themes: <span className="text-neon-blue font-mono">{Array.isArray(reflActionResult.themes) ? (reflActionResult.themes as unknown[]).length : ''}</span></span>
                </div>
                {Array.isArray(reflActionResult.themes) && (
                  <div className="flex flex-wrap gap-1">{(reflActionResult.themes as {theme:string;prevalence:number}[]).slice(0,8).map(({theme,prevalence}) => <span key={theme} className="px-2 py-0.5 bg-neon-blue/10 text-neon-blue rounded font-mono">{theme} <span className="text-gray-500">{Math.round(prevalence*100)}%</span></span>)}</div>
                )}
              </div>
            )}
            {reflActionResult.action === 'growthMetrics' && (
              <div className="space-y-1">
                <div className="flex gap-4 flex-wrap">
                  <span className="text-gray-400">Sentiment trend: <span className={`font-mono ${(reflActionResult.sentiment as Record<string,unknown>)?.trend === 'improving' ? 'text-green-400' : (reflActionResult.sentiment as Record<string,unknown>)?.trend === 'declining' ? 'text-red-400' : 'text-yellow-400'}`}>{String((reflActionResult.sentiment as Record<string,unknown>)?.trend ?? '')}</span></span>
                  <span className="text-gray-400">Depth: <span className="text-neon-blue font-mono">{String((reflActionResult.entryDepth as Record<string,unknown>)?.trend ?? '')}</span></span>
                </div>
                {!!(reflActionResult.sentiment as Record<string,unknown>)?.overall && <p className="text-gray-300">Avg sentiment: {String((reflActionResult.sentiment as Record<string,unknown>)?.overall ?? '')}</p>}
              </div>
            )}
            {reflActionResult.action === 'habitTracking' && (
              <div className="space-y-1">
                <div className="flex gap-4 flex-wrap">
                  <span className="text-gray-400">Habits tracked: <span className="text-white font-mono">{String(reflActionResult.totalHabits ?? '')}</span></span>
                  <span className="text-gray-400">Consistency: <span className="text-neon-green font-mono">{String(Math.round(((reflActionResult.overallConsistency as number) ?? 0) * 100))}%</span></span>
                </div>
                {Array.isArray(reflActionResult.habitProfiles) && (
                  <div className="space-y-0.5">{(reflActionResult.habitProfiles as {name:string;currentStreak:number;consistency:number}[]).slice(0,5).map(h => <div key={h.name} className="flex gap-3"><span className="text-gray-300">{h.name}</span><span className="text-neon-green font-mono">🔥{h.currentStreak}d</span><span className="text-gray-500">{Math.round(h.consistency*100)}%</span></div>)}</div>
                )}
              </div>
            )}
            <button onClick={() => setReflActionResult(null)} className="text-gray-600 hover:text-gray-400 text-xs flex items-center gap-1"><X className="w-3 h-3" /> Dismiss</button>
          </div>
        )}
      </div>

      {/* ConnectiveTissueBar */}
      <ConnectiveTissueBar lensId="reflection" />

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
            <LensFeaturePanel lensId="reflection" />
          </div>
        )}
      </div>
    </div>
  );
}
