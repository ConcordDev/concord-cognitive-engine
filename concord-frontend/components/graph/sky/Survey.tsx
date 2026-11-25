'use client';

/**
 * The survey: the graph's own analysis run over exactly the stars and links
 * on the chart right now (the count is shown with every result). Density,
 * diameter and clustering (graph.graphMetrics); how many separate groups
 * the chart falls into (graph.clusterDetect); the most central stars by
 * degree, betweenness and closeness (graph.nodeAnalysis).
 */

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import type { SkyLine, Star } from './gx';

type Kind = 'graphMetrics' | 'clusterDetect' | 'nodeAnalysis';
interface Metrics { density: number; densityLabel: string; averageDegree: number; maxDegree: number; diameter: number | null; averagePathLength: number | null; clusteringCoefficient: number; isConnected: boolean }
interface ClusterOut { clusterCount: number; clusters: { clusterId: number; size: number; nodes: string[] }[]; summary: { largestClusterSize: number; isolatedNodes: number; connectivity: string } }
interface NodeOut { nodes: { id: string; degreeCentrality: number; betweennessCentrality: number; closenessCentrality: number }[] }

const KINDS: { id: Kind; label: string; note: string }[] = [
  { id: 'graphMetrics', label: 'Survey the sky', note: 'density, diameter, clustering' },
  { id: 'clusterDetect', label: 'Count the groups', note: 'separate regions of the chart' },
  { id: 'nodeAnalysis', label: 'Find the hubs', note: 'the most central stars' },
];
const n2 = (x: number | null | undefined) => (x == null ? '—' : Number(x).toFixed(Math.abs(Number(x)) < 1 ? 3 : 1));

export function Survey({ stars, lines, onPoint }: { stars: Star[]; lines: SkyLine[]; onPoint: (id: string) => void }) {
  const [busy, setBusy] = useState<Kind | null>(null);
  const [out, setOut] = useState<{ kind: Kind; data: unknown; n: number; m: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const title = (id: string) => stars.find((s) => s.id === id)?.title || id;

  const run = async (kind: Kind) => {
    setBusy(kind); setErr(null);
    const nodes = stars.map((s) => ({ id: s.id }));
    const edges = lines.map((l) => ({ source: l.a, target: l.b }));
    try {
      const r = await lensRun('graph', kind, { nodes, edges });
      const d = r.data as { ok?: boolean; result?: unknown; error?: string } | undefined;
      if (!d?.ok) throw new Error(d?.error || 'The survey did not run.');
      setOut({ kind, data: d.result, n: nodes.length, m: edges.length });
    } catch (e) { setErr(e instanceof Error ? e.message : 'The survey did not run.'); }
    setBusy(null);
  };

  return (
    <section className="space-y-3" aria-label="Survey" data-testid="sk-survey">
      <div className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button key={k.id} type="button" className="sk-btn" onClick={() => { void run(k.id); }} disabled={!!busy || stars.length === 0} title={k.note} data-testid={`sk-survey-${k.id}`}>
            {busy === k.id ? 'Surveying…' : k.label}
          </button>
        ))}
      </div>
      {err && <p className="sk-error" role="alert">{err}</p>}
      {out && (
        <div className="sk-card sk-rise p-3 text-[13px]" data-testid="sk-survey-result">
          <p className="sk-label mb-2">Over the {out.n} stars and {out.m} links on the chart</p>
          {out.kind === 'graphMetrics' && (() => {
            const m = (out.data as { metrics?: Metrics }).metrics;
            if (!m) return <p className="text-[var(--sk-muted)]">Nothing to measure yet.</p>;
            return (
              <dl className="sk-mono grid grid-cols-2 gap-x-4 gap-y-1">
                <dt className="text-[var(--sk-muted)]">density</dt><dd>{n2(m.density)} ({m.densityLabel})</dd>
                <dt className="text-[var(--sk-muted)]">avg links</dt><dd>{n2(m.averageDegree)} (max {m.maxDegree})</dd>
                <dt className="text-[var(--sk-muted)]">diameter</dt><dd>{m.isConnected ? m.diameter : 'not all connected'}</dd>
                <dt className="text-[var(--sk-muted)]">avg path</dt><dd>{n2(m.averagePathLength)}</dd>
                <dt className="text-[var(--sk-muted)]">clustering</dt><dd>{n2(m.clusteringCoefficient)}</dd>
              </dl>
            );
          })()}
          {out.kind === 'clusterDetect' && (() => {
            const c = out.data as ClusterOut;
            return (
              <div className="space-y-1">
                <p><span className="sk-mono">{c.clusterCount}</span> separate groups · largest <span className="sk-mono">{c.summary?.largestClusterSize}</span> stars · <span className="sk-mono">{c.summary?.isolatedNodes}</span> lone stars · {c.summary?.connectivity}</p>
              </div>
            );
          })()}
          {out.kind === 'nodeAnalysis' && (() => {
            const top = ((out.data as NodeOut).nodes || []).slice(0, 8);
            return (
              <ol className="space-y-0.5">
                {top.map((n) => (
                  <li key={n.id} className="flex items-baseline gap-2">
                    <button type="button" className="sk-link sk-atlas min-w-0 flex-1 truncate italic" onClick={() => onPoint(n.id)}>{title(n.id)}</button>
                    <span className="sk-mono text-[11px] text-[var(--sk-muted)]">deg {n2(n.degreeCentrality)} · btw {n2(n.betweennessCentrality)}</span>
                  </li>
                ))}
              </ol>
            );
          })()}
        </div>
      )}
    </section>
  );
}
