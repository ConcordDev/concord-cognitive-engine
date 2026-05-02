'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  HardDrive,
  Cloud,
  CloudOff,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Clock,
  RefreshCw,
  Play,
  Database,
  Archive,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ───────────────────────────────────────────────────────────────

interface BackupEntry {
  id: string;
  type: 'local' | 's3' | 'restore';
  status: 'started' | 'completed' | 'failed';
  db_size_bytes: number | null;
  compressed_size_bytes: number | null;
  artifacts_size_bytes: number | null;
  s3_key: string | null;
  s3_etag: string | null;
  integrity_check: string | null;
  duration_ms: number | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  metadata: Record<string, unknown> | null;
}

interface BackupStatus {
  healthy: boolean;
  status: 'healthy' | 'warning' | 'critical' | 'unknown' | 'not_initialized';
  schedulerRunning: boolean;
  schedule: string;
  s3Enabled: boolean;
  backupInProgress: boolean;
  currentBackupId: string | null;
  lastBackup: BackupEntry | null;
  lastSuccessfulBackup: BackupEntry | null;
  age: {
    ms: number | null;
    hours: number | null;
    human: string;
  };
  alertThresholdHours: number;
  counts: {
    total: number;
    failed: number;
    successful: number;
    local: number;
    s3: number;
  };
  localFiles: {
    db: number;
    artifacts: number;
    totalSizeBytes: number;
  };
}

interface BackupHealthProps {
  className?: string;
  apiBase?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleString();
}

function statusColor(status: string): string {
  switch (status) {
    case 'healthy':
      return 'text-green-400';
    case 'warning':
      return 'text-yellow-400';
    case 'critical':
      return 'text-red-400';
    default:
      return 'text-gray-400';
  }
}

function statusBg(status: string): string {
  switch (status) {
    case 'healthy':
      return 'bg-green-400/10 border-green-400/30';
    case 'warning':
      return 'bg-yellow-400/10 border-yellow-400/30';
    case 'critical':
      return 'bg-red-400/10 border-red-400/30';
    default:
      return 'bg-gray-400/10 border-gray-400/30';
  }
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'healthy':
      return <CheckCircle className="w-5 h-5 text-green-400" />;
    case 'warning':
      return <AlertTriangle className="w-5 h-5 text-yellow-400" />;
    case 'critical':
      return <XCircle className="w-5 h-5 text-red-400" />;
    default:
      return <Clock className="w-5 h-5 text-gray-400" />;
  }
}

// ── Component ───────────────────────────────────────────────────────────

function BackupHealth({ className, apiBase = '' }: BackupHealthProps) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [history, setHistory] = useState<BackupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [backingUp, setBackingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/admin/backups/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.ok !== false) {
        setStatus(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch backup status');
    }
  }, [apiBase]);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/admin/backups?limit=10`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.ok !== false) {
        setHistory(data.history || []);
      }
    } catch {
      // Non-fatal
    }
  }, [apiBase]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    await Promise.all([fetchStatus(), fetchHistory()]);
    setLoading(false);
  }, [fetchStatus, fetchHistory]);

  const triggerBackup = async () => {
    setBackingUp(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/admin/backups/run`, { method: 'POST' });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || 'Backup failed');
      }
      // Refresh status after backup
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger backup');
    } finally {
      setBackingUp(false);
    }
  };

  useEffect(() => {
    refresh();
    // Poll every 60 seconds
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (loading && !status) {
    return (
      <div
        className={cn('bg-lattice-surface border border-lattice-border rounded-xl p-6', className)}
      >
        <div className="flex items-center gap-3 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Loading backup status...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('bg-lattice-surface border border-lattice-border rounded-xl', className)}>
      {/* Header */}
      <div className="px-6 py-4 border-b border-lattice-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Database className="w-5 h-5 text-neon-cyan" />
          <h2 className="text-lg font-semibold text-white">Backup Health</h2>
          {status && (
            <div
              className={cn(
                'px-2.5 py-0.5 rounded-full text-xs font-medium border',
                statusBg(status.status)
              )}
            >
              <span className={statusColor(status.status)}>
                {status.status.charAt(0).toUpperCase() + status.status.slice(1)}
              </span>
            </div>
          )}
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
            onClick={triggerBackup}
            disabled={backingUp || status?.backupInProgress}
            className="flex items-center gap-2 px-3 py-1.5 bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan rounded-lg text-sm hover:bg-neon-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {backingUp || status?.backupInProgress ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Backing up...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Backup Now
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-6 mt-4 px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Status cards */}
      <div className="p-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Health status */}
        <div className="bg-lattice-bg rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <StatusIcon status={status?.status || 'unknown'} />
            <span className="text-sm text-gray-400">Status</span>
          </div>
          <div className={cn('text-lg font-bold', statusColor(status?.status || 'unknown'))}>
            {status?.status === 'healthy'
              ? 'Healthy'
              : status?.status === 'warning'
                ? 'Warning'
                : status?.status === 'critical'
                  ? 'Critical'
                  : status?.status === 'not_initialized'
                    ? 'Not Set Up'
                    : 'Unknown'}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {status?.schedulerRunning ? 'Scheduler active' : 'Scheduler stopped'}
          </div>
        </div>

        {/* Last backup age */}
        <div className="bg-lattice-bg rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-5 h-5 text-neon-purple" />
            <span className="text-sm text-gray-400">Last Backup</span>
          </div>
          <div className="text-lg font-bold text-white">{status?.age?.human || 'Never'}</div>
          <div className="text-xs text-gray-500 mt-1">
            Alert after {status?.alertThresholdHours || 12}h
          </div>
        </div>

        {/* Local backups */}
        <div className="bg-lattice-bg rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <HardDrive className="w-5 h-5 text-blue-400" />
            <span className="text-sm text-gray-400">Local</span>
          </div>
          <div className="text-lg font-bold text-white">{status?.localFiles?.db || 0} files</div>
          <div className="text-xs text-gray-500 mt-1">
            {formatBytes(status?.localFiles?.totalSizeBytes || 0)} used
          </div>
        </div>

        {/* S3 backups */}
        <div className="bg-lattice-bg rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            {status?.s3Enabled ? (
              <Cloud className="w-5 h-5 text-green-400" />
            ) : (
              <CloudOff className="w-5 h-5 text-gray-500" />
            )}
            <span className="text-sm text-gray-400">S3 Offsite</span>
          </div>
          <div className="text-lg font-bold text-white">
            {status?.s3Enabled ? `${status?.counts?.s3 || 0} uploads` : 'Disabled'}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {status?.s3Enabled
              ? `${status?.counts?.s3 || 0} of ${status?.counts?.total || 0} total`
              : 'Set AWS_BUCKET to enable'}
          </div>
        </div>
      </div>

      {/* Schedule info */}
      {status && (
        <div className="px-6 pb-2">
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span>
              Schedule: <code className="text-gray-400">{status.schedule}</code>
            </span>
            <span>Total: {status.counts?.total || 0}</span>
            <span>Successful: {status.counts?.successful || 0}</span>
            {(status.counts?.failed || 0) > 0 && (
              <span className="text-red-400">Failed: {status.counts.failed}</span>
            )}
          </div>
        </div>
      )}

      {/* Recent backup history */}
      {history.length > 0 && (
        <div className="px-6 pb-6">
          <div className="flex items-center gap-2 mb-3 mt-2">
            <Archive className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-300">Recent Backups</span>
          </div>
          <div className="bg-lattice-bg rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-lattice-border">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">
                    Status
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Type</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Time</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Size</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">
                    Duration
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">
                    Integrity
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-lattice-border/50 last:border-0 hover:bg-lattice-surface/50"
                  >
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium',
                          entry.status === 'completed' && 'bg-green-500/10 text-green-400',
                          entry.status === 'failed' && 'bg-red-500/10 text-red-400',
                          entry.status === 'started' && 'bg-blue-500/10 text-blue-400'
                        )}
                      >
                        {entry.status === 'completed' && <CheckCircle className="w-3 h-3" />}
                        {entry.status === 'failed' && <XCircle className="w-3 h-3" />}
                        {entry.status === 'started' && <Loader2 className="w-3 h-3 animate-spin" />}
                        {entry.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          'text-xs px-1.5 py-0.5 rounded',
                          entry.type === 's3' && 'bg-blue-500/10 text-blue-400',
                          entry.type === 'local' && 'bg-gray-500/10 text-gray-400',
                          entry.type === 'restore' && 'bg-purple-500/10 text-purple-400'
                        )}
                      >
                        {entry.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-400">
                      {formatTime(entry.started_at)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-400">
                      {formatBytes(entry.compressed_size_bytes)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-400">
                      {formatDuration(entry.duration_ms)}
                    </td>
                    <td className="px-4 py-2.5">
                      {entry.integrity_check === 'ok' ? (
                        <span className="text-xs text-green-400">OK</span>
                      ) : entry.integrity_check ? (
                        <span className="text-xs text-yellow-400">{entry.integrity_check}</span>
                      ) : (
                        <span className="text-xs text-gray-500">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Error details for failed backups */}
          {history
            .filter((e) => e.status === 'failed' && e.error)
            .slice(0, 2)
            .map((entry) => (
              <div
                key={`err-${entry.id}`}
                className="mt-2 px-3 py-2 bg-red-500/5 border border-red-500/20 rounded text-xs text-red-300"
              >
                <span className="font-medium">{formatTime(entry.started_at)}:</span> {entry.error}
              </div>
            ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && history.length === 0 && (
        <div className="px-6 pb-6">
          <div className="text-center py-8 bg-lattice-bg rounded-lg">
            <Database className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">No backups recorded yet</p>
            <p className="text-gray-500 text-xs mt-1">
              Click "Backup Now" to create your first backup
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedBackupHealth = withErrorBoundary(BackupHealth);
export { _WrappedBackupHealth as BackupHealth };
