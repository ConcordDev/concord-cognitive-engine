'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useLensBridge } from '@/lib/hooks/use-lens-bridge';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { motion } from 'framer-motion';
import {
  GitMerge, Plus, ArrowRight, Database, Search, Zap,
  Clock, Gauge, Activity, ListOrdered, ChevronDown, ChevronUp,
  RefreshCw, AlertCircle, CheckCircle2, Timer, Layers, Loader2, BarChart3, Link,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

interface ForwardChainResult {
  initialFactCount: number;
  derivedFactCount: number;
  totalFactCount: number;
  iterations: number;
  fixedPointReached: boolean;
  derivedFacts: string[];
  derivationLog: { iteration: number; rule: string; derived: string }[];
  factsByPredicate: Record<string, number>;
  rulesApplied: string[];
}

interface BackwardChainResult {
  goal: string;
  proved: boolean;
  answerCount: number;
  answers: string[];
  proofCount: number;
  proofTrees: { root: string; children: unknown[] }[];
  nodesExplored: number;
}

interface UnifyResult {
  unifiable: boolean;
  term1: string;
  term2: string;
  mgu: Record<string, string>;
  bindingCount: number;
  unifiedTerm: string;
  verification: boolean;
  steps: { step: number; description: string }[];
  stepCount: number;
}

interface InferenceHistoryEntry {
  id?: string;
  type: string;
  query?: string;
  result?: unknown;
  confidence?: number;
  latencyMs?: number;
  timestamp?: string;
  status?: string;
}

const MODEL_OPTIONS = [
  { id: 'default', label: 'Default Engine', description: 'Built-in logical inference' },
  { id: 'forward-chain', label: 'Forward Chaining', description: 'Rule-based forward reasoning' },
  { id: 'backward-chain', label: 'Backward Chaining', description: 'Goal-directed reasoning' },
  { id: 'probabilistic', label: 'Probabilistic', description: 'Bayesian inference model' },
];

export default function InferenceLensPage() {
  useLensNav('inference');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('inference');

  const queryClient = useQueryClient();
  const [factInput, setFactInput] = useState('');
  const [queryInput, setQueryInput] = useState('');
  const [majorPremise, setMajorPremise] = useState('');
  const [minorPremise, setMinorPremise] = useState('');
  const [results, setResults] = useState<unknown>(null);
  const [tab, setTab] = useState<'facts' | 'query' | 'syllogism' | 'forward'>('facts');

  // Lens-scoped keyboard commands (auto-wired by codemod).
  useLensCommand(
    [
      { id: 'tab-facts', keys: 'f', description: 'Facts', category: 'navigation', action: () => setTab('facts') },
      { id: 'tab-query', keys: 'q', description: 'Query', category: 'navigation', action: () => setTab('query') },
      { id: 'tab-syllogism', keys: 's', description: 'Syllogism', category: 'navigation', action: () => setTab('syllogism') },
      { id: 'tab-forward', keys: 'o', description: 'Forward', category: 'navigation', action: () => setTab('forward') },
    ],
    { lensId: 'inference' }
  );
  const [selectedModel, setSelectedModel] = useState('default');
  const [inferenceHistory, setInferenceHistory] = useState<InferenceHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(true);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [showFeatures, setShowFeatures] = useState(true);

  // --- Lens Bridge ---
  const bridge = useLensBridge('inference', 'snapshot');

  const { items: infArtifacts } = useLensData('inference', 'snapshot', { seed: [] });
  const runAction = useRunArtifact('inference');
  const [infActionResult, setInfActionResult] = useState<{ action: string; data: unknown } | null>(null);

  const handleInfAction = useCallback(async (action: string) => {
    let artifactId = infArtifacts[0]?.id;
    // Auto-create a snapshot artifact if none exists yet
    if (!artifactId) {
      try {
        const created = await apiHelpers.lens.create('inference', {
          type: 'snapshot',
          title: 'Inference Engine Snapshot',
          data: { model: selectedModel },
        });
        artifactId = created?.data?.artifact?.id;
      } catch (e) {
        console.error('[Inference] Failed to auto-create artifact:', e);
        setInfActionResult({ action, data: { error: 'No inference artifact found. Try again after the auto-create completes.' } });
        return;
      }
      if (!artifactId) {
        setInfActionResult({ action, data: { error: 'Could not create inference artifact. Please try again.' } });
        return;
      }
    }
    runAction.mutate(
      { id: artifactId, action, params: {} },
      {
        onSuccess: (res) => setInfActionResult({ action, data: res.result }),
        onError: (e) => {
          console.error(`Action failed:`, e);
          setInfActionResult({ action, data: { error: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` } });
        },
      }
    );
  }, [infArtifacts, runAction, selectedModel]);

  const { data: status, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['inference-status'],
    queryFn: () => apiHelpers.inference.status().then((r) => r.data),
    refetchInterval: 15000,
  });

  const trackInference = (type: string, query: string | undefined, result: unknown, startTime: number) => {
    const entry: InferenceHistoryEntry = {
      id: `inf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      query,
      result,
      confidence: typeof result === 'object' && result !== null
        ? (result as Record<string, unknown>).confidence as number | undefined
        : undefined,
      latencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      status: 'completed',
    };
    setInferenceHistory(prev => [entry, ...prev].slice(0, 50));
  };

  const addFacts = useMutation({
    mutationFn: () => {
      const startTime = Date.now();
      return apiHelpers.inference.facts({ facts: factInput.split('\n').filter(Boolean) }).then(res => {
        trackInference('add-facts', `${factInput.split('\n').filter(Boolean).length} facts`, res.data, startTime);
        return res;
      });
    },
    onSuccess: (res) => {
      setResults(res.data);
      queryClient.invalidateQueries({ queryKey: ['inference-status'] });
      setFactInput('');
    },
    onError: (err) => console.error('addFacts failed:', err instanceof Error ? err.message : err),
  });

  const runQuery = useMutation({
    mutationFn: () => {
      const startTime = Date.now();
      return apiHelpers.inference.query({ query: queryInput }).then(res => {
        trackInference('query', queryInput, res.data, startTime);
        return res;
      });
    },
    onSuccess: (res) => setResults(res.data),
    onError: (err) => console.error('runQuery failed:', err instanceof Error ? err.message : err),
  });

  const runSyllogism = useMutation({
    mutationFn: () => {
      const startTime = Date.now();
      return apiHelpers.inference.syllogism({ major: majorPremise, minor: minorPremise }).then(res => {
        trackInference('syllogism', `${majorPremise} + ${minorPremise}`, res.data, startTime);
        return res;
      });
    },
    onSuccess: (res) => setResults(res.data),
    onError: (err) => console.error('runSyllogism failed:', err instanceof Error ? err.message : err),
  });

  const runForwardChain = useMutation({
    mutationFn: () => {
      const startTime = Date.now();
      return apiHelpers.inference.forwardChain({}).then(res => {
        trackInference('forward-chain', 'Full forward chain', res.data, startTime);
        return res;
      });
    },
    onSuccess: (res) => setResults(res.data),
    onError: (err) => console.error('runForwardChain failed:', err instanceof Error ? err.message : err),
  });

  const statusInfo = useMemo(() => status?.status || status || {}, [status]);

  // Bridge inference status into lens artifacts
  useEffect(() => {
    if (Object.keys(statusInfo).length > 0) {
      bridge.sync(statusInfo as Record<string, unknown>, 'Inference Engine Status');
    }
  }, [statusInfo, bridge]);

  const avgLatency = useMemo(() => {
    if (inferenceHistory.length === 0) return 0;
    return inferenceHistory.reduce((s, h) => s + (h.latencyMs || 0), 0) / inferenceHistory.length;
  }, [inferenceHistory]);

  const resultConfidence = useMemo(() => {
    if (!results || typeof results !== 'object') return null;
    const r = results as Record<string, unknown>;
    return r.confidence as number | undefined ?? r.score as number | undefined ?? null;
  }, [results]);

  const isPending = addFacts.isPending || runQuery.isPending || runSyllogism.isPending || runForwardChain.isPending;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-blue border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading inference engine...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  return (
    <LensShell lensId="inference" asMain={false}>
      <ManifestActionBar />
    <div data-lens-theme="inference" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <GitMerge className="w-7 h-7 text-neon-blue" />
          <div>
            <h1 className="text-xl font-bold">Inference Lens</h1>
            <p className="text-sm text-gray-400">
              Logical inference engine -- facts, rules, syllogisms, forward chaining
            </p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="inference" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <div className="flex items-center gap-2">
          <UniversalActions domain="inference" artifactId={bridge.selectedId} compact />
          <button
            onClick={() => refetch()}
            className="p-2 rounded-lg bg-lattice-surface hover:bg-lattice-border transition-colors text-gray-400 hover:text-white"
            title="Refresh status"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Stats Row — model cards with inference latency */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { icon: Database, color: 'text-neon-blue', value: statusInfo.factCount || 0, label: 'Facts' },
          { icon: GitMerge, color: 'text-neon-purple', value: statusInfo.ruleCount || 0, label: 'Rules' },
          { icon: Zap, color: 'text-neon-green', value: statusInfo.inferences || 0, label: 'Inferences' },
          { icon: Search, color: 'text-neon-cyan', value: statusInfo.queries || 0, label: 'Queries' },
          { icon: Timer, color: 'text-neon-yellow', value: avgLatency > 0 ? `${avgLatency.toFixed(0)}ms` : '--', label: 'Avg Latency' },
        ].map((stat, i) => (
          <motion.div key={stat.label} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }} className="lens-card">
            <stat.icon className={`w-5 h-5 ${stat.color} mb-2`} />
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-sm text-gray-400">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Confidence Distribution Bar */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="flex items-center gap-3 px-1">
        <span className="text-[10px] text-gray-500 shrink-0">Confidence</span>
        <div className="flex-1 h-2 rounded-full overflow-hidden flex bg-lattice-deep">
          {inferenceHistory.length > 0 ? (
            <>
              <div className="bg-neon-green h-full" style={{ width: `${(inferenceHistory.filter(h => (h.confidence ?? 0) > 0.7).length / inferenceHistory.length) * 100}%` }} title="High" />
              <div className="bg-neon-yellow h-full" style={{ width: `${(inferenceHistory.filter(h => (h.confidence ?? 0) > 0.4 && (h.confidence ?? 0) <= 0.7).length / inferenceHistory.length) * 100}%` }} title="Medium" />
              <div className="bg-red-400 h-full" style={{ width: `${(inferenceHistory.filter(h => (h.confidence ?? 0) <= 0.4).length / inferenceHistory.length) * 100}%` }} title="Low" />
            </>
          ) : (
            <div className="bg-white/5 h-full w-full" />
          )}
        </div>
        <span className="text-[10px] text-gray-500">{inferenceHistory.length} runs</span>
      </motion.div>

      {/* Model Selector */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <Gauge className="w-4 h-4 text-neon-cyan" /> Inference Model
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {MODEL_OPTIONS.map((m) => (
            <button
              key={m.id}
              onClick={() => setSelectedModel(m.id)}
              className={`p-3 rounded-lg border text-left transition-all ${
                selectedModel === m.id
                  ? 'bg-neon-cyan/10 border-neon-cyan/40 text-white'
                  : 'bg-lattice-surface border-lattice-border text-gray-400 hover:border-gray-500'
              }`}
            >
              <p className="text-sm font-medium">{m.label}</p>
              <p className="text-xs text-gray-500 mt-1">{m.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {(['facts', 'query', 'syllogism', 'forward'] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setResults(null); }}
            className={`px-3 py-1.5 rounded-lg text-sm capitalize transition-colors ${
              tab === t
                ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30'
                : 'bg-lattice-surface text-gray-400 hover:text-gray-300'
            }`}
          >
            {t === 'forward' ? 'Forward Chain' : t}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Panel */}
        <div className="panel p-4 space-y-4">
          {tab === 'facts' && (
            <>
              <h2 className="font-semibold flex items-center gap-2">
                <Plus className="w-4 h-4 text-neon-purple" /> Add Facts
              </h2>
              <textarea
                value={factInput}
                onChange={(e) => setFactInput(e.target.value)}
                placeholder="Enter facts (one per line)..."
                className="input-lattice w-full h-40 resize-none font-mono text-sm"
              />
              <button
                onClick={() => addFacts.mutate()}
                disabled={!factInput || addFacts.isPending}
                className="btn-neon purple w-full"
              >
                {addFacts.isPending ? 'Adding...' : 'Add Facts'}
              </button>
            </>
          )}

          {tab === 'query' && (
            <>
              <h2 className="font-semibold flex items-center gap-2">
                <Search className="w-4 h-4 text-neon-cyan" /> Query Inference
              </h2>
              <input
                type="text"
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder="Enter query..."
                className="input-lattice w-full"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && queryInput && !runQuery.isPending) runQuery.mutate();
                }}
              />
              <p className="text-xs text-gray-500">
                Using model: <span className="text-neon-cyan">{MODEL_OPTIONS.find(m => m.id === selectedModel)?.label}</span>
              </p>
              <button
                onClick={() => runQuery.mutate()}
                disabled={!queryInput || runQuery.isPending}
                className="btn-neon purple w-full"
              >
                {runQuery.isPending ? 'Querying...' : 'Run Query'}
              </button>
            </>
          )}

          {tab === 'syllogism' && (
            <>
              <h2 className="font-semibold flex items-center gap-2">
                <GitMerge className="w-4 h-4 text-neon-purple" /> Syllogism
              </h2>
              <input
                type="text"
                value={majorPremise}
                onChange={(e) => setMajorPremise(e.target.value)}
                placeholder="Major premise: All X are Y"
                className="input-lattice w-full"
              />
              <input
                type="text"
                value={minorPremise}
                onChange={(e) => setMinorPremise(e.target.value)}
                placeholder="Minor premise: Z is X"
                className="input-lattice w-full"
              />
              <button
                onClick={() => runSyllogism.mutate()}
                disabled={!majorPremise || !minorPremise || runSyllogism.isPending}
                className="btn-neon purple w-full"
              >
                {runSyllogism.isPending ? 'Reasoning...' : 'Derive Conclusion'}
              </button>
            </>
          )}

          {tab === 'forward' && (
            <>
              <h2 className="font-semibold flex items-center gap-2">
                <Zap className="w-4 h-4 text-neon-green" /> Forward Chaining
              </h2>
              <p className="text-sm text-gray-400">
                Apply all known rules to derive new facts from the existing knowledge base.
              </p>
              <div className="lens-card text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-500">Current facts</span>
                  <span className="text-gray-300">{statusInfo.factCount || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Active rules</span>
                  <span className="text-gray-300">{statusInfo.ruleCount || 0}</span>
                </div>
              </div>
              <button
                onClick={() => runForwardChain.mutate()}
                disabled={runForwardChain.isPending}
                className="btn-neon purple w-full"
              >
                {runForwardChain.isPending ? 'Chaining...' : 'Run Forward Chain'}
              </button>
            </>
          )}

          {/* Queue / Pending Indicator */}
          {isPending && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-neon-blue/10 border border-neon-blue/20">
              <Activity className="w-4 h-4 text-neon-blue animate-pulse" />
              <span className="text-sm text-neon-blue">Inference in progress...</span>
            </div>
          )}
        </div>

        {/* Results Panel */}
        <div className="panel p-4 space-y-4">
          <h2 className="font-semibold flex items-center gap-2">
            <ArrowRight className="w-4 h-4 text-neon-green" /> Results
          </h2>

          {/* Confidence Score Bar */}
          {resultConfidence !== null && resultConfidence !== undefined && (
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Confidence</span>
                <span className={`font-bold ${
                  resultConfidence > 0.7 ? 'text-neon-green' :
                  resultConfidence > 0.4 ? 'text-neon-yellow' : 'text-red-400'
                }`}>
                  {(resultConfidence * 100).toFixed(1)}%
                </span>
              </div>
              <div className="h-2 bg-lattice-deep rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    resultConfidence > 0.7 ? 'bg-neon-green' :
                    resultConfidence > 0.4 ? 'bg-neon-yellow' : 'bg-red-400'
                  }`}
                  style={{ width: `${resultConfidence * 100}%` }}
                />
              </div>
            </div>
          )}

          {results ? (
            <div className="bg-lattice-surface p-3 rounded-lg">
              <pre className="whitespace-pre-wrap text-xs text-gray-300 font-mono max-h-96 overflow-y-auto">
                {JSON.stringify(results, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="text-center py-12 text-gray-500">
              Run a query or operation to see results
            </p>
          )}
        </div>
      </div>

      {/* Inference History */}
      <div className="panel p-4">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="w-full flex items-center justify-between font-semibold"
        >
          <span className="flex items-center gap-2">
            <ListOrdered className="w-4 h-4 text-neon-purple" /> Inference History
            <span className="text-xs text-gray-500 font-normal">({inferenceHistory.length} entries)</span>
          </span>
          {showHistory ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>

        {showHistory && (
          <div className="mt-4 space-y-2 max-h-80 overflow-y-auto">
            {inferenceHistory.length > 0 ? inferenceHistory.map((entry) => (
              <div
                key={entry.id}
                className="lens-card cursor-pointer hover:bg-lattice-border/30 transition-colors"
                onClick={() => setExpandedHistoryId(expandedHistoryId === entry.id ? null : (entry.id ?? null))}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {entry.status === 'completed' ? (
                      <CheckCircle2 className="w-4 h-4 text-neon-green flex-shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-neon-yellow flex-shrink-0" />
                    )}
                    <div>
                      <span className="text-sm font-medium capitalize">{entry.type.replace('-', ' ')}</span>
                      {entry.query && (
                        <p className="text-xs text-gray-500 truncate max-w-xs">{entry.query}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    {entry.confidence != null && (
                      <span className={`font-medium ${
                        entry.confidence > 0.7 ? 'text-neon-green' :
                        entry.confidence > 0.4 ? 'text-neon-yellow' : 'text-red-400'
                      }`}>
                        {(entry.confidence * 100).toFixed(0)}%
                      </span>
                    )}
                    {entry.latencyMs != null && (
                      <span className="text-gray-500 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {entry.latencyMs}ms
                      </span>
                    )}
                    {entry.timestamp && (
                      <span className="text-gray-600">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                </div>
                {expandedHistoryId === entry.id && !!entry.result && (
                  <div className="mt-2 pt-2 border-t border-lattice-border">
                    <pre className="text-xs text-gray-400 font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
                      {JSON.stringify(entry.result, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )) : (
              <p className="text-center py-8 text-gray-500 text-sm">
                No inference history yet -- run queries to build history
              </p>
            )}
          </div>
        )}

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="inference"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
      </div>

      {/* AI Inference Actions Panel */}
      <div className="panel p-4 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-neon-blue" />
          Logical Inference Actions
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { action: 'forwardChain', label: 'Forward Chain', icon: Zap, color: 'text-neon-green' },
            { action: 'backwardChain', label: 'Backward Chain', icon: ArrowRight, color: 'text-neon-cyan' },
            { action: 'unify', label: 'Unify Terms', icon: Link, color: 'text-neon-purple' },
          ].map(({ action, label, icon: Icon, color }) => (
            <button
              key={action}
              onClick={() => handleInfAction(action)}
              disabled={runAction.isPending}
              className="flex items-center gap-2 px-4 py-3 bg-lattice-surface border border-lattice-border rounded-lg text-sm font-medium text-white hover:border-neon-blue/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {runAction.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Icon className={`w-4 h-4 ${color}`} />
              )}
              {label}
            </button>
          ))}
        </div>

        {infActionResult && !runAction.isPending && (() => {
          if (infActionResult.action === 'forwardChain') {
            const d = infActionResult.data as ForwardChainResult;
            return (
              <div className="space-y-3 pt-2 border-t border-lattice-border">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-neon-green">Forward Chain Results</h3>
                  <span className={`text-xs px-2 py-1 rounded ${d.fixedPointReached ? 'bg-neon-green/10 text-neon-green' : 'bg-yellow-400/10 text-yellow-400'}`}>
                    {d.fixedPointReached ? 'Fixed Point Reached' : 'Not Saturated'}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Initial Facts', value: d.initialFactCount || 0, color: 'text-gray-300' },
                    { label: 'Derived Facts', value: d.derivedFactCount || 0, color: 'text-neon-green' },
                    { label: 'Total Facts', value: d.totalFactCount || 0, color: 'text-neon-cyan' },
                    { label: 'Iterations', value: d.iterations || 0, color: 'text-neon-purple' },
                  ].map(s => (
                    <div key={s.label} className="lens-card text-center">
                      <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                      <p className="text-xs text-gray-400">{s.label}</p>
                    </div>
                  ))}
                </div>
                {(d.derivedFacts || []).length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 mb-2">Derived Facts (first 5)</p>
                    <div className="space-y-1">
                      {d.derivedFacts.slice(0, 5).map((f, i) => (
                        <p key={i} className="text-xs font-mono text-neon-green bg-neon-green/5 px-2 py-1 rounded">{f}</p>
                      ))}
                    </div>
                  </div>
                )}
                {(d.rulesApplied || []).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    <span className="text-xs text-gray-500 mr-1">Rules applied:</span>
                    {d.rulesApplied.slice(0, 5).map((r, i) => (
                      <span key={i} className="text-xs px-1.5 py-0.5 bg-lattice-surface rounded text-gray-400">{r}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          if (infActionResult.action === 'backwardChain') {
            const d = infActionResult.data as BackwardChainResult;
            return (
              <div className="space-y-3 pt-2 border-t border-lattice-border">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-neon-cyan">Backward Chain — {d.goal}</h3>
                  <span className={`text-xs px-2 py-1 rounded font-semibold ${d.proved ? 'bg-neon-green/20 text-neon-green' : 'bg-red-400/20 text-red-400'}`}>
                    {d.proved ? 'Proved' : 'Unproved'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="lens-card text-center">
                    <p className="text-lg font-bold text-neon-cyan">{d.answerCount || 0}</p>
                    <p className="text-xs text-gray-400">Answers</p>
                  </div>
                  <div className="lens-card text-center">
                    <p className="text-lg font-bold text-neon-purple">{d.proofCount || 0}</p>
                    <p className="text-xs text-gray-400">Proofs</p>
                  </div>
                  <div className="lens-card text-center">
                    <p className="text-lg font-bold text-gray-300">{d.nodesExplored || 0}</p>
                    <p className="text-xs text-gray-400">Nodes Explored</p>
                  </div>
                </div>
                {(d.answers || []).length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 mb-2">Answers</p>
                    {d.answers.slice(0, 5).map((a, i) => (
                      <p key={i} className="text-xs font-mono text-neon-cyan bg-neon-cyan/5 px-2 py-1 rounded mb-1">{a}</p>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          if (infActionResult.action === 'unify') {
            const d = infActionResult.data as UnifyResult;
            return (
              <div className="space-y-3 pt-2 border-t border-lattice-border">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-neon-purple">Unification Result</h3>
                  <span className={`text-xs px-2 py-1 rounded font-semibold ${d.unifiable ? 'bg-neon-green/20 text-neon-green' : 'bg-red-400/20 text-red-400'}`}>
                    {d.unifiable ? 'Unifiable' : 'Not Unifiable'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div className="lens-card">
                    <p className="text-gray-400 mb-1">Term 1</p>
                    <p className="text-white">{d.term1}</p>
                  </div>
                  <div className="lens-card">
                    <p className="text-gray-400 mb-1">Term 2</p>
                    <p className="text-white">{d.term2}</p>
                  </div>
                </div>
                {d.unifiable && d.unifiedTerm && (
                  <div className="lens-card">
                    <p className="text-xs text-gray-400 mb-1">Unified Term</p>
                    <p className="text-sm font-mono text-neon-purple">{d.unifiedTerm}</p>
                  </div>
                )}
                {Object.keys(d.mgu || {}).length > 0 && (
                  <div>
                    <p className="text-xs text-gray-400 mb-2">MGU Bindings ({d.bindingCount})</p>
                    <div className="space-y-1">
                      {Object.entries(d.mgu).slice(0, 5).map(([k, v]) => (
                        <p key={k} className="text-xs font-mono"><span className="text-neon-cyan">{k}</span><span className="text-gray-500"> → </span><span className="text-white">{v}</span></p>
                      ))}
                    </div>
                  </div>
                )}
                {d.verification !== undefined && (
                  <span className={`text-xs px-2 py-1 rounded ${d.verification ? 'bg-neon-green/10 text-neon-green' : 'bg-red-400/10 text-red-400'}`}>
                    Verification: {d.verification ? 'Passed' : 'Failed'}
                  </span>
                )}
              </div>
            );
          }
          return null;
        })()}
      </div>

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
            <LensFeaturePanel lensId="inference" />
          </div>
        )}
      </div>
    </div>
    
      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <a href="#inference-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to inference content</a>
    </LensShell>
  );
}
