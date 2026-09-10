'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity, ArrowLeftRight, BarChart3, GitMerge, Loader2, RefreshCw, XCircle, Zap,
} from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensData } from '@/lib/hooks/use-lens-data';

/** Bridge connection macros — connectionHealth / dataMapping / syncStatus / throughputAnalysis */
export function BridgeActionsPanel() {
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const { items: bridgeItems } = useLensData('bridge', 'connection', { noSeed: true });
  const runAction = useRunArtifact('bridge');

  const handleBridgeAction = async (action: string) => {
    const targetId = bridgeItems[0]?.id;
    if (!targetId) return;
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) {
        setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` });
      } else {
        setActionResult(res.result as Record<string, unknown>);
      }
    } catch (e) {
      console.error(`Action ${action} failed:`, e);
      setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` });
    }
    setIsRunning(null);
  };

  return (
    <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
      <h2 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
        <Zap className="w-4 h-4 text-purple-400" />
        Bridge Actions
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        {[
          { action: 'connectionHealth', label: 'Connection Health', icon: <Activity className="w-4 h-4" /> },
          { action: 'dataMapping', label: 'Data Mapping', icon: <GitMerge className="w-4 h-4" /> },
          { action: 'syncStatus', label: 'Sync Status', icon: <RefreshCw className="w-4 h-4" /> },
          { action: 'throughputAnalysis', label: 'Throughput Analysis', icon: <BarChart3 className="w-4 h-4" /> },
        ].map(({ action, label, icon }) => (
          <button
            key={action}
            onClick={() => handleBridgeAction(action)}
            disabled={isRunning !== null || bridgeItems.length === 0}
            className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isRunning === action ? <Loader2 className="w-4 h-4 animate-spin text-purple-400" /> : icon}
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>
      {bridgeItems.length === 0 && (
        <p className="text-xs text-zinc-400 text-center py-1">No bridge connection artifact found — actions are unavailable.</p>
      )}
      {actionResult && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="p-4 bg-zinc-800 rounded-lg border border-purple-500/30"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-purple-400" /> Action Result
            </h3>
            <button onClick={() => setActionResult(null)} className="text-zinc-400 hover:text-zinc-300 transition-colors" title="Dismiss">
              <XCircle className="w-4 h-4" />
            </button>
          </div>

          {actionResult.overallHealth !== undefined && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className={`text-3xl font-bold font-mono ${
                  (actionResult.overallHealth as number) >= 80 ? 'text-green-400' :
                  (actionResult.overallHealth as number) >= 50 ? 'text-amber-400' : 'text-red-400'
                }`}>{actionResult.overallHealth as number}</div>
                <div>
                  <p className="text-xs text-zinc-400">Overall Health Score</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    (actionResult.overallHealth as number) >= 80 ? 'bg-green-500/20 text-green-400' :
                    (actionResult.overallHealth as number) >= 50 ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400'
                  }`}>
                    {(actionResult.overallHealth as number) >= 80 ? 'Healthy' : (actionResult.overallHealth as number) >= 50 ? 'Degraded' : 'Critical'}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 bg-zinc-900 rounded text-center">
                  <p className="text-sm font-bold text-green-400">{actionResult.healthy as number}</p>
                  <p className="text-[10px] text-zinc-400">Healthy</p>
                </div>
                <div className="p-2 bg-zinc-900 rounded text-center">
                  <p className="text-sm font-bold text-amber-400">{actionResult.degraded as number}</p>
                  <p className="text-[10px] text-zinc-400">Degraded</p>
                </div>
                <div className="p-2 bg-zinc-900 rounded text-center">
                  <p className="text-sm font-bold text-red-400">{actionResult.critical as number}</p>
                  <p className="text-[10px] text-zinc-400">Critical</p>
                </div>
              </div>
              {(actionResult.connections as Array<{ name: string; status: string; latencyMs: number; uptimePercent: number; errorRate: number; healthScore: number }>)?.map((conn, i) => (
                <div key={i} className="flex items-center justify-between p-2 bg-zinc-900 rounded">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      conn.status === 'healthy' ? 'bg-green-400' : conn.status === 'degraded' ? 'bg-amber-400' : 'bg-red-400'
                    }`} />
                    <span className="text-sm text-zinc-200">{conn.name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-zinc-400">
                    <span>{conn.latencyMs}ms</span>
                    <span>{conn.uptimePercent}% up</span>
                    <span className={`font-bold ${
                      conn.status === 'healthy' ? 'text-green-400' : conn.status === 'degraded' ? 'text-amber-400' : 'text-red-400'
                    }`}>{conn.healthScore}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {actionResult.coverage !== undefined && actionResult.mappings !== undefined && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className={`text-3xl font-bold font-mono ${
                  (actionResult.coverage as number) >= 90 ? 'text-green-400' :
                  (actionResult.coverage as number) >= 60 ? 'text-amber-400' : 'text-red-400'
                }`}>{actionResult.coverage as number}%</div>
                <p className="text-xs text-zinc-400">Field Coverage</p>
              </div>
              <div className="w-full bg-zinc-900 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${
                    (actionResult.coverage as number) >= 90 ? 'bg-green-400' :
                    (actionResult.coverage as number) >= 60 ? 'bg-amber-400' : 'bg-red-400'
                  }`}
                  style={{ width: `${actionResult.coverage as number}%` }}
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 bg-zinc-900 rounded text-center">
                  <p className="text-sm font-bold text-zinc-200">{actionResult.total as number}</p>
                  <p className="text-[10px] text-zinc-400">Total</p>
                </div>
                <div className="p-2 bg-zinc-900 rounded text-center">
                  <p className="text-sm font-bold text-green-400">{actionResult.valid as number}</p>
                  <p className="text-[10px] text-zinc-400">Valid</p>
                </div>
                <div className="p-2 bg-zinc-900 rounded text-center">
                  <p className="text-sm font-bold text-red-400">{actionResult.invalid as number}</p>
                  <p className="text-[10px] text-zinc-400">Invalid</p>
                </div>
              </div>
              {(actionResult.transforms as string[])?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  <span className="text-[10px] text-zinc-400 self-center mr-1">Transforms:</span>
                  {(actionResult.transforms as string[]).map((t, i) => (
                    <span key={i} className="text-xs px-1.5 py-0.5 bg-purple-500/20 text-purple-300 rounded">{t}</span>
                  ))}
                </div>
              )}
              {(actionResult.mappings as Array<{ sourceField: string; targetField: string; transform: string; dataType: string; valid: boolean }>)?.slice(0, 5).map((m, i) => (
                <div key={i} className="flex items-center gap-2 text-xs p-2 bg-zinc-900 rounded">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${m.valid ? 'bg-green-400' : 'bg-red-400'}`} />
                  <span className="text-zinc-300 font-mono">{m.sourceField}</span>
                  <ArrowLeftRight className="w-3 h-3 text-zinc-600 flex-shrink-0" />
                  <span className="text-zinc-300 font-mono">{m.targetField}</span>
                  <span className="ml-auto text-zinc-400">{m.transform}</span>
                </div>
              ))}
            </div>
          )}

          {actionResult.syncHealth !== undefined && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className={`text-sm font-bold px-3 py-1 rounded-full ${
                  actionResult.syncHealth === 'real-time' ? 'bg-green-500/20 text-green-400' :
                  actionResult.syncHealth === 'recent' ? 'bg-cyan-500/20 text-cyan-400' :
                  actionResult.syncHealth === 'stale' ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400'
                }`}>{String(actionResult.syncHealth).toUpperCase()}</span>
                <p className="text-xs text-zinc-400">
                  {actionResult.lastSync === 'never' ? 'Never synced' : `Last sync ${actionResult.minutesSinceSync as number} min ago`}
                </p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="p-2 bg-zinc-900 rounded text-center">
                  <p className="text-sm font-bold text-zinc-200">{actionResult.totalSyncs as number}</p>
                  <p className="text-[10px] text-zinc-400">Total Syncs</p>
                </div>
                <div className="p-2 bg-zinc-900 rounded text-center">
                  <p className="text-sm font-bold text-cyan-400">{(actionResult.totalRecordsProcessed as number).toLocaleString()}</p>
                  <p className="text-[10px] text-zinc-400">Records</p>
                </div>
                <div className="p-2 bg-zinc-900 rounded text-center">
                  <p className="text-sm font-bold text-red-400">{actionResult.totalErrors as number}</p>
                  <p className="text-[10px] text-zinc-400">Errors</p>
                </div>
                <div className="p-2 bg-zinc-900 rounded text-center">
                  <p className="text-sm font-bold text-amber-400">{actionResult.errorRate as number}%</p>
                  <p className="text-[10px] text-zinc-400">Error Rate</p>
                </div>
              </div>
              {actionResult.lastSync !== 'never' && (
                <p className="text-[10px] text-zinc-400 font-mono">
                  Last sync: {new Date(actionResult.lastSync as string).toLocaleString()}
                </p>
              )}
            </div>
          )}

          {actionResult.avgRPS !== undefined && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className={`text-3xl font-bold font-mono ${
                  (actionResult.avgRPS as number) >= 100 ? 'text-green-400' :
                  (actionResult.avgRPS as number) >= 50 ? 'text-amber-400' : 'text-red-400'
                }`}>{actionResult.avgRPS as number}</div>
                <div>
                  <p className="text-xs text-zinc-400">Avg Records / sec</p>
                  <span className="text-xs text-zinc-400">{actionResult.dataPoints as number} data points</span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 bg-zinc-900 rounded text-center">
                  <p className="text-sm font-bold text-green-400">{actionResult.peakRPS as number}</p>
                  <p className="text-[10px] text-zinc-400">Peak RPS</p>
                </div>
                <div className="p-2 bg-zinc-900 rounded text-center">
                  <p className="text-sm font-bold text-cyan-400">{actionResult.avgRPS as number}</p>
                  <p className="text-[10px] text-zinc-400">Avg RPS</p>
                </div>
                <div className="p-2 bg-zinc-900 rounded text-center">
                  <p className="text-sm font-bold text-zinc-400">{actionResult.minRPS as number}</p>
                  <p className="text-[10px] text-zinc-400">Min RPS</p>
                </div>
              </div>
              {!!actionResult.bottleneck && (
                <div className={`flex items-start gap-2 text-xs p-2 rounded ${
                  String(actionResult.bottleneck).startsWith('Low') ? 'bg-amber-500/10 text-amber-300' : 'bg-green-500/10 text-green-300'
                }`}>
                  <Activity className="w-3 h-3 flex-shrink-0 mt-0.5" />
                  {actionResult.bottleneck as string}
                </div>
              )}
            </div>
          )}

          {!!actionResult.message &&
            actionResult.overallHealth === undefined &&
            actionResult.coverage === undefined &&
            actionResult.syncHealth === undefined &&
            actionResult.avgRPS === undefined && (
            <p className="text-sm text-zinc-400">{actionResult.message as string}</p>
          )}
        </motion.div>
      )}
    </div>
  );
}
