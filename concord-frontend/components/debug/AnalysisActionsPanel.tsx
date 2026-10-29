'use client';

/**
 * AnalysisActionsPanel — logAnalysis / errorCluster / performanceProfile /
 * stackTraceAnalysis, each with a real input path (S5): paste your own
 * logs / errors / traces / stacks, or pull the data from your Debug
 * workspace (issues, recorded traces). The engines answer from the
 * input given — outputs name the input's actual contents.
 */
import { useCallback, useState } from 'react';
import { Zap, Loader2, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

type Engine = 'logAnalysis' | 'errorCluster' | 'performanceProfile' | 'stackTraceAnalysis';

const ENGINE_LABEL: Record<Engine, string> = {
  logAnalysis: 'Log Analysis',
  errorCluster: 'Error Cluster',
  performanceProfile: 'Perf Profile',
  stackTraceAnalysis: 'Stack Trace',
};

const ENGINE_HINT: Record<Engine, string> = {
  logAnalysis: 'Paste log lines (or a JSON array of {timestamp, level, message}). Plain lines are level-detected.',
  errorCluster: 'Paste one error message per line (or a JSON array of {message}), or cluster the issues already in your workspace.',
  performanceProfile: 'Paste spans as a JSON array of {name, startMs, endMs}, or profile the traces recorded in your workspace.',
  stackTraceAnalysis: 'Paste one or more stack traces (separate multiple traces with a blank line), or analyze the stacks on your workspace issues.',
};

function parseLogLines(text: string): Array<Record<string, unknown>> {
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) return arr;
    } catch { /* fall through to line parsing */ }
  }
  const now = Date.now();
  return trimmed.split('\n').filter((l) => l.trim()).map((line, i) => {
    const m = line.match(/\b(FATAL|ERROR|WARN|WARNING|INFO|DEBUG)\b/i);
    return {
      timestamp: new Date(now + i * 1000).toISOString(),
      level: (m ? m[1].toLowerCase() : 'info'),
      message: line.trim(),
      source: 'pasted',
    };
  });
}

export function AnalysisActionsPanel() {
  const [engine, setEngine] = useState<Engine>('logAnalysis');
  const [input, setInput] = useState('');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const runWith = useCallback(async (action: Engine, payload: Record<string, unknown>) => {
    setActiveAction(action);
    setActionResult(null);
    setNotice(null);
    const r = await lensRun('debug', action, payload);
    setActiveAction(null);
    if (r.data?.ok && r.data.result) {
      setActionResult(r.data.result as Record<string, unknown>);
    } else {
      setActionResult({ message: `Action failed: ${r.data?.error || 'Unknown error'}` });
    }
  }, []);

  const runPasted = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    if (engine === 'logAnalysis') {
      void runWith(engine, { logs: parseLogLines(text) });
    } else if (engine === 'errorCluster') {
      let errors: Array<Record<string, unknown>>;
      if (text.startsWith('[')) {
        try { errors = JSON.parse(text); } catch { errors = []; }
      } else {
        errors = text.split('\n').filter((l) => l.trim()).map((message) => ({ message: message.trim() }));
      }
      void runWith(engine, { errors });
    } else if (engine === 'performanceProfile') {
      try {
        const traces = JSON.parse(text);
        if (!Array.isArray(traces)) throw new Error('not an array');
        void runWith(engine, { traces });
      } catch {
        setActionResult({ message: 'Perf Profile input must be a JSON array of spans ({name, startMs, endMs}).' });
      }
    } else {
      const stackTraces = text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)
        .map((stack) => ({ error: stack.split('\n')[0] || 'Error', stack }));
      void runWith(engine, { stackTraces });
    }
  }, [engine, input, runWith]);

  const runFromWorkspace = useCallback(async () => {
    setActiveAction(engine);
    setActionResult(null);
    setNotice(null);
    try {
      if (engine === 'errorCluster') {
        const r = await lensRun('debug', 'issue-list', {});
        const issues = (r.data?.result?.issues || []) as Array<{ type: string; message: string; count: number; culprit: string | null }>;
        if (!issues.length) { setNotice('Your workspace has no issues yet — record or capture one first, or paste errors instead.'); setActiveAction(null); return; }
        await runWith(engine, { errors: issues.map((i) => ({ message: `${i.type}: ${i.message}`, count: i.count, source: i.culprit || 'workspace' })) });
      } else if (engine === 'performanceProfile') {
        const list = await lensRun('debug', 'trace-list', {});
        const tracesMeta = (list.data?.result?.traces || []) as Array<{ id: string }>;
        if (!tracesMeta.length) { setNotice('No recorded traces yet — capture one in the Traces tool, or paste spans instead.'); setActiveAction(null); return; }
        const spans: Array<Record<string, unknown>> = [];
        for (const t of tracesMeta.slice(0, 5)) {
          const d = await lensRun('debug', 'trace-detail', { id: t.id });
          const trace = d.data?.result?.trace as { spans?: Array<Record<string, unknown>> } | undefined;
          for (const sp of trace?.spans || []) spans.push(sp);
        }
        await runWith(engine, { traces: spans });
      } else if (engine === 'stackTraceAnalysis') {
        const list = await lensRun('debug', 'issue-list', {});
        const issues = (list.data?.result?.issues || []) as Array<{ id: string }>;
        const stackTraces: Array<Record<string, unknown>> = [];
        for (const i of issues.slice(0, 10)) {
          const d = await lensRun('debug', 'issue-detail', { id: i.id });
          const issue = d.data?.result?.issue as { type: string; message: string; stack?: string | null } | undefined;
          if (issue?.stack) stackTraces.push({ error: `${issue.type}: ${issue.message}`, stack: issue.stack });
        }
        if (!stackTraces.length) { setNotice('None of your issues carries a stack trace yet — paste one instead.'); setActiveAction(null); return; }
        await runWith(engine, { stackTraces });
      }
    } catch {
      setActionResult({ message: 'Could not load workspace data for this engine.' });
      setActiveAction(null);
    }
  }, [engine, runWith]);

  return (
<div className="panel p-4 space-y-3">
  <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
    <Zap className="w-4 h-4 text-neon-cyan" /> AI Debug Analysis
  </h3>
  <div className="flex flex-wrap gap-2">
    {(Object.keys(ENGINE_LABEL) as Engine[]).map((action) => (
      <button
        key={action}
        onClick={() => { setEngine(action); setActionResult(null); setNotice(null); }}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-colors ${
          engine === action
            ? 'bg-neon-cyan/20 border-neon-cyan/50 text-neon-cyan'
            : 'bg-neon-cyan/5 border-neon-cyan/20 text-gray-300 hover:bg-neon-cyan/10'
        }`}
      >
        <Zap className="w-3 h-3" />
        {ENGINE_LABEL[action]}
      </button>
    ))}
  </div>
  <p className="text-[11px] text-gray-500">{ENGINE_HINT[engine]}</p>
  <textarea
    value={input}
    onChange={(e) => setInput(e.target.value)}
    rows={5}
    placeholder={`Paste input for ${ENGINE_LABEL[engine]}…`}
    className="w-full px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs font-mono"
  />
  <div className="flex flex-wrap items-center gap-2">
    <button
      onClick={runPasted}
      disabled={activeAction !== null || !input.trim()}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan hover:bg-neon-cyan/20 disabled:opacity-50 transition-colors"
    >
      {activeAction === engine ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
      Run {ENGINE_LABEL[engine]}
    </button>
    {engine !== 'logAnalysis' && (
      <button
        onClick={runFromWorkspace}
        disabled={activeAction !== null}
        className="px-3 py-1.5 text-xs rounded bg-lattice-surface border border-lattice-border text-gray-300 hover:text-white disabled:opacity-50"
      >
        {engine === 'errorCluster' ? 'Use my workspace issues' : engine === 'performanceProfile' ? 'Use my recorded traces' : 'Use my issues\u2019 stacks'}
      </button>
    )}
    {notice && <span className="text-[11px] text-yellow-400">{notice}</span>}
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
