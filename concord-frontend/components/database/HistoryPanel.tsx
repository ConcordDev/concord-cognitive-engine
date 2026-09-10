'use client';

import { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, Trash2, History, CheckCircle, XCircle, Copy, Play, Zap, Loader2 } from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import type { QueryHistoryEntry } from './db-utils';

export function HistoryPanel({ onLoadQuery }: { onLoadQuery?: (sql: string) => void }) {
  const { items: queryItems } = useLensData('database', 'query', { seed: [] });
  const { latestData: realtimeData, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('database');
  const runAction = useRunArtifact('database');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);

  const queryHistory: QueryHistoryEntry[] = useMemo(() => {
    if (cleared) return [];
    return (queryItems || []).map((item, i) => {
      const d = (item.data || {}) as Partial<QueryHistoryEntry>;
      return {
        id: d.id ?? i,
        sql: String(d.sql || item.title || ''),
        timestamp: d.timestamp ?? Date.now(),
        duration: d.duration ?? 0,
        rowCount: d.rowCount ?? 0,
        success: d.success !== false,
      };
    });
  }, [queryItems, cleared]);

  const handleDbAction = useCallback(async (action: string) => {
    const targetId = queryItems[0]?.id;
    if (!targetId) return;
    setActiveAction(action);
    setActionResult(null);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setActiveAction(null);
  }, [queryItems, runAction]);

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2 text-neon-orange">
          <Clock className="w-4 h-4" />
          Query History ({queryHistory.length})
        </h2>
        {queryHistory.length > 0 && (
          <button
            onClick={() => setCleared(true)}
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

      <div className="panel p-4 space-y-4">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Zap className="w-4 h-4 text-neon-orange" /> Database Analysis Actions
        </h3>
        <div className="flex flex-wrap gap-2">
          {(['schemaAnalysis','queryOptimize','migrationPlan','indexRecommendation'] as const).map(action => (
            <button
              key={action}
              onClick={() => handleDbAction(action)}
              disabled={!!activeAction || !queryItems[0]?.id}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-neon-orange/10 border border-neon-orange/30 text-neon-orange hover:bg-neon-orange/20 disabled:opacity-40 transition-colors"
            >
              {activeAction === action ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {action === 'schemaAnalysis' ? 'Schema Analysis' : action === 'queryOptimize' ? 'Query Optimize' : action === 'migrationPlan' ? 'Migration Plan' : 'Index Recommendations'}
            </button>
          ))}
        </div>

        {actionResult && actionResult.healthScore !== undefined && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-sm font-bold text-neon-cyan">{String(actionResult.totalTables ?? 0)}</p>
                <p className="text-[10px] text-gray-400">Tables</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-sm font-bold text-neon-green">{String(actionResult.totalColumns ?? 0)}</p>
                <p className="text-[10px] text-gray-400">Columns</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className={`text-sm font-bold ${Number(actionResult.totalIssues) > 0 ? 'text-red-400' : 'text-neon-green'}`}>{String(actionResult.totalIssues ?? 0)}</p>
                <p className="text-[10px] text-gray-400">Issues</p>
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Health Score</span>
                <span className="font-bold text-neon-green">{String(actionResult.healthScore ?? 0)}/100</span>
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-neon-green rounded-full transition-all" style={{ width: `${actionResult.healthScore ?? 0}%` }} />
              </div>
            </div>
            {!!actionResult.normalizationTip && <p className="text-xs text-gray-400 italic">{String(actionResult.normalizationTip)}</p>}
            {Array.isArray(actionResult.tables) && actionResult.tables.length > 0 && (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {(actionResult.tables as Array<{table:string;columns:number;hasPrimaryKey:boolean;indexedColumns:number;issues:string[]}>).map((t, i) => (
                  <div key={i} className="flex items-center justify-between text-xs bg-lattice-surface/50 rounded px-2 py-1">
                    <span className="font-medium text-gray-200">{t.table}</span>
                    <span className="text-gray-400">{t.columns} cols</span>
                    {t.issues.length > 0 ? (
                      <span className="text-red-400">{t.issues[0]}</span>
                    ) : (
                      <span className="text-neon-green">OK</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {actionResult && actionResult.grade !== undefined && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className={`text-2xl font-bold ${actionResult.grade === 'A' ? 'text-neon-green' : actionResult.grade === 'F' ? 'text-red-400' : 'text-yellow-400'}`}>{String(actionResult.grade)}</p>
                <p className="text-[10px] text-gray-400">Query Grade</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className={`text-xl font-bold ${Number(actionResult.issueCount) > 0 ? 'text-orange-400' : 'text-neon-green'}`}>{String(actionResult.issueCount ?? 0)}</p>
                <p className="text-[10px] text-gray-400">Issues Found</p>
              </div>
            </div>
            {Array.isArray(actionResult.issues) && actionResult.issues.length > 0 && (
              <div className="space-y-1">
                {(actionResult.issues as Array<{issue:string;fix:string;severity:string}>).map((issue, i) => (
                  <div key={i} className="rounded px-3 py-2 bg-lattice-surface/50 space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-200">{issue.issue}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${issue.severity === 'critical' ? 'bg-red-500/20 text-red-400' : issue.severity === 'high' ? 'bg-orange-500/20 text-orange-400' : 'bg-yellow-500/20 text-yellow-400'}`}>{issue.severity}</span>
                    </div>
                    <p className="text-[10px] text-gray-400">{issue.fix}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {actionResult && actionResult.estimatedDowntime !== undefined && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-sm font-bold text-neon-cyan">{String(actionResult.totalChanges ?? 0)}</p>
                <p className="text-[10px] text-gray-400">Changes</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className={`text-sm font-bold ${Number(actionResult.highRiskChanges) > 0 ? 'text-red-400' : 'text-neon-green'}`}>{String(actionResult.highRiskChanges ?? 0)}</p>
                <p className="text-[10px] text-gray-400">High Risk</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-xs font-bold text-yellow-400">{String(actionResult.estimatedDowntime)}</p>
                <p className="text-[10px] text-gray-400">Downtime</p>
              </div>
            </div>
            {!!actionResult.recommendation && <p className={`text-xs px-3 py-2 rounded ${Number(actionResult.highRiskChanges) > 0 ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-neon-green/10 text-neon-green border border-neon-green/20'}`}>{String(actionResult.recommendation)}</p>}
            {Array.isArray(actionResult.steps) && actionResult.steps.length > 0 && (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {(actionResult.steps as Array<{step:number;operation:string;table:string;risk:string;reversible:boolean}>).map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs bg-lattice-surface/50 rounded px-2 py-1">
                    <span className="text-gray-400">#{s.step}</span>
                    <span className="font-mono text-neon-cyan">{s.operation}</span>
                    <span className="text-gray-300 flex-1">{s.table}</span>
                    <span className={`text-[10px] px-1 rounded ${s.risk === 'high' ? 'bg-red-500/20 text-red-400' : s.risk === 'medium' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-neon-green/20 text-neon-green'}`}>{s.risk}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {actionResult && actionResult.suggestedIndexes !== undefined && actionResult.estimatedDowntime === undefined && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-sm font-bold text-neon-cyan">{String(actionResult.queriesAnalyzed ?? 0)}</p>
                <p className="text-[10px] text-gray-400">Queries Analyzed</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-sm font-bold text-neon-orange">{String(actionResult.suggestedIndexes ?? 0)}</p>
                <p className="text-[10px] text-gray-400">Indexes Suggested</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center col-span-1">
                <p className="text-xs font-bold text-neon-green">{String(actionResult.estimatedSpeedup ?? '—')}</p>
                <p className="text-[10px] text-gray-400">Speed Gain</p>
              </div>
            </div>
            {Array.isArray(actionResult.recommendations) && (actionResult.recommendations as Array<{column:string;reason:string;type:string}>).map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs bg-lattice-surface/50 rounded px-2 py-1">
                <span className="font-mono text-neon-orange">{r.column}</span>
                <span className="text-gray-400 flex-1">{r.reason}</span>
                <span className="text-[10px] px-1 rounded bg-neon-cyan/10 text-neon-cyan">{r.type}</span>
              </div>
            ))}
          </div>
        )}

        {actionResult && !!actionResult.message && (
          <p className="text-xs text-gray-400 italic">{String(actionResult.message)}</p>
        )}
      </div>

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
