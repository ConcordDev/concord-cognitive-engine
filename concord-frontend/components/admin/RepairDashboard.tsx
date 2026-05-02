'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Cpu,
  Database,
  Eye,
  Gauge,
  HardDrive,
  Loader2,
  Network,
  RefreshCw,
  Search,
  Send,
  Shield,
  Sparkles,
  TrendingUp,
  XCircle,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';

// -- Types --------------------------------------------------------------------

interface HealthDimension {
  pattern: string;
  confidence: number;
  severity: string;
  details: string;
  samples: number;
}

interface HealthReport {
  healthy: boolean;
  overallSeverity: string;
  timestamp: string;
  dimensions: {
    memory: HealthDimension;
    latency: HealthDimension;
    errors: HealthDimension;
    connections: HealthDimension;
    cpu: HealthDimension;
  };
  unhealthyDimensions: number;
}

interface ProcessMetrics {
  memoryMB: number;
  rssMB: number;
  heapTotalMB: number;
  externalMB: number;
  cpuUser: number;
  cpuSystem: number;
  uptimeSeconds: number;
}

interface StatusResponse {
  ok: boolean;
  health: HealthReport;
  processMetrics: ProcessMetrics;
  summary: {
    totalPatterns: number;
    totalRepairs: number;
    successRate: number;
    totalPredictions: number;
    knowledgeEntries: number;
  };
}

interface Prediction {
  id: string;
  predicted_issue?: string;
  predictedIssue?: string;
  confidence: number;
  time_to_impact?: string;
  timeToImpact?: string;
  preventive_action?: string;
  preventiveAction?: string;
  applied: boolean;
  outcome?: string;
  severity?: string;
  created_at?: string;
  timestamp?: string;
}

interface RepairHistoryEntry {
  id: string;
  issueType: string;
  symptoms: string[];
  severity: string;
  fixApplied: string;
  success: boolean;
  repairTimeMs: number;
  rollbackNeeded: boolean;
  verified: boolean;
  createdAt: string;
}

interface KnowledgeCategory {
  category: string;
  count: number;
  totalSuccesses: number;
  totalFailures: number;
  successRate: number;
}

interface GrowthEntry {
  day: string;
  total: number;
  successes: number;
  failures: number;
}

interface KnowledgeResponse {
  ok: boolean;
  stats: {
    patterns: number;
    repairs: { total: number; successful: number; failed: number; successRate: number };
    predictions: { total: number; applied: number; accuracy: number };
    knowledge: { total: number; byCategory: KnowledgeCategory[] };
    growth: GrowthEntry[];
  };
}

interface DiagnoseResponse {
  ok: boolean;
  diagnosis: {
    id: string;
    classified: boolean;
    primaryIssue: {
      category: string;
      subcategory: string;
      severity: string;
      details: string;
    } | null;
    repairOptions: {
      type: string;
      name: string;
      description: string;
      confidence: number;
      source: string;
    }[];
    optionCount: number;
  };
  repair: { success: boolean; option: string; description: string; repairTimeMs: number } | null;
}

interface RepairDashboardProps {
  className?: string;
  apiBase?: string;
}

// -- Helpers ------------------------------------------------------------------

function severityColor(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'text-red-400';
    case 'high':
      return 'text-orange-400';
    case 'medium':
      return 'text-yellow-400';
    case 'low':
      return 'text-blue-400';
    default:
      return 'text-green-400';
  }
}

function severityBg(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'bg-red-400/10 border-red-400/30';
    case 'high':
      return 'bg-orange-400/10 border-orange-400/30';
    case 'medium':
      return 'bg-yellow-400/10 border-yellow-400/30';
    case 'low':
      return 'bg-blue-400/10 border-blue-400/30';
    default:
      return 'bg-green-400/10 border-green-400/30';
  }
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.8) return 'bg-green-400';
  if (confidence >= 0.6) return 'bg-yellow-400';
  if (confidence >= 0.4) return 'bg-orange-400';
  return 'bg-red-400';
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60000)}m`;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function dimensionIcon(dim: string) {
  switch (dim) {
    case 'memory':
      return <HardDrive className="w-4 h-4" />;
    case 'latency':
      return <Clock className="w-4 h-4" />;
    case 'errors':
      return <AlertTriangle className="w-4 h-4" />;
    case 'connections':
      return <Network className="w-4 h-4" />;
    case 'cpu':
      return <Cpu className="w-4 h-4" />;
    default:
      return <Activity className="w-4 h-4" />;
  }
}

// -- Component ----------------------------------------------------------------

function RepairDashboard({ className, apiBase = '' }: RepairDashboardProps) {
  const [activeTab, setActiveTab] = useState<
    'overview' | 'predictions' | 'history' | 'knowledge' | 'diagnose'
  >('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data state
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [history, setHistory] = useState<RepairHistoryEntry[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeResponse | null>(null);

  // Diagnose form state
  const [diagnoseError, setDiagnoseError] = useState('');
  const [diagnoseCategory, setDiagnoseCategory] = useState('');
  const [diagnoseAutoRepair, setDiagnoseAutoRepair] = useState(false);
  const [diagnoseResult, setDiagnoseResult] = useState<DiagnoseResponse | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);

  // Expanded repair entry
  const [expandedRepairId, setExpandedRepairId] = useState<string | null>(null);

  // -- Data fetching --

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/repair/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.ok) setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch status');
    }
  }, [apiBase]);

  const fetchPredictions = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/repair/predictions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.ok) {
        const active = data.active || [];
        const current = data.currentScan?.predictions || [];
        const combined = [
          ...current,
          ...active.filter((a: Prediction) => !current.some((c: Prediction) => c.id === a.id)),
        ];
        setPredictions(combined);
      }
    } catch {
      // Non-fatal
    }
  }, [apiBase]);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/repair/history?limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.ok) setHistory(data.history || []);
    } catch {
      // Non-fatal
    }
  }, [apiBase]);

  const fetchKnowledge = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/repair/knowledge`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.ok) setKnowledge(data);
    } catch {
      // Non-fatal
    }
  }, [apiBase]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    await Promise.all([fetchStatus(), fetchPredictions(), fetchHistory(), fetchKnowledge()]);
    setLoading(false);
  }, [fetchStatus, fetchPredictions, fetchHistory, fetchKnowledge]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // -- Diagnose handler --

  const handleDiagnose = async () => {
    if (!diagnoseError && !diagnoseCategory) return;
    setDiagnosing(true);
    setDiagnoseResult(null);
    try {
      const res = await fetch(`${apiBase}/api/repair/diagnose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          errorMessage: diagnoseError,
          category: diagnoseCategory,
          autoRepair: diagnoseAutoRepair,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDiagnoseResult(data);
      if (diagnoseAutoRepair) {
        // Refresh data after repair
        await fetchAll();
      }
    } catch {
      setDiagnoseResult({
        ok: false,
        diagnosis: {
          id: '',
          classified: false,
          primaryIssue: null,
          repairOptions: [],
          optionCount: 0,
        },
        repair: null,
      });
    }
    setDiagnosing(false);
  };

  // -- Render sections --

  const tabs = [
    { key: 'overview' as const, label: 'Overview', icon: <Gauge className="w-4 h-4" /> },
    { key: 'predictions' as const, label: 'Predictions', icon: <Eye className="w-4 h-4" /> },
    { key: 'history' as const, label: 'History', icon: <Database className="w-4 h-4" /> },
    { key: 'knowledge' as const, label: 'Knowledge', icon: <Brain className="w-4 h-4" /> },
    { key: 'diagnose' as const, label: 'Diagnose', icon: <Search className="w-4 h-4" /> },
  ];

  if (loading && !status) {
    return (
      <div className={cn('p-6 space-y-6', className)}>
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-neon-cyan" />
          <span className="text-gray-400">Loading repair brain status...</span>
        </div>
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className={cn('p-6 space-y-6', className)}>
        <div className={cn(ds.panel, 'border-red-500/30')}>
          <div className="flex items-center gap-2 text-red-400">
            <XCircle className="w-5 h-5" />
            <span>Failed to connect to repair brain: {error}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('p-6 space-y-6', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-neon-cyan" />
          <h1 className={ds.heading1}>Repair Brain</h1>
          {status?.health && (
            <span
              className={cn(
                'px-2 py-0.5 rounded-full text-xs font-medium border',
                status.health.healthy
                  ? 'bg-green-400/10 border-green-400/30 text-green-400'
                  : severityBg(status.health.overallSeverity) +
                      ' ' +
                      severityColor(status.health.overallSeverity)
              )}
            >
              {status.health.healthy ? 'HEALTHY' : status.health.overallSeverity.toUpperCase()}
            </span>
          )}
        </div>
        <button onClick={fetchAll} className={ds.btnGhost} title="Refresh">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Tab bar */}
      <div className={ds.tabBar}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={activeTab === tab.key ? ds.tabActive('neon-cyan') : ds.tabInactive}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && renderOverview()}
      {activeTab === 'predictions' && renderPredictions()}
      {activeTab === 'history' && renderHistory()}
      {activeTab === 'knowledge' && renderKnowledge()}
      {activeTab === 'diagnose' && renderDiagnose()}
    </div>
  );

  // ── Overview Tab ──────────────────────────────────────────────────────

  function renderOverview() {
    if (!status) return null;
    const { health, processMetrics, summary } = status;

    return (
      <div className="space-y-6">
        {/* Summary cards */}
        <div className={ds.grid4}>
          <div className={ds.panel}>
            <div className={ds.textMuted}>Total Patterns</div>
            <div className="text-2xl font-bold text-white mt-1">{summary.totalPatterns}</div>
          </div>
          <div className={ds.panel}>
            <div className={ds.textMuted}>Total Repairs</div>
            <div className="text-2xl font-bold text-white mt-1">{summary.totalRepairs}</div>
            <div className="text-xs text-gray-500 mt-1">
              {(summary.successRate * 100).toFixed(0)}% success rate
            </div>
          </div>
          <div className={ds.panel}>
            <div className={ds.textMuted}>Predictions Made</div>
            <div className="text-2xl font-bold text-white mt-1">{summary.totalPredictions}</div>
          </div>
          <div className={ds.panel}>
            <div className={ds.textMuted}>Knowledge Entries</div>
            <div className="text-2xl font-bold text-white mt-1">{summary.knowledgeEntries}</div>
          </div>
        </div>

        {/* Health dimensions */}
        <div className={ds.panel}>
          <h2 className={cn(ds.heading3, 'mb-4 flex items-center gap-2')}>
            <Activity className="w-5 h-5 text-neon-cyan" />
            System Health Dimensions
          </h2>
          <div className="space-y-3">
            {Object.entries(health.dimensions).map(([dimName, dim]) => (
              <div
                key={dimName}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-lg border',
                  severityBg(dim.severity)
                )}
              >
                <div className={severityColor(dim.severity)}>{dimensionIcon(dimName)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white capitalize">{dimName}</span>
                    <span
                      className={cn('text-xs px-1.5 py-0.5 rounded', severityColor(dim.severity))}
                    >
                      {dim.pattern.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5 truncate">{dim.details}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="flex items-center gap-1.5">
                    <div className="w-16 h-2 rounded-full bg-lattice-void overflow-hidden">
                      <div
                        className={cn('h-full rounded-full', confidenceColor(dim.confidence))}
                        style={{ width: `${dim.confidence * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-400 w-10 text-right">
                      {(dim.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{dim.samples} samples</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Process metrics */}
        <div className={ds.panel}>
          <h2 className={cn(ds.heading3, 'mb-4 flex items-center gap-2')}>
            <Cpu className="w-5 h-5 text-neon-cyan" />
            Process Metrics
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard label="Heap Used" value={`${processMetrics.memoryMB} MB`} />
            <MetricCard label="RSS" value={`${processMetrics.rssMB} MB`} />
            <MetricCard label="Heap Total" value={`${processMetrics.heapTotalMB} MB`} />
            <MetricCard label="External" value={`${processMetrics.externalMB} MB`} />
            <MetricCard
              label="CPU User"
              value={`${(processMetrics.cpuUser / 1000).toFixed(0)}ms`}
            />
            <MetricCard
              label="CPU System"
              value={`${(processMetrics.cpuSystem / 1000).toFixed(0)}ms`}
            />
            <MetricCard label="Uptime" value={formatUptime(processMetrics.uptimeSeconds)} />
            <MetricCard
              label="Capability Growth"
              value={
                summary.knowledgeEntries > 0 ? `+${summary.knowledgeEntries} DTUs` : 'Learning...'
              }
              accent
            />
          </div>
        </div>
      </div>
    );
  }

  // ── Predictions Tab ───────────────────────────────────────────────────

  function renderPredictions() {
    return (
      <div className="space-y-6">
        <div className={ds.panel}>
          <h2 className={cn(ds.heading3, 'mb-4 flex items-center gap-2')}>
            <Eye className="w-5 h-5 text-neon-cyan" />
            Active Predictions
          </h2>

          {predictions.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No active predictions. The system is healthy.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {predictions.map((pred) => {
                const issue = pred.predicted_issue || pred.predictedIssue || 'Unknown';
                const impact = pred.time_to_impact || pred.timeToImpact || '-';
                const action = pred.preventive_action || pred.preventiveAction || '';
                const ts = pred.created_at || pred.timestamp || '';

                return (
                  <div
                    key={pred.id}
                    className={cn(
                      'p-4 rounded-lg border',
                      pred.applied
                        ? 'bg-green-400/5 border-green-400/20'
                        : severityBg(pred.severity || 'medium')
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {pred.applied ? (
                            <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
                          ) : (
                            <AlertTriangle
                              className={cn(
                                'w-4 h-4 shrink-0',
                                severityColor(pred.severity || 'medium')
                              )}
                            />
                          )}
                          <span className="text-sm font-medium text-white">{issue}</span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-gray-400 mt-1">
                          <span>Time to impact: {impact}</span>
                          <span>Action: {action.replace(/_/g, ' ')}</span>
                        </div>
                        {pred.outcome && (
                          <div className="text-xs text-gray-500 mt-1">Outcome: {pred.outcome}</div>
                        )}
                        {ts && (
                          <div className="text-xs text-gray-600 mt-1">
                            {new Date(ts).toLocaleString()}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="flex items-center gap-1.5">
                          <div className="w-20 h-2 rounded-full bg-lattice-void overflow-hidden">
                            <div
                              className={cn(
                                'h-full rounded-full',
                                confidenceColor(pred.confidence)
                              )}
                              style={{ width: `${pred.confidence * 100}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-400 w-10 text-right">
                            {(pred.confidence * 100).toFixed(0)}%
                          </span>
                        </div>
                        {pred.confidence >= 0.8 && !pred.applied && (
                          <span className="text-xs text-neon-cyan mt-1 block">
                            Auto-apply eligible
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Predictive accuracy */}
        {knowledge?.stats?.predictions && (
          <div className={ds.panel}>
            <h2 className={cn(ds.heading3, 'mb-4 flex items-center gap-2')}>
              <TrendingUp className="w-5 h-5 text-neon-cyan" />
              Predictive Accuracy
            </h2>
            <div className={ds.grid3}>
              <MetricCard
                label="Total Predictions"
                value={String(knowledge.stats.predictions.total)}
              />
              <MetricCard label="Applied" value={String(knowledge.stats.predictions.applied)} />
              <MetricCard
                label="Accuracy"
                value={`${(knowledge.stats.predictions.accuracy * 100).toFixed(0)}%`}
                accent={knowledge.stats.predictions.accuracy > 0.7}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── History Tab ───────────────────────────────────────────────────────

  function renderHistory() {
    return (
      <div className="space-y-6">
        <div className={ds.panel}>
          <h2 className={cn(ds.heading3, 'mb-4 flex items-center gap-2')}>
            <Database className="w-5 h-5 text-neon-cyan" />
            Repair History
          </h2>

          {history.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Shield className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No repair history yet. The brain is learning.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((entry) => {
                const isExpanded = expandedRepairId === entry.id;
                return (
                  <div
                    key={entry.id}
                    className="border border-lattice-border rounded-lg overflow-hidden"
                  >
                    <button
                      onClick={() => setExpandedRepairId(isExpanded ? null : entry.id)}
                      className="w-full flex items-center gap-3 p-3 text-left hover:bg-lattice-elevated/50 transition-colors"
                    >
                      {entry.success ? (
                        <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white truncate">
                            {entry.issueType.replace(/_/g, ' ')}
                          </span>
                          <span
                            className={cn(
                              'text-xs px-1.5 py-0.5 rounded',
                              severityColor(entry.severity)
                            )}
                          >
                            {entry.severity}
                          </span>
                          {entry.verified && (
                            <span className="text-xs text-green-400">verified</span>
                          )}
                          {entry.rollbackNeeded && (
                            <span className="text-xs text-orange-400">rolled back</span>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-gray-500 shrink-0">
                        {formatDuration(entry.repairTimeMs)}
                      </span>
                      <span className="text-xs text-gray-600 shrink-0 w-32 text-right">
                        {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '-'}
                      </span>
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-500 shrink-0" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 border-t border-lattice-border bg-lattice-void/30">
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <span className="text-gray-500">Fix Applied:</span>
                            <p className="text-gray-300 mt-0.5">{entry.fixApplied || '-'}</p>
                          </div>
                          <div>
                            <span className="text-gray-500">Symptoms:</span>
                            <div className="mt-0.5">
                              {entry.symptoms.length > 0 ? (
                                <ul className="text-gray-300 text-xs space-y-0.5">
                                  {entry.symptoms.map((s, i) => (
                                    <li key={i} className="truncate">
                                      - {s}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <span className="text-gray-500">-</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-gray-600 font-mono">{entry.id}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Knowledge Tab ─────────────────────────────────────────────────────

  function renderKnowledge() {
    const stats = knowledge?.stats;

    return (
      <div className="space-y-6">
        {/* Overall stats */}
        <div className={ds.grid4}>
          <div className={ds.panel}>
            <div className={ds.textMuted}>Known Patterns</div>
            <div className="text-2xl font-bold text-white mt-1">{stats?.patterns ?? 0}</div>
          </div>
          <div className={ds.panel}>
            <div className={ds.textMuted}>Successful Repairs</div>
            <div className="text-2xl font-bold text-green-400 mt-1">
              {stats?.repairs.successful ?? 0}
            </div>
          </div>
          <div className={ds.panel}>
            <div className={ds.textMuted}>Failed Repairs</div>
            <div className="text-2xl font-bold text-red-400 mt-1">{stats?.repairs.failed ?? 0}</div>
          </div>
          <div className={ds.panel}>
            <div className={ds.textMuted}>Success Rate</div>
            <div className="text-2xl font-bold text-white mt-1">
              {stats?.repairs.successRate
                ? `${(stats.repairs.successRate * 100).toFixed(0)}%`
                : '-'}
            </div>
          </div>
        </div>

        {/* Knowledge by category */}
        <div className={ds.panel}>
          <h2 className={cn(ds.heading3, 'mb-4 flex items-center gap-2')}>
            <Brain className="w-5 h-5 text-neon-cyan" />
            Knowledge by Category
          </h2>

          {!stats?.knowledge.byCategory.length ? (
            <div className="text-center py-6 text-gray-500">
              <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>Knowledge base is empty. The brain will learn from repairs.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {stats.knowledge.byCategory.map((cat) => (
                <div
                  key={cat.category}
                  className="flex items-center gap-3 p-3 rounded-lg bg-lattice-elevated/30"
                >
                  <div className="text-neon-cyan">{dimensionIcon(cat.category)}</div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-white capitalize">
                      {cat.category.replace(/_/g, ' ')}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {cat.count} entries | {cat.totalSuccesses} successes | {cat.totalFailures}{' '}
                      failures
                    </div>
                  </div>
                  <div className="w-32">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-lattice-void overflow-hidden">
                        <div
                          className="h-full rounded-full bg-green-400"
                          style={{ width: `${cat.successRate * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-400 w-10 text-right">
                        {(cat.successRate * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Growth over time */}
        {stats?.growth && stats.growth.length > 0 && (
          <div className={ds.panel}>
            <h2 className={cn(ds.heading3, 'mb-4 flex items-center gap-2')}>
              <TrendingUp className="w-5 h-5 text-neon-cyan" />
              Capability Growth
            </h2>
            <div className="space-y-2">
              {stats.growth.slice(-14).map((g) => {
                const maxTotal = Math.max(...stats.growth.map((e) => e.total), 1);
                return (
                  <div key={g.day} className="flex items-center gap-3 text-sm">
                    <span className="text-gray-500 w-24 shrink-0 text-xs font-mono">{g.day}</span>
                    <div className="flex-1 flex items-center gap-1">
                      <div
                        className="h-3 rounded bg-green-400/60"
                        style={{ width: `${(g.successes / maxTotal) * 100}%` }}
                        title={`${g.successes} successes`}
                      />
                      <div
                        className="h-3 rounded bg-red-400/60"
                        style={{ width: `${(g.failures / maxTotal) * 100}%` }}
                        title={`${g.failures} failures`}
                      />
                    </div>
                    <span className="text-xs text-gray-400 w-16 text-right shrink-0">
                      {g.total} repairs
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Diagnose Tab ──────────────────────────────────────────────────────

  function renderDiagnose() {
    return (
      <div className="space-y-6">
        <div className={ds.panel}>
          <h2 className={cn(ds.heading3, 'mb-4 flex items-center gap-2')}>
            <Search className="w-5 h-5 text-neon-cyan" />
            Manual Diagnosis
          </h2>

          <div className="space-y-4">
            <div>
              <label className={ds.label}>Error Message / Description</label>
              <textarea
                className={ds.textarea}
                rows={3}
                placeholder="Describe the issue or paste an error message..."
                value={diagnoseError}
                onChange={(e) => setDiagnoseError(e.target.value)}
              />
            </div>

            <div>
              <label className={ds.label}>Category (optional)</label>
              <select
                className={ds.select}
                value={diagnoseCategory}
                onChange={(e) => setDiagnoseCategory(e.target.value)}
              >
                <option value="">Auto-detect</option>
                <option value="memory">Memory</option>
                <option value="latency">Latency</option>
                <option value="error_rate">Error Rate</option>
                <option value="connection">Connection</option>
                <option value="cpu">CPU</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="autoRepair"
                checked={diagnoseAutoRepair}
                onChange={(e) => setDiagnoseAutoRepair(e.target.checked)}
                className="rounded border-lattice-border bg-lattice-surface"
              />
              <label htmlFor="autoRepair" className="text-sm text-gray-400">
                Auto-repair if a fix is found
              </label>
            </div>

            <button
              onClick={handleDiagnose}
              disabled={diagnosing || (!diagnoseError && !diagnoseCategory)}
              className={ds.btnPrimary}
            >
              {diagnosing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Diagnosing...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Run Diagnosis
                </>
              )}
            </button>
          </div>
        </div>

        {/* Diagnosis result */}
        {diagnoseResult && (
          <div className={ds.panel}>
            <h2 className={cn(ds.heading3, 'mb-4 flex items-center gap-2')}>
              <Zap className="w-5 h-5 text-neon-cyan" />
              Diagnosis Result
            </h2>

            {!diagnoseResult.ok ? (
              <div className="text-red-400 text-sm">Diagnosis failed. Check server logs.</div>
            ) : (
              <div className="space-y-4">
                {/* Classification */}
                <div>
                  <div className="text-sm text-gray-400 mb-2">Classification</div>
                  {diagnoseResult.diagnosis.classified ? (
                    <div
                      className={cn(
                        'p-3 rounded-lg border',
                        severityBg(diagnoseResult.diagnosis.primaryIssue?.severity || 'info')
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'text-sm font-medium',
                            severityColor(diagnoseResult.diagnosis.primaryIssue?.severity || 'info')
                          )}
                        >
                          {diagnoseResult.diagnosis.primaryIssue?.category} /{' '}
                          {diagnoseResult.diagnosis.primaryIssue?.subcategory?.replace(/_/g, ' ')}
                        </span>
                        <span
                          className={cn(
                            'text-xs px-1.5 py-0.5 rounded',
                            severityColor(diagnoseResult.diagnosis.primaryIssue?.severity || 'info')
                          )}
                        >
                          {diagnoseResult.diagnosis.primaryIssue?.severity}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {diagnoseResult.diagnosis.primaryIssue?.details}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500">
                      No issues classified from the provided information.
                    </div>
                  )}
                </div>

                {/* Repair options */}
                {diagnoseResult.diagnosis.repairOptions.length > 0 && (
                  <div>
                    <div className="text-sm text-gray-400 mb-2">
                      Repair Options ({diagnoseResult.diagnosis.optionCount})
                    </div>
                    <div className="space-y-2">
                      {diagnoseResult.diagnosis.repairOptions.map((opt, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-3 p-2 rounded-lg bg-lattice-elevated/30"
                        >
                          <span className="text-xs text-gray-500 w-5 shrink-0">#{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-white">{opt.name}</div>
                            <div className="text-xs text-gray-400 truncate">{opt.description}</div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <div className="w-12 h-1.5 rounded-full bg-lattice-void overflow-hidden">
                              <div
                                className={cn(
                                  'h-full rounded-full',
                                  confidenceColor(opt.confidence)
                                )}
                                style={{ width: `${opt.confidence * 100}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-400 w-10 text-right">
                              {(opt.confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                          <span className="text-xs text-gray-600 shrink-0">{opt.source}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Repair result */}
                {diagnoseResult.repair && (
                  <div
                    className={cn(
                      'p-3 rounded-lg border',
                      diagnoseResult.repair.success
                        ? 'bg-green-400/10 border-green-400/30'
                        : 'bg-red-400/10 border-red-400/30'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {diagnoseResult.repair.success ? (
                        <CheckCircle className="w-4 h-4 text-green-400" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-400" />
                      )}
                      <span className="text-sm font-medium text-white">
                        {diagnoseResult.repair.success ? 'Repair Successful' : 'Repair Failed'}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {diagnoseResult.repair.description} (
                      {formatDuration(diagnoseResult.repair.repairTimeMs)})
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
}

// -- Sub-components -----------------------------------------------------------

function MetricCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="p-3 rounded-lg bg-lattice-elevated/30">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={cn('text-lg font-semibold mt-0.5', accent ? 'text-neon-cyan' : 'text-white')}>
        {value}
      </div>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedRepairDashboard = withErrorBoundary(RepairDashboard);
export { _WrappedRepairDashboard as RepairDashboard };
