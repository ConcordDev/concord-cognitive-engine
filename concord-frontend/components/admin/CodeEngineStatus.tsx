'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Code2,
  GitBranch,
  Package,
  Layers,
  AlertTriangle,
  RefreshCw,
  Play,
  Minimize2,
  CheckCircle,
  XCircle,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ───────────────────────────────────────────────────────────────

interface IngestionEntry {
  id: string;
  repository: string;
  status: 'running' | 'completed' | 'failed' | 'queued';
  filesProcessed: number;
  patternsFound: number;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
}

interface PatternEntry {
  id: string;
  name: string;
  language: string;
  cretiScore: number;
  occurrences: number;
  category: string;
}

interface CodeEngineStats {
  repositoryCount: number;
  patternCount: number;
  megaDTUCount: number;
  generationCount: number;
  errorCount: number;
  lastIngestionAt: string | null;
  lastCompressionAt: string | null;
  recentIngestions: IngestionEntry[];
  topPatterns: PatternEntry[];
}

interface CodeEngineStatusProps {
  className?: string;
  apiBase?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

function cretiColor(score: number): string {
  if (score >= 0.8) return 'text-green-400';
  if (score >= 0.5) return 'text-yellow-400';
  return 'text-red-400';
}

function cretiBg(score: number): string {
  if (score >= 0.8) return 'bg-green-400';
  if (score >= 0.5) return 'bg-yellow-400';
  return 'bg-red-400';
}

// ── Component ───────────────────────────────────────────────────────────

function CodeEngineStatus({ className, apiBase = '' }: CodeEngineStatusProps) {
  const [stats, setStats] = useState<CodeEngineStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [actionResult, setActionResult] = useState<{ ok: boolean; message: string } | null>(null);

  // ── Data fetching ──────────────────────────────────────────────────

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/code-engine/stats`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch code engine stats');
    }
  }, [apiBase]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await fetchStats();
    setLoading(false);
  }, [fetchStats]);

  useEffect(() => {
    refresh();
    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, [refresh, fetchStats]);

  // ── Actions ────────────────────────────────────────────────────────

  const triggerIngest = useCallback(async () => {
    setIngesting(true);
    setActionResult(null);
    try {
      const res = await fetch(`${apiBase}/api/code-engine/ingest`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setActionResult({
        ok: true,
        message: data.message || 'Ingestion triggered successfully',
      });
      await fetchStats();
    } catch (err) {
      setActionResult({
        ok: false,
        message: `Ingestion failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setIngesting(false);
    }
  }, [apiBase, fetchStats]);

  const triggerCompression = useCallback(async () => {
    setCompressing(true);
    setActionResult(null);
    try {
      const res = await fetch(`${apiBase}/api/code-engine/compress`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setActionResult({
        ok: true,
        message: data.message || 'Compression triggered successfully',
      });
      await fetchStats();
    } catch (err) {
      setActionResult({
        ok: false,
        message: `Compression failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setCompressing(false);
    }
  }, [apiBase, fetchStats]);

  // ── Loading state ──────────────────────────────────────────────────

  if (loading && !stats) {
    return (
      <div
        className={cn('bg-lattice-surface border border-lattice-border rounded-xl p-6', className)}
      >
        <div className="flex items-center gap-3 animate-pulse">
          <Code2 className="w-5 h-5 text-gray-600" />
          <span className="text-gray-500">Loading Code Engine status...</span>
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────

  if (error && !stats) {
    return (
      <div
        className={cn('bg-lattice-surface border border-lattice-border rounded-xl p-6', className)}
      >
        <div className="flex items-center gap-3">
          <XCircle className="w-5 h-5 text-red-400" />
          <span className="text-red-400">Failed to load Code Engine status</span>
          <button
            onClick={refresh}
            className="ml-auto text-sm text-gray-400 hover:text-white transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="bg-lattice-surface border border-lattice-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Code2 className="w-6 h-6 text-neon-cyan" />
            <h2 className="text-lg font-bold text-white">Code Engine</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              disabled={loading}
              className="p-2 rounded-lg hover:bg-lattice-bg transition-colors text-gray-400 hover:text-white disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </button>
            <button
              onClick={triggerIngest}
              disabled={ingesting}
              className="flex items-center gap-2 px-3 py-1.5 bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan rounded-lg text-sm hover:bg-neon-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {ingesting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Ingesting...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Ingest
                </>
              )}
            </button>
            <button
              onClick={triggerCompression}
              disabled={compressing}
              className="flex items-center gap-2 px-3 py-1.5 bg-neon-purple/10 border border-neon-purple/30 text-neon-purple rounded-lg text-sm hover:bg-neon-purple/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {compressing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Compressing...
                </>
              ) : (
                <>
                  <Minimize2 className="w-4 h-4" />
                  Compress
                </>
              )}
            </button>
          </div>
        </div>

        {/* Action result banner */}
        {actionResult && (
          <div
            className={cn(
              'mb-4 px-4 py-2 rounded-lg text-sm flex items-center gap-2',
              actionResult.ok
                ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                : 'bg-red-500/10 border border-red-500/30 text-red-400'
            )}
          >
            {actionResult.ok ? (
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            )}
            {actionResult.message}
            <button
              onClick={() => setActionResult(null)}
              className="ml-auto text-xs opacity-60 hover:opacity-100 transition-opacity"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-5 gap-3">
          <StatCard
            label="Repositories"
            value={stats?.repositoryCount ?? 0}
            icon={GitBranch}
            color="cyan"
          />
          <StatCard
            label="Patterns"
            value={stats?.patternCount ?? 0}
            icon={Layers}
            color="purple"
          />
          <StatCard
            label="Mega DTUs"
            value={stats?.megaDTUCount ?? 0}
            icon={Package}
            color="green"
          />
          <StatCard
            label="Generations"
            value={stats?.generationCount ?? 0}
            icon={Code2}
            color="cyan"
          />
          <StatCard
            label="Errors"
            value={stats?.errorCount ?? 0}
            icon={stats?.errorCount ? AlertTriangle : CheckCircle}
            color={stats?.errorCount ? 'yellow' : 'green'}
          />
        </div>

        {/* Timestamps */}
        <div className="flex items-center gap-6 mt-4 text-xs text-gray-500">
          <span>
            Last ingestion:{' '}
            <span className="text-gray-400">
              {formatRelativeTime(stats?.lastIngestionAt ?? null)}
            </span>
          </span>
          <span>
            Last compression:{' '}
            <span className="text-gray-400">
              {formatRelativeTime(stats?.lastCompressionAt ?? null)}
            </span>
          </span>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-2 gap-4">
        {/* Recent Ingestions */}
        <div className="bg-lattice-surface border border-lattice-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-neon-cyan" />
            <span className="font-medium text-white text-sm">Recent Ingestions</span>
          </div>

          {stats?.recentIngestions && stats.recentIngestions.length > 0 ? (
            <div className="space-y-2">
              {stats.recentIngestions.slice(0, 8).map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between py-2 px-3 bg-lattice-bg rounded-lg"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <IngestionStatusBadge status={entry.status} />
                    <div className="min-w-0">
                      <div className="text-sm text-white truncate">{entry.repository}</div>
                      <div className="text-xs text-gray-500">
                        {entry.filesProcessed} files, {entry.patternsFound} patterns
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 flex-shrink-0 ml-2">
                    {formatRelativeTime(entry.startedAt)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6">
              <GitBranch className="w-8 h-8 text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No recent ingestions</p>
            </div>
          )}
        </div>

        {/* Top Patterns by CRETI Score */}
        <div className="bg-lattice-surface border border-lattice-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Layers className="w-4 h-4 text-neon-purple" />
            <span className="font-medium text-white text-sm">Top Patterns by CRETI</span>
          </div>

          {stats?.topPatterns && stats.topPatterns.length > 0 ? (
            <div className="space-y-2">
              {stats.topPatterns.slice(0, 8).map((pattern) => (
                <div
                  key={pattern.id}
                  className="flex items-center justify-between py-2 px-3 bg-lattice-bg rounded-lg"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <div className="text-sm text-white truncate">{pattern.name}</div>
                      <div className="text-xs text-gray-500 flex items-center gap-2">
                        <span className="px-1.5 py-0.5 rounded bg-lattice-surface text-gray-400">
                          {pattern.language}
                        </span>
                        <span>{pattern.occurrences} uses</span>
                        {pattern.category && (
                          <span className="text-gray-600">{pattern.category}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    <div className="w-16 h-1.5 bg-lattice-surface rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full', cretiBg(pattern.cretiScore))}
                        style={{ width: `${Math.min(pattern.cretiScore * 100, 100)}%` }}
                      />
                    </div>
                    <span
                      className={cn(
                        'text-sm font-mono font-medium',
                        cretiColor(pattern.cretiScore)
                      )}
                    >
                      {pattern.cretiScore.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6">
              <Layers className="w-8 h-8 text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No patterns discovered yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: 'cyan' | 'purple' | 'green' | 'yellow';
}) {
  const colors = {
    cyan: 'text-neon-cyan bg-neon-cyan/10',
    purple: 'text-neon-purple bg-neon-purple/10',
    green: 'text-green-400 bg-green-400/10',
    yellow: 'text-yellow-400 bg-yellow-400/10',
  };

  return (
    <div className="bg-lattice-bg rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500">{label}</span>
        <div className={cn('p-1.5 rounded', colors[color])}>
          <Icon className="w-3.5 h-3.5" />
        </div>
      </div>
      <div className="text-xl font-bold text-white">{value.toLocaleString()}</div>
    </div>
  );
}

function IngestionStatusBadge({ status }: { status: IngestionEntry['status'] }) {
  const config = {
    running: { icon: RefreshCw, color: 'bg-blue-500/10 text-blue-400', spin: true },
    completed: { icon: CheckCircle, color: 'bg-green-500/10 text-green-400', spin: false },
    failed: { icon: XCircle, color: 'bg-red-500/10 text-red-400', spin: false },
    queued: { icon: Clock, color: 'bg-gray-500/10 text-gray-400', spin: false },
  };

  const { icon: Icon, color, spin } = config[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
        color
      )}
    >
      <Icon className={cn('w-3 h-3', spin && 'animate-spin')} />
      {status}
    </span>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedCodeEngineStatus = withErrorBoundary(CodeEngineStatus);
export { _WrappedCodeEngineStatus as CodeEngineStatus };
export default _WrappedCodeEngineStatus;
