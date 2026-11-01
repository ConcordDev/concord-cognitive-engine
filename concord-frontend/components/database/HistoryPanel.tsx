'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, Trash2, History, CheckCircle, XCircle, Copy, Play } from 'lucide-react';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { lensRun } from '@/lib/api/client';
import type { QueryHistoryEntry } from './db-utils';

interface ServerHistoryEntry {
  id: string;
  connectionName?: string;
  sql: string;
  durationMs: number;
  rowCount: number;
  success: boolean;
  error?: string | null;
  at: string;
}

export function HistoryPanel({ onLoadQuery }: { onLoadQuery?: (sql: string) => void }) {
  const { latestData: realtimeData, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('database');

  // S6: History reads the server's query-history — the log query-run
  // writes for BOTH editors (Console and Query Editor). It previously
  // read the Query Editor's private lens-data list, so console runs
  // never appeared and Clear only hid the list locally (a stale card
  // survived). One source, refetched; Clear clears the server log.
  const [queryHistory, setQueryHistory] = useState<(QueryHistoryEntry & { source?: string })[]>([]);
  const loadHistory = useCallback(async () => {
    const r = await lensRun<{ history: ServerHistoryEntry[] }>('database', 'query-history', { limit: 200 });
    if (r.data.ok && r.data.result) {
      setQueryHistory(r.data.result.history.map((h) => ({
        id: h.id as unknown as number,
        sql: h.sql,
        timestamp: Date.parse(h.at) || Date.now(),
        duration: h.durationMs,
        rowCount: h.rowCount,
        success: h.success,
        source: h.connectionName,
      })));
    }
  }, []);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const clearHistory = useCallback(async () => {
    await lensRun('database', 'history-clear', {});
    await loadHistory();
  }, [loadHistory]);

  // The analysis quartet moved to the Analysis tab (S8), where it runs
  // on real inputs (workspace tables + this history) instead of a
  // saved-query artifact.

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2 text-neon-orange">
          <Clock className="w-4 h-4" />
          Query History ({queryHistory.length})
        </h2>
        {queryHistory.length > 0 && (
          <button
            onClick={clearHistory}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </button>
        )}
      </div>
      {queryHistory.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-gray-400">
          <History className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm">No queries executed yet</p>
          <p className="text-xs mt-1">Execute a query in the editor and it will appear here</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {queryHistory.map(entry => (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-lattice-surface border border-lattice-border/50 rounded p-3 space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs">
                  {entry.success
                    ? <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                    : <XCircle className="w-3.5 h-3.5 text-red-400" />}
                  <span className="text-gray-400">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                  <span className="text-gray-600">|</span>
                  <span className="text-gray-400">{entry.duration}ms</span>
                  <span className="text-gray-600">|</span>
                  <span className="text-gray-400">{entry.rowCount} rows</span>
                  {entry.source && (
                    <>
                      <span className="text-gray-600">|</span>
                      <span className="text-gray-500">{entry.source}</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { navigator.clipboard.writeText(entry.sql); }}
                    className="p-1 hover:bg-lattice-border/30 rounded transition-colors"
                    title="Copy to clipboard"
                  >
                    <Copy className="w-3 h-3 text-gray-400" />
                  </button>
                  <button
                    onClick={() => onLoadQuery?.(entry.sql)}
                    className="p-1 hover:bg-lattice-border/30 rounded transition-colors"
                    title="Load in editor"
                  >
                    <Play className="w-3 h-3 text-neon-cyan" />
                  </button>
                </div>
              </div>
              <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap break-all bg-lattice-bg/50 rounded p-2">
                {entry.sql}
              </pre>
            </motion.div>
          ))}
        </div>
      )}


      {realtimeData && (
        <RealtimeDataPanel
          domain="database"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
    </div>
  );
}
