'use client';

/**
 * AnalysisActionsPanel — logAnalysis / errorCluster / performanceProfile / stackTraceAnalysis
 * via useRunArtifact('debug'). Extracted from the former page chrome.
 */
import { Zap, Loader2, AlertTriangle } from 'lucide-react';
import { useDebugDesk } from '@/components/debug/useDebugDesk';

export function AnalysisActionsPanel() {
  const { debugItems, actionResult, activeAction, handleDebugAction } = useDebugDesk();

  return (
<div className="panel p-4 space-y-3">
  <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
    <Zap className="w-4 h-4 text-neon-cyan" /> AI Debug Analysis
  </h3>
  <div className="flex flex-wrap gap-2">
    {(
      ['logAnalysis', 'errorCluster', 'performanceProfile', 'stackTraceAnalysis'] as const
    ).map((action) => (
      <button
        key={action}
        onClick={() => handleDebugAction(action)}
        disabled={activeAction !== null || !debugItems[0]?.id}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan hover:bg-neon-cyan/20 disabled:opacity-50 transition-colors"
      >
        {activeAction === action ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Zap className="w-3 h-3" />
        )}
        {action === 'logAnalysis'
          ? 'Log Analysis'
          : action === 'errorCluster'
            ? 'Error Cluster'
            : action === 'performanceProfile'
              ? 'Perf Profile'
              : 'Stack Trace'}
      </button>
    ))}
  </div>

  {/* logAnalysis result */}
  {actionResult &&
    actionResult.totalLogs !== undefined &&
    actionResult.logsPerSecond !== undefined && (
      <div className="space-y-3 pt-2 border-t border-white/5">
        <div className="grid grid-cols-4 gap-2">
          <div className="p-2 bg-lattice-surface rounded text-center">
            <p className="text-lg font-bold text-neon-cyan">
              {String(actionResult.totalLogs)}
            </p>
            <p className="text-[10px] text-gray-400">Total Logs</p>
          </div>
          <div className="p-2 bg-lattice-surface rounded text-center">
            <p
              className={`text-lg font-bold ${Number(actionResult.errorRate) > 10 ? 'text-red-400' : Number(actionResult.errorRate) > 5 ? 'text-yellow-400' : 'text-neon-green'}`}
            >
              {String(actionResult.errorRate)}%
            </p>
            <p className="text-[10px] text-gray-400">Error Rate</p>
          </div>
          <div className="p-2 bg-lattice-surface rounded text-center">
            <p className="text-lg font-bold text-neon-purple">
              {String(actionResult.logsPerSecond)}
            </p>
            <p className="text-[10px] text-gray-400">Logs/sec</p>
          </div>
          <div className="p-2 bg-lattice-surface rounded text-center">
            <p className="text-lg font-bold text-yellow-400">
              {Array.isArray(actionResult.topPatterns)
                ? (actionResult.topPatterns as unknown[]).length
                : 0}
            </p>
            <p className="text-[10px] text-gray-400">Patterns</p>
          </div>
        </div>
        {!!actionResult.levelDistribution && (
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">
              Level Distribution
            </p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(actionResult.levelDistribution as Record<string, number>).map(
                ([level, count]) => (
                  <span
                    key={level}
                    className={`px-2 py-0.5 text-[10px] rounded border font-mono ${
                      level === 'error' || level === 'fatal'
                        ? 'bg-red-400/10 border-red-400/30 text-red-400'
                        : level === 'warn'
                          ? 'bg-yellow-400/10 border-yellow-400/30 text-yellow-400'
                          : 'bg-neon-cyan/10 border-neon-cyan/30 text-neon-cyan'
                    }`}
                  >
                    {level.toUpperCase()}: {count}
                  </span>
                )
              )}
            </div>
          </div>
        )}
        {Array.isArray(actionResult.sourceHotspots) &&
          (
            actionResult.sourceHotspots as Array<{
              source: string;
              errors: number;
              errorRate: number;
            }>
          ).length > 0 && (
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">
                Error Hotspots
              </p>
              <div className="space-y-1">
                {(
                  actionResult.sourceHotspots as Array<{
                    source: string;
                    errors: number;
                    errorRate: number;
                  }>
                )
                  .slice(0, 5)
                  .map((s, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="text-gray-300 font-mono flex-1 truncate">
                        {s.source}
                      </span>
                      <span className="text-red-400">{s.errors} errors</span>
                      <span className="text-gray-400">{s.errorRate}%</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        {Array.isArray(actionResult.spikes) &&
          (actionResult.spikes as unknown[]).length > 0 && (
            <p className="text-xs text-yellow-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />{' '}
              {(actionResult.spikes as unknown[]).length} error spike(s) detected
            </p>
          )}
      </div>
    )}

  {/* errorCluster result */}
  {actionResult &&
    actionResult.uniqueClusters !== undefined &&
    actionResult.deduplicationRatio !== undefined && (
      <div className="space-y-3 pt-2 border-t border-white/5">
        <div className="grid grid-cols-3 gap-2">
          <div className="p-2 bg-lattice-surface rounded text-center">
            <p className="text-lg font-bold text-neon-cyan">
              {String(actionResult.totalErrors)}
            </p>
            <p className="text-[10px] text-gray-400">Total Errors</p>
          </div>
          <div className="p-2 bg-lattice-surface rounded text-center">
            <p className="text-lg font-bold text-neon-purple">
              {String(actionResult.uniqueClusters)}
            </p>
            <p className="text-[10px] text-gray-400">Clusters</p>
          </div>
          <div className="p-2 bg-lattice-surface rounded text-center">
            <p className="text-lg font-bold text-neon-green">
              {String(actionResult.deduplicationRatio)}%
            </p>
            <p className="text-[10px] text-gray-400">Dedup Ratio</p>
          </div>
        </div>
        {Array.isArray(actionResult.clusters) && (
          <div className="space-y-2">
            {(
              actionResult.clusters as Array<{
                representative: string;
                memberCount: number;
                totalOccurrences: number;
                severity: string;
                sources: string[];
                commonFrame: string | null;
              }>
            )
              .slice(0, 5)
              .map((cluster, i) => (
                <div
                  key={i}
                  className={`p-2 rounded border text-xs ${
                    cluster.severity === 'critical'
                      ? 'border-red-400/30 bg-red-400/5'
                      : cluster.severity === 'high'
                        ? 'border-orange-400/30 bg-orange-400/5'
                        : 'border-white/5 bg-white/[0.02]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${cluster.severity === 'critical' ? 'bg-red-400/20 text-red-400' : cluster.severity === 'high' ? 'bg-orange-400/20 text-orange-400' : 'bg-gray-400/20 text-gray-400'}`}
                    >
                      {cluster.severity}
                    </span>
                    <span className="text-gray-400">
                      {cluster.totalOccurrences} occurrences
                    </span>
                  </div>
                  <p className="text-gray-300 font-mono truncate">{cluster.representative}</p>
                  {cluster.commonFrame && (
                    <p className="text-gray-400 font-mono text-[10px] mt-0.5 truncate">
                      {cluster.commonFrame}
                    </p>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>
    )}

  {/* performanceProfile result */}
  {actionResult &&
    actionResult.totalDurationMs !== undefined &&
    actionResult.uniqueOperations !== undefined && (
      <div className="space-y-3 pt-2 border-t border-white/5">
        <div className="grid grid-cols-3 gap-2">
          <div className="p-2 bg-lattice-surface rounded text-center">
            <p className="text-lg font-bold text-neon-cyan">
              {String(actionResult.totalTraces)}
            </p>
            <p className="text-[10px] text-gray-400">Traces</p>
          </div>
          <div className="p-2 bg-lattice-surface rounded text-center">
            <p className="text-lg font-bold text-yellow-400">
              {String(actionResult.totalDurationMs)}ms
            </p>
            <p className="text-[10px] text-gray-400">Total Time</p>
          </div>
          <div className="p-2 bg-lattice-surface rounded text-center">
            <p className="text-lg font-bold text-neon-purple">
              {String(actionResult.uniqueOperations)}
            </p>
            <p className="text-[10px] text-gray-400">Operations</p>
          </div>
        </div>
        {Array.isArray(actionResult.hotPath) &&
          (actionResult.hotPath as string[]).length > 0 && (
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">
                Hot Path
              </p>
              <div className="flex flex-wrap gap-1">
                {(actionResult.hotPath as string[]).map((p, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 text-[10px] rounded bg-orange-400/10 border border-orange-400/30 text-orange-400 font-mono"
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}
        {Array.isArray(actionResult.bottlenecks) && (
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">
              Bottlenecks
            </p>
            {(
              actionResult.bottlenecks as Array<{
                name: string;
                selfTimeMs: number;
                percentSelfTime: number;
              }>
            )
              .slice(0, 5)
              .map((b, i) => (
                <div key={i} className="flex items-center gap-2 text-xs mb-1">
                  <span className="text-gray-300 font-mono flex-1 truncate">{b.name}</span>
                  <span className="text-red-400">{b.selfTimeMs}ms</span>
                  <span className="text-gray-400">{b.percentSelfTime}%</span>
                </div>
              ))}
          </div>
        )}
      </div>
    )}

  {/* stackTraceAnalysis result */}
  {actionResult && actionResult.rootCauseCandidates !== undefined && (
    <div className="space-y-3 pt-2 border-t border-white/5">
      <div className="grid grid-cols-3 gap-2">
        <div className="p-2 bg-lattice-surface rounded text-center">
          <p className="text-lg font-bold text-neon-cyan">
            {String(actionResult.totalTraces)}
          </p>
          <p className="text-[10px] text-gray-400">Traces</p>
        </div>
        <div className="p-2 bg-lattice-surface rounded text-center">
          <p className="text-lg font-bold text-yellow-400">
            {String(
              (actionResult.userVsLibrary as Record<string, number>)?.avgUserFrames ?? 0
            )}
          </p>
          <p className="text-[10px] text-gray-400">Avg User Frames</p>
        </div>
        <div className="p-2 bg-lattice-surface rounded text-center">
          <p className="text-lg font-bold text-neon-purple">
            {String(
              (actionResult.userVsLibrary as Record<string, number>)?.avgLibraryFrames ?? 0
            )}
          </p>
          <p className="text-[10px] text-gray-400">Avg Lib Frames</p>
        </div>
      </div>
      {!!actionResult.errorTypeDistribution && (
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">
            Error Types
          </p>
          <div className="flex flex-wrap gap-1">
            {Object.entries(actionResult.errorTypeDistribution as Record<string, number>).map(
              ([type, count]) => (
                <span
                  key={type}
                  className="px-2 py-0.5 text-[10px] rounded bg-red-400/10 border border-red-400/30 text-red-400 font-mono"
                >
                  {type}: {count}
                </span>
              )
            )}
          </div>
        </div>
      )}
      {Array.isArray(actionResult.rootCauseCandidates) &&
        (
          actionResult.rootCauseCandidates as Array<{
            location: string;
            count: number;
            errors: string[];
          }>
        ).length > 0 && (
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">
              Root Cause Candidates
            </p>
            {(
              actionResult.rootCauseCandidates as Array<{
                location: string;
                count: number;
                errors: string[];
              }>
            ).map((rc, i) => (
              <div
                key={i}
                className="p-2 bg-red-400/5 border border-red-400/20 rounded text-xs mb-1"
              >
                <p className="text-red-300 font-mono text-[10px] truncate">{rc.location}</p>
                <p className="text-gray-400">{rc.count} occurrences</p>
              </div>
            ))}
          </div>
        )}
      {Array.isArray(actionResult.commonFrames) &&
        (
          actionResult.commonFrames as Array<{
            frame: string;
            occurrences: number;
            percentage: number;
          }>
        ).length > 0 && (
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-2">
              Common Frames
            </p>
            {(
              actionResult.commonFrames as Array<{
                frame: string;
                occurrences: number;
                percentage: number;
              }>
            )
              .slice(0, 4)
              .map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-xs mb-1">
                  <span className="text-gray-300 font-mono flex-1 truncate">{f.frame}</span>
                  <span className="text-neon-cyan">{f.occurrences}x</span>
                  <span className="text-gray-400">{f.percentage}%</span>
                </div>
              ))}
          </div>
        )}
    </div>
  )}

  {actionResult && !!actionResult.message && (
    <p className="text-xs text-gray-400 italic pt-1">{String(actionResult.message)}</p>
  )}
</div>

  );
}
