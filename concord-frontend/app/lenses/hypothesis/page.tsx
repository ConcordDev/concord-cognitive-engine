'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useLensBridge } from '@/lib/hooks/use-lens-bridge';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  FlaskConical, Plus, CheckCircle2, Beaker,
  FileText, TrendingUp, ArrowRight, Layers, ChevronDown, Target, Percent,
  Loader2, BarChart3, Activity,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

interface ZTestResult {
  testType: string;
  zStatistic: number;
  pValue: number;
  reject: boolean;
  conclusion: string;
  confidenceInterval: { level: number; lower: number; upper: number };
  effectSize: number;
  effectMagnitude: string;
  standardError: number;
}

interface ABTestResult {
  control: { visitors: number; conversions: number; rate: number };
  variant: { visitors: number; conversions: number; rate: number };
  absoluteDifference: number;
  relativeUplift: number;
  significant: boolean;
  recommendation: string;
  statisticalPower: number;
  sampleSizeForPower80: number;
}

interface BayesianResult {
  prior: Record<string, unknown>;
  posterior: { distribution: string; mean: number; mode: number; stdDev: number };
  credibleInterval: { lower: number; upper: number; level: number };
  bayesFactor: number;
  evidenceStrength: string;
  shrinkage: number;
}

interface PowerAnalysisResult {
  solve: string;
  requiredN?: number;
  power?: number;
  minimumDetectableEffect?: number;
  effectMagnitude: string;
  alpha: number;
  effectSize?: number;
}

interface Hypothesis {
  id: string;
  statement: string;
  domain?: string;
  status?: string;
  confidence?: number;
  evidence?: Record<string, unknown>[];
  createdAt?: string;
}

export default function HypothesisLensPage() {
  useLensNav('hypothesis');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('hypothesis');

  const queryClient = useQueryClient();
  const [newStatement, setNewStatement] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newEvidence, setNewEvidence] = useState('');
  const [evidenceSupports, setEvidenceSupports] = useState(true);
  const [showFeatures, setShowFeatures] = useState(true);

  // --- Lens Bridge ---
  const bridge = useLensBridge('hypothesis', 'hypothesis');

  const { items: hypArtifacts } = useLensData('hypothesis', 'hypothesis', { seed: [] });
  const runAction = useRunArtifact('hypothesis');
  const [hypActionResult, setHypActionResult] = useState<{ action: string; data: unknown } | null>(null);

  const handleHypAction = useCallback((action: string) => {
    const artifactId = hypArtifacts[0]?.id;
    if (!artifactId) return;
    runAction.mutate(
      { id: artifactId, action, params: {} },
      {
        onSuccess: (res) => setHypActionResult({ action, data: res.result }),
        onError: (e) => {
          console.error(`Action failed:`, e);
          setHypActionResult({ action, data: { error: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` } });
        },
      }
    );
  }, [hypArtifacts, runAction]);

  const { data: hypothesesData, isLoading, isError: isError, error: error, refetch: refetch,} = useQuery({
    queryKey: ['hypotheses'],
    queryFn: () => apiHelpers.hypothesis.list().then((r) => r.data),
    refetchInterval: 10000,
  });

  const { data: statusData, isError: isError2, error: error2, refetch: refetch2,} = useQuery({
    queryKey: ['hypothesis-status'],
    queryFn: () => apiHelpers.hypothesis.status().then((r) => r.data),
  });

  const createHypothesis = useMutation({
    mutationFn: () =>
      apiHelpers.hypothesis.create({
        statement: newStatement,
        domain: newDomain || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hypotheses'] });
      setNewStatement('');
      setNewDomain('');
    },
    onError: (err) => console.error('createHypothesis failed:', err instanceof Error ? err.message : err),
  });

  const evaluateHypothesis = useMutation({
    mutationFn: (id: string) => apiHelpers.hypothesis.evaluate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hypotheses'] }),
    onError: (err) => console.error('evaluateHypothesis failed:', err instanceof Error ? err.message : err),
  });

  const addEvidence = useMutation({
    mutationFn: () => {
      if (!selectedId) return Promise.reject('No hypothesis selected');
      return apiHelpers.hypothesis.addEvidence(selectedId, {
        evidence: newEvidence,
        supports: evidenceSupports,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hypotheses'] });
      setNewEvidence('');
    },
    onError: (err) => console.error('addEvidence failed:', err instanceof Error ? err.message : err),
  });

  const runExperiment = useMutation({
    mutationFn: (id: string) => apiHelpers.hypothesis.experiment(id, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hypotheses'] }),
    onError: (err) => console.error('runExperiment failed:', err instanceof Error ? err.message : err),
  });

  const hypotheses: Hypothesis[] = useMemo(() => hypothesesData?.hypotheses || hypothesesData || [], [hypothesesData]);
  const status = statusData?.status || statusData || {};

  // Bridge hypotheses into lens artifacts
  useEffect(() => {
    bridge.syncList(hypotheses, (h) => {
      const hyp = h as Hypothesis;
      return { title: hyp.statement, data: h as Record<string, unknown>, meta: { status: hyp.status } };
    });
  }, [hypotheses, bridge]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-purple border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading hypotheses...</p>
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
    <div data-lens-theme="hypothesis" className="p-6 space-y-6">
      <header className="flex items-center gap-3">
        <span className="text-2xl">🧪</span>
        <div>
          <h1 className="text-xl font-bold">Hypothesis Lens</h1>
          <p className="text-sm text-gray-400">
            Scientific method — hypothesize, collect evidence, evaluate, experiment
          </p>
        </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="hypothesis" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        <UniversalActions domain="hypothesis" artifactId={bridge.selectedId} compact />
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }} className="lens-card">
          <FlaskConical className="w-5 h-5 text-neon-purple mb-2" />
          <p className="text-2xl font-bold">{hypotheses.filter(h => h.status === 'pending' || h.status === 'testing').length}</p>
          <p className="text-sm text-gray-400">Active</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="lens-card">
          <Target className="w-5 h-5 text-neon-cyan mb-2" />
          <p className="text-2xl font-bold">{status.experiments || 0}</p>
          <p className="text-sm text-gray-400">Tested</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="lens-card">
          <CheckCircle2 className="w-5 h-5 text-neon-green mb-2" />
          <p className="text-2xl font-bold">{status.confirmed || 0}</p>
          <p className="text-sm text-gray-400">Confirmed</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="lens-card">
          <Percent className="w-5 h-5 text-yellow-400 mb-2" />
          <p className="text-2xl font-bold">{hypotheses.length > 0 ? (((status.confirmed || 0) / hypotheses.length) * 100).toFixed(0) : 0}%</p>
          <p className="text-sm text-gray-400">Confirmed Rate</p>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create + List */}
        <div className="space-y-4">
          <div className="panel p-4 space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Plus className="w-4 h-4 text-neon-purple" /> New Hypothesis
            </h2>
            <input
              type="text"
              value={newStatement}
              onChange={(e) => setNewStatement(e.target.value)}
              placeholder="Hypothesis statement..."
              className="input-lattice w-full"
            />
            <input
              type="text"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="Domain (optional)..."
              className="input-lattice w-full"
            />
            <button
              onClick={() => createHypothesis.mutate()}
              disabled={!newStatement || createHypothesis.isPending}
              className="btn-neon purple w-full"
            >
              {createHypothesis.isPending ? 'Creating...' : 'Create Hypothesis'}
            </button>
          </div>

          <div className="panel p-4">
            <h2 className="font-semibold mb-3">Hypotheses</h2>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {hypotheses.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">No hypotheses yet. Create one above to get started.</p>
              )}
              {hypotheses.map((h, index) => (
                <motion.button
                  key={h.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => setSelectedId(h.id)}
                  className={`w-full text-left lens-card ${
                    selectedId === h.id ? 'border-neon-cyan' : ''
                  }`}
                >
                  <p className="text-sm font-medium truncate">{h.statement}</p>
                  <div className="flex gap-2 mt-1">
                    {h.domain && <span className="text-xs text-gray-400">{h.domain}</span>}
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      h.status === 'confirmed' ? 'bg-green-400/20 text-green-400' :
                      h.status === 'refuted' ? 'bg-red-400/20 text-red-400' :
                      'bg-blue-400/20 text-blue-400'
                    }`}>
                      {h.status || 'pending'}
                    </span>
                  </div>
                </motion.button>
              ))}
            </div>
          </div>
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-2 panel p-4 space-y-4">
          {selectedId ? (
            <>
              <h2 className="font-semibold flex items-center gap-2">
                <FileText className="w-4 h-4 text-neon-cyan" /> Hypothesis Detail
              </h2>
              {(() => {
                const h = hypotheses.find((x) => x.id === selectedId);
                if (!h) return <p className="text-gray-500">Not found</p>;
                return (
                  <>
                    <p className="text-sm">{h.statement}</p>
                    {h.confidence != null && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">Confidence:</span>
                        <div className="flex-1 h-2 bg-lattice-deep rounded-full overflow-hidden">
                          <div className="h-full bg-neon-cyan" style={{ width: `${h.confidence * 100}%` }} />
                        </div>
                        <span className="text-xs font-mono">{(h.confidence * 100).toFixed(0)}%</span>
                      </div>
                    )}

                    {/* Evidence */}
                    <div>
                      <h3 className="text-sm font-medium mb-2">Evidence</h3>
                      <div className="space-y-1 mb-3">
                        {(h.evidence || []).map((e: Record<string, unknown>, i: number) => (
                          <div key={i} className={`lens-card text-xs border-l-4 ${
                            e.supports ? 'border-l-green-500' : 'border-l-red-500'
                          }`}>
                            <span>{typeof e === 'string' ? e : String(e.evidence || e.content)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newEvidence}
                          onChange={(e) => setNewEvidence(e.target.value)}
                          placeholder="Add evidence..."
                          className="input-lattice flex-1"
                        />
                        <select
                          value={evidenceSupports ? 'supports' : 'contradicts'}
                          onChange={(e) => setEvidenceSupports(e.target.value === 'supports')}
                          className="input-lattice w-32"
                        >
                          <option value="supports">Supports</option>
                          <option value="contradicts">Contradicts</option>
                        </select>
                        <button
                          onClick={() => addEvidence.mutate()}
                          disabled={!newEvidence || addEvidence.isPending}
                          className="btn-neon"
                        >
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => evaluateHypothesis.mutate(h.id)}
                        disabled={evaluateHypothesis.isPending}
                        className="btn-neon purple flex-1 flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <TrendingUp className="w-4 h-4" /> {evaluateHypothesis.isPending ? 'Evaluating...' : 'Evaluate'}
                      </button>
                      <button
                        onClick={() => runExperiment.mutate(h.id)}
                        disabled={runExperiment.isPending}
                        className="btn-neon flex-1 flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Beaker className="w-4 h-4" /> {runExperiment.isPending ? 'Running...' : 'Experiment'}
                      </button>
                    </div>
                  </>
                );
              })()}
            </>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <FlaskConical className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>Select a hypothesis to view details and manage evidence</p>
            </div>
          )}
        </div>

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="hypothesis"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
      </div>

      {/* AI Actions Panel */}
      <div className="panel p-4 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-neon-purple" />
          Statistical Analysis Actions
        </h2>
        {!hypArtifacts[0]?.id && (
          <p className="text-xs text-gray-500">Create a hypothesis-data artifact to run statistical actions.</p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { action: 'zTest', label: 'Z-Test', icon: Activity, color: 'text-neon-cyan' },
            { action: 'abTest', label: 'A/B Test', icon: BarChart3, color: 'text-neon-green' },
            { action: 'bayesianInference', label: 'Bayesian Inference', icon: FlaskConical, color: 'text-neon-purple' },
            { action: 'powerAnalysis', label: 'Power Analysis', icon: Target, color: 'text-yellow-400' },
          ].map(({ action, label, icon: Icon, color }) => (
            <button
              key={action}
              onClick={() => handleHypAction(action)}
              disabled={runAction.isPending || !hypArtifacts[0]?.id}
              className="flex items-center gap-2 px-4 py-3 bg-lattice-surface border border-lattice-border rounded-lg text-sm font-medium text-white hover:border-neon-purple/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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

        {hypActionResult && !runAction.isPending && (() => {
          if (hypActionResult.action === 'zTest') {
            const d = hypActionResult.data as ZTestResult;
            return (
              <div className="space-y-3 pt-2 border-t border-lattice-border">
                <h3 className="text-sm font-semibold text-neon-cyan">Z-Test Results — {d.testType}</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Z-Statistic', value: (d.zStatistic || 0).toFixed(4), color: 'text-neon-cyan' },
                    { label: 'p-Value', value: (d.pValue || 0).toFixed(4), color: d.pValue < 0.05 ? 'text-neon-green' : 'text-red-400' },
                    { label: 'Effect Size', value: (d.effectSize || 0).toFixed(3), color: 'text-neon-purple' },
                    { label: 'Std Error', value: (d.standardError || 0).toFixed(4), color: 'text-gray-300' },
                  ].map(s => (
                    <div key={s.label} className="lens-card text-center">
                      <p className={`text-base font-bold font-mono ${s.color}`}>{s.value}</p>
                      <p className="text-xs text-gray-400">{s.label}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${d.reject ? 'bg-neon-green/20 text-neon-green' : 'bg-red-400/20 text-red-400'}`}>
                    {d.reject ? 'H₀ Rejected' : 'Fail to Reject H₀'}
                  </span>
                  <span className="text-xs text-gray-400">{d.effectMagnitude} effect</span>
                </div>
                {d.confidenceInterval && (
                  <p className="text-xs text-gray-400">
                    {(d.confidenceInterval.level * 100).toFixed(0)}% CI: [{d.confidenceInterval.lower?.toFixed(4)}, {d.confidenceInterval.upper?.toFixed(4)}]
                  </p>
                )}
                {d.conclusion && <p className="text-xs text-gray-300 italic">{d.conclusion}</p>}
              </div>
            );
          }
          if (hypActionResult.action === 'abTest') {
            const d = hypActionResult.data as ABTestResult;
            return (
              <div className="space-y-3 pt-2 border-t border-lattice-border">
                <h3 className="text-sm font-semibold text-neon-green">A/B Test Results</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="lens-card">
                    <p className="text-xs text-gray-400 mb-2">Control</p>
                    <p className="text-xl font-bold text-gray-300">{parseFloat(d.control?.rate as unknown as string || '0').toFixed(2)}%</p>
                    <p className="text-xs text-gray-500">{(d.control?.conversions || 0).toLocaleString()} / {(d.control?.visitors || 0).toLocaleString()}</p>
                  </div>
                  <div className="lens-card">
                    <p className="text-xs text-gray-400 mb-2">Variant</p>
                    <p className="text-xl font-bold text-neon-green">{parseFloat(d.variant?.rate as unknown as string || '0').toFixed(2)}%</p>
                    <p className="text-xs text-gray-500">{(d.variant?.conversions || 0).toLocaleString()} / {(d.variant?.visitors || 0).toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${d.significant ? 'bg-neon-green/20 text-neon-green' : 'bg-yellow-400/20 text-yellow-400'}`}>
                    {d.significant ? 'Significant' : 'Not Significant'}
                  </span>
                  <span className="text-xs text-gray-400">+{parseFloat(d.relativeUplift as unknown as string || '0').toFixed(1)}% uplift</span>
                  <span className="text-xs text-gray-400">Power: {parseFloat(d.statisticalPower as unknown as string || '0').toFixed(0)}%</span>
                </div>
                {d.recommendation && <p className="text-xs text-gray-300 italic">{d.recommendation}</p>}
                {d.sampleSizeForPower80 && <p className="text-xs text-gray-500">Sample for 80% power: {d.sampleSizeForPower80.toLocaleString()}</p>}
              </div>
            );
          }
          if (hypActionResult.action === 'bayesianInference') {
            const d = hypActionResult.data as BayesianResult;
            return (
              <div className="space-y-3 pt-2 border-t border-lattice-border">
                <h3 className="text-sm font-semibold text-neon-purple">Bayesian Inference</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: 'Posterior Mean', value: (d.posterior?.mean || 0).toFixed(4), color: 'text-neon-purple' },
                    { label: 'Posterior Mode', value: (d.posterior?.mode || 0).toFixed(4), color: 'text-neon-cyan' },
                    { label: 'Bayes Factor', value: (d.bayesFactor || 0).toFixed(2), color: 'text-neon-green' },
                    { label: 'Shrinkage', value: (d.shrinkage || 0).toFixed(3), color: 'text-gray-300' },
                  ].map(s => (
                    <div key={s.label} className="lens-card text-center">
                      <p className={`text-base font-bold font-mono ${s.color}`}>{s.value}</p>
                      <p className="text-xs text-gray-400">{s.label}</p>
                    </div>
                  ))}
                </div>
                {d.credibleInterval && (
                  <p className="text-xs text-gray-400">
                    {d.credibleInterval.level} Credible Interval: [{d.credibleInterval.lower?.toFixed(4)}, {d.credibleInterval.upper?.toFixed(4)}]
                  </p>
                )}
                {d.evidenceStrength && (
                  <span className="text-xs px-2 py-1 rounded bg-neon-purple/10 text-neon-purple border border-neon-purple/20">
                    Evidence: {d.evidenceStrength}
                  </span>
                )}
                {d.posterior?.distribution && <p className="text-xs text-gray-500">Distribution: {d.posterior.distribution}</p>}
              </div>
            );
          }
          if (hypActionResult.action === 'powerAnalysis') {
            const d = hypActionResult.data as PowerAnalysisResult;
            return (
              <div className="space-y-3 pt-2 border-t border-lattice-border">
                <h3 className="text-sm font-semibold text-yellow-400">Power Analysis — Solve for {d.solve}</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {d.requiredN !== undefined && (
                    <div className="lens-card text-center">
                      <p className="text-xl font-bold text-yellow-400">{d.requiredN.toLocaleString()}</p>
                      <p className="text-xs text-gray-400">Required N</p>
                    </div>
                  )}
                  {d.power !== undefined && (
                    <div className="lens-card text-center">
                      <p className="text-xl font-bold text-neon-green">{((d.power || 0) * 100).toFixed(1)}%</p>
                      <p className="text-xs text-gray-400">Power</p>
                    </div>
                  )}
                  {d.minimumDetectableEffect !== undefined && (
                    <div className="lens-card text-center">
                      <p className="text-xl font-bold text-neon-cyan">{(d.minimumDetectableEffect || 0).toFixed(4)}</p>
                      <p className="text-xs text-gray-400">Min Detectable Effect</p>
                    </div>
                  )}
                  <div className="lens-card text-center">
                    <p className="text-base font-bold text-gray-300">{d.alpha}</p>
                    <p className="text-xs text-gray-400">Alpha</p>
                  </div>
                </div>
                {d.effectMagnitude && (
                  <span className="text-xs px-2 py-1 rounded bg-yellow-400/10 text-yellow-400 border border-yellow-400/20">
                    Effect: {d.effectMagnitude}
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
            <LensFeaturePanel lensId="hypothesis" />
          </div>
        )}
      </div>
    </div>
  );
}
