'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { CheckCircle, AlertCircle, Activity, Loader2 } from 'lucide-react';

interface SLOStatus {
  id: string;
  description: string;
  type: 'latency' | 'availability';
  target: number;
  budget: number;
  window: string;
  percentile?: string;
  current?: number | null;
  budgetUsed?: number | null;
  status: 'ok' | 'breached' | 'no_data';
  sampleCount: number;
}

interface SLODashboardData {
  ok: boolean;
  breachedCount: number;
  slos: SLOStatus[];
  generatedAt: number;
}

function formatTarget(slo: SLOStatus): string {
  if (slo.type === 'latency') {
    const unit = slo.id.includes('voice') ? 'ms' : slo.target >= 1000 ? 'ms' : 'ms';
    return `${slo.percentile || 'p95'} < ${slo.target}${unit}`;
  }
  return `${(slo.target * 100).toFixed(1)}%`;
}

function formatCurrent(slo: SLOStatus): string {
  if (slo.current == null) return '—';
  if (slo.type === 'latency') return `${Math.round(slo.current)}ms`;
  return `${(slo.current * 100).toFixed(2)}%`;
}

const STATUS_STYLES: Record<string, string> = {
  ok: 'text-green-400 bg-green-500/10 border-green-500/30',
  breached: 'text-red-400 bg-red-500/10 border-red-500/30',
  no_data: 'text-white/30 bg-white/5 border-white/10',
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  ok: <CheckCircle className="w-3.5 h-3.5" />,
  breached: <AlertCircle className="w-3.5 h-3.5" />,
  no_data: <Activity className="w-3.5 h-3.5" />,
};

function SLODashboard() {
  const { data, isLoading, isError, error } = useQuery<SLODashboardData>({
    queryKey: ['slo-dashboard'],
    queryFn: () => api.get('/api/inference/slos').then((r) => r.data),
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-white/40 p-4">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading SLO data...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
        <AlertCircle className="w-4 h-4 flex-shrink-0" />
        Failed to load SLOs: {(error as Error)?.message || 'Unknown error'}
      </div>
    );
  }

  const slos = data?.slos || [];
  const breachedCount = data?.breachedCount ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-white/40" />
          <span className="text-sm font-semibold text-white">Service Level Objectives</span>
        </div>
        {breachedCount > 0 ? (
          <span className="text-xs px-2 py-0.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded">
            {breachedCount} breached
          </span>
        ) : (
          <span className="text-xs px-2 py-0.5 bg-green-500/20 text-green-400 border border-green-500/30 rounded">
            All healthy
          </span>
        )}
      </div>

      <div className="space-y-2">
        {slos.map((slo) => (
          <div
            key={slo.id}
            className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/10"
          >
            <span
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs font-medium ${STATUS_STYLES[slo.status]}`}
            >
              {STATUS_ICONS[slo.status]}
              {slo.status === 'no_data' ? 'no data' : slo.status}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white">{slo.id.replace(/_/g, ' ')}</p>
              <p className="text-xs text-white/40 truncate">{slo.description}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs text-white/60">
                Target: <span className="text-white">{formatTarget(slo)}</span>
              </p>
              {slo.current != null && (
                <p className="text-xs text-white/40">
                  Current:{' '}
                  <span className={slo.status === 'breached' ? 'text-red-400' : 'text-green-400'}>
                    {formatCurrent(slo)}
                  </span>
                </p>
              )}
              {slo.sampleCount > 0 && (
                <p className="text-xs text-white/25">{slo.sampleCount} samples</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {data?.generatedAt && (
        <p className="text-xs text-white/25 text-right">
          Updated {new Date(data.generatedAt).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedSLODashboard = withErrorBoundary(SLODashboard);
export { _WrappedSLODashboard as SLODashboard };
