'use client';

import {
  Play, Clock, Zap, RefreshCw, BarChart3, ListOrdered, Timer,
  AlertTriangle, Pause, PlayCircle, Trash2, Server, ShieldAlert,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { ChartKit } from '@/components/viz';
import { EnqueueForm } from '@/components/queue/EnqueueForm';
import type { QueueRow, QueueMetrics } from '@/components/queue/useQueueData';
import type { QueueEvent } from '@/components/queue/JobDetailDrawer';
import type { EnqueueInput } from '@/components/queue/EnqueueForm';

export function OverviewPanel({
  metrics,
  queues,
  events,
  queueFilter,
  setQueueFilter,
  onProcessNext,
  onControl,
  onConcurrency,
  onClearCompleted,
  onEnqueue,
}: {
  metrics: QueueMetrics | null | undefined;
  queues: QueueRow[];
  events: QueueEvent[];
  queueFilter: string;
  setQueueFilter: (v: string) => void;
  onProcessNext: () => void;
  onControl: (queue: string, paused: boolean) => void;
  onConcurrency: (queue: string, concurrency: number) => void;
  onClearCompleted: () => void;
  onEnqueue: (input: EnqueueInput) => void;
}) {
  const t = metrics?.totals;
  const tp = metrics?.throughput;
  const alerts = metrics?.alerts || [];
  const queueNames = queues.map((q) => q.name);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          onClick={onProcessNext}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-500/30"
        >
          <Play className="h-4 w-4" /> Process next
        </button>
      </div>

      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                a.level === 'critical'
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
              }`}
            >
              {a.level === 'critical' ? (
                <ShieldAlert className="h-4 w-4 shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0" />
              )}
              <span>{a.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="lens-card">
          <ListOrdered className="mb-2 h-5 w-5 text-neon-cyan" />
          <p className="text-2xl font-bold text-neon-cyan">{t?.depth ?? 0}</p>
          <p className="text-sm text-gray-400">Queue Depth</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="lens-card">
          <Timer className="mb-2 h-5 w-5 text-neon-green" />
          <p className="text-2xl font-bold text-neon-green">{tp?.ratePerMin ?? 0}/min</p>
          <p className="text-sm text-gray-400">Processing Rate</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="lens-card">
          <Zap className="mb-2 h-5 w-5 text-neon-purple" />
          <p className="text-2xl font-bold text-neon-purple">{tp?.completed24h ?? 0}</p>
          <p className="text-sm text-gray-400">Completed (24h)</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="lens-card">
          <Clock className="mb-2 h-5 w-5 text-yellow-400" />
          <p className="text-2xl font-bold text-yellow-400">{tp?.avgLatencyMs ?? 0}ms</p>
          <p className="text-sm text-gray-400">Avg Latency</p>
        </motion.div>
      </div>

      <div className="panel space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="h-4 w-4 text-neon-cyan" /> Throughput &amp; Latency (last hour)
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartKit
            kind="bar"
            data={(tp?.series || []) as unknown as Array<Record<string, unknown>>}
            xKey="slot"
            series={[
              { key: 'processed', label: 'Processed', color: '#22c55e' },
              { key: 'failed', label: 'Failed', color: '#ef4444' },
            ]}
            stacked
            height={200}
          />
          <ChartKit
            kind="line"
            data={(tp?.series || []) as unknown as Array<Record<string, unknown>>}
            xKey="slot"
            series={[{ key: 'latencyMs', label: 'Latency (ms)', color: '#06b6d4' }]}
            height={200}
          />
        </div>
      </div>

      {metrics && (
        <div className="panel space-y-3 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Zap className="h-4 w-4 text-neon-purple" /> Priority Lanes (waiting)
          </h2>
          {(['high', 'normal', 'low'] as const).map((p) => {
            const count = metrics.byPriority[p];
            const total =
              metrics.byPriority.high + metrics.byPriority.normal + metrics.byPriority.low || 1;
            const pct = Math.round((count / total) * 100);
            const color =
              p === 'high' ? 'bg-rose-500' : p === 'low' ? 'bg-zinc-500' : 'bg-neon-blue';
            return (
              <div key={p} className="flex items-center gap-3">
                <span className="w-28 text-xs capitalize text-gray-400">{p} priority</span>
                <div className="h-4 flex-1 overflow-hidden rounded-full bg-lattice-deep">
                  <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                </div>
                <span className="w-8 text-right font-mono text-xs">{count}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="panel space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Server className="h-4 w-4 text-neon-cyan" /> Queues
          </h2>
          <button
            onClick={onClearCompleted}
            className="flex items-center gap-1 rounded bg-white/5 px-2 py-1 text-xs text-gray-400 hover:bg-white/10"
          >
            <Trash2 className="h-3 w-3" /> Clear completed
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {queues.length === 0 && (
            <p className="col-span-full py-4 text-center text-sm text-gray-400">
              No queues yet. Enqueue a job to create one.
            </p>
          )}
          {queues.map((q) => (
            <div key={q.name} className="rounded-lg border border-white/10 bg-black/30 p-3">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setQueueFilter(queueFilter === q.name ? '' : q.name)}
                  className={`text-sm font-semibold ${
                    queueFilter === q.name ? 'text-neon-cyan' : 'text-white'
                  }`}
                >
                  {q.name}
                </button>
                <button
                  onClick={() => onControl(q.name, !q.paused)}
                  title={q.paused ? 'Resume' : 'Pause'}
                  className={`rounded p-1.5 ${
                    q.paused
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-emerald-500/20 text-emerald-300'
                  }`}
                >
                  {q.paused ? <PlayCircle className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                <span className="rounded bg-zinc-700/40 px-1.5 py-0.5 text-zinc-300">
                  depth {q.depth}
                </span>
                <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-cyan-300">
                  active {q.counts.active}
                </span>
                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-300">
                  done {q.counts.completed}
                </span>
                {q.counts.dead > 0 && (
                  <span className="rounded bg-red-700/30 px-1.5 py-0.5 text-red-300">
                    dead {q.counts.dead}
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <label className="text-[10px] text-gray-400">Concurrency</label>
                <input
                  type="number"
                  min={1}
                  max={64}
                  defaultValue={q.concurrency}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v !== q.concurrency) onConcurrency(q.name, v);
                  }}
                  className="w-14 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-xs text-white"
                />
                {q.paused && <span className="text-[10px] text-amber-400">paused</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <EnqueueForm
        queues={queueNames.length ? queueNames : ['ingest', 'autocrawl', 'terminal']}
        busy={false}
        onEnqueue={onEnqueue}
      />

      <div className="panel space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <RefreshCw className="h-4 w-4 text-neon-cyan" /> Recent Activity
        </h2>
        {events.length === 0 ? (
          <p className="py-4 text-center text-xs text-gray-400">No activity yet.</p>
        ) : (
          <div className="space-y-1.5">
            {events.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-3 rounded bg-black/30 px-3 py-2 transition-colors hover:bg-white/5"
              >
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] uppercase text-zinc-400">
                  {e.kind}
                </span>
                <span className="flex-1 text-xs text-gray-300">{e.message}</span>
                <span className="text-xs text-gray-400">
                  {new Date(e.at).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
