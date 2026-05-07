'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState, useMemo, useEffect } from 'react';
import { useLensBridge } from '@/lib/hooks/use-lens-bridge';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { motion } from 'framer-motion';
import {
  Heart,
  Activity,
  Shield,
  Brain,
  Zap,
  Battery,
  Users,
  RefreshCw,
  Send,
  AlertTriangle,
  BarChart3,
  Clock,
  Filter,
  ToggleLeft,
  ToggleRight,
  Gauge,
  TrendingUp,
  TrendingDown,
  Minus,
  Thermometer,
  Eye,
  ChevronDown,
  ChevronUp,
  Layers,
  Loader2,
  Search,
  Sparkles,
  MessageSquare,
  Hand,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

// --- Types ---

type AffectDim = {
  key: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  description: string;
};

type TabId = 'dimensions' | 'events' | 'policy' | 'health' | 'analysis';

// --- Constants ---

const DIMS: AffectDim[] = [
  {
    key: 'v',
    label: 'Valence',
    icon: <Heart className="w-4 h-4" />,
    color: 'text-pink-400',
    bgColor: 'bg-pink-400',
    description: 'Positive vs negative emotional tone',
  },
  {
    key: 'a',
    label: 'Arousal',
    icon: <Activity className="w-4 h-4" />,
    color: 'text-orange-400',
    bgColor: 'bg-orange-400',
    description: 'Level of activation and energy',
  },
  {
    key: 's',
    label: 'Stability',
    icon: <Shield className="w-4 h-4" />,
    color: 'text-green-400',
    bgColor: 'bg-green-400',
    description: 'Emotional steadiness over time',
  },
  {
    key: 'c',
    label: 'Coherence',
    icon: <Brain className="w-4 h-4" />,
    color: 'text-blue-400',
    bgColor: 'bg-blue-400',
    description: 'Internal consistency of emotional state',
  },
  {
    key: 'g',
    label: 'Agency',
    icon: <Zap className="w-4 h-4" />,
    color: 'text-purple-400',
    bgColor: 'bg-purple-400',
    description: 'Sense of control and self-efficacy',
  },
  {
    key: 't',
    label: 'Trust',
    icon: <Users className="w-4 h-4" />,
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-400',
    description: 'Confidence in the interaction environment',
  },
  {
    key: 'f',
    label: 'Fatigue',
    icon: <Battery className="w-4 h-4" />,
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-400',
    description: 'Cognitive and emotional exhaustion level',
  },
];

const EVENT_TYPES = [
  'USER_MESSAGE',
  'SYSTEM_RESULT',
  'ERROR',
  'SUCCESS',
  'TIMEOUT',
  'CONFLICT',
  'SAFETY_BLOCK',
  'GOAL_PROGRESS',
  'TOOL_RESULT',
  'FEEDBACK',
  'SESSION_START',
  'SESSION_END',
  'CUSTOM',
];

// --- Helpers ---

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function dimColor(value: number): string {
  if (value >= 0.65) return 'text-green-400';
  if (value >= 0.35) return 'text-yellow-400';
  return 'text-red-400';
}

function dimBgColor(value: number): string {
  if (value >= 0.65) return 'bg-green-500';
  if (value >= 0.35) return 'bg-yellow-500';
  return 'bg-red-500';
}

function _formatTimestamp(ts: unknown): string {
  if (!ts) return '';
  try {
    const d = new Date(String(ts));
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return String(ts);
  }
}

function formatTimeShort(ts: unknown): string {
  if (!ts) return '';
  try {
    const d = new Date(String(ts));
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return String(ts);
  }
}

function eventTypeColor(type: string): string {
  const t = type.toUpperCase();
  if (t === 'ERROR' || t === 'SAFETY_BLOCK') return 'bg-red-500/20 text-red-400';
  if (t === 'SUCCESS' || t === 'GOAL_PROGRESS') return 'bg-green-500/20 text-green-400';
  if (t === 'TIMEOUT' || t === 'CONFLICT') return 'bg-yellow-500/20 text-yellow-400';
  if (t === 'FEEDBACK') return 'bg-purple-500/20 text-purple-400';
  if (t === 'SESSION_START' || t === 'SESSION_END') return 'bg-blue-500/20 text-blue-400';
  return 'bg-gray-500/20 text-gray-400';
}

// --- Component ---

export default function AffectLensPage() {
  useLensNav('affect');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('affect');

  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState('default');
  const [eventType, setEventType] = useState('USER_MESSAGE');
  const [intensity, setIntensity] = useState(0.5);
  const [polarity, setPolarity] = useState(0.0);
  const [activeTab, setActiveTab] = useState<TabId>('dimensions');
  const [eventFilter, setEventFilter] = useState<string>('all');
  const [eventDimFilter, setEventDimFilter] = useState<string>('all');
  const [expandedEvent, setExpandedEvent] = useState<number | null>(null);
  const [showFeatures, setShowFeatures] = useState(true);

  // --- Domain action state (backend analysis tools) ---
  const runAction = useRunArtifact('affect');
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const [sentimentResult, setSentimentResult] = useState<Record<string, unknown> | null>(null);
  const [timelineResult, setTimelineResult] = useState<Record<string, unknown> | null>(null);
  const [empathyResult, setEmpathyResult] = useState<Record<string, unknown> | null>(null);
  const [patternResult, setPatternResult] = useState<Record<string, unknown> | null>(null);

  // --- Lens Bridge (mirrors affect state into universal artifact system) ---
  const bridge = useLensBridge('affect', 'snapshot');

  // --- Queries ---

  const {
    data: state,
    isLoading: stateLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['affect-state', sessionId],
    queryFn: () => apiHelpers.affect.state(sessionId).then((r) => r.data),
    refetchInterval: 3000,
  });

  const {
    data: policy,
    isError: isError2,
    error: error2,
    refetch: refetch2,
  } = useQuery({
    queryKey: ['affect-policy', sessionId],
    queryFn: () => apiHelpers.affect.policy(sessionId).then((r) => r.data),
    refetchInterval: 5000,
  });

  const {
    data: health,
    isError: isError3,
    error: error3,
    refetch: refetch3,
  } = useQuery({
    queryKey: ['affect-health'],
    queryFn: () => apiHelpers.affect.health().then((r) => r.data),
    refetchInterval: 10000,
  });

  const {
    data: events,
    isError: isError4,
    error: error4,
    refetch: refetch4,
  } = useQuery({
    queryKey: ['affect-events', sessionId],
    queryFn: () => apiHelpers.affect.events(sessionId).then((r) => r.data),
    refetchInterval: 5000,
  });

  // --- Mutations ---

  const emitEvent = useMutation({
    mutationFn: () =>
      apiHelpers.affect.emit(sessionId, { type: eventType, intensity, polarity }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['affect-state', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['affect-policy', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['affect-events', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['affect-health'] });
    },
    onError: (err) => {
      console.error('Failed to emit affect event:', err instanceof Error ? err.message : err);
    },
  });

  const resetAffect = useMutation({
    mutationFn: (mode?: string) => apiHelpers.affect.reset(sessionId, mode),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['affect-state', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['affect-policy', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['affect-events', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['affect-health'] });
    },
    onError: (err) => {
      console.error('Failed to reset affect:', err instanceof Error ? err.message : err);
    },
  });

  // --- Policy toggle via artifact action ---
  const togglePolicy = useMutation({
    mutationFn: async ({ category, key, newValue }: { category: string; key: string; newValue: boolean }) => {
      // Use the lens artifact action system to request a policy toggle
      if (bridge.selectedId) {
        return runAction.mutateAsync({
          id: bridge.selectedId,
          action: 'togglePolicy',
          params: { category, key, value: newValue, sessionId },
        });
      }
      // Fallback: emit a CUSTOM event carrying the toggle payload
      return apiHelpers.affect.emit(sessionId, {
        type: 'CUSTOM',
        intensity: 0,
        polarity: 0,
        payload: { action: 'togglePolicy', category, key, value: newValue },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['affect-policy', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['affect-state', sessionId] });
    },
    onError: (err) => {
      console.error('Policy toggle failed:', err instanceof Error ? err.message : err);
    },
  });

  // --- Derived data ---

  const affectState = useMemo(() => {
    const raw = state?.state || state?.E || state;
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  }, [state]);

  const policyData = useMemo(() => {
    const raw = policy?.policy || policy;
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  }, [policy]);

  const healthData = useMemo(() => {
    return health && typeof health === 'object' ? (health as Record<string, unknown>) : {};
  }, [health]);

  // Bridge affect state into lens artifacts for universal AI actions
  useEffect(() => {
    if (Object.keys(affectState).length > 0) {
      bridge.sync(affectState as Record<string, unknown>, 'Affect State Snapshot');
    }
  }, [affectState, bridge]);

  // --- Domain action handler ---
  const handleAnalysisAction = async (
    action: string,
    setter: (val: Record<string, unknown> | null) => void
  ) => {
    if (!bridge.selectedId) return;
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: bridge.selectedId, action });
      if (res.ok === false) { setter({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` } as Record<string, unknown>); } else { setter((res.result as Record<string, unknown>) || null); }
    } catch (e) {
      console.error(`Action ${action} failed:`, e);
    }
    setIsRunning(null);
  };

  const eventList = useMemo(() => {
    const raw = events?.events || events;
    return Array.isArray(raw) ? raw : [];
  }, [events]);

  const filteredEvents = useMemo(() => {
    let filtered = [...eventList];
    if (eventFilter !== 'all') {
      filtered = filtered.filter(
        (evt: Record<string, unknown>) =>
          String(evt.type).toUpperCase() === eventFilter.toUpperCase()
      );
    }
    if (eventDimFilter !== 'all') {
      filtered = filtered.filter((evt: Record<string, unknown>) => {
        const dims = evt.dimensions || evt.affected_dimensions || evt.changes;
        if (Array.isArray(dims)) return dims.includes(eventDimFilter);
        if (dims && typeof dims === 'object')
          return eventDimFilter in (dims as Record<string, unknown>);
        return true;
      });
    }
    return filtered;
  }, [eventList, eventFilter, eventDimFilter]);

  const dimValues = useMemo(() => {
    return DIMS.map((dim) => {
      const val = typeof affectState[dim.key] === 'number' ? (affectState[dim.key] as number) : 0.5;
      return { ...dim, value: clamp(val, 0, 1) };
    });
  }, [affectState]);

  const overallScore = useMemo(() => {
    const healthScore =
      typeof healthData.score === 'number'
        ? healthData.score
        : typeof healthData.overall_score === 'number'
          ? healthData.overall_score
          : null;
    if (healthScore != null) return healthScore;

    // Compute from dimensions (inverse fatigue, average others)
    const vals = dimValues.map((d) => (d.key === 'f' ? 1 - d.value : d.value));
    if (vals.length === 0) return null;
    return vals.reduce((sum, v) => sum + v, 0) / vals.length;
  }, [healthData, dimValues]);

  const warnings = useMemo(() => {
    const w: { dimension: string; message: string; severity: string }[] = [];
    for (const d of dimValues) {
      if (d.key === 'f' && d.value > 0.8) {
        w.push({
          dimension: d.label,
          message: `Fatigue critically high at ${(d.value * 100).toFixed(0)}%`,
          severity: 'critical',
        });
      } else if (d.key === 'f' && d.value > 0.6) {
        w.push({
          dimension: d.label,
          message: `Fatigue elevated at ${(d.value * 100).toFixed(0)}%`,
          severity: 'warning',
        });
      } else if (d.key !== 'f' && d.value < 0.2) {
        w.push({
          dimension: d.label,
          message: `${d.label} critically low at ${(d.value * 100).toFixed(0)}%`,
          severity: 'critical',
        });
      } else if (d.key !== 'f' && d.value < 0.35) {
        w.push({
          dimension: d.label,
          message: `${d.label} below threshold at ${(d.value * 100).toFixed(0)}%`,
          severity: 'warning',
        });
      }
    }
    // Also include API warnings
    const apiWarnings = healthData.warnings || healthData.alerts;
    if (Array.isArray(apiWarnings)) {
      for (const aw of apiWarnings) {
        if (typeof aw === 'string') {
          w.push({ dimension: 'System', message: aw, severity: 'warning' });
        } else if (aw && typeof aw === 'object') {
          w.push({
            dimension: String((aw as Record<string, unknown>).dimension || 'System'),
            message: String((aw as Record<string, unknown>).message || JSON.stringify(aw)),
            severity: String((aw as Record<string, unknown>).severity || 'warning'),
          });
        }
      }
    }
    return w;
  }, [dimValues, healthData]);

  const recoveryRecommendations = useMemo(() => {
    const recs: string[] = [];
    const apiRecs = healthData.recommendations || healthData.recovery;
    if (Array.isArray(apiRecs)) {
      for (const r of apiRecs) recs.push(typeof r === 'string' ? r : JSON.stringify(r));
    }
    // Generate contextual recommendations if none from API
    if (recs.length === 0) {
      for (const d of dimValues) {
        if (d.key === 'f' && d.value > 0.7) {
          recs.push('Consider a cooldown period to reduce fatigue levels.');
        }
        if (d.key === 'v' && d.value < 0.3) {
          recs.push('Valence is low. Positive feedback or success events may help restore balance.');
        }
        if (d.key === 's' && d.value < 0.3) {
          recs.push('Stability is low. Reducing event frequency may help stabilize emotional state.');
        }
        if (d.key === 'c' && d.value < 0.3) {
          recs.push('Coherence is degraded. Consistent interaction patterns may improve internal alignment.');
        }
        if (d.key === 'g' && d.value < 0.3) {
          recs.push('Agency is low. Successful task completions can restore sense of control.');
        }
        if (d.key === 't' && d.value < 0.3) {
          recs.push('Trust is diminished. Reliable, transparent interactions can help rebuild trust.');
        }
      }
    }
    return recs;
  }, [healthData, dimValues]);

  // --- Radar chart helpers ---

  function radarPoints(values: { value: number }[], radius: number): string {
    const n = values.length;
    return values
      .map((v, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        const r = v.value * radius;
        const x = 100 + r * Math.cos(angle);
        const y = 100 + r * Math.sin(angle);
        return `${x},${y}`;
      })
      .join(' ');
  }

  function radarLabelPos(index: number, total: number, radius: number) {
    const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
    const x = 100 + (radius + 14) * Math.cos(angle);
    const y = 100 + (radius + 14) * Math.sin(angle);
    return { x, y };
  }

  // --- Loading/Error ---

  if (stateLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-pink border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading affect state...</p>
        </div>
      </div>
    );
  }

  if (isError || isError2 || isError3 || isError4) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState
          error={error?.message || error2?.message || error3?.message || error4?.message}
          onRetry={() => {
            refetch();
            refetch2();
            refetch3();
            refetch4();
          }}
        />
      </div>
    );
  }

  // --- Tab config ---

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'dimensions', label: 'Dimensions', icon: <Activity className="w-4 h-4" /> },
    { id: 'events', label: 'Event Log', icon: <Clock className="w-4 h-4" /> },
    { id: 'policy', label: 'Policies', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'health', label: 'Health', icon: <Thermometer className="w-4 h-4" /> },
    { id: 'analysis', label: 'Analysis Tools', icon: <Sparkles className="w-4 h-4" /> },
  ];

  // --- Render ---

  return (
    <div data-lens-theme="affect" className="p-6 space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Heart className="w-7 h-7 text-neon-pink" />
          <div>
            <h1 className="text-xl font-bold">Affect Lens</h1>
            <p className="text-sm text-gray-400">
              Affect Translation Spine &mdash; 7D emotional state monitoring &amp; control
            </p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="affect" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <div className="flex items-center gap-3">
          <UniversalActions domain="affect" artifactId={bridge.selectedId} compact />
          <input
            type="text"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            className="input-lattice w-40 text-sm"
            placeholder="Session ID"
          />
          <button
            onClick={() => resetAffect.mutate(undefined)}
            disabled={resetAffect.isPending}
            className="btn-neon flex items-center gap-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw
              className={`w-3 h-3 ${resetAffect.isPending ? 'animate-spin' : ''}`}
            />{' '}
            {resetAffect.isPending ? 'Resetting...' : 'Reset'}
          </button>
          <button
            onClick={() => resetAffect.mutate('cooldown')}
            disabled={resetAffect.isPending}
            className="btn-neon flex items-center gap-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            title="Council-mandated cooldown"
          >
            <Shield className="w-3 h-3" /> Cooldown
          </button>
        </div>
      </header>

      {/* Health Banner */}
      {healthData && (
        <div
          className={`p-3 rounded-lg border text-sm flex items-center gap-2 ${
            healthData.healthy !== false
              ? 'bg-green-500/10 border-green-500/30 text-green-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}
        >
          {healthData.healthy !== false ? (
            <Shield className="w-4 h-4" />
          ) : (
            <AlertTriangle className="w-4 h-4" />
          )}
          ATS Health: {healthData.healthy !== false ? 'Operational' : 'Degraded'} &mdash;{' '}
          {typeof healthData.sessions === 'number' ? healthData.sessions : 0} active sessions
          {overallScore != null && (
            <span className="ml-auto font-mono">
              Score: {(overallScore * 100).toFixed(0)}%
            </span>
          )}
        </div>
      )}

      {/* Warning Alerts */}
      {warnings.length > 0 && (
        <div className="space-y-1">
          {warnings.map((w, i) => (
            <div
              key={i}
              className={`p-2 rounded-lg border text-xs flex items-center gap-2 ${
                w.severity === 'critical'
                  ? 'bg-red-500/10 border-red-500/30 text-red-400'
                  : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="font-medium">{w.dimension}:</span>
              {w.message}
            </div>
          ))}
        </div>
      )}

      {/* 7D State Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {dimValues.map((dim) => (
          <motion.div
            key={dim.key}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="panel p-3"
          >
            <div className={`flex items-center gap-1 mb-2 ${dim.color}`}>
              {dim.icon}
              <span className="text-xs font-medium">{dim.label}</span>
            </div>
            <p className={`text-2xl font-bold font-mono ${dimColor(dim.key === 'f' ? 1 - dim.value : dim.value)}`}>
              {(dim.value * 100).toFixed(1)}%
            </p>
            <div className="h-2 bg-lattice-deep rounded-full mt-2 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${dim.value * 100}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                className={`h-full rounded-full ${dimBgColor(dim.key === 'f' ? 1 - dim.value : dim.value)}`}
              />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-gray-700/50 pb-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === tab.id
                ? 'bg-lattice-surface text-neon-pink border border-gray-700/50 border-b-transparent -mb-px'
                : 'text-gray-400 hover:text-gray-200 hover:bg-lattice-surface/50'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* === TAB: Dimensions === */}
      {activeTab === 'dimensions' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Radar/Spider Chart */}
            <div className="panel p-4">
              <h2 className="font-semibold mb-4 flex items-center gap-2">
                <Eye className="w-4 h-4 text-neon-pink" />
                Dimensional Radar
              </h2>
              <div className="flex justify-center">
                <svg viewBox="0 0 200 200" className="w-full max-w-xs">
                  {/* Background rings */}
                  {[0.25, 0.5, 0.75, 1].map((r) => (
                    <polygon
                      key={r}
                      points={radarPoints(
                        DIMS.map(() => ({ value: r })),
                        80
                      )}
                      fill="none"
                      stroke="rgba(255,255,255,0.08)"
                      strokeWidth="0.5"
                    />
                  ))}
                  {/* Axis lines */}
                  {DIMS.map((_, i) => {
                    const angle = (Math.PI * 2 * i) / DIMS.length - Math.PI / 2;
                    const x2 = 100 + 80 * Math.cos(angle);
                    const y2 = 100 + 80 * Math.sin(angle);
                    return (
                      <line
                        key={i}
                        x1="100"
                        y1="100"
                        x2={x2}
                        y2={y2}
                        stroke="rgba(255,255,255,0.06)"
                        strokeWidth="0.5"
                      />
                    );
                  })}
                  {/* Data polygon */}
                  <motion.polygon
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    points={radarPoints(dimValues, 80)}
                    fill="rgba(236, 72, 153, 0.15)"
                    stroke="rgba(236, 72, 153, 0.8)"
                    strokeWidth="1.5"
                  />
                  {/* Data points */}
                  {dimValues.map((dim, i) => {
                    const angle = (Math.PI * 2 * i) / DIMS.length - Math.PI / 2;
                    const r = dim.value * 80;
                    const cx = 100 + r * Math.cos(angle);
                    const cy = 100 + r * Math.sin(angle);
                    return (
                      <circle
                        key={dim.key}
                        cx={cx}
                        cy={cy}
                        r="3"
                        fill={
                          (dim.key === 'f' ? 1 - dim.value : dim.value) >= 0.65
                            ? '#4ade80'
                            : (dim.key === 'f' ? 1 - dim.value : dim.value) >= 0.35
                              ? '#facc15'
                              : '#f87171'
                        }
                        stroke="white"
                        strokeWidth="0.5"
                      />
                    );
                  })}
                  {/* Labels */}
                  {dimValues.map((dim, i) => {
                    const pos = radarLabelPos(i, DIMS.length, 80);
                    return (
                      <text
                        key={dim.key}
                        x={pos.x}
                        y={pos.y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="fill-gray-400"
                        fontSize="7"
                      >
                        {dim.label}
                      </text>
                    );
                  })}
                </svg>
              </div>
            </div>

            {/* Event Emitter */}
            <div className="panel p-4 space-y-4">
              <h2 className="font-semibold flex items-center gap-2">
                <Send className="w-4 h-4 text-neon-cyan" />
                Emit Affect Event
              </h2>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Event Type</label>
                <select
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                  className="input-lattice w-full"
                >
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">
                  Intensity: {intensity.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={intensity}
                  onChange={(e) => setIntensity(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">
                  Polarity: {polarity.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.01"
                  value={polarity}
                  onChange={(e) => setPolarity(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
              <button
                onClick={() => emitEvent.mutate()}
                disabled={emitEvent.isPending}
                className="btn-neon purple w-full flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" />
                {emitEvent.isPending ? 'Emitting...' : 'Emit Event'}
              </button>
            </div>
          </div>

          {/* Dimension Detail Cards */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-neon-purple" />
              Dimension Details
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {dimValues.map((dim) => {
                const adjustedVal = dim.key === 'f' ? 1 - dim.value : dim.value;
                const status =
                  adjustedVal >= 0.65 ? 'Healthy' : adjustedVal >= 0.35 ? 'Moderate' : 'Low';
                const statusColor =
                  adjustedVal >= 0.65
                    ? 'text-green-400'
                    : adjustedVal >= 0.35
                      ? 'text-yellow-400'
                      : 'text-red-400';
                return (
                  <div key={dim.key} className="lens-card">
                    <div className="flex items-center justify-between mb-2">
                      <div className={`flex items-center gap-2 ${dim.color}`}>
                        {dim.icon}
                        <span className="font-medium text-sm">{dim.label}</span>
                      </div>
                      <span className={`text-xs font-medium ${statusColor}`}>{status}</span>
                    </div>
                    <p className="text-xs text-gray-500 mb-2">{dim.description}</p>
                    <div className="flex items-center gap-3">
                      <div className="h-2.5 flex-1 bg-lattice-deep rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${dimBgColor(adjustedVal)}`}
                          style={{ width: `${dim.value * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-mono font-bold text-gray-300 w-14 text-right">
                        {(dim.value * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Historical Trend (from events data) */}
          {eventList.length > 2 && (
            <div className="panel p-4">
              <h2 className="font-semibold mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-neon-green" />
                Recent Trends
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {dimValues.map((dim) => {
                  // Extract historical values from events if they contain state snapshots
                  const recentEvents = eventList.slice(-10);
                  const vals = recentEvents
                    .map((evt: Record<string, unknown>) => {
                      const st = evt.state || evt.after_state || evt.dimensions;
                      if (st && typeof st === 'object')
                        return typeof (st as Record<string, unknown>)[dim.key] === 'number'
                          ? ((st as Record<string, unknown>)[dim.key] as number)
                          : null;
                      return null;
                    })
                    .filter((v): v is number => v != null);

                  if (vals.length < 2) return null;

                  const first = vals[0];
                  const last = vals[vals.length - 1];
                  const delta = last - first;

                  return (
                    <div key={dim.key} className="lens-card flex items-center gap-3">
                      <div className={`${dim.color}`}>{dim.icon}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-400">{dim.label}</p>
                        <p className="text-sm font-mono font-bold">
                          {(last * 100).toFixed(0)}%
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {delta > 0.01 ? (
                          <TrendingUp className="w-3.5 h-3.5 text-green-400" />
                        ) : delta < -0.01 ? (
                          <TrendingDown className="w-3.5 h-3.5 text-red-400" />
                        ) : (
                          <Minus className="w-3.5 h-3.5 text-gray-400" />
                        )}
                        <span
                          className={`text-xs font-mono ${
                            delta > 0.01
                              ? 'text-green-400'
                              : delta < -0.01
                                ? 'text-red-400'
                                : 'text-gray-400'
                          }`}
                        >
                          {delta > 0 ? '+' : ''}
                          {(delta * 100).toFixed(1)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* === TAB: Event Log === */}
      {activeTab === 'events' && (
        <div className="space-y-6">
          {/* Filters */}
          <div className="panel p-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-400">Filters:</span>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Event Type</label>
                <select
                  value={eventFilter}
                  onChange={(e) => setEventFilter(e.target.value)}
                  className="input-lattice text-sm"
                >
                  <option value="all">All Types</option>
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Dimension</label>
                <select
                  value={eventDimFilter}
                  onChange={(e) => setEventDimFilter(e.target.value)}
                  className="input-lattice text-sm"
                >
                  <option value="all">All Dimensions</option>
                  {DIMS.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ml-auto text-xs text-gray-500">
                Showing {filteredEvents.length} of {eventList.length} events
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-neon-green" />
              Event Timeline
            </h2>
            {filteredEvents.length > 0 ? (
              <div className="space-y-1 max-h-[32rem] overflow-y-auto">
                {[...filteredEvents]
                  .reverse()
                  .slice(0, 50)
                  .map((evt: Record<string, unknown>, i: number) => {
                    const isExpanded = expandedEvent === i;
                    return (
                      <div key={i} className="lens-card text-sm">
                        <div
                          className="flex items-center gap-3 cursor-pointer"
                          onClick={() => setExpandedEvent(isExpanded ? null : i)}
                        >
                          <div className="w-1 h-8 rounded-full bg-gray-700 shrink-0 relative">
                            <div
                              className={`absolute inset-0 rounded-full ${
                                (typeof evt.intensity === 'number' ? evt.intensity : 0.5) > 0.7
                                  ? 'bg-red-500'
                                  : (typeof evt.intensity === 'number' ? evt.intensity : 0.5) > 0.4
                                    ? 'bg-yellow-500'
                                    : 'bg-green-500'
                              }`}
                              style={{
                                top: `${(1 - (typeof evt.intensity === 'number' ? evt.intensity : 0.5)) * 100}%`,
                              }}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-xs font-mono font-medium px-2 py-0.5 rounded ${eventTypeColor(
                                  String(evt.type)
                                )}`}
                              >
                                {String(evt.type)}
                              </span>
                              <span className="text-xs text-gray-500">
                                i={typeof evt.intensity === 'number' ? evt.intensity.toFixed(2) : '--'}{' '}
                                p={typeof evt.polarity === 'number' ? evt.polarity.toFixed(2) : '--'}
                              </span>
                            </div>
                            {!!(evt.trigger || evt.cause || evt.description) && (
                              <p className="text-xs text-gray-400 mt-0.5 truncate">
                                {String(evt.trigger || evt.cause || evt.description)}
                              </p>
                            )}
                          </div>
                          <span className="text-xs text-gray-500 shrink-0">
                            {formatTimeShort(evt.timestamp || evt.created_at || evt.time)}
                          </span>
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                          )}
                        </div>
                        {isExpanded && (
                          <div className="mt-2 pt-2 border-t border-gray-700/30 space-y-1 text-xs">
                            {Object.entries(evt)
                              .filter(
                                ([k]) => !['type', 'intensity', 'polarity'].includes(k)
                              )
                              .map(([k, v]) => (
                                <div key={k} className="flex justify-between">
                                  <span className="text-gray-500">{k.replace(/_/g, ' ')}</span>
                                  <span className="font-mono text-gray-400 max-w-[60%] text-right truncate">
                                    {typeof v === 'number'
                                      ? v.toFixed(3)
                                      : typeof v === 'object'
                                        ? JSON.stringify(v)
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
              <p className="text-center py-8 text-gray-500 text-sm">
                {eventList.length === 0
                  ? 'No events recorded yet. Emit an event to see the timeline.'
                  : 'No events match the current filters.'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* === TAB: Policy === */}
      {activeTab === 'policy' && (
        <div className="space-y-6">
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-neon-purple" />
              Affect Policies
            </h2>
            <p className="text-sm text-gray-400 mb-4">
              Policies govern how the emotional state responds to events. They define thresholds, dampening factors, and regulatory behaviors.
            </p>
            {Object.keys(policyData).length > 0 ? (
              <div className="space-y-4">
                {Object.entries(policyData).map(([category, values]) => {
                  const isObj = typeof values === 'object' && values !== null && !Array.isArray(values);
                  const isArr = Array.isArray(values);

                  return (
                    <div key={category} className="lens-card">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wider">
                          {category.replace(/_/g, ' ')}
                        </h3>
                        {isObj && (
                          <span className="text-xs text-gray-500">
                            {Object.keys(values as object).length} settings
                          </span>
                        )}
                      </div>
                      {isObj && (
                        <div className="space-y-2">
                          {Object.entries(values as Record<string, unknown>).map(
                            ([key, val]) => {
                              const isBoolean = typeof val === 'boolean';
                              const isNumber = typeof val === 'number';
                              return (
                                <div
                                  key={key}
                                  className="flex items-center justify-between py-1.5 border-b border-gray-700/20 last:border-0"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm text-gray-300">
                                      {key.replace(/_/g, ' ')}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {isBoolean ? (
                                      <button
                                        onClick={() => togglePolicy.mutate({ category, key, newValue: !val })}
                                        disabled={togglePolicy.isPending}
                                        className="flex items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity disabled:opacity-50"
                                        title={`Click to toggle ${key.replace(/_/g, ' ')} ${val ? 'off' : 'on'}`}
                                      >
                                        {val ? (
                                          <ToggleRight className="w-5 h-5 text-green-400" />
                                        ) : (
                                          <ToggleLeft className="w-5 h-5 text-gray-500" />
                                        )}
                                        <span
                                          className={`text-xs font-medium ${
                                            val ? 'text-green-400' : 'text-gray-500'
                                          }`}
                                        >
                                          {val ? 'ON' : 'OFF'}
                                        </span>
                                      </button>
                                    ) : isNumber ? (
                                      <div className="flex items-center gap-2">
                                        <div className="w-16 h-1.5 bg-lattice-deep rounded-full overflow-hidden">
                                          <div
                                            className="h-full rounded-full bg-neon-cyan"
                                            style={{
                                              width: `${clamp(val as number, 0, 1) * 100}%`,
                                            }}
                                          />
                                        </div>
                                        <span className="font-mono text-sm text-neon-cyan">
                                          {(val as number).toFixed(3)}
                                        </span>
                                      </div>
                                    ) : (
                                      <span className="font-mono text-sm text-neon-cyan">
                                        {String(val)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            }
                          )}
                        </div>
                      )}
                      {isArr && (
                        <div className="space-y-1">
                          {(values as unknown[]).map((item, j) => (
                            <div
                              key={j}
                              className="text-sm p-2 bg-lattice-deep rounded text-gray-300"
                            >
                              {typeof item === 'string'
                                ? item
                                : typeof item === 'object' && item !== null
                                  ? Object.entries(item as Record<string, unknown>).map(([k, v]) => (
                                      <span key={k} className="mr-3">
                                        <span className="text-gray-500">{k}: </span>
                                        <span className="font-mono text-neon-cyan">
                                          {typeof v === 'boolean'
                                            ? v
                                              ? 'ON'
                                              : 'OFF'
                                            : String(v)}
                                        </span>
                                      </span>
                                    ))
                                  : String(item)}
                            </div>
                          ))}
                        </div>
                      )}
                      {!isObj && !isArr && (
                        <p className="font-mono text-sm text-neon-cyan">
                          {typeof values === 'boolean'
                            ? values
                              ? 'Enabled'
                              : 'Disabled'
                            : String(values)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-center py-8 text-gray-500 text-sm">
                No affect policies configured for this session. Policies will appear as the system initializes.
              </p>
            )}
          </div>
        </div>
      )}

      {/* === TAB: Health === */}
      {activeTab === 'health' && (
        <div className="space-y-6">
          {/* Overall Health Score */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Gauge className="w-4 h-4 text-neon-green" />
              Overall Emotional Health
            </h2>
            {overallScore != null ? (
              <div className="space-y-4">
                <div className="flex items-center gap-6">
                  {/* Score gauge */}
                  <div className="relative w-32 h-32 shrink-0">
                    <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                      <circle
                        cx="50"
                        cy="50"
                        r="42"
                        fill="none"
                        stroke="rgba(255,255,255,0.05)"
                        strokeWidth="8"
                      />
                      <circle
                        cx="50"
                        cy="50"
                        r="42"
                        fill="none"
                        stroke={
                          overallScore >= 0.65
                            ? '#4ade80'
                            : overallScore >= 0.35
                              ? '#facc15'
                              : '#f87171'
                        }
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={`${overallScore * 264} 264`}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span
                        className={`text-2xl font-bold font-mono ${
                          overallScore >= 0.65
                            ? 'text-green-400'
                            : overallScore >= 0.35
                              ? 'text-yellow-400'
                              : 'text-red-400'
                        }`}
                      >
                        {(overallScore * 100).toFixed(0)}%
                      </span>
                      <span className="text-xs text-gray-500">Health</span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-2">
                    <p className="text-sm text-gray-400">
                      {overallScore >= 0.65
                        ? 'Emotional state is in a healthy range. All dimensions are operating within normal parameters.'
                        : overallScore >= 0.35
                          ? 'Emotional state shows some areas of concern. Monitor affected dimensions.'
                          : 'Emotional health is compromised. Immediate attention recommended for low-scoring dimensions.'}
                    </p>
                    {/* Compact dimension summary */}
                    <div className="grid grid-cols-4 gap-2">
                      {dimValues.map((dim) => {
                        const adj = dim.key === 'f' ? 1 - dim.value : dim.value;
                        return (
                          <div key={dim.key} className="text-center">
                            <div className={`text-xs ${dim.color}`}>{dim.label}</div>
                            <div
                              className={`text-sm font-mono font-bold ${
                                adj >= 0.65
                                  ? 'text-green-400'
                                  : adj >= 0.35
                                    ? 'text-yellow-400'
                                    : 'text-red-400'
                              }`}
                            >
                              {(dim.value * 100).toFixed(0)}%
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-center py-6 text-gray-500 text-sm">
                Health score will be computed once dimensional data is available.
              </p>
            )}
          </div>

          {/* Warning Indicators */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-neon-yellow" />
              Warning Indicators
              {warnings.length > 0 && (
                <span className="ml-auto text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">
                  {warnings.length}
                </span>
              )}
            </h2>
            {warnings.length > 0 ? (
              <div className="space-y-2">
                {warnings.map((w, i) => (
                  <div
                    key={i}
                    className={`p-3 rounded-lg border-l-4 flex items-center gap-3 ${
                      w.severity === 'critical'
                        ? 'border-l-red-500 bg-red-500/5'
                        : 'border-l-yellow-500 bg-yellow-500/5'
                    }`}
                  >
                    <AlertTriangle
                      className={`w-4 h-4 shrink-0 ${
                        w.severity === 'critical' ? 'text-red-400' : 'text-yellow-400'
                      }`}
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-300">{w.message}</p>
                      <p className="text-xs text-gray-500">Dimension: {w.dimension}</p>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        w.severity === 'critical'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-yellow-500/20 text-yellow-400'
                      }`}
                    >
                      {w.severity}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <Shield className="w-8 h-8 text-green-400 mx-auto mb-2" />
                <p className="text-sm text-green-400 font-medium">All Clear</p>
                <p className="text-xs text-gray-500 mt-1">
                  All dimensions are within acceptable ranges.
                </p>
              </div>
            )}
          </div>

          {/* Recovery Recommendations */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Zap className="w-4 h-4 text-neon-cyan" />
              Recovery Recommendations
            </h2>
            {recoveryRecommendations.length > 0 ? (
              <div className="space-y-2">
                {recoveryRecommendations.map((rec, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 p-3 bg-cyan-500/5 border border-cyan-500/10 rounded-lg"
                  >
                    <div className="w-6 h-6 rounded-full bg-neon-cyan/20 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-xs font-bold text-neon-cyan">{i + 1}</span>
                    </div>
                    <p className="text-sm text-gray-300">{rec}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center py-6 text-gray-500 text-sm">
                No recovery actions needed. Emotional state is healthy.
              </p>
            )}
          </div>

          {/* Raw Health Data */}
          {Object.keys(healthData).length > 0 && (
            <div className="panel p-4">
              <h2 className="font-semibold mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-gray-400" />
                System Health Details
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(healthData)
                  .filter(
                    ([k]) =>
                      ![
                        'healthy',
                        'score',
                        'overall_score',
                        'warnings',
                        'alerts',
                        'recommendations',
                        'recovery',
                      ].includes(k)
                  )
                  .map(([key, val]) => (
                    <div key={key} className="lens-card">
                      <p className="text-xs text-gray-400 uppercase truncate">
                        {key.replace(/_/g, ' ')}
                      </p>
                      <p className="text-lg font-bold font-mono">
                        {typeof val === 'number'
                          ? val.toFixed(3)
                          : typeof val === 'boolean'
                            ? val
                              ? 'Yes'
                              : 'No'
                            : String(val)}
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          )}

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="affect"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
        </div>
      )}

      {/* === TAB: Analysis Tools === */}
      {activeTab === 'analysis' && (
        <div className="space-y-6">
          {/* Intro */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-2 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-neon-pink" />
              Affect Analysis Engine
            </h2>
            <p className="text-sm text-gray-400">
              Run domain-specific analysis actions against the current affect state snapshot.
              Each tool calls the backend computation engine and returns structured results.
            </p>
            {!bridge.selectedId && (
              <div className="mt-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                No artifact synced yet. Affect state will sync automatically once dimensional data loads.
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* --- Sentiment Analysis Panel --- */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="panel p-4 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold flex items-center gap-2">
                  <Heart className="w-4 h-4 text-pink-400" />
                  Sentiment Analysis
                </h2>
                <button
                  onClick={() => handleAnalysisAction('sentimentAnalysis', setSentimentResult)}
                  disabled={isRunning !== null || !bridge.selectedId}
                  className="btn-neon text-xs flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isRunning === 'sentimentAnalysis' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Heart className="w-3.5 h-3.5" />
                  )}
                  {isRunning === 'sentimentAnalysis' ? 'Analyzing...' : 'Analyze Sentiment'}
                </button>
              </div>
              <p className="text-xs text-gray-500">
                Multi-dimensional VAD (Valence-Arousal-Dominance) sentiment scoring with sarcasm detection and emotion classification.
              </p>

              {sentimentResult && !('message' in sentimentResult) ? (
                <div className="space-y-3">
                  {/* Sentiment Label & Primary Emotion */}
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-bold uppercase px-3 py-1 rounded-full ${
                      sentimentResult.sentimentLabel === 'positive'
                        ? 'bg-green-500/20 text-green-400'
                        : sentimentResult.sentimentLabel === 'negative'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-gray-500/20 text-gray-400'
                    }`}>
                      {String(sentimentResult.sentimentLabel)}
                    </span>
                    <span className="text-xs text-gray-500">Primary:</span>
                    <span className="text-sm font-medium text-neon-cyan capitalize">
                      {String(sentimentResult.primaryEmotion)}
                    </span>
                    {!!sentimentResult.isMixedEmotion && (
                      <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full">
                        Mixed
                      </span>
                    )}
                  </div>

                  {/* VAD Scores */}
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">VAD Model Scores</p>
                    {(() => {
                      const vad = sentimentResult.vad as Record<string, number> | undefined;
                      if (!vad) return null;
                      const dims = [
                        { key: 'valence', label: 'Valence', color: 'bg-pink-500', desc: 'Positive vs Negative' },
                        { key: 'arousal', label: 'Arousal', color: 'bg-orange-500', desc: 'Calm vs Excited' },
                        { key: 'dominance', label: 'Dominance', color: 'bg-purple-500', desc: 'Submissive vs Dominant' },
                      ];
                      return dims.map((d) => (
                        <div key={d.key} className="flex items-center gap-3">
                          <span className="text-xs text-gray-400 w-20">{d.label}</span>
                          <div className="flex-1 h-2 bg-lattice-deep rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${(vad[d.key] || 0) * 100}%` }}
                              transition={{ duration: 0.5 }}
                              className={`h-full rounded-full ${d.color}`}
                            />
                          </div>
                          <span className="text-xs font-mono text-gray-300 w-12 text-right">
                            {((vad[d.key] || 0) * 100).toFixed(1)}%
                          </span>
                        </div>
                      ));
                    })()}
                  </div>

                  {/* Stats Row */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="lens-card text-center">
                      <p className="text-xs text-gray-500">Tokens</p>
                      <p className="text-sm font-mono font-bold">{String(sentimentResult.tokenCount)}</p>
                    </div>
                    <div className="lens-card text-center">
                      <p className="text-xs text-gray-500">Matched</p>
                      <p className="text-sm font-mono font-bold">{String(sentimentResult.matchedTokens)}</p>
                    </div>
                    <div className="lens-card text-center">
                      <p className="text-xs text-gray-500">Coverage</p>
                      <p className="text-sm font-mono font-bold">{String(sentimentResult.coverage)}%</p>
                    </div>
                  </div>

                  {/* Emotion Keywords */}
                  {Array.isArray(sentimentResult.emotionHits) && (sentimentResult.emotionHits as Array<Record<string, unknown>>).length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 font-medium mb-2">Detected Emotion Words</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(sentimentResult.emotionHits as Array<Record<string, unknown>>).slice(0, 20).map((hit, i) => (
                          <span
                            key={i}
                            className={`text-xs px-2 py-0.5 rounded-full font-mono ${
                              (hit.valence as number) >= 0.65
                                ? 'bg-green-500/15 text-green-400'
                                : (hit.valence as number) <= 0.35
                                  ? 'bg-red-500/15 text-red-400'
                                  : 'bg-gray-500/15 text-gray-400'
                            } ${hit.negated ? 'line-through opacity-60' : ''}`}
                          >
                            {String(hit.word)}
                            {!!hit.negated && <span className="ml-1 text-yellow-400 no-underline">(neg)</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Sarcasm Indicators */}
                  {Array.isArray(sentimentResult.sarcasmIndicators) && (sentimentResult.sarcasmIndicators as Array<Record<string, unknown>>).length > 0 && (
                    <div className="p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/15">
                      <p className="text-xs font-medium text-yellow-400 mb-1.5 flex items-center gap-1.5">
                        <AlertTriangle className="w-3 h-3" />
                        Sarcasm Detected ({String(sentimentResult.sarcasmLikelihood)} likelihood)
                      </p>
                      {(sentimentResult.sarcasmIndicators as Array<Record<string, unknown>>).map((ind, i) => (
                        <p key={i} className="text-xs text-gray-400 ml-5">
                          {String(ind.detail)}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ) : sentimentResult && 'message' in sentimentResult ? (
                <p className="text-sm text-gray-500 py-4 text-center">{String(sentimentResult.message)}</p>
              ) : (
                <div className="text-center py-6 text-gray-600">
                  <Heart className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">Click &quot;Analyze Sentiment&quot; to run VAD analysis</p>
                </div>
              )}
            </motion.div>

            {/* --- Emotion Timeline Panel --- */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="panel p-4 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold flex items-center gap-2">
                  <Clock className="w-4 h-4 text-neon-green" />
                  Emotion Timeline
                </h2>
                <button
                  onClick={() => handleAnalysisAction('emotionTimeline', setTimelineResult)}
                  disabled={isRunning !== null || !bridge.selectedId}
                  className="btn-neon text-xs flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isRunning === 'emotionTimeline' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Clock className="w-3.5 h-3.5" />
                  )}
                  {isRunning === 'emotionTimeline' ? 'Tracking...' : 'Build Timeline'}
                </button>
              </div>
              <p className="text-xs text-gray-500">
                Track emotional valence changes over time. Detects emotional arcs (rags-to-riches, tragedy, etc.) and turning points.
              </p>

              {timelineResult && !('message' in timelineResult) ? (
                <div className="space-y-4">
                  {/* Arc Type & Summary */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-bold uppercase px-3 py-1 rounded-full bg-neon-green/20 text-neon-green">
                      {String(timelineResult.arcType).replace(/-/g, ' ')}
                    </span>
                    <span className="text-xs text-gray-500">
                      {String(timelineResult.entryCount)} entries analyzed
                    </span>
                    <span className="text-xs text-gray-500">
                      Volatility: <span className="font-mono text-gray-300">{String(timelineResult.volatility)}</span>
                    </span>
                  </div>

                  {/* Mini Timeline Chart */}
                  {Array.isArray(timelineResult.smoothedValence) && (timelineResult.smoothedValence as number[]).length > 1 && (
                    <div className="bg-lattice-deep rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-2">Smoothed Valence Over Time</p>
                      <div className="h-24 flex items-end gap-[2px]">
                        {(timelineResult.smoothedValence as number[]).map((val, i) => {
                          const normalized = (val + 1) / 2; // -1..1 -> 0..1
                          const height = Math.max(4, normalized * 100);
                          return (
                            <div
                              key={i}
                              className="flex-1 rounded-t transition-all"
                              style={{
                                height: `${height}%`,
                                backgroundColor: val > 0.15
                                  ? 'rgba(74, 222, 128, 0.6)'
                                  : val < -0.15
                                    ? 'rgba(248, 113, 113, 0.6)'
                                    : 'rgba(156, 163, 175, 0.4)',
                              }}
                              title={`Entry ${i}: ${val.toFixed(3)}`}
                            />
                          );
                        })}
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-[10px] text-gray-600">Start</span>
                        <span className="text-[10px] text-gray-600">End</span>
                      </div>
                    </div>
                  )}

                  {/* Arc Segments */}
                  {!!timelineResult.arcSegments && (
                    <div className="grid grid-cols-3 gap-2">
                      {Object.entries(timelineResult.arcSegments as Record<string, number>).map(([seg, val]) => {
                        const arrow = val > 0.1
                          ? <ArrowUpRight className="w-3.5 h-3.5 text-green-400" />
                          : val < -0.1
                            ? <ArrowDownRight className="w-3.5 h-3.5 text-red-400" />
                            : <ArrowRight className="w-3.5 h-3.5 text-gray-400" />;
                        return (
                          <div key={seg} className="lens-card text-center">
                            <p className="text-xs text-gray-500 capitalize">{seg}</p>
                            <div className="flex items-center justify-center gap-1">
                              {arrow}
                              <span className={`text-sm font-mono font-bold ${
                                val > 0.1 ? 'text-green-400' : val < -0.1 ? 'text-red-400' : 'text-gray-400'
                              }`}>
                                {val.toFixed(3)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Turning Points */}
                  {Array.isArray(timelineResult.turningPoints) && (timelineResult.turningPoints as Array<Record<string, unknown>>).length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 font-medium mb-2">Turning Points</p>
                      <div className="space-y-1">
                        {(timelineResult.turningPoints as Array<Record<string, unknown>>).map((tp, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            {tp.type === 'peak' ? (
                              <TrendingUp className="w-3 h-3 text-green-400" />
                            ) : (
                              <TrendingDown className="w-3 h-3 text-red-400" />
                            )}
                            <span className="text-gray-400">
                              Entry #{String(tp.index)}
                            </span>
                            <span className={`font-mono ${
                              tp.type === 'peak' ? 'text-green-400' : 'text-red-400'
                            }`}>
                              {String(tp.type)} ({Number(tp.valence).toFixed(3)})
                            </span>
                            <span className="text-gray-600">
                              magnitude: {Number(tp.magnitude).toFixed(3)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Overall Stats */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="lens-card text-center">
                      <p className="text-xs text-gray-500">Overall Valence</p>
                      <p className={`text-sm font-mono font-bold ${
                        (timelineResult.overallValence as number) > 0.1
                          ? 'text-green-400'
                          : (timelineResult.overallValence as number) < -0.1
                            ? 'text-red-400'
                            : 'text-gray-400'
                      }`}>
                        {String(timelineResult.overallValence)}
                      </p>
                    </div>
                    <div className="lens-card text-center">
                      <p className="text-xs text-gray-500">Overall Intensity</p>
                      <p className="text-sm font-mono font-bold text-orange-400">
                        {String(timelineResult.overallIntensity)}
                      </p>
                    </div>
                  </div>
                </div>
              ) : timelineResult && 'message' in timelineResult ? (
                <p className="text-sm text-gray-500 py-4 text-center">{String(timelineResult.message)}</p>
              ) : (
                <div className="text-center py-6 text-gray-600">
                  <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">Click &quot;Build Timeline&quot; to trace emotional arcs</p>
                </div>
              )}
            </motion.div>

            {/* --- Empathy Map Panel --- */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="panel p-4 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold flex items-center gap-2">
                  <Users className="w-4 h-4 text-neon-cyan" />
                  Empathy Map
                </h2>
                <button
                  onClick={() => handleAnalysisAction('empathyMap', setEmpathyResult)}
                  disabled={isRunning !== null || !bridge.selectedId}
                  className="btn-neon text-xs flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isRunning === 'empathyMap' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Users className="w-3.5 h-3.5" />
                  )}
                  {isRunning === 'empathyMap' ? 'Mapping...' : 'Build Empathy Map'}
                </button>
              </div>
              <p className="text-xs text-gray-500">
                Categorize feedback into Think/Feel/Say/Do quadrants. Identifies pain points, gains, and recurring themes.
              </p>

              {empathyResult && !('message' in empathyResult) ? (
                <div className="space-y-4">
                  {/* Feedback Summary */}
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span>{String(empathyResult.totalFeedback)} feedback items analyzed</span>
                    {!!empathyResult.analyzedAt && (
                      <span className="text-gray-600">{new Date(String(empathyResult.analyzedAt)).toLocaleTimeString()}</span>
                    )}
                  </div>

                  {/* Empathy Map Quadrants */}
                  {!!empathyResult.quadrants && (
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { key: 'thinks', label: 'Thinks', icon: <Brain className="w-3.5 h-3.5" />, color: 'text-blue-400', borderColor: 'border-blue-500/30', bgColor: 'bg-blue-500/5' },
                        { key: 'feels', label: 'Feels', icon: <Heart className="w-3.5 h-3.5" />, color: 'text-pink-400', borderColor: 'border-pink-500/30', bgColor: 'bg-pink-500/5' },
                        { key: 'says', label: 'Says', icon: <MessageSquare className="w-3.5 h-3.5" />, color: 'text-green-400', borderColor: 'border-green-500/30', bgColor: 'bg-green-500/5' },
                        { key: 'does', label: 'Does', icon: <Hand className="w-3.5 h-3.5" />, color: 'text-orange-400', borderColor: 'border-orange-500/30', bgColor: 'bg-orange-500/5' },
                      ].map((q) => {
                        const qData = (empathyResult.quadrants as Record<string, Record<string, unknown>>)[q.key];
                        const items = Array.isArray(qData?.items) ? qData.items as Array<Record<string, unknown>> : [];
                        return (
                          <div key={q.key} className={`rounded-lg border p-3 ${q.borderColor} ${q.bgColor}`}>
                            <div className={`flex items-center gap-1.5 mb-2 ${q.color}`}>
                              {q.icon}
                              <span className="text-xs font-bold uppercase tracking-wider">{q.label}</span>
                              <span className="ml-auto text-xs text-gray-500">{String(qData?.count || 0)}</span>
                            </div>
                            {items.length > 0 ? (
                              <div className="space-y-1 max-h-32 overflow-y-auto">
                                {items.slice(0, 5).map((item, j) => (
                                  <p key={j} className="text-xs text-gray-400 truncate">
                                    {String(item.text || '')}
                                  </p>
                                ))}
                                {items.length > 5 && (
                                  <p className="text-xs text-gray-600">+{items.length - 5} more</p>
                                )}
                              </div>
                            ) : (
                              <p className="text-xs text-gray-600 italic">No items</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Pain Points & Gains */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs font-medium text-red-400 mb-2 flex items-center gap-1">
                        <TrendingDown className="w-3 h-3" />
                        Pain Points ({String((empathyResult.summary as Record<string, unknown>)?.totalPainPoints || 0)})
                      </p>
                      {Array.isArray(empathyResult.painPoints) && (empathyResult.painPoints as Array<Record<string, unknown>>).length > 0 ? (
                        <div className="space-y-1.5">
                          {(empathyResult.painPoints as Array<Record<string, unknown>>).slice(0, 5).map((pp, i) => (
                            <div key={i} className="text-xs p-2 bg-red-500/5 rounded border border-red-500/10">
                              <p className="text-gray-400 truncate">{String(pp.text)}</p>
                              <div className="flex gap-1 mt-1 flex-wrap">
                                {Array.isArray(pp.keywords) && (pp.keywords as string[]).map((kw, k) => (
                                  <span key={k} className="text-[10px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">
                                    {kw}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-600 italic">None detected</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-green-400 mb-2 flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" />
                        Gains ({String((empathyResult.summary as Record<string, unknown>)?.totalGains || 0)})
                      </p>
                      {Array.isArray(empathyResult.gains) && (empathyResult.gains as Array<Record<string, unknown>>).length > 0 ? (
                        <div className="space-y-1.5">
                          {(empathyResult.gains as Array<Record<string, unknown>>).slice(0, 5).map((g, i) => (
                            <div key={i} className="text-xs p-2 bg-green-500/5 rounded border border-green-500/10">
                              <p className="text-gray-400 truncate">{String(g.text)}</p>
                              <div className="flex gap-1 mt-1 flex-wrap">
                                {Array.isArray(g.keywords) && (g.keywords as string[]).map((kw, k) => (
                                  <span key={k} className="text-[10px] text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">
                                    {kw}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-600 italic">None detected</p>
                      )}
                    </div>
                  </div>

                  {/* Top Themes */}
                  {Array.isArray(empathyResult.topThemes) && (empathyResult.topThemes as Array<Record<string, unknown>>).length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 font-medium mb-2">Top Themes</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(empathyResult.topThemes as Array<Record<string, unknown>>).map((theme, i) => (
                          <span key={i} className="text-xs bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded-full">
                            {String(theme.phrase)} ({String(theme.count)})
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Sentiment Balance */}
                  {!!empathyResult.summary && (
                    <div className="flex items-center gap-4 p-3 bg-lattice-deep rounded-lg text-xs">
                      <div className="text-center">
                        <p className="text-gray-500">Balance</p>
                        <p className={`font-mono font-bold ${
                          ((empathyResult.summary as Record<string, unknown>).sentimentBalance as number) > 0
                            ? 'text-green-400'
                            : ((empathyResult.summary as Record<string, unknown>).sentimentBalance as number) < 0
                              ? 'text-red-400'
                              : 'text-gray-400'
                        }`}>
                          {((empathyResult.summary as Record<string, unknown>).sentimentBalance as number) > 0 ? '+' : ''}
                          {String((empathyResult.summary as Record<string, unknown>).sentimentBalance)}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-gray-500">Avg Pain</p>
                        <p className="font-mono font-bold text-red-400">
                          {String((empathyResult.summary as Record<string, unknown>).avgPainScore)}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-gray-500">Avg Gain</p>
                        <p className="font-mono font-bold text-green-400">
                          {String((empathyResult.summary as Record<string, unknown>).avgGainScore)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ) : empathyResult && 'message' in empathyResult ? (
                <p className="text-sm text-gray-500 py-4 text-center">{String(empathyResult.message)}</p>
              ) : (
                <div className="text-center py-6 text-gray-600">
                  <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">Click &quot;Build Empathy Map&quot; to categorize feedback</p>
                </div>
              )}
            </motion.div>

            {/* --- Pattern Detection Panel --- */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="panel p-4 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold flex items-center gap-2">
                  <Search className="w-4 h-4 text-neon-purple" />
                  Pattern Detection
                </h2>
                <button
                  onClick={() => handleAnalysisAction('detect-patterns', setPatternResult)}
                  disabled={isRunning !== null || !bridge.selectedId}
                  className="btn-neon text-xs flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isRunning === 'detect-patterns' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Search className="w-3.5 h-3.5" />
                  )}
                  {isRunning === 'detect-patterns' ? 'Detecting...' : 'Detect Patterns'}
                </button>
              </div>
              <p className="text-xs text-gray-500">
                Identify emotional triggers, cycles, and correlations across affect data using the brain analysis engine.
              </p>

              {patternResult && !('message' in patternResult) ? (
                <div className="space-y-3">
                  {/* Patterns List */}
                  {Array.isArray(patternResult.patterns) && (patternResult.patterns as Array<Record<string, unknown>>).length > 0 ? (
                    <div className="space-y-2">
                      {(patternResult.patterns as Array<Record<string, unknown>>).map((pattern, i) => (
                        <div key={i} className="lens-card">
                          <div className="flex items-start gap-2">
                            <Sparkles className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
                              pattern.severity === 'high' || pattern.importance === 'high'
                                ? 'text-red-400'
                                : pattern.severity === 'medium' || pattern.importance === 'medium'
                                  ? 'text-yellow-400'
                                  : 'text-purple-400'
                            }`} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-300">
                                {String(pattern.name || pattern.label || pattern.type || `Pattern ${i + 1}`)}
                              </p>
                              {!!(pattern.description || pattern.detail) && (
                                <p className="text-xs text-gray-500 mt-0.5">
                                  {String(pattern.description || pattern.detail)}
                                </p>
                              )}
                              {!!pattern.frequency && (
                                <span className="text-[10px] text-gray-600 mt-1 block">
                                  Frequency: {String(pattern.frequency)}
                                </span>
                              )}
                            </div>
                            {!!(pattern.confidence || pattern.score) && (
                              <span className="text-xs font-mono text-neon-purple shrink-0">
                                {typeof pattern.confidence === 'number'
                                  ? `${(pattern.confidence * 100).toFixed(0)}%`
                                  : typeof pattern.score === 'number'
                                    ? `${(pattern.score * 100).toFixed(0)}%`
                                    : String(pattern.confidence || pattern.score)}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {/* Triggers */}
                  {Array.isArray(patternResult.triggers) && (patternResult.triggers as Array<Record<string, unknown>>).length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 font-medium mb-2">Emotional Triggers</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(patternResult.triggers as Array<Record<string, unknown>>).map((trigger, i) => (
                          <span key={i} className="text-xs bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full">
                            {String(trigger.name || trigger.label || trigger)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Cycles */}
                  {Array.isArray(patternResult.cycles) && (patternResult.cycles as Array<Record<string, unknown>>).length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 font-medium mb-2">Emotional Cycles</p>
                      <div className="space-y-1.5">
                        {(patternResult.cycles as Array<Record<string, unknown>>).map((cycle, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs p-2 bg-purple-500/5 rounded border border-purple-500/10">
                            <RefreshCw className="w-3 h-3 text-purple-400 shrink-0" />
                            <span className="text-gray-400">{String(cycle.description || cycle.name || `Cycle ${i + 1}`)}</span>
                            {!!cycle.period && (
                              <span className="ml-auto text-gray-600 font-mono">{String(cycle.period)}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Correlations */}
                  {Array.isArray(patternResult.correlations) && (patternResult.correlations as Array<Record<string, unknown>>).length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 font-medium mb-2">Correlations</p>
                      <div className="space-y-1">
                        {(patternResult.correlations as Array<Record<string, unknown>>).map((corr, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <Activity className="w-3 h-3 text-cyan-400" />
                            <span className="text-gray-400">
                              {String(corr.description || corr.name || `${corr.from || ''} -> ${corr.to || ''}`)}
                            </span>
                            {typeof corr.strength === 'number' && (
                              <span className="ml-auto font-mono text-cyan-400">
                                r={corr.strength.toFixed(2)}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Summary / Raw fallback for arbitrary result shapes */}
                  {!!patternResult.summary && typeof patternResult.summary === 'string' && (
                    <p className="text-xs text-gray-400 p-3 bg-lattice-deep rounded-lg">
                      {String(patternResult.summary)}
                    </p>
                  )}

                  {/* If result has no known sub-fields, show key-value pairs */}
                  {!patternResult.patterns && !patternResult.triggers && !patternResult.cycles && !patternResult.correlations && (
                    <div className="space-y-1.5">
                      {Object.entries(patternResult)
                        .filter(([k]) => k !== 'analyzedAt')
                        .map(([key, val]) => (
                          <div key={key} className="flex items-start justify-between gap-3 text-xs py-1 border-b border-gray-700/20 last:border-0">
                            <span className="text-gray-500 capitalize">{key.replace(/[_-]/g, ' ')}</span>
                            <span className="text-gray-300 font-mono text-right max-w-[60%] break-words">
                              {typeof val === 'number'
                                ? val.toFixed(3)
                                : typeof val === 'boolean'
                                  ? val ? 'Yes' : 'No'
                                  : typeof val === 'object'
                                    ? JSON.stringify(val, null, 0)
                                    : String(val)}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              ) : patternResult && 'message' in patternResult ? (
                <p className="text-sm text-gray-500 py-4 text-center">{String(patternResult.message)}</p>
              ) : (
                <div className="text-center py-6 text-gray-600">
                  <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">Click &quot;Detect Patterns&quot; to find emotional triggers and cycles</p>
                </div>
              )}
            </motion.div>
          </div>
        </div>
      )}

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
            <LensFeaturePanel lensId="affect" />
          </div>
        )}
      </div>
    </div>
  );
}
