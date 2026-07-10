'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { InferenceFrameworks } from '@/components/inference/InferenceFrameworks';
import { RuleEngineWorkbench } from '@/components/inference/RuleEngineWorkbench';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers, lensRun } from '@/lib/api/client';
import { useState, useMemo, useEffect } from 'react';
import { useLensBridge } from '@/lib/hooks/use-lens-bridge';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { motion } from 'framer-motion';
import {
  GitMerge, Plus, ArrowRight, Database, Search, Zap,
  Clock, Gauge, Activity, ListOrdered, ChevronDown, ChevronUp,
  RefreshCw, AlertCircle, CheckCircle2, Timer, Layers, Link,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

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

type InferenceTerm = string | { functor: string; args: InferenceTerm[] };

/**
 * Parses a compact Prolog-style term for the `unify` macro
 * (server/domains/inference.js:357) — `functor(arg1, arg2, ...)` for a
 * compound term (args may themselves be compound), or a bare token for a
 * constant/variable (variables are conventionally prefixed `?`, e.g. `?X`).
 * Not a JSON-paste box — a real, bounded grammar matching the macro's own
 * term shape (`isVar`/`isConstant`/`isCompound` in the handler).
 */
function parseInferenceTerm(input: string): InferenceTerm {
  const s = input.trim();
  const m = s.match(/^([a-zA-Z0-9_?]+)\((.*)\)$/s);
  if (!m) return s;
  const functor = m[1];
  const args = splitTermArgs(m[2]).map(parseInferenceTerm);
  return { functor, args };
}
function splitTermArgs(s: string): string[] {
  const parts: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim());
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
  const [factSubject, setFactSubject] = useState('');
  const [factPredicate, setFactPredicate] = useState('');
  const [factObject, setFactObject] = useState('');
  const [querySubject, setQuerySubject] = useState('');
  const [queryPredicate, setQueryPredicate] = useState('');
  const [queryObject, setQueryObject] = useState('');
  const [majorPremise, setMajorPremise] = useState('');
  const [minorPremise, setMinorPremise] = useState('');
  const [results, setResults] = useState<unknown>(null);
  const [tab, setTab] = useState<'facts' | 'query' | 'syllogism' | 'forward' | 'unify'>('facts');
  const [unifyTerm1, setUnifyTerm1] = useState('');
  const [unifyTerm2, setUnifyTerm2] = useState('');

  // Lens-scoped keyboard commands (auto-wired by codemod).
  useLensCommand(
    [
      { id: 'tab-facts', keys: 'f', description: 'Facts', category: 'navigation', action: () => setTab('facts') },
      { id: 'tab-query', keys: 'q', description: 'Query', category: 'navigation', action: () => setTab('query') },
      { id: 'tab-syllogism', keys: 's', description: 'Syllogism', category: 'navigation', action: () => setTab('syllogism') },
      { id: 'tab-forward', keys: 'o', description: 'Forward', category: 'navigation', action: () => setTab('forward') },
      { id: 'tab-unify', keys: 'u', description: 'Unify', category: 'navigation', action: () => setTab('unify') },
    ],
    { lensId: 'inference' }
  );
  const [selectedModel, setSelectedModel] = useState('default');
  const [inferenceHistory, setInferenceHistory] = useState<InferenceHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(true);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [showFeatures, setShowFeatures] = useState(true);

  // --- Lens Bridge --- (syncs real engine status into a real artifact;
  // UniversalActions below reads bridge.selectedId from this real sync,
  // never from an auto-created blank placeholder)
  const bridge = useLensBridge('inference', 'snapshot');

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

  // add_fact (server.js:67284) reads {subject,predicate,object} directly off
  // the POST body — NOT a {facts:[...]} array. The prior textarea-of-lines
  // UI sent {facts:[...]}, which the handler silently ignores (falls back to
  // empty-string subject/predicate/object on every call), so every "Add
  // Facts" click added a blank fact regardless of what was typed.
  const addFacts = useMutation({
    mutationFn: () => {
      const startTime = Date.now();
      return apiHelpers.inference.facts({ subject: factSubject.trim(), predicate: factPredicate.trim(), object: factObject.trim() }).then(res => {
        trackInference('add-fact', `${factSubject} ${factPredicate} ${factObject}`, res.data, startTime);
        return res;
      });
    },
    onSuccess: (res) => {
      setResults(res.data);
      queryClient.invalidateQueries({ queryKey: ['inference-status'] });
      setFactSubject(''); setFactPredicate(''); setFactObject('');
    },
    onError: (err) => console.error('addFacts failed:', err instanceof Error ? err.message : err),
  });

  // query (server.js:67560) reads {subject,predicate,object} directly too
  // (falsy fields act as wildcards) — the prior single free-text-string
  // "query" field was wrapped as {query: "..."}, which the handler never
  // reads (it destructures .subject/.predicate/.object off the same object
  // it was itself passed as, so a plain string query always searched with
  // all three wildcarded regardless of what was typed).
  const runQuery = useMutation({
    mutationFn: () => {
      const startTime = Date.now();
      const q = { subject: querySubject.trim() || undefined, predicate: queryPredicate.trim() || undefined, object: queryObject.trim() || undefined };
      return apiHelpers.inference.query(q).then(res => {
        trackInference('query', `${querySubject} ${queryPredicate} ${queryObject}`.trim(), res.data, startTime);
        return res;
      });
    },
    onSuccess: (res) => setResults(res.data),
    onError: (err) => console.error('runQuery failed:', err instanceof Error ? err.message : err),
  });

  // unify (server/domains/inference.js:357, registerLensAction family) — a
  // standalone Robinson's-algorithm unifier. Not covered by the kb-* engine
  // (RuleEngineWorkbench.tsx) at all, so it gets its own real tab here
  // instead of the broken generic-artifact-bridge quick panel this lens
  // used to route it through (an auto-created blank "snapshot" artifact
  // with no term1/term2 — always failed "Both term1 and term2 are required").
  const runUnify = useMutation({
    mutationFn: () => {
      const startTime = Date.now();
      const term1 = parseInferenceTerm(unifyTerm1);
      const term2 = parseInferenceTerm(unifyTerm2);
      return lensRun('inference', 'unify', { term1, term2 }).then(res => {
        trackInference('unify', `${unifyTerm1} =? ${unifyTerm2}`, res.data, startTime);
        return res;
      });
    },
    onSuccess: (res) => setResults(res.data.ok ? res.data.result : { error: res.data.error }),
    onError: (err) => console.error('runUnify failed:', err instanceof Error ? err.message : err),
  });

  const runSyllogism = useMutation({
    mutationFn: () => {
      const startTime = Date.now();
      return apiHelpers.inference.syllogism({ majorPremise, minorPremise }).then(res => {
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
      <FirstRunTour lensId="inference" />
      <ManifestActionBar />
      <DepthBadge lensId="inference" size="sm" className="ml-2" />
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
        <span className="text-[10px] text-gray-400 shrink-0">Confidence</span>
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
        <span className="text-[10px] text-gray-400">{inferenceHistory.length} runs</span>
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
              <p className="text-xs text-gray-400 mt-1">{m.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {(['facts', 'query', 'syllogism', 'forward', 'unify'] as const).map((t) => (
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
                <Plus className="w-4 h-4 text-neon-purple" /> Add a Fact
              </h2>
              <p className="text-xs text-gray-400">A fact is a subject-predicate-object triple, e.g. &quot;socrates — is — mortal&quot;.</p>
              <input type="text" value={factSubject} onChange={(e) => setFactSubject(e.target.value)} placeholder="Subject (e.g. socrates)" className="input-lattice w-full" />
              <input type="text" value={factPredicate} onChange={(e) => setFactPredicate(e.target.value)} placeholder="Predicate (e.g. is)" className="input-lattice w-full" />
              <input type="text" value={factObject} onChange={(e) => setFactObject(e.target.value)} placeholder="Object (e.g. mortal)" className="input-lattice w-full"
                onKeyDown={(e) => { if (e.key === 'Enter' && factSubject && factPredicate && factObject && !addFacts.isPending) addFacts.mutate(); }} />
              <button
                onClick={() => addFacts.mutate()}
                disabled={!factSubject.trim() || !factPredicate.trim() || !factObject.trim() || addFacts.isPending}
                className="btn-neon purple w-full"
              >
                {addFacts.isPending ? 'Adding...' : 'Add Fact'}
              </button>
            </>
          )}

          {tab === 'query' && (
            <>
              <h2 className="font-semibold flex items-center gap-2">
                <Search className="w-4 h-4 text-neon-cyan" /> Query Knowledge Base
              </h2>
              <p className="text-xs text-gray-400">Leave a field blank to match any value in that position.</p>
              <input type="text" value={querySubject} onChange={(e) => setQuerySubject(e.target.value)} placeholder="Subject (optional)" className="input-lattice w-full" />
              <input type="text" value={queryPredicate} onChange={(e) => setQueryPredicate(e.target.value)} placeholder="Predicate (optional)" className="input-lattice w-full" />
              <input type="text" value={queryObject} onChange={(e) => setQueryObject(e.target.value)} placeholder="Object (optional)" className="input-lattice w-full"
                onKeyDown={(e) => { if (e.key === 'Enter' && !runQuery.isPending) runQuery.mutate(); }} />
              <p className="text-xs text-gray-400">
                Using model: <span className="text-neon-cyan">{MODEL_OPTIONS.find(m => m.id === selectedModel)?.label}</span>
              </p>
              <button
                onClick={() => runQuery.mutate()}
                disabled={(!querySubject.trim() && !queryPredicate.trim() && !queryObject.trim()) || runQuery.isPending}
                className="btn-neon purple w-full"
              >
                {runQuery.isPending ? 'Querying...' : 'Run Query'}
              </button>
            </>
          )}

          {tab === 'unify' && (
            <>
              <h2 className="font-semibold flex items-center gap-2">
                <Link className="w-4 h-4 text-neon-purple" /> Unify Terms
              </h2>
              <p className="text-xs text-gray-400">
                Robinson&apos;s unification algorithm. A bare word is a constant; prefix with <code className="text-neon-cyan">?</code> for a variable; use <code className="text-neon-cyan">functor(arg1, arg2)</code> for a compound term.
              </p>
              <input type="text" value={unifyTerm1} onChange={(e) => setUnifyTerm1(e.target.value)} placeholder="e.g. loves(john, ?Y)" className="input-lattice w-full font-mono text-sm" />
              <input type="text" value={unifyTerm2} onChange={(e) => setUnifyTerm2(e.target.value)} placeholder="e.g. loves(?X, mary)" className="input-lattice w-full font-mono text-sm"
                onKeyDown={(e) => { if (e.key === 'Enter' && unifyTerm1 && unifyTerm2 && !runUnify.isPending) runUnify.mutate(); }} />
              <button
                onClick={() => runUnify.mutate()}
                disabled={!unifyTerm1.trim() || !unifyTerm2.trim() || runUnify.isPending}
                className="btn-neon purple w-full"
              >
                {runUnify.isPending ? 'Unifying...' : 'Unify'}
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
                  <span className="text-gray-400">Current facts</span>
                  <span className="text-gray-300">{statusInfo.factCount || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Active rules</span>
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

          {results && tab === 'unify' && (results as UnifyResult).term1 !== undefined ? (() => {
            const d = results as UnifyResult;
            return (
              <div className="space-y-3">
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
                        <p key={k} className="text-xs font-mono"><span className="text-neon-cyan">{k}</span><span className="text-gray-400"> → </span><span className="text-white">{v}</span></p>
                      ))}
                    </div>
                  </div>
                )}
                {d.verification !== undefined && (
                  <span className={`text-xs px-2 py-1 rounded ${d.verification ? 'bg-neon-green/10 text-neon-green' : 'bg-red-400/10 text-red-400'}`}>
                    Verification: {d.verification ? 'Passed' : 'Failed'}
                  </span>
                )}
                <details className="text-xs">
                  <summary className="cursor-pointer text-gray-400">Raw steps ({d.stepCount})</summary>
                  <pre className="whitespace-pre-wrap text-[10px] text-gray-400 font-mono mt-1 max-h-48 overflow-y-auto">{JSON.stringify(d.steps, null, 2)}</pre>
                </details>
              </div>
            );
          })() : results ? (
            <div className="bg-lattice-surface p-3 rounded-lg">
              <pre className="whitespace-pre-wrap text-xs text-gray-300 font-mono max-h-96 overflow-y-auto">
                {JSON.stringify(results, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="text-center py-12 text-gray-400">
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
            <span className="text-xs text-gray-400 font-normal">({inferenceHistory.length} entries)</span>
          </span>
          {showHistory ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>

        {showHistory && (
          <div className="mt-4 space-y-2 max-h-80 overflow-y-auto">
            {inferenceHistory.length > 0 ? inferenceHistory.map((entry) => (
              <div
                key={entry.id}
                className="lens-card cursor-pointer hover:bg-lattice-border/30 transition-colors"
                onClick={() => setExpandedHistoryId(expandedHistoryId === entry.id ? null : (entry.id ?? null))} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
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
                        <p className="text-xs text-gray-400 truncate max-w-xs">{entry.query}</p>
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
                      <span className="text-gray-400 flex items-center gap-1">
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
              <p className="text-center py-8 text-gray-400 text-sm">
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
      <section className="mt-6 rounded-xl border border-cyan-500/15 bg-zinc-950/40 p-4">
        <RuleEngineWorkbench />
      </section>

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <InferenceFrameworks />
      </section>
    </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <a href="#inference-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to inference content</a>
          <RecentMineCard domain="inference" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="inference" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="inference" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
