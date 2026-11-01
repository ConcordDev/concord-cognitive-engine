'use client';

/**
 * StatusPanel — health cards, AI analysis macros, system/perf/jobs JSON.
 */
import { motion } from 'framer-motion';
import { Database, Cpu, Play } from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useDebugDesk } from '@/components/debug/useDebugDesk';
import { HealthCard, formatUptime } from '@/components/debug/debug-helpers';
import { AnalysisActionsPanel } from '@/components/debug/AnalysisActionsPanel';

export function StatusPanel() {
  const {
    status, jobs, dbStatus, isDbAdmin, perfMetrics, isLoading, isError, errorMessage, refetchAll,
  } = useDebugDesk();

  if (isLoading) {
    return (
      <div role="status" aria-busy="true" className="flex items-center justify-center p-8">
        <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (isError) return <ErrorState error={errorMessage} onRetry={refetchAll} />;

  return (
    <div className="space-y-6">
{/* Quick Health Indicators */}
<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
  {[
    {
      label: 'System',
      status: (status?.ok ? 'ok' : 'error') as 'ok' | 'warn' | 'error',
      detail: status?.version || 'unknown',
    },
    // Members cannot read /api/db/status (admin-only), so there is nothing honest to show: omit the card
    // rather than render "checking" forever or a fabricated state.
    ...(isDbAdmin ? [{
      label: 'Database',
      status: (dbStatus?.ok !== false ? 'ok' : 'error') as 'ok' | 'warn' | 'error',
      detail: dbStatus?.engine || 'checking',
    }] : []),
    {
      label: 'Jobs',
      status: (jobs?.active !== undefined ? 'ok' : 'warn') as 'ok' | 'warn' | 'error',
      detail: `${jobs?.active || 0} active`,
    },
    {
      label: 'Memory',
      status: (perfMetrics?.memory ? 'ok' : 'warn') as 'ok' | 'warn',
      // perf.metrics reports memory already in MB — dividing again was
      // the F12 contradiction (cards read 0MB over a ~1.1GB heap).
      detail: perfMetrics?.memory
        ? `${perfMetrics.memory.heapUsed || 0}MB`
        : 'N/A',
    },
  ].map((card, i) => (
    <motion.div
      key={card.label}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.08 }}
    >
      <HealthCard label={card.label} status={card.status} detail={card.detail} />
    </motion.div>
  ))}
</div>

      <AnalysisActionsPanel />
<div className="space-y-4">
  {/* System Status — designed rows; the raw payload lives behind Raw */}
  <div className="panel p-4">
    <h2 className="font-semibold mb-4 flex items-center gap-2">
      <Database className="w-4 h-4 text-neon-blue" />
      System Status
    </h2>
    <ScalarRows data={status} />
    <RawDetails data={status} />
  </div>

  {/* Performance Metrics */}
  {perfMetrics && (
    <div className="panel p-4">
      <h2 className="font-semibold mb-4 flex items-center gap-2">
        <Cpu className="w-4 h-4 text-neon-cyan" />
        Performance Metrics
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
        {perfMetrics.uptime != null && (
          <div className="bg-lattice-deep p-3 rounded-lg">
            <p className="text-xs text-gray-400">Uptime</p>
            <p className="text-lg font-mono text-neon-green">
              {formatUptime(perfMetrics.uptime)}
            </p>
          </div>
        )}
        {perfMetrics.memory?.heapUsed != null && (
          <div className="bg-lattice-deep p-3 rounded-lg">
            <p className="text-xs text-gray-400">Heap Used</p>
            <p className="text-lg font-mono text-neon-blue">
              {perfMetrics.memory.heapUsed}MB
            </p>
          </div>
        )}
        {perfMetrics.memory?.heapTotal != null && (
          <div className="bg-lattice-deep p-3 rounded-lg">
            <p className="text-xs text-gray-400">Heap Total</p>
            <p className="text-lg font-mono text-gray-300">
              {perfMetrics.memory.heapTotal}MB
            </p>
          </div>
        )}
        {perfMetrics.memory?.rss != null && (
          <div className="bg-lattice-deep p-3 rounded-lg">
            <p className="text-xs text-gray-400">RSS</p>
            <p className="text-lg font-mono text-gray-300">{perfMetrics.memory.rss}MB</p>
          </div>
        )}
        {perfMetrics.dtus?.total != null && (
          <div className="bg-lattice-deep p-3 rounded-lg">
            <p className="text-xs text-gray-400">DTUs</p>
            <p className="text-lg font-mono text-gray-300">{perfMetrics.dtus.total}</p>
          </div>
        )}
        {perfMetrics.graph?.nodes != null && (
          <div className="bg-lattice-deep p-3 rounded-lg">
            <p className="text-xs text-gray-400">Graph Nodes</p>
            <p className="text-lg font-mono text-gray-300">{perfMetrics.graph.nodes}</p>
          </div>
        )}
        {perfMetrics.graph?.edges != null && (
          <div className="bg-lattice-deep p-3 rounded-lg">
            <p className="text-xs text-gray-400">Graph Edges</p>
            <p className="text-lg font-mono text-gray-300">{perfMetrics.graph.edges}</p>
          </div>
        )}
        {perfMetrics.cache?.queries != null && (
          <div className="bg-lattice-deep p-3 rounded-lg">
            <p className="text-xs text-gray-400">Cached Queries</p>
            <p className="text-lg font-mono text-gray-300">{perfMetrics.cache.queries}</p>
          </div>
        )}
      </div>
      <RawDetails data={perfMetrics} />
    </div>
  )}

  {/* Jobs Status */}
  <div className="panel p-4">
    <h2 className="font-semibold mb-4 flex items-center gap-2">
      <Play className="w-4 h-4 text-neon-green" />
      Jobs Status
    </h2>
    <ScalarRows data={jobs} />
    <RawDetails data={jobs} />
  </div>
</div>

    </div>
  );
}

/**
 * ScalarRows — the scalar (string/number/boolean) fields of a payload
 * as designed label/value rows. Nested objects and arrays are skipped
 * here; they stay available in the Raw payload below. This is the S12
 * de-engine-room presentation: Overview reads like a status page, the
 * JSON dump is one click away instead of the default view.
 */
function ScalarRows({ data }: { data: unknown }) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return <p className="text-xs text-gray-500">No data yet.</p>;
  }
  const rows = Object.entries(data as Record<string, unknown>).filter(
    ([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v),
  );
  if (rows.length === 0) {
    return (
      <p className="text-xs text-gray-500">
        No summary fields in this payload — the full payload is under Raw payload below.
      </p>
    );
  }
  return (
    <dl className="divide-y divide-white/5">
      {rows.map(([key, value]) => (
        <div key={key} className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="text-xs text-gray-400 capitalize">
            {key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ')}
          </dt>
          <dd className="text-sm font-mono text-gray-200 text-right break-all">
            {value === null ? '—' : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** RawDetails — the untouched JSON payload, collapsed by default. */
function RawDetails({ data }: { data: unknown }) {
  if (data == null) return null;
  return (
    <details className="mt-3">
      <summary className="text-[11px] text-gray-500 cursor-pointer hover:text-gray-300 select-none">
        Raw payload
      </summary>
      <pre className="mt-2 bg-lattice-void p-4 rounded-lg overflow-auto max-h-96 text-xs font-mono text-gray-400">
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  );
}
