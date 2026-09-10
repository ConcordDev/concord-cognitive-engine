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
    status, jobs, dbStatus, perfMetrics, isLoading, isError, errorMessage, refetchAll,
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
    {
      label: 'Database',
      status: (dbStatus?.ok !== false ? 'ok' : 'error') as 'ok' | 'warn' | 'error',
      detail: dbStatus?.engine || 'checking',
    },
    {
      label: 'Jobs',
      status: (jobs?.active !== undefined ? 'ok' : 'warn') as 'ok' | 'warn' | 'error',
      detail: `${jobs?.active || 0} active`,
    },
    {
      label: 'Memory',
      status: 'ok' as const,
      detail: perfMetrics?.memory
        ? `${Math.round((perfMetrics.memory.heapUsed || 0) / 1024 / 1024)}MB`
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
  {/* System Status */}
  <div className="panel p-4">
    <h2 className="font-semibold mb-4 flex items-center gap-2">
      <Database className="w-4 h-4 text-neon-blue" />
      System Status
    </h2>
    <pre className="bg-lattice-void p-4 rounded-lg overflow-auto max-h-96 text-sm font-mono text-gray-300">
      {JSON.stringify(status, null, 2)}
    </pre>
  </div>

  {/* Performance Metrics */}
  {perfMetrics && (
    <div className="panel p-4">
      <h2 className="font-semibold mb-4 flex items-center gap-2">
        <Cpu className="w-4 h-4 text-neon-cyan" />
        Performance Metrics
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
        {perfMetrics.uptime && (
          <div className="bg-lattice-deep p-3 rounded-lg">
            <p className="text-xs text-gray-400">Uptime</p>
            <p className="text-lg font-mono text-neon-green">
              {formatUptime(perfMetrics.uptime)}
            </p>
          </div>
        )}
        {perfMetrics.memory?.heapUsed && (
          <div className="bg-lattice-deep p-3 rounded-lg">
            <p className="text-xs text-gray-400">Heap Used</p>
            <p className="text-lg font-mono text-neon-blue">
              {Math.round(perfMetrics.memory.heapUsed / 1024 / 1024)}MB
            </p>
          </div>
        )}
        {perfMetrics.memory?.heapTotal && (
          <div className="bg-lattice-deep p-3 rounded-lg">
            <p className="text-xs text-gray-400">Heap Total</p>
            <p className="text-lg font-mono text-gray-300">
              {Math.round(perfMetrics.memory.heapTotal / 1024 / 1024)}MB
            </p>
          </div>
        )}
      </div>
      <pre className="bg-lattice-void p-4 rounded-lg overflow-auto max-h-48 text-xs font-mono text-gray-400">
        {JSON.stringify(perfMetrics, null, 2)}
      </pre>
    </div>
  )}

  {/* Jobs Status */}
  <div className="panel p-4">
    <h2 className="font-semibold mb-4 flex items-center gap-2">
      <Play className="w-4 h-4 text-neon-green" />
      Jobs Status
    </h2>
    <pre className="bg-lattice-void p-4 rounded-lg overflow-auto max-h-60 text-sm font-mono text-gray-300">
      {JSON.stringify(jobs, null, 2)}
    </pre>
  </div>
</div>

    </div>
  );
}
