'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useState } from 'react';
import { Activity, Loader2, GitCompare, Layers, Gauge } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { allDocs } from './local-store';

interface ConflictSummary {
  totalKeys: number;
  conflictCount: number;
  conflictRate: number;
  replicaCount: number;
  highSeverityConflicts: number;
  avgSeverity: number;
}

interface SyncConflictResult {
  conflicts: { key: string; severity: number; severityLevel: string; resolution: string }[];
  strategy: string;
  summary: ConflictSummary;
}

interface CacheStrategyResult {
  hotColdSplit: { hotCount: number; coldCount: number; hotAccessShare: number; paretoRatio: string };
  evictionPolicy: {
    lru: { hits: number; hitRate: number };
    lfu: { hits: number; hitRate: number };
    recommended: string;
  };
  ttlOptimization: { globalRecommendedTtlSeconds: number };
}

interface DeltaResult {
  changes: { added: number; removed: number; modified: number; unchanged: number };
  bandwidth: {
    fullStateSizeBytes: number;
    deltaSizeBytes: number;
    compressedDeltaBytes: number;
    deltaSavingsPercent: number;
    networkEstimates: Record<string, { fullSync: number; deltaSync: number }>;
  };
  recommendation: string;
}

type Tab = 'conflict' | 'cache' | 'delta';

/**
 * Sync-analysis surface. Feeds REAL data from the local IndexedDB store into
 * the three pure-compute macros (`syncConflict`, `cacheStrategy`,
 * `deltaCompute`) and renders the results as purpose-built charts — never a
 * raw JSON dump.
 */
export function SyncAnalysisPanel() {
  const [tab, setTab] = useState<Tab>('conflict');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [conflict, setConflict] = useState<SyncConflictResult | null>(null);
  const [cache, setCache] = useState<CacheStrategyResult | null>(null);
  const [delta, setDelta] = useState<DeltaResult | null>(null);

  const runConflict = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const docs = await allDocs();
      if (docs.length < 1) {
        setErr('Write some local documents first — the analysis runs on real data.');
        return;
      }
      // Build two replicas from the real local docs: one as-stored, one with a
      // simulated concurrent edit per doc so the LWW/CRDT math has work to do.
      const replicaA: Record<string, any> = {};
      const replicaB: Record<string, any> = {};
      docs.forEach((d, i) => {
        const ts = Date.parse(d.updatedAt) || Date.now();
        replicaA[d.id] = { value: d.body, timestamp: ts, vectorClock: { a: i + 1, b: i } };
        replicaB[d.id] = {
          value: { ...d.body, _rev: d.rev },
          timestamp: ts + 1000,
          vectorClock: { a: i, b: i + 1 },
        };
      });
      const r = await lensRun<SyncConflictResult>('offline', 'syncConflict', {
        replicas: [
          { replicaId: 'a', state: replicaA },
          { replicaId: 'b', state: replicaB },
        ],
        strategy: 'lww',
      });
      if (!r.data.ok || !r.data.result) {
        setErr(r.data.error || 'syncConflict failed');
        return;
      }
      setConflict(r.data.result);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'conflict error');
    } finally {
      setBusy(false);
    }
  }, []);

  const runCache = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const docs = await allDocs();
      if (docs.length < 1) {
        setErr('Write some local documents first — the analysis runs on real data.');
        return;
      }
      // Real access log: each doc's updatedAt is a genuine access event;
      // dirty docs get an extra recent access (they were just written).
      const accessLog: { key: string; timestamp: string; sizeBytes: number }[] = [];
      for (const d of docs) {
        accessLog.push({
          key: d.id,
          timestamp: d.updatedAt,
          sizeBytes: JSON.stringify(d.body).length,
        });
        if (d.dirty) {
          accessLog.push({
            key: d.id,
            timestamp: new Date().toISOString(),
            sizeBytes: JSON.stringify(d.body).length,
          });
        }
      }
      const r = await lensRun<CacheStrategyResult>('offline', 'cacheStrategy', {
        accessLog,
        cacheCapacity: Math.max(10, Math.ceil(docs.length / 2)),
      });
      if (!r.data.ok || !r.data.result) {
        setErr(r.data.error || 'cacheStrategy failed');
        return;
      }
      setCache(r.data.result);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'cache error');
    } finally {
      setBusy(false);
    }
  }, []);

  const runDelta = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const docs = await allDocs();
      if (docs.length < 1) {
        setErr('Write some local documents first — the analysis runs on real data.');
        return;
      }
      // Base state = clean docs, current state = full local store. The delta is
      // exactly the set of dirty/new writes awaiting replication.
      const baseState: Record<string, unknown> = {};
      const currentState: Record<string, unknown> = {};
      for (const d of docs) {
        currentState[d.id] = d.body;
        if (!d.dirty) baseState[d.id] = d.body;
      }
      const r = await lensRun<DeltaResult>('offline', 'deltaCompute', {
        baseState,
        currentState,
        compressionRatio: 0.6,
      });
      if (!r.data.ok || !r.data.result) {
        setErr(r.data.error || 'deltaCompute failed');
        return;
      }
      setDelta(r.data.result);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'delta error');
    } finally {
      setBusy(false);
    }
  }, []);

  const run = useCallback(() => {
    if (tab === 'conflict') return runConflict();
    if (tab === 'cache') return runCache();
    return runDelta();
  }, [tab, runConflict, runCache, runDelta]);

  const tabs: { id: Tab; label: string; icon: typeof Activity }[] = [
    { id: 'conflict', label: 'CRDT conflict', icon: GitCompare },
    { id: 'cache', label: 'Cache strategy', icon: Layers },
    { id: 'delta', label: 'Delta bandwidth', icon: Gauge },
  ];

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-purple-300" />
          <h2 className="text-sm font-semibold text-white">Sync intelligence</h2>
        </div>
        <button
          onClick={run}
          disabled={busy}
          className="flex items-center gap-1.5 rounded bg-purple-500/15 px-3 py-1.5 text-xs text-purple-300 hover:bg-purple-500/25 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
          Analyze local store
        </button>
      </header>

      <div className="flex gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs ${
              tab === t.id
                ? 'bg-purple-500/20 text-purple-200'
                : 'border border-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {err && (
        <p className="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300">
          {err}
        </p>
      )}

      {tab === 'conflict' && conflict && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              { l: 'Keys', v: conflict.summary.totalKeys },
              { l: 'Conflicts', v: conflict.summary.conflictCount },
              { l: 'Conflict rate', v: `${conflict.summary.conflictRate}%` },
              { l: 'Avg severity', v: conflict.summary.avgSeverity },
            ].map((m) => (
              <div key={m.l} className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-2">
                <div className="text-[10px] uppercase tracking-wider text-zinc-400">{m.l}</div>
                <div className="mt-0.5 font-mono text-lg text-zinc-200">{m.v}</div>
              </div>
            ))}
          </div>
          {conflict.conflicts.length > 0 && (
            <ChartKit
              kind="bar"
              data={conflict.conflicts.slice(0, 12).map((c) => ({
                key: c.key.length > 14 ? `${c.key.slice(0, 13)}…` : c.key,
                severity: c.severity,
              }))}
              xKey="key"
              series={[{ key: 'severity', label: 'severity', color: '#ec4899' }]}
              height={180}
            />
          )}
          <div className="space-y-1">
            {conflict.conflicts.slice(0, 8).map((c) => (
              <div
                key={c.key}
                className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-[11px]"
              >
                <span className="font-mono text-zinc-200">{c.key}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${
                    c.severityLevel === 'high'
                      ? 'bg-rose-500/15 text-rose-300'
                      : c.severityLevel === 'moderate'
                        ? 'bg-amber-500/15 text-amber-300'
                        : 'bg-emerald-500/15 text-emerald-300'
                  }`}
                >
                  {c.severityLevel} · {c.resolution}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'cache' && cache && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              { l: 'Hot keys', v: cache.hotColdSplit.hotCount },
              { l: 'Cold keys', v: cache.hotColdSplit.coldCount },
              { l: 'Recommended', v: cache.evictionPolicy.recommended },
              { l: 'Global TTL', v: `${cache.ttlOptimization.globalRecommendedTtlSeconds}s` },
            ].map((m) => (
              <div key={m.l} className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-2">
                <div className="text-[10px] uppercase tracking-wider text-zinc-400">{m.l}</div>
                <div className="mt-0.5 font-mono text-lg text-zinc-200">{m.v}</div>
              </div>
            ))}
          </div>
          <ChartKit
            kind="bar"
            data={[
              { policy: 'LRU', hitRate: cache.evictionPolicy.lru.hitRate },
              { policy: 'LFU', hitRate: cache.evictionPolicy.lfu.hitRate },
            ]}
            xKey="policy"
            series={[{ key: 'hitRate', label: 'hit rate %', color: '#06b6d4' }]}
            height={170}
          />
          <p className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-[11px] text-zinc-400">
            {cache.hotColdSplit.paretoRatio}
          </p>
        </div>
      )}

      {tab === 'delta' && delta && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              { l: 'Added', v: delta.changes.added },
              { l: 'Modified', v: delta.changes.modified },
              { l: 'Removed', v: delta.changes.removed },
              { l: 'Delta savings', v: `${delta.bandwidth.deltaSavingsPercent}%` },
            ].map((m) => (
              <div key={m.l} className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-2">
                <div className="text-[10px] uppercase tracking-wider text-zinc-400">{m.l}</div>
                <div className="mt-0.5 font-mono text-lg text-zinc-200">{m.v}</div>
              </div>
            ))}
          </div>
          <ChartKit
            kind="bar"
            data={Object.entries(delta.bandwidth.networkEstimates).map(([net, est]) => ({
              network: net.toUpperCase(),
              fullSync: est.fullSync,
              deltaSync: est.deltaSync,
            }))}
            xKey="network"
            series={[
              { key: 'fullSync', label: 'full sync (ms)', color: '#ef4444' },
              { key: 'deltaSync', label: 'delta sync (ms)', color: '#22c55e' },
            ]}
            height={180}
          />
          <p className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-[11px] text-zinc-400">
            {delta.bandwidth.fullStateSizeBytes} B full ·{' '}
            {delta.bandwidth.compressedDeltaBytes} B compressed delta — recommendation:{' '}
            <span className="font-mono text-cyan-300">{delta.recommendation}</span>
          </p>
        </div>
      )}

      {!conflict && !cache && !delta && !err && (
        <p className="rounded border border-dashed border-zinc-800 px-3 py-4 text-center text-[11px] text-zinc-400">
          Run the analysis to score conflict resolution, cache strategy, and
          delta bandwidth against your real local store.
        </p>
      )}
    </div>
  );
}
