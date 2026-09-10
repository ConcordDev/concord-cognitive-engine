'use client';

import { Terminal, Search, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { ErrorState } from '@/components/common/EmptyState';
import { useDebugDesk, type LogLevel } from '@/components/debug/useDebugDesk';

export function LogsPanel() {
  const {
    logEntries, filteredLogs, logFilter, setLogFilter, logSearch, setLogSearch,
    isLoading, isError, errorMessage, refetchAll,
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
    <div className="space-y-4">
{/* Log Level Badges */}
<motion.div
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  transition={{ delay: 0.35 }}
  className="flex items-center gap-2 flex-wrap"
>
  <Terminal className="w-3.5 h-3.5 text-gray-400" />
  {[
    {
      level: 'INFO',
      color: 'bg-neon-blue/15 text-neon-blue border-neon-blue/30',
      count: logEntries.filter((l) => l.level === 'info').length,
    },
    {
      level: 'WARN',
      color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
      count: logEntries.filter((l) => l.level === 'warn').length,
    },
    {
      level: 'ERROR',
      color: 'bg-red-500/15 text-red-400 border-red-500/30',
      count: logEntries.filter((l) => l.level === 'error').length,
    },
    {
      level: 'DEBUG',
      color: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
      count: logEntries.filter((l) => l.level === 'debug').length,
    },
  ].map((badge) => (
    <span
      key={badge.level}
      className={`text-[10px] px-2 py-0.5 rounded-full border ${badge.color} font-mono`}
    >
      {badge.level}{' '}
      {badge.count > 0 && <span className="ml-1 opacity-70">{badge.count}</span>}
    </span>
  ))}
</motion.div>

<div className="panel p-4">
  <div className="flex items-center justify-between mb-4">
    <h2 className="font-semibold flex items-center gap-2">
      <Terminal className="w-4 h-4 text-neon-green" />
      System Logs ({filteredLogs.length})
    </h2>
    <div className="flex items-center gap-2">
      <select
        value={logFilter}
        onChange={(e) => setLogFilter(e.target.value as LogLevel)}
        className="px-2 py-1 bg-lattice-surface border border-lattice-border rounded text-xs"
      >
        <option value="all">All Levels</option>
        <option value="info">Info</option>
        <option value="warn">Warning</option>
        <option value="error">Error</option>
        <option value="debug">Debug</option>
      </select>
    </div>
  </div>
  <div className="relative mb-3">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
    <input
      className="w-full pl-10 pr-8 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm focus:border-neon-cyan outline-none"
      placeholder="Filter logs..."
      value={logSearch}
      onChange={(e) => setLogSearch(e.target.value)}
    />
    {logSearch && (
      <button
        onClick={() => setLogSearch('')}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
      aria-label="Close">
        <X className="w-4 h-4" />
      </button>
    )}
  </div>
  <div className="bg-lattice-void rounded-lg overflow-auto max-h-[500px] font-mono text-xs">
    {filteredLogs.length === 0 ? (
      <div className="text-center py-12 text-gray-400">
        <Terminal className="w-8 h-8 mx-auto mb-3 opacity-40" />
        <p>No matching log entries</p>
      </div>
    ) : (
      filteredLogs.map((log, i) => (
        <div
          key={i}
          className={`flex gap-3 px-3 py-1.5 border-b border-lattice-border/30 hover:bg-lattice-surface/30 ${
            log.level === 'error'
              ? 'bg-red-500/5'
              : log.level === 'warn'
                ? 'bg-yellow-500/5'
                : ''
          }`}
        >
          <span className="text-gray-600 shrink-0 w-20">
            {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '--:--:--'}
          </span>
          <span
            className={`shrink-0 w-12 uppercase ${
              log.level === 'error'
                ? 'text-red-400'
                : log.level === 'warn'
                  ? 'text-yellow-400'
                  : log.level === 'debug'
                    ? 'text-gray-400'
                    : 'text-neon-blue'
            }`}
          >
            {log.level}
          </span>
          <span className="text-gray-300 break-all">{log.message}</span>
        </div>
      ))
    )}
  </div>
</div>

    </div>
  );
}
