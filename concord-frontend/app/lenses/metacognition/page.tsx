'use client';

import { motion } from 'framer-motion';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { CogsciFeed } from '@/components/metacognition/CogsciFeed';
import { DecisionJournal } from '@/components/metacognition/DecisionJournal';
import { ReflectionPrompts } from '@/components/metacognition/ReflectionPrompts';
import { BiasChecklist } from '@/components/metacognition/BiasChecklist';
import { StrategyLibrary } from '@/components/metacognition/StrategyLibrary';
import { AccuracyTracker } from '@/components/metacognition/AccuracyTracker';
import { ReasoningToolkit } from '@/components/metacognition/ReasoningToolkit';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers, lensRun } from '@/lib/api/client';
import { useState, useMemo, useEffect } from 'react';
import { useLensBridge } from '@/lib/hooks/use-lens-bridge';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Eye,
  Brain,
  AlertTriangle,
  Target,
  BarChart3,
  Crosshair,
  Lightbulb,
  Send,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  BookOpen,
  Sparkles,
  Gauge,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Layers,
  Play,
  Loader2,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

type TabId = 'dashboard' | 'introspection' | 'predictions' | 'learning' | 'journal' | 'practice';

// --- Helpers ---

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function pct(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : fallback;
  return clamp(n, 0, 1) * 100;
}

function severityColor(severity: unknown): string {
  const s = typeof severity === 'string' ? severity.toLowerCase() : String(severity ?? '').toLowerCase();
  if (s === 'high' || s === 'critical') return 'border-l-red-500 bg-red-500/5';
  if (s === 'medium' || s === 'moderate') return 'border-l-yellow-500 bg-yellow-500/5';
  return 'border-l-blue-500 bg-blue-500/5';
}

function severityBadge(severity: unknown): { label: string; cls: string } {
  const s = typeof severity === 'string' ? severity.toLowerCase() : String(severity ?? '').toLowerCase();
  if (s === 'high' || s === 'critical') return { label: String(severity), cls: 'bg-red-500/20 text-red-400' };
  if (s === 'medium' || s === 'moderate') return { label: String(severity), cls: 'bg-yellow-500/20 text-yellow-400' };
  return { label: String(severity || 'low'), cls: 'bg-blue-500/20 text-blue-400' };
}

function trendIcon(trend: unknown) {
  const t = typeof trend === 'string' ? trend.toLowerCase() : '';
  if (t === 'improving' || t === 'up') return <TrendingUp className="w-4 h-4 text-green-400" />;
  if (t === 'declining' || t === 'down') return <TrendingDown className="w-4 h-4 text-red-400" />;
  return <Minus className="w-4 h-4 text-gray-400" />;
}

function formatTimestamp(ts: unknown): string {
  if (!ts) return '';
  try {
    const d = new Date(String(ts));
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(ts);
  }
}

// --- Component ---

export default function MetacognitionLensPage() {
  useLensNav('metacognition');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('metacognition');

  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');

  // Lens-scoped keyboard commands (auto-wired by codemod).
  useLensCommand(
    [
      { id: 'tab-dashboard', keys: 'd', description: 'Dashboard', category: 'navigation', action: () => setActiveTab('dashboard') },
      { id: 'tab-introspection', keys: 'i', description: 'Introspection', category: 'navigation', action: () => setActiveTab('introspection') },
      { id: 'tab-predictions', keys: 'p', description: 'Predictions', category: 'navigation', action: () => setActiveTab('predictions') },
      { id: 'tab-learning', keys: 'l', description: 'Learning', category: 'navigation', action: () => setActiveTab('learning') },
      { id: 'tab-journal', keys: 'j', description: 'Decision Journal', category: 'navigation', action: () => setActiveTab('journal') },
      { id: 'tab-practice', keys: 'r', description: 'Practice', category: 'navigation', action: () => setActiveTab('practice') },
    ],
    { lensId: 'metacognition' }
  );
  const [predictionClaim, setPredictionClaim] = useState('');
  const [predictionConfidence, setPredictionConfidence] = useState(0.7);
  const [predictionDomain, setPredictionDomain] = useState('');
  const [introspectFocus, setIntrospectFocus] = useState('');
  const [expandedPrediction, setExpandedPrediction] = useState<string | null>(null);
  const [showFeatures, setShowFeatures] = useState(true);

  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);

  // --- Lens Bridge ---
  const bridge = useLensBridge('metacognition', 'snapshot');

  // confidenceCalibration / learningCurve (server/domains/metacognition.js) are
  // general-purpose analyzers over a caller-supplied predictions/progress array —
  // they were previously wired through the lens-artifact "run" system
  // (useRunArtifact + a synced snapshot artifact), but the synced snapshot's
  // `data` was always the status/calibration/introspection payload, which has no
  // `predictions`/`progress` array — so those buttons could never do anything but
  // return "insufficient data", forever, regardless of how many predictions were
  // logged. Wired directly here instead, against the real predictions_list this
  // pass added: confidenceCalibration analyzes resolved Predictions-tab entries
  // (Brier/log-loss/discrimination — a richer analysis than the calibration
  // summary card above), and learningCurve fits a power-law/exponential curve to
  // the chronological resolved-prediction accuracy trend to forecast a mastery
  // trial. (biasDetection needs decisions with per-option scores/evidence/anchor/
  // invested-cost, which this lens's data model doesn't capture anywhere — see
  // the capability map for the deferred triage; it isn't wired here.)
  const handleAction = async (action: 'confidenceCalibration' | 'learningCurve') => {
    const resolved = predictions.filter((p) => p.outcome === 'correct' || p.outcome === 'incorrect');
    if (resolved.length < 2) {
      setActionResult({ message: 'Resolve at least 2 predictions in the Predictions tab to run this analysis.' });
      return;
    }
    setIsRunning(action);
    try {
      let res;
      if (action === 'confidenceCalibration') {
        const predictionRows = resolved.map((p) => ({
          predicted: p.confidence,
          actual: p.outcome === 'correct' ? 1 : 0,
          label: p.statement,
        }));
        res = await lensRun('metacognition', 'confidenceCalibration', { predictions: predictionRows });
      } else {
        const chrono = [...resolved].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
        let correctSoFar = 0;
        const progressRows = chrono.map((p, i) => {
          if (p.outcome === 'correct') correctSoFar += 1;
          return { trial: i + 1, performance: correctSoFar / (i + 1) };
        });
        res = await lensRun('metacognition', 'learningCurve', { progress: progressRows });
      }
      if (res.data.ok === false) {
        setActionResult({ message: `Action failed: ${res.data.error || 'Unknown error'}` });
      } else {
        setActionResult((res.data.result as Record<string, unknown>) || { message: 'No result returned.' });
      }
    } catch (e) {
      console.error(`Action ${action} failed:`, e);
      setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` });
    } finally {
      setIsRunning(null);
    }
  };

  // --- Queries ---

  const {
    data: status,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['metacognition-status'],
    queryFn: () => apiHelpers.metacognition.status().then((r) => r.data),
    refetchInterval: 15000,
  });

  const {
    data: blindspots,
    isError: isError2,
    error: error2,
    refetch: refetch2,
  } = useQuery({
    queryKey: ['metacognition-blindspots'],
    queryFn: () => apiHelpers.metacognition.blindspots().then((r) => r.data),
  });

  const {
    data: calibration,
    isError: isError3,
    error: error3,
    refetch: refetch3,
  } = useQuery({
    queryKey: ['metacognition-calibration'],
    queryFn: () => apiHelpers.metacognition.calibration().then((r) => r.data),
    refetchInterval: 30000,
  });

  const {
    data: introspectionStatus,
    isError: isError4,
    error: error4,
    refetch: refetch4,
  } = useQuery({
    queryKey: ['metacognition-introspection'],
    queryFn: () => apiHelpers.metacognition.introspection().then((r) => r.data),
    refetchInterval: 10000,
  });

  // predictions_list / assessments_list — these two endpoints didn't exist until
  // this pass: recordPrediction()/assessKnowledge() persisted server-side but
  // nothing ever listed the results back out, so the Predictions tab could create
  // entries but never show or resolve them, and the Knowledge Confidence Map /
  // Skill Timeline sections were permanently empty.
  const {
    data: predictionsData,
    isError: isError5,
    error: error5,
    refetch: refetch5,
  } = useQuery({
    queryKey: ['metacognition-predictions'],
    queryFn: () => apiHelpers.metacognition.predictions().then((r) => r.data),
    refetchInterval: 15000,
  });

  const {
    data: assessmentsData,
    isError: isError6,
    error: error6,
    refetch: refetch6,
  } = useQuery({
    queryKey: ['metacognition-assessments'],
    queryFn: () => apiHelpers.metacognition.assessments().then((r) => r.data),
    refetchInterval: 30000,
  });

  // --- Mutations ---

  const makePrediction = useMutation({
    mutationFn: () =>
      apiHelpers.metacognition.predict({
        claim: predictionClaim,
        confidence: predictionConfidence,
        domain: predictionDomain || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metacognition-status'] });
      queryClient.invalidateQueries({ queryKey: ['metacognition-calibration'] });
      queryClient.invalidateQueries({ queryKey: ['metacognition-predictions'] });
      setPredictionClaim('');
      setPredictionDomain('');
    },
    onError: (err) =>
      console.error('makePrediction failed:', err instanceof Error ? err.message : err),
  });

  const resolvePrediction = useMutation({
    mutationFn: ({ id, outcome }: { id: string; outcome: boolean }) =>
      apiHelpers.metacognition.resolve(id, outcome),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metacognition-status'] });
      queryClient.invalidateQueries({ queryKey: ['metacognition-calibration'] });
      queryClient.invalidateQueries({ queryKey: ['metacognition-predictions'] });
    },
    onError: (err) =>
      console.error('resolvePrediction failed:', err instanceof Error ? err.message : err),
  });

  // Captures the LATEST introspection run's own findings (failurePatterns +
  // recommendations for THIS pass) — introspection_status only ever returns
  // aggregate counts + a 5-entry recentPatterns tail, so without this the UI
  // had no way to show what a just-run introspection actually found.
  const [latestIntrospection, setLatestIntrospection] = useState<Record<string, unknown> | null>(null);

  const runIntrospection = useMutation({
    mutationFn: () =>
      apiHelpers.metacognition.introspect({ focus: introspectFocus || undefined }),
    onSuccess: (res) => {
      // introspectOnFailures() (server.js) returns either
      // { ok, introspection: {...} } (enough resolved predictions to analyze) or
      // { ok, message, failurePatterns: [], recommendations: [] } (insufficient data).
      const data = (res as { data?: Record<string, unknown> })?.data;
      const inner = data && typeof data.introspection === 'object' ? (data.introspection as Record<string, unknown>) : data;
      if (inner && typeof inner === 'object') setLatestIntrospection(inner);
      queryClient.invalidateQueries({ queryKey: ['metacognition-introspection'] });
      queryClient.invalidateQueries({ queryKey: ['metacognition-blindspots'] });
      queryClient.invalidateQueries({ queryKey: ['metacognition-status'] });
    },
    onError: (err) =>
      console.error('runIntrospection failed:', err instanceof Error ? err.message : err),
  });

  const runAssessment = useMutation({
    mutationFn: (domain: string) => apiHelpers.metacognition.assess({ domain }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metacognition-status'] });
      queryClient.invalidateQueries({ queryKey: ['metacognition-calibration'] });
      queryClient.invalidateQueries({ queryKey: ['metacognition-assessments'] });
    },
    onError: (err) =>
      console.error('runAssessment failed:', err instanceof Error ? err.message : err),
  });

  // --- Derived data ---

  // NOTE: the backend (blind_spots macro, server.js) returns `{ ok, blindSpots }`
  // (capital S) — a prior version of this read `blindspots.blindspots` (lowercase),
  // which never matched, so the Blind Spots panel always rendered empty regardless
  // of how many blind spots had actually been identified.
  const spots = useMemo(() => {
    const raw = (blindspots as Record<string, unknown> | undefined)?.blindSpots;
    return Array.isArray(raw) ? raw : [];
  }, [blindspots]);

  // NOTE: getCalibrationReport() (server.js) returns `{ ok, report: {...} }` — a
  // prior version of this read `calibration.calibration` (a field that never
  // existed), so the Calibration Report card + Meta-Score stat were permanently
  // stuck on "--" even after resolving predictions.
  const cal = useMemo(() => {
    const raw = (calibration as Record<string, unknown> | undefined)?.report;
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  }, [calibration]);

  const statusInfo = useMemo(() => {
    const raw = status?.status || status;
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  }, [status]);

  const introData = useMemo(() => {
    const raw = introspectionStatus?.introspection || introspectionStatus;
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  }, [introspectionStatus]);

  // predictions_list / assessments_list results (see the two new queries above).
  const predictionsList = useMemo(() => {
    const raw = (predictionsData as Record<string, unknown> | undefined)?.predictions;
    return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  }, [predictionsData]);

  const assessmentsList = useMemo(() => {
    const raw = (assessmentsData as Record<string, unknown> | undefined)?.assessments;
    return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  }, [assessmentsData]);

  // recentPatterns (introspection_status) — each entry is a full past
  // introspection-run record: { id, timestamp, totalPredictions, failures,
  // successes, failureRate, patterns, recommendations, confidenceAdjustments }.
  const recentPatterns = useMemo(() => {
    const raw = introData.recentPatterns;
    return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  }, [introData]);

  // Bridge metacognition status into lens artifacts — try status first, fallback to calibration
  useEffect(() => {
    if (Object.keys(statusInfo).length > 0) {
      bridge.sync(statusInfo as Record<string, unknown>, 'Metacognition Status');
    } else if (Object.keys(cal).length > 0) {
      bridge.sync(cal as Record<string, unknown>, 'Metacognition Calibration');
    } else if (Object.keys(introData).length > 0) {
      bridge.sync(introData as Record<string, unknown>, 'Metacognition Introspection');
    }
  }, [statusInfo, cal, introData, bridge]);

  // predictions_list is the real source now (see the new query above) — the
  // prior version read fields (`predictions_list`/`recent_predictions`/etc) that
  // never existed anywhere on the status or calibration payloads, so this array
  // was always empty: predictions could be created via the form but never seen
  // or resolved.
  const predictions = predictionsList;

  // Knowledge Confidence Map / Skill Timeline — real data from assessments_list
  // (each assessKnowledge() call), mapped onto the {domain, confidence} shape
  // the existing render code expects. Previously sourced from fields
  // (`knowledge_domains`/`domains`) that don't exist anywhere in the backend,
  // so both sections were permanently empty regardless of how many domain
  // assessments had been run.
  const knowledgeDomains = useMemo(() => {
    return assessmentsList.map((a) => ({
      domain: a.topic,
      confidence: a.knowledgeScore,
      gaps: a.gaps,
      recommendation: a.recommendation,
      assessedAt: a.assessedAt,
    }));
  }, [assessmentsList]);

  // introspection_status's recentPatterns IS the history — a prior version
  // looked for `introData.history`/`.results`/`.past_results`, none of which
  // the backend ever produces, so "Introspection History" never rendered a
  // past run even after introspection had been run repeatedly.
  const introspectionHistory = recentPatterns;

  // "Recent Knowledge Acquisitions" — assessKnowledge()'s own recommendation
  // per topic is the honest analogue of a "learning insight" here (there is no
  // separate insights concept in the backend); a prior version read
  // `learning_insights`/`insights`/`recent_learning`, none of which exist.
  const learningInsights = useMemo(() => {
    return assessmentsList.map((a) => ({
      description: a.recommendation,
      domain: a.topic,
      timestamp: a.assessedAt,
    }));
  }, [assessmentsList]);

  // Pattern Recognition Highlights — the real recurring-pattern signal is
  // which FAILURE-PATTERN TYPES keep showing up across past introspection
  // runs (recentPatterns[i].patterns is an array of type strings per run —
  // see introspectOnFailures() in server.js). A prior version read fields
  // that never existed, so this was permanently empty.
  const patterns = useMemo(() => {
    const counts = new Map<string, number>();
    for (const run of recentPatterns) {
      const types = Array.isArray(run.patterns) ? (run.patterns as unknown[]) : [];
      for (const t of types) {
        const key = String(t);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([pattern, occurrences]) => ({
        pattern: pattern.replace(/_/g, ' '),
        occurrences,
        category: 'introspection',
      }));
  }, [recentPatterns]);

  const predictionStats = useMemo(() => {
    let hits = 0;
    let misses = 0;
    let pending = 0;
    for (const p of predictions) {
      const outcome = p.outcome;
      if (outcome === 'correct') hits++;
      else if (outcome === 'incorrect') misses++;
      else pending++;
    }
    const total = hits + misses;
    const ratio = total > 0 ? hits / total : null;
    return { hits, misses, pending, total, ratio };
  }, [predictions]);

  // --- Loading/Error ---

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-purple border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading metacognition data...</p>
        </div>
      </div>
    );
  }

  if (isError || isError2 || isError3 || isError4 || isError5 || isError6) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState
          error={
            error?.message || error2?.message || error3?.message || error4?.message || error5?.message || error6?.message
          }
          onRetry={() => {
            refetch();
            refetch2();
            refetch3();
            refetch4();
            refetch5();
            refetch6();
          }}
        />
      </div>
    );
  }

  // --- Tab config ---

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Self-Awareness', icon: <Eye className="w-4 h-4" /> },
    { id: 'introspection', label: 'Introspection', icon: <Lightbulb className="w-4 h-4" /> },
    { id: 'predictions', label: 'Predictions', icon: <Crosshair className="w-4 h-4" /> },
    { id: 'learning', label: 'Learning', icon: <BookOpen className="w-4 h-4" /> },
    { id: 'journal', label: 'Decision Journal', icon: <BookOpen className="w-4 h-4" /> },
    { id: 'practice', label: 'Practice', icon: <Sparkles className="w-4 h-4" /> },
  ];

  // --- Render ---

  return (
    <LensShell lensId="metacognition" asMain={false}>
      <FirstRunTour lensId="metacognition" />
      <ManifestActionBar />
      <DepthBadge lensId="metacognition" size="sm" className="ml-2" />
    <div data-lens-theme="metacognition" className="p-6 space-y-6">
      {/* Header */}
      <header className="flex items-center gap-3">
        <Brain className="w-7 h-7 text-neon-purple" />
        <div>
          <h1 className="text-xl font-bold">Metacognition Lens</h1>
          <p className="text-sm text-gray-400">
            Self-awareness, blindspot detection, calibration, and introspection
          </p>
        </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="metacognition" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      </header>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Reflections', value: introspectionHistory.length, icon: BookOpen },
          { label: 'Patterns', value: patterns.length, icon: Activity },
          { label: 'Meta-Score', value: cal.overallAccuracy != null ? `${(Number(cal.overallAccuracy) * 100).toFixed(0)}%` : '--', icon: Gauge },
          { label: 'Blind Spots', value: spots.length, icon: AlertTriangle },
        ].map((stat) => (
          <div key={stat.label} className="panel flex items-center gap-3 p-3">
            <stat.icon className="w-5 h-5 text-neon-purple shrink-0" />
            <div>
              <p className="text-xs text-gray-400">{stat.label}</p>
              <p className="text-lg font-bold text-white">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* AI Actions */}
      <UniversalActions domain="metacognition" artifactId={bridge.selectedId} compact />

      {/* Summary Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="lens-card">
          <Eye className="w-5 h-5 text-neon-cyan mb-2" />
          <p className="text-2xl font-bold">
            {typeof statusInfo.predictions === 'number'
              ? statusInfo.predictions
              : predictions.length || 0}
          </p>
          <p className="text-sm text-gray-400">Predictions</p>
        </div>
        <div className="lens-card">
          <Target className="w-5 h-5 text-neon-green mb-2" />
          <p className="text-2xl font-bold">
            {cal.overallAccuracy != null
              ? `${(Number(cal.overallAccuracy) * 100).toFixed(0)}%`
              : predictionStats.ratio != null
                ? `${(predictionStats.ratio * 100).toFixed(0)}%`
                : '--'}
          </p>
          <p className="text-sm text-gray-400">Calibration</p>
        </div>
        <div className="lens-card">
          <AlertTriangle className="w-5 h-5 text-neon-yellow mb-2" />
          <p className="text-2xl font-bold">{spots.length}</p>
          <p className="text-sm text-gray-400">Blind Spots</p>
        </div>
        <div className="lens-card">
          <Brain className="w-5 h-5 text-neon-purple mb-2" />
          <p className="text-2xl font-bold">
            {typeof (statusInfo.stats as Record<string, unknown> | undefined)?.strategiesUsed === 'number'
              ? ((statusInfo.stats as Record<string, unknown>).strategiesUsed as number)
              : 0}
          </p>
          <p className="text-sm text-gray-400">Strategies</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-gray-700/50 pb-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === tab.id
                ? 'bg-lattice-surface text-neon-purple border border-gray-700/50 border-b-transparent -mb-px'
                : 'text-gray-400 hover:text-gray-200 hover:bg-lattice-surface/50'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* === TAB: Dashboard === */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Knowledge Confidence Map */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-neon-green" />
              Knowledge Confidence Map
            </h2>
            {knowledgeDomains.length > 0 ? (
              <div className="space-y-3">
                {knowledgeDomains.map(
                  (domain: Record<string, unknown>, i: number) => {
                    const name = String(
                      domain.domain || domain.name || domain.label || `Domain ${i + 1}`
                    );
                    const confidence = typeof domain.confidence === 'number' ? domain.confidence : 0;
                    const confPct = pct(confidence);
                    return (
                      <div key={i} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-300 truncate mr-2">{name}</span>
                          <span className="font-mono text-xs text-gray-400 shrink-0">
                            {confPct.toFixed(0)}%
                          </span>
                        </div>
                        <div className="h-2.5 bg-lattice-deep rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              confPct >= 75
                                ? 'bg-green-500'
                                : confPct >= 40
                                  ? 'bg-yellow-500'
                                  : 'bg-red-500'
                            }`}
                            style={{ width: `${confPct}%` }}
                          />
                        </div>
                      </div>
                    );
                  }
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-4">
                No domain confidence data yet. Make predictions across different domains to build the map.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Active Blind Spots */}
            <div className="panel p-4">
              <h2 className="font-semibold mb-4 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-neon-yellow" />
                Active Blind Spots
                {spots.length > 0 && (
                  <span className="ml-auto text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">
                    {spots.length}
                  </span>
                )}
              </h2>
              {spots.length > 0 ? (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {spots.map((spot: Record<string, unknown>, i: number) => {
                    const badge = severityBadge(spot.severity);
                    return (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                        className={`p-3 rounded-lg border-l-4 ${severityColor(spot.severity)}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium text-sm">
                            {String(spot.topic || spot.description || spot.domain || spot.name || 'Untitled gap')}
                          </p>
                          {!!spot.severity && (
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${badge.cls}`}
                            >
                              {typeof spot.severity === 'number' ? `${(Number(spot.severity) * 100).toFixed(0)}%` : badge.label}
                            </span>
                          )}
                        </div>
                        {Array.isArray(spot.gaps) && (spot.gaps as unknown[]).length > 0 && (
                          <p className="text-xs text-gray-400 mt-1">
                            {(spot.gaps as unknown[]).map(String).join(' · ')}
                          </p>
                        )}
                        {!!spot.recommendation && (
                          <p className="text-xs text-gray-400 mt-1">
                            {String(spot.recommendation)}
                          </p>
                        )}
                        {!!(spot.identifiedAt || spot.detected_at) && (
                          <p className="text-xs text-gray-400 mt-1">
                            Detected: {formatTimestamp(spot.identifiedAt || spot.detected_at)}
                          </p>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-center py-6 text-gray-400 text-sm">
                  No blind spots detected. Run introspection to discover potential gaps.
                </p>
              )}
            </div>

            {/* Calibration Score & Trend */}
            <div className="panel p-4">
              <h2 className="font-semibold mb-4 flex items-center gap-2">
                <Target className="w-4 h-4 text-neon-green" />
                Calibration Report
              </h2>
              {cal && cal.totalPredictions != null && Number(cal.totalPredictions) > 0 ? (
                <div className="space-y-4">
                  {/* Main accuracy display */}
                  <div className="flex items-center gap-4 p-3 bg-lattice-deep rounded-lg">
                    <div className="text-center">
                      <p className="text-3xl font-bold font-mono text-neon-green">
                        {cal.overallAccuracy != null ? `${(Number(cal.overallAccuracy) * 100).toFixed(1)}%` : '--'}
                      </p>
                      <p className="text-xs text-gray-400">Accuracy</p>
                    </div>
                    {!!cal.interpretation && (
                      <div className="flex items-center gap-1 text-sm">
                        {trendIcon(cal.interpretation === 'well-calibrated' ? 'up' : cal.interpretation === 'poorly calibrated' ? 'down' : 'flat')}
                        <span className="text-gray-400 capitalize">{String(cal.interpretation)}</span>
                      </div>
                    )}
                  </div>
                  {/* Additional calibration metrics (whitelisted — `buckets` is a nested
                      object the grid isn't shaped for, so it's shown separately, not here) */}
                  <div className="grid grid-cols-2 gap-3">
                    {(['totalPredictions', 'correctPredictions', 'avgCalibrationError'] as const)
                      .filter((key) => cal[key] != null)
                      .map((key) => (
                        <div key={key} className="lens-card">
                          <p className="text-xs text-gray-400 uppercase truncate">{key.replace(/([A-Z])/g, ' $1')}</p>
                          <p className="text-lg font-bold font-mono">
                            {typeof cal[key] === 'number' ? (cal[key] as number).toFixed(key === 'avgCalibrationError' ? 3 : 0) : String(cal[key])}
                          </p>
                        </div>
                      ))}
                  </div>
                </div>
              ) : (
                <p className="text-center py-6 text-gray-400 text-sm">
                  Make predictions and resolve them to build calibration data.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* === TAB: Introspection === */}
      {activeTab === 'introspection' && (
        <div className="space-y-6">
          {/* Run Introspection */}
          <div className="panel p-4 space-y-4">
            <h2 className="font-semibold flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-neon-yellow" />
              Run Introspection
            </h2>
            <p className="text-sm text-gray-400">
              Trigger a self-analysis pass. Optionally specify a focus area to examine.
            </p>
            <div className="flex gap-3">
              <input
                type="text"
                value={introspectFocus}
                onChange={(e) => setIntrospectFocus(e.target.value)}
                placeholder="Focus area (optional) — e.g. reasoning, memory, calibration..."
                className="input-lattice flex-1"
              />
              <button
                onClick={() => runIntrospection.mutate()}
                disabled={runIntrospection.isPending}
                className="btn-neon purple flex items-center gap-2 shrink-0"
              >
                <Brain className="w-4 h-4" />
                {runIntrospection.isPending ? 'Introspecting...' : 'Run Introspection'}
              </button>
            </div>
          </div>

          {/* Current Introspection Results — introspectOnFailures() (server.js)
              analyzes resolved predictions for four real pattern types
              (domain_weakness / overconfidence / underconfidence / topic_weakness);
              it has no concept of "strengths" — a prior version of this panel
              rendered fictional strengths/weaknesses sections that could never be
              populated by the actual backend. This shows the LATEST run's real
              findings (captured from the mutation response, since
              introspection_status only returns aggregate counts). */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-neon-purple" />
              Introspection Results
            </h2>
            {latestIntrospection ? (
              <div className="space-y-4">
                {!!latestIntrospection.message && (
                  <p className="text-sm text-gray-400">{String(latestIntrospection.message)}</p>
                )}
                {typeof latestIntrospection.totalPredictions === 'number' && (
                  <div className="flex flex-wrap gap-4 text-xs text-gray-400">
                    <span>Analyzed: <span className="text-gray-200 font-mono">{String(latestIntrospection.totalPredictions)}</span></span>
                    <span>Failures: <span className="text-red-400 font-mono">{String(latestIntrospection.failures)}</span></span>
                    <span>Successes: <span className="text-green-400 font-mono">{String(latestIntrospection.successes)}</span></span>
                    {typeof latestIntrospection.failureRate === 'number' && (
                      <span>Failure rate: <span className="text-yellow-400 font-mono">{(Number(latestIntrospection.failureRate) * 100).toFixed(0)}%</span></span>
                    )}
                  </div>
                )}
                {/* Failure patterns found in this pass */}
                {(() => {
                  const foundPatterns = Array.isArray(latestIntrospection.patterns)
                    ? (latestIntrospection.patterns as Record<string, unknown>[])
                    : Array.isArray(latestIntrospection.failurePatterns)
                      ? (latestIntrospection.failurePatterns as Record<string, unknown>[])
                      : [];
                  return foundPatterns.length > 0 ? (
                    <div>
                      <h3 className="text-sm font-medium text-red-400 mb-2 flex items-center gap-1">
                        <XCircle className="w-3.5 h-3.5" />
                        Failure Patterns Found
                      </h3>
                      <div className="space-y-1">
                        {foundPatterns.map((p, i) => (
                          <div key={i} className="text-sm p-2 bg-red-500/5 border border-red-500/10 rounded">
                            <p className="text-gray-200">{String(p.description || p.type)}</p>
                            {!!p.recommendation && <p className="text-xs text-gray-400 mt-0.5">{String(p.recommendation)}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null;
                })()}
                {/* Recommendations */}
                {Array.isArray(latestIntrospection.recommendations) && (latestIntrospection.recommendations as unknown[]).length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-neon-cyan mb-2 flex items-center gap-1">
                      <Lightbulb className="w-3.5 h-3.5" />
                      Recommendations
                    </h3>
                    <div className="space-y-1">
                      {(latestIntrospection.recommendations as Record<string, unknown>[]).map(
                        (r: Record<string, unknown> | string, i: number) => (
                          <div
                            key={i}
                            className="text-sm p-2 bg-cyan-500/5 border border-cyan-500/10 rounded"
                          >
                            {typeof r === 'string' ? r : String(r.description || r.action || 'Recommendation')}
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}
                {/* Per-domain confidence adjustments this pass produced/holds */}
                {!!latestIntrospection.confidenceAdjustments && typeof latestIntrospection.confidenceAdjustments === 'object'
                  && Object.keys(latestIntrospection.confidenceAdjustments as Record<string, unknown>).length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-300 mb-2">Confidence Adjustments</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(latestIntrospection.confidenceAdjustments as Record<string, number>).map(([domain, factor]) => (
                        <div key={domain} className="lens-card flex items-center justify-between text-xs">
                          <span className="text-gray-300 capitalize">{domain}</span>
                          <span className={factor < 1 ? 'text-red-400 font-mono' : factor > 1 ? 'text-green-400 font-mono' : 'text-gray-400 font-mono'}>
                            ×{Number(factor).toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-center py-8 text-gray-400 text-sm">
                {typeof introData.failurePatternCount === 'number' && introData.failurePatternCount > 0
                  ? `${introData.failurePatternCount} failure pattern(s) found in past runs. Click "Run Introspection" to re-analyze with the latest predictions.`
                  : 'No introspection results yet. Click "Run Introspection" to begin.'}
              </p>
            )}
          </div>

          {/* Introspection History */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-400" />
              Introspection History
            </h2>
            {introspectionHistory.length > 0 ? (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {[...introspectionHistory].reverse().map((entry: Record<string, unknown>, i: number) => {
                  const entryPatterns = Array.isArray(entry.patterns) ? (entry.patterns as unknown[]) : [];
                  return (
                    <div key={i} className="lens-card text-sm">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-gray-300">
                          {entryPatterns.length > 0 ? entryPatterns.map((t) => String(t).replace(/_/g, ' ')).join(', ') : 'No patterns found'}
                        </span>
                        <span className="text-xs text-gray-400">
                          {formatTimestamp(entry.timestamp)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400">
                        {String(entry.totalPredictions ?? 0)} analyzed · {String(entry.failures ?? 0)} failed
                        {typeof entry.failureRate === 'number' ? ` (${(Number(entry.failureRate) * 100).toFixed(0)}%)` : ''}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-center py-6 text-gray-400 text-sm">
                Past introspection results will appear here after running introspections.
              </p>
            )}
          </div>
        </div>
      )}

      {/* === TAB: Predictions === */}
      {activeTab === 'predictions' && (
        <div className="space-y-6">
          {/* Make a Prediction */}
          <div className="panel p-4 space-y-4">
            <h2 className="font-semibold flex items-center gap-2">
              <Crosshair className="w-4 h-4 text-neon-cyan" />
              Make a Prediction
            </h2>
            <input
              type="text"
              value={predictionClaim}
              onChange={(e) => setPredictionClaim(e.target.value)}
              placeholder="Prediction claim..."
              className="input-lattice w-full"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">
                  Confidence: {(predictionConfidence * 100).toFixed(0)}%
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={predictionConfidence}
                  onChange={(e) => setPredictionConfidence(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Domain (optional)</label>
                <input
                  type="text"
                  value={predictionDomain}
                  onChange={(e) => setPredictionDomain(e.target.value)}
                  placeholder="e.g. reasoning, memory..."
                  className="input-lattice w-full"
                />
              </div>
            </div>
            <button
              onClick={() => makePrediction.mutate()}
              disabled={!predictionClaim || makePrediction.isPending}
              className="btn-neon purple w-full flex items-center justify-center gap-2"
            >
              <Send className="w-4 h-4" />
              {makePrediction.isPending ? 'Recording...' : 'Record Prediction'}
            </button>
          </div>

          {/* Hit/Miss Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="lens-card">
              <CheckCircle2 className="w-5 h-5 text-green-400 mb-1" />
              <p className="text-2xl font-bold font-mono">{predictionStats.hits}</p>
              <p className="text-xs text-gray-400">Correct</p>
            </div>
            <div className="lens-card">
              <XCircle className="w-5 h-5 text-red-400 mb-1" />
              <p className="text-2xl font-bold font-mono">{predictionStats.misses}</p>
              <p className="text-xs text-gray-400">Incorrect</p>
            </div>
            <div className="lens-card">
              <Clock className="w-5 h-5 text-gray-400 mb-1" />
              <p className="text-2xl font-bold font-mono">{predictionStats.pending}</p>
              <p className="text-xs text-gray-400">Pending</p>
            </div>
            <div className="lens-card">
              <Target className="w-5 h-5 text-neon-cyan mb-1" />
              <p className="text-2xl font-bold font-mono">
                {predictionStats.ratio != null
                  ? `${(predictionStats.ratio * 100).toFixed(0)}%`
                  : '--'}
              </p>
              <p className="text-xs text-gray-400">Hit Rate</p>
            </div>
          </div>

          {/* Confidence vs Accuracy Scatter Display */}
          {predictions.length > 0 ? (
            <div className="panel p-4">
              <h2 className="font-semibold mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-neon-purple" />
                Confidence vs Accuracy
              </h2>
              <div className="relative h-48 bg-lattice-deep rounded-lg overflow-hidden border border-gray-700/30">
                {/* Y-axis labels */}
                <div className="absolute left-0 top-0 bottom-0 w-10 flex flex-col justify-between py-2 text-xs text-gray-400">
                  <span>100%</span>
                  <span>50%</span>
                  <span>0%</span>
                </div>
                {/* Grid lines */}
                <div className="absolute left-10 right-0 top-1/2 border-t border-gray-700/30" />
                <div className="absolute left-10 right-0 top-1/4 border-t border-gray-700/20" />
                <div className="absolute left-10 right-0 top-3/4 border-t border-gray-700/20" />
                {/* Ideal calibration line (diagonal) */}
                <div
                  className="absolute border-t border-dashed border-gray-500/40"
                  style={{
                    left: '40px',
                    bottom: '0',
                    width: 'calc((100% - 40px) * 1.414)',
                    transformOrigin: 'bottom left',
                    transform: 'rotate(-45deg)',
                  }}
                />
                {/* Data points */}
                <div className="absolute left-10 right-2 top-2 bottom-2">
                  {predictions
                    .filter(
                      (p: Record<string, unknown>) =>
                        typeof p.confidence === 'number' &&
                        (p.outcome != null || p.resolved != null || p.result != null)
                    )
                    .map((p: Record<string, unknown>, i: number) => {
                      const conf = Number(p.confidence);
                      const outcome = p.outcome ?? p.resolved ?? p.result;
                      const isCorrect =
                        outcome === true || outcome === 'correct' || outcome === 'hit';
                      const x = conf * 100;
                      const y = isCorrect ? conf * 100 : (1 - conf) * 50;
                      return (
                        <div
                          key={i}
                          className={`absolute w-3 h-3 rounded-full border-2 transition-all ${
                            isCorrect
                              ? 'bg-green-500 border-green-400'
                              : 'bg-red-500 border-red-400'
                          }`}
                          style={{
                            left: `${x}%`,
                            bottom: `${y}%`,
                            transform: 'translate(-50%, 50%)',
                          }}
                          title={`${String(p.statement || p.claim || p.description || '')} | Conf: ${(conf * 100).toFixed(0)}% | ${isCorrect ? 'Correct' : 'Incorrect'}`}
                        />
                      );
                    })}
                </div>
                {/* X-axis labels */}
                <div className="absolute bottom-0 left-10 right-0 flex justify-between px-2 text-xs text-gray-400">
                  <span>0%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </div>
              <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />
                  Correct
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
                  Incorrect
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-6 border-t border-dashed border-gray-500/60 inline-block" />
                  Ideal calibration
                </span>
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-gray-400 text-sm border border-dashed border-white/10 rounded-lg">
              <p>No predictions yet. Create cognitive predictions to see pattern analysis here.</p>
            </div>
          )}

          {/* Recent Predictions List */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Crosshair className="w-4 h-4 text-neon-cyan" />
              Recent Predictions
            </h2>
            {predictions.length > 0 ? (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {[...predictions].reverse().map((p: Record<string, unknown>, i: number) => {
                  const id = String(p.id || p.prediction_id || i);
                  const outcome = p.outcome ?? p.resolved ?? p.result;
                  const isResolved = outcome != null;
                  const isCorrect =
                    outcome === true || outcome === 'correct' || outcome === 'hit';
                  const expanded = expandedPrediction === id;

                  return (
                    <div key={id} className="lens-card">
                      <div
                        className="flex items-center gap-3 cursor-pointer"
                        onClick={() => setExpandedPrediction(expanded ? null : id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                        {isResolved ? (
                          isCorrect ? (
                            <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                          )
                        ) : (
                          <Clock className="w-4 h-4 text-gray-400 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {String(p.statement || p.claim || p.description || p.prediction || 'Prediction')}
                          </p>
                          <div className="flex items-center gap-3 text-xs text-gray-400">
                            {typeof p.confidence === 'number' && (
                              <span>Conf: {(p.confidence * 100).toFixed(0)}%</span>
                            )}
                            {!!p.domain && <span>Domain: {String(p.domain)}</span>}
                            {!!(p.createdAt || p.timestamp || p.created_at) && (
                              <span>{formatTimestamp(p.createdAt || p.timestamp || p.created_at)}</span>
                            )}
                          </div>
                        </div>
                        {!isResolved && (
                          <div className="flex gap-1 shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                resolvePrediction.mutate({ id, outcome: true });
                              }}
                              disabled={resolvePrediction.isPending}
                              className="p-1 rounded bg-green-500/20 hover:bg-green-500/30 text-green-400 transition-colors"
                              title="Mark correct"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                resolvePrediction.mutate({ id, outcome: false });
                              }}
                              disabled={resolvePrediction.isPending}
                              className="p-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors"
                              title="Mark incorrect"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                        {expanded ? (
                          <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                        )}
                      </div>
                      {expanded && (
                        <div className="mt-3 pt-3 border-t border-gray-700/30 text-xs text-gray-400 space-y-1">
                          {Object.entries(p)
                            .filter(
                              ([k]) =>
                                !['id', 'prediction_id', 'statement', 'claim', 'description', 'prediction'].includes(k)
                            )
                            .map(([k, v]) => (
                              <div key={k} className="flex justify-between">
                                <span className="text-gray-400">{k.replace(/_/g, ' ')}</span>
                                <span className="font-mono">
                                  {typeof v === 'number'
                                    ? v.toFixed(3)
                                    : typeof v === 'boolean'
                                      ? v ? 'true' : 'false'
                                      : String(v)}
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-center py-8 text-gray-400 text-sm">
                No predictions yet. Use the form above to record your first prediction.
              </p>
            )}
          </div>
        </div>
      )}

      {/* === TAB: Learning === */}
      {activeTab === 'learning' && (
        <div className="space-y-6">
          {/* Domain Assessment Tool */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-neon-cyan" />
              Domain Assessment
            </h2>
            <p className="text-sm text-gray-400 mb-3">
              Run an assessment on a specific knowledge domain to evaluate competence.
            </p>
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="Domain to assess — e.g. logic, language, math..."
                className="input-lattice flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.currentTarget.value) {
                    runAssessment.mutate(e.currentTarget.value);
                    e.currentTarget.value = '';
                  }
                }}
              />
              <button
                onClick={() => {
                  // detector-allow: frontend-fake-data — "placeholder" here is part of a
                  // CSS attribute selector used to find the input above, not rendered content.
                  const input = document.querySelector<HTMLInputElement>(
                    'input[placeholder*="Domain to assess"]'
                  );
                  if (input?.value) {
                    runAssessment.mutate(input.value);
                    input.value = '';
                  }
                }}
                disabled={runAssessment.isPending}
                className="btn-neon flex items-center gap-2 shrink-0"
              >
                <Target className="w-4 h-4" />
                {runAssessment.isPending ? 'Assessing...' : 'Assess'}
              </button>
            </div>
          </div>

          {/* Recent Learning Insights */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-neon-yellow" />
              Recent Knowledge Acquisitions
            </h2>
            {learningInsights.length > 0 ? (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {[...learningInsights].reverse().map((insight: Record<string, unknown>, i: number) => (
                  <div key={i} className="lens-card text-sm">
                    <div className="flex items-start gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-neon-yellow shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-medium text-gray-300">
                          {String(
                            insight.description ||
                              insight.insight ||
                              insight.name ||
                              insight.topic ||
                              JSON.stringify(insight)
                          )}
                        </p>
                        {!!insight.domain && (
                          <span className="text-xs text-gray-400">
                            Domain: {String(insight.domain)}
                          </span>
                        )}
                        {!!(insight.timestamp || insight.learned_at) && (
                          <span className="text-xs text-gray-400 ml-2">
                            {formatTimestamp(insight.timestamp || insight.learned_at)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center py-6 text-gray-400 text-sm">
                Learning insights will appear as the system processes new information.
              </p>
            )}
          </div>

          {/* Pattern Recognition Highlights */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Brain className="w-4 h-4 text-neon-purple" />
              Pattern Recognition Highlights
            </h2>
            {patterns.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {patterns.map((pattern: Record<string, unknown>, i: number) => {
                  const confidence = typeof pattern.confidence === 'number' ? pattern.confidence : null;
                  return (
                    <div key={i} className="lens-card">
                      <p className="text-sm font-medium text-gray-300 mb-1">
                        {String(
                          pattern.description ||
                            pattern.pattern ||
                            pattern.name ||
                            JSON.stringify(pattern)
                        )}
                      </p>
                      {confidence != null && (
                        <div className="flex items-center gap-2 mt-2">
                          <div className="h-1.5 flex-1 bg-lattice-deep rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-neon-purple"
                              style={{ width: `${pct(confidence)}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-400 font-mono">
                            {pct(confidence).toFixed(0)}%
                          </span>
                        </div>
                      )}
                      {!!pattern.occurrences && (
                        <p className="text-xs text-gray-400 mt-1">
                          Occurrences: {String(pattern.occurrences)}
                        </p>
                      )}
                      {!!pattern.category && (
                        <span className="inline-block text-xs bg-neon-purple/10 text-neon-purple px-2 py-0.5 rounded mt-1">
                          {String(pattern.category)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-center py-6 text-gray-400 text-sm">
                Pattern recognition data will populate as the system identifies recurring themes.
              </p>
            )}
          </div>

          {/* Skill Improvement Timeline */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-neon-green" />
              Skill Improvement Timeline
            </h2>
            {knowledgeDomains.length > 0 ? (
              <div className="space-y-4">
                {knowledgeDomains.map((domain: Record<string, unknown>, i: number) => {
                  const name = String(domain.domain || domain.name || domain.label || `Skill ${i + 1}`);
                  const current = typeof domain.confidence === 'number' ? domain.confidence : null;
                  const previous = typeof domain.previous_confidence === 'number' ? domain.previous_confidence : null;
                  const improvement =
                    current != null && previous != null ? current - previous : null;

                  return (
                    <div key={i} className="flex items-center gap-4">
                      <div className="w-28 text-sm text-gray-300 truncate shrink-0">{name}</div>
                      <div className="flex-1 relative">
                        <div className="h-3 bg-lattice-deep rounded-full overflow-hidden">
                          {previous != null && (
                            <div
                              className="absolute h-3 rounded-full bg-gray-600/50 top-0"
                              style={{ width: `${pct(previous)}%` }}
                            />
                          )}
                          <div
                            className="relative h-full rounded-full bg-neon-green transition-all duration-500"
                            style={{ width: `${pct(current ?? 0)}%` }}
                          />
                        </div>
                      </div>
                      <div className="w-20 text-right shrink-0">
                        <span className="text-sm font-mono text-gray-300">
                          {current != null ? `${pct(current).toFixed(0)}%` : '--'}
                        </span>
                        {improvement != null && improvement !== 0 && (
                          <span
                            className={`text-xs ml-1 ${
                              improvement > 0 ? 'text-green-400' : 'text-red-400'
                            }`}
                          >
                            {improvement > 0 ? '+' : ''}
                            {(improvement * 100).toFixed(1)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-center py-6 text-gray-400 text-sm">
                Skill improvements will be tracked as the system operates across different domains.
              </p>
            )}
          </div>

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="metacognition"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
        </div>
      )}

      {/* === TAB: Decision Journal === */}
      {activeTab === 'journal' && (
        <div className="space-y-6">
          <DecisionJournal />
        </div>
      )}

      {/* === TAB: Practice === */}
      {activeTab === 'practice' && (
        <div className="space-y-6">
          <BiasChecklist />
          <AccuracyTracker />
          <ReflectionPrompts />
          <StrategyLibrary />
        </div>
      )}

      {/* Predictions Analysis — advanced statistical analysis of the raw
          Predictions tab (STATE.metacognition.predictions), distinct from the
          Decision Journal's own calibrationReport above (different substrate). */}
      <div className="panel p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Brain className="w-4 h-4 text-neon-purple" />
          Predictions Analysis
        </h2>
        <p className="text-xs text-gray-400">
          Deeper statistical analysis of your resolved Predictions-tab entries — log loss,
          discrimination, and a power-law/exponential learning-curve fit with a forecast
          for when you&apos;ll reach 90% calibration accuracy.
        </p>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'confidenceCalibration' as const, label: 'Confidence Calibration' },
            { action: 'learningCurve' as const, label: 'Learning Curve' },
          ].map(({ action, label }) => (
            <button key={action} onClick={() => handleAction(action)} disabled={!!isRunning || predictions.filter((p) => p.outcome === 'correct' || p.outcome === 'incorrect').length < 2}
              className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
              {isRunning === action ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {label}
            </button>
          ))}
        </div>
        {actionResult && (
          <div className="bg-lattice-deep rounded-lg p-4 space-y-3 text-sm">
            {'brierScore' in actionResult && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-4 text-xs">
                  <span className="text-gray-400">Brier Score: <span className="text-neon-cyan font-bold">{String(actionResult.brierScore)}</span></span>
                  <span className="text-gray-400">Skill Score: <span className="text-neon-green">{String(actionResult.brierSkillScore)}</span></span>
                  <span className="text-gray-400">Log Loss: <span className="text-yellow-400">{String(actionResult.logLoss)}</span></span>
                </div>
                {'calibration' in actionResult && actionResult.calibration !== null && typeof actionResult.calibration === 'object' && (
                  <div className="flex flex-wrap gap-3 text-xs">
                    {Object.entries(actionResult.calibration as Record<string, unknown>).map(([k, v]) => (
                      <span key={k} className="text-gray-400">{k}: <span className="text-neon-cyan">{String(v)}</span></span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {'currentPerformance' in actionResult && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-4 text-xs">
                  <span className="text-gray-400">Performance: <span className="text-neon-cyan font-bold">{String(actionResult.currentPerformance)}</span></span>
                  <span className="text-gray-400">Mastered: <span className={actionResult.mastered ? 'text-neon-green' : 'text-yellow-400'}>{String(actionResult.mastered)}</span></span>
                  <span className="text-gray-400">Best Model: <span className="text-neon-purple">{String(actionResult.bestModel)}</span></span>
                </div>
                {'learningRate' in actionResult && actionResult.learningRate !== null && typeof actionResult.learningRate === 'object' && (
                  <div className="flex flex-wrap gap-3 text-xs">
                    {Object.entries(actionResult.learningRate as Record<string, unknown>).map(([k, v]) => (
                      <span key={k} className="text-gray-400">{k}: <span className="text-neon-cyan">{String(v)}</span></span>
                    ))}
                  </div>
                )}
                {(() => {
                  const fit = actionResult.bestModel === 'power_law' ? actionResult.powerLawFit
                    : actionResult.bestModel === 'exponential' ? actionResult.exponentialFit : null;
                  const fitObj = fit && typeof fit === 'object' ? (fit as Record<string, unknown>) : null;
                  return fitObj?.predictedMasteryTrial != null ? (
                    <p className="text-xs text-neon-green">
                      Forecast: 90% calibration accuracy around trial #{String(fitObj.predictedMasteryTrial)} ({String(fitObj.equation)}, R²={typeof fitObj.rSquared === 'number' ? fitObj.rSquared.toFixed(3) : fitObj.rSquared as string})
                    </p>
                  ) : null;
                })()}
              </div>
            )}
            {'message' in actionResult && <p className="text-gray-400">{String(actionResult.message)}</p>}
          </div>
        )}
      </div>

      {/* Reasoning Toolkit — designed entry points for select_strategy +
          adjust_confidence (previously functional macros with no button
          anywhere in this page; see the capability-map "Genuinely missing,
          deferred" section for the prior gap). */}
      <ReasoningToolkit />

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
            <LensFeaturePanel lensId="metacognition" />
          </div>
        )}
      </div>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <CogsciFeed />
      </section>
    </div>
          <RecentMineCard domain="metacognition" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="metacognition" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="metacognition" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
