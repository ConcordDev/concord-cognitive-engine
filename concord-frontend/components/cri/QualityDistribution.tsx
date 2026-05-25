'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface DtuQuality { id: string; title?: string; creti?: { coherence?: number; relevance?: number; evidence?: number; truth?: number; insight?: number; aggregate?: number }; tier?: string; domain?: string }

export function QualityDistribution() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 30000); return () => clearInterval(id); }, []);
  useEffect(() => { void tick; }, [tick]);

  const dtus = useQuery({
    queryKey: ['cri-dtus-recent'],
    queryFn: async () => {
      const r = await api.get('/api/dtus', { params: { limit: 200 } });
      const data = r.data as { dtus?: DtuQuality[] } | DtuQuality[];
      return (Array.isArray(data) ? data : data.dtus || []) as DtuQuality[];
    },
    refetchInterval: 30000,
  });

  const list = dtus.data || [];
  const withCreti = list.filter((d) => d.creti);
  const dims = ['coherence', 'relevance', 'evidence', 'truth', 'insight'] as const;
  const dimMeans: Record<string, number> = {};
  for (const d of dims) {
    const vals = withCreti.map((dtu) => (dtu.creti as Record<string, number>)?.[d]).filter((v) => typeof v === 'number');
    dimMeans[d] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  }
  const aggMean = withCreti.length ? withCreti.reduce((s, d) => s + (d.creti?.aggregate || 0), 0) / withCreti.length : 0;
  const histogram = new Array(10).fill(0);
  for (const d of withCreti) {
    const a = d.creti?.aggregate || 0;
    const bucket = Math.min(9, Math.floor(a * 10));
    histogram[bucket]++;
  }
  const histMax = Math.max(1, ...histogram);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">CRETI quality distribution</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">/api/dtus · live CRETI scores · 30s poll</span>
        </div>
        {list.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="concord-creti"
            title={`CRETI distribution — ${withCreti.length}/${list.length} DTUs scored`}
            content={`Total DTUs sampled: ${list.length}\nDTUs with CRETI: ${withCreti.length}\nMean aggregate: ${aggMean.toFixed(3)}\n\nDimension means:\n${dims.map((d) => `  ${d}: ${dimMeans[d].toFixed(3)}`).join('\n')}\n\nAggregate histogram (10 buckets):\n${histogram.map((n, i) => `  ${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}: ${n}`).join('\n')}`}
            extraTags={['cri', 'creti', 'quality']}
            rawData={{ count: list.length, scoredCount: withCreti.length, dimMeans, aggMean, histogram }}
          />
        )}
      </header>
      {dtus.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">DTU substrate unreachable.</div>}
      {dtus.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cell label="Sampled DTUs" value={list.length.toString()} />
        <Cell label="With CRETI" value={withCreti.length.toString()} />
        <Cell label="Mean aggregate" value={aggMean.toFixed(3)} />
        <Cell label="Coverage" value={`${list.length ? Math.round((withCreti.length / list.length) * 100) : 0}%`} />
      </div>
      {withCreti.length > 0 && (
        <>
          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="mb-2 text-xs font-semibold text-zinc-200">Dimension means</div>
            <div className="space-y-1">
              {dims.map((d) => (
                <div key={d} className="flex items-center gap-2 text-[11px]">
                  <span className="w-20 font-mono capitalize text-zinc-400">{d}</span>
                  <div className="flex-1 rounded-full bg-zinc-800">
                    <div className="h-2 rounded-full bg-cyan-500/60" style={{ width: `${dimMeans[d] * 100}%` }} />
                  </div>
                  <span className="w-12 text-right font-mono text-cyan-300">{dimMeans[d].toFixed(3)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="mb-2 text-xs font-semibold text-zinc-200">Aggregate histogram</div>
            <div className="flex items-end gap-1 h-24">
              {histogram.map((n, i) => (
                <div key={i} className="flex-1 rounded-t bg-cyan-500/40" style={{ height: `${(n / histMax) * 100}%` }} title={`${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}: ${n}`} />
              ))}
            </div>
            <div className="mt-1 flex justify-between font-mono text-[9px] text-zinc-400"><span>0.0</span><span>0.5</span><span>1.0</span></div>
          </div>
        </>
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="mt-0.5 font-mono text-lg text-cyan-300">{value}</div>
    </div>
  );
}
