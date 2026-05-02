'use client';

import { useState, useCallback } from 'react';
import {
  Globe,
  Activity,
  HardDrive,
  RefreshCw,
  Trash2,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Search,
  ExternalLink,
  Wifi,
  WifiOff,
  BarChart3,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/useApi';
import { api } from '@/lib/api/client';

// ── Types ──────────────────────────────────────────────────────────────

interface CDNProviderInfo {
  provider: string;
  description: string;
  configured: boolean;
  baseUrl?: string;
  r2Bucket?: string;
  distributionId?: string;
  s3Bucket?: string;
  region?: string;
}

interface CDNHealth {
  ok: boolean;
  provider: string;
  status: string;
  message?: string;
}

interface CDNStats {
  ok: boolean;
  provider: string;
  hits: number;
  misses: number;
  pushes: number;
  purges: number;
  errors: number;
  bytesServed: number;
  bytesPushed: number;
  cachedArtifacts: number;
  hitRate: string;
  uptime: number;
  startedAt: string;
  configured?: boolean;
}

interface CDNStatusResponse {
  ok: boolean;
  health: CDNHealth;
  provider: CDNProviderInfo;
  stats: CDNStats;
}

interface CDNStatusProps {
  className?: string;
}

// ── Component ──────────────────────────────────────────────────────────

function CDNStatus({ className }: CDNStatusProps) {
  const [purgeHash, setPurgeHash] = useState('');
  const [testUrlHash, setTestUrlHash] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [purgeResult, setPurgeResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [isPurging, setIsPurging] = useState(false);
  const [isPurgingAll, setIsPurgingAll] = useState(false);

  const {
    data: statusData,
    loading,
    error,
    refetch,
  } = useApi<CDNStatusResponse>('/api/cdn/status', {
    refreshInterval: 30000,
  });

  const health = statusData?.health;
  const provider = statusData?.provider;
  const stats = statusData?.stats;

  // ── Handlers ───────────────────────────────────────────────────────

  const handlePurge = useCallback(async () => {
    if (!purgeHash.trim()) return;
    setIsPurging(true);
    setPurgeResult(null);
    try {
      await api.post('/api/cdn/purge', { artifactHash: purgeHash.trim() });
      setPurgeResult({ ok: true, message: `Purged ${purgeHash.trim()} from CDN cache` });
      setPurgeHash('');
      refetch();
    } catch (e) {
      setPurgeResult({
        ok: false,
        message: `Purge failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setIsPurging(false);
    }
  }, [purgeHash, refetch]);

  const handlePurgeAll = useCallback(async () => {
    if (!confirm('Are you sure you want to purge ALL cached content from the CDN?')) return;
    setIsPurgingAll(true);
    setPurgeResult(null);
    try {
      await api.post('/api/cdn/purge-all');
      setPurgeResult({ ok: true, message: 'All CDN cache purged successfully' });
      refetch();
    } catch (e) {
      setPurgeResult({
        ok: false,
        message: `Purge all failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setIsPurgingAll(false);
    }
  }, [refetch]);

  const handleTestUrl = useCallback(async () => {
    if (!testUrlHash.trim()) return;
    setTestResult(null);
    try {
      const urlResp = await api.get(`/api/cdn/signed-url/${testUrlHash.trim()}?userId=admin`);
      const data = urlResp.data as { signedUrl?: string; expiresAt?: string };
      setTestResult(data.signedUrl || 'No URL generated');
    } catch (e) {
      setTestResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [testUrlHash]);

  // ── Formatting ─────────────────────────────────────────────────────

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatUptime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  // ── Status indicator ──────────────────────────────────────────────

  const getStatusInfo = () => {
    if (!health) return { color: 'gray', label: 'Unknown', icon: WifiOff };
    if (health.status === 'healthy') return { color: 'green', label: 'Healthy', icon: Wifi };
    if (health.status === 'unconfigured')
      return { color: 'yellow', label: 'Unconfigured', icon: AlertTriangle };
    return { color: 'red', label: 'Error', icon: XCircle };
  };

  const statusInfo = getStatusInfo();
  const StatusIcon = statusInfo.icon;

  // ── Loading / Error ───────────────────────────────────────────────

  if (loading && !statusData) {
    return (
      <div
        className={cn('bg-lattice-surface border border-lattice-border rounded-xl p-6', className)}
      >
        <div className="flex items-center gap-3 animate-pulse">
          <Globe className="w-5 h-5 text-gray-600" />
          <span className="text-gray-500">Loading CDN status...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn('bg-lattice-surface border border-lattice-border rounded-xl p-6', className)}
      >
        <div className="flex items-center gap-3">
          <XCircle className="w-5 h-5 text-red-400" />
          <span className="text-red-400">Failed to load CDN status</span>
          <button onClick={refetch} className="ml-auto text-sm text-gray-400 hover:text-white">
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header Card */}
      <div className="bg-lattice-surface border border-lattice-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Globe className="w-6 h-6 text-neon-cyan" />
            <h2 className="text-lg font-bold text-white">CDN Status</h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'w-2 h-2 rounded-full',
                  statusInfo.color === 'green' && 'bg-green-400 animate-pulse',
                  statusInfo.color === 'yellow' && 'bg-yellow-400',
                  statusInfo.color === 'red' && 'bg-red-400',
                  statusInfo.color === 'gray' && 'bg-gray-400'
                )}
              />
              <StatusIcon
                className={cn(
                  'w-4 h-4',
                  statusInfo.color === 'green' && 'text-green-400',
                  statusInfo.color === 'yellow' && 'text-yellow-400',
                  statusInfo.color === 'red' && 'text-red-400',
                  statusInfo.color === 'gray' && 'text-gray-400'
                )}
              />
              <span
                className={cn(
                  'text-sm',
                  statusInfo.color === 'green' && 'text-green-400',
                  statusInfo.color === 'yellow' && 'text-yellow-400',
                  statusInfo.color === 'red' && 'text-red-400',
                  statusInfo.color === 'gray' && 'text-gray-400'
                )}
              >
                {statusInfo.label}
              </span>
            </div>
            <button
              onClick={refetch}
              className="p-1.5 rounded-lg bg-lattice-bg border border-lattice-border text-gray-400 hover:text-white transition-colors"
              title="Refresh status"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Provider Info */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-lattice-bg rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">Provider</div>
            <div className="text-sm font-medium text-white capitalize">
              {provider?.provider || 'local'}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              {provider?.description || 'Local origin serving'}
            </div>
          </div>
          <div className="bg-lattice-bg rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">Base URL</div>
            <div className="text-sm font-medium text-white truncate">
              {provider?.baseUrl || 'Direct origin'}
            </div>
          </div>
          <div className="bg-lattice-bg rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">Uptime</div>
            <div className="text-sm font-medium text-white">
              {stats ? formatUptime(stats.uptime) : '--'}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              Since {stats?.startedAt ? new Date(stats.startedAt).toLocaleString() : '--'}
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-3">
          <StatCard
            label="Cache Hit Rate"
            value={stats?.hitRate || '0.00%'}
            icon={Zap}
            color="cyan"
          />
          <StatCard
            label="Bandwidth Served"
            value={formatBytes(stats?.bytesServed || 0)}
            icon={BarChart3}
            color="purple"
          />
          <StatCard
            label="Cached Artifacts"
            value={String(stats?.cachedArtifacts || 0)}
            icon={HardDrive}
            color="green"
          />
          <StatCard
            label="Errors"
            value={String(stats?.errors || 0)}
            icon={stats?.errors ? AlertTriangle : CheckCircle}
            color={stats?.errors ? 'yellow' : 'green'}
          />
        </div>
      </div>

      {/* Detailed Metrics */}
      <div className="grid grid-cols-2 gap-4">
        {/* Cache Metrics */}
        <div className="bg-lattice-surface border border-lattice-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-neon-cyan" />
            <span className="font-medium text-white text-sm">Cache Metrics</span>
          </div>
          <div className="space-y-3">
            <MetricRow label="Hits" value={String(stats?.hits || 0)} />
            <MetricRow label="Misses" value={String(stats?.misses || 0)} />
            <MetricRow label="Pushes" value={String(stats?.pushes || 0)} />
            <MetricRow label="Purges" value={String(stats?.purges || 0)} />
            <MetricRow label="Bytes Pushed" value={formatBytes(stats?.bytesPushed || 0)} />
          </div>
        </div>

        {/* Purge Controls */}
        <div className="bg-lattice-surface border border-lattice-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Trash2 className="w-4 h-4 text-red-400" />
            <span className="font-medium text-white text-sm">Purge Controls</span>
          </div>

          {/* Purge by hash */}
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Purge by Artifact Hash</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={purgeHash}
                  onChange={(e) => setPurgeHash(e.target.value)}
                  placeholder="Enter artifact hash..."
                  className="flex-1 bg-lattice-bg border border-lattice-border rounded px-3 py-1.5 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-neon-cyan/50"
                />
                <button
                  onClick={handlePurge}
                  disabled={isPurging || !purgeHash.trim()}
                  className="px-3 py-1.5 bg-red-500/20 border border-red-500/30 rounded text-sm text-red-400 hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isPurging ? 'Purging...' : 'Purge'}
                </button>
              </div>
            </div>

            {/* Purge all */}
            <div className="pt-2 border-t border-lattice-border/50">
              <button
                onClick={handlePurgeAll}
                disabled={isPurgingAll}
                className="w-full px-3 py-2 bg-red-500/10 border border-red-500/20 rounded text-sm text-red-400 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isPurgingAll ? 'Purging All...' : 'Purge All Cached Content'}
              </button>
            </div>

            {/* Purge result */}
            {purgeResult && (
              <div
                className={cn(
                  'p-2 rounded text-xs',
                  purgeResult.ok
                    ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                    : 'bg-red-500/10 text-red-400 border border-red-500/20'
                )}
              >
                {purgeResult.message}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* URL Preview/Test Tool */}
      <div className="bg-lattice-surface border border-lattice-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Search className="w-4 h-4 text-neon-purple" />
          <span className="font-medium text-white text-sm">URL Preview / Test</span>
        </div>
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={testUrlHash}
              onChange={(e) => setTestUrlHash(e.target.value)}
              placeholder="Enter artifact hash to generate signed URL..."
              className="flex-1 bg-lattice-bg border border-lattice-border rounded px-3 py-1.5 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-neon-purple/50"
            />
            <button
              onClick={handleTestUrl}
              disabled={!testUrlHash.trim()}
              className="px-3 py-1.5 bg-neon-purple/20 border border-neon-purple/30 rounded text-sm text-neon-purple hover:bg-neon-purple/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Generate
            </button>
          </div>
          {testResult && (
            <div className="p-3 bg-lattice-bg rounded border border-lattice-border/50">
              <div className="text-xs text-gray-500 mb-1">Signed URL</div>
              <div className="text-sm text-neon-cyan font-mono break-all select-all">
                {testResult}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
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
      <div className="text-lg font-bold text-white">{value}</div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-400">{label}</span>
      <span className="text-sm font-medium text-white">{value}</span>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedCDNStatus = withErrorBoundary(CDNStatus);
export { _WrappedCDNStatus as CDNStatus };
