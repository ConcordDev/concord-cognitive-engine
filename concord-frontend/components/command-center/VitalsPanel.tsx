'use client';

import { useQuery } from '@tanstack/react-query';
import { apiHelpers, api } from '@/lib/api/client';
import {
  ArrowUp
} from 'lucide-react';
import { ConcordVitals } from '@/components/command-center/ConcordVitals';
import { Stat, BreakerBadge } from '@/components/command-center/cc-primitives';

import type { SystemHealth } from '@/components/command-center/cc-primitives';

export function VitalsPanel() {
  const { data: health } = useQuery({ queryKey: ['cc-health'], queryFn: () => apiHelpers.guidance.health().then(r => r.data), refetchInterval: 15000 });
  const { data: queue } = useQuery({ queryKey: ['cc-queue'], queryFn: () => apiHelpers.backpressure.status().then(r => r.data), refetchInterval: 15000 });
  const { data: breakers } = useQuery({ queryKey: ['cc-breakers'], queryFn: () => apiHelpers.status.get().then(r => r.data), refetchInterval: 15000 });
  const { data: traces } = useQuery({ queryKey: ['cc-traces'], queryFn: () => apiHelpers.perf.metrics().then(r => r.data), refetchInterval: 15000 });
  const { data: shadowData } = useQuery({ queryKey: ['cc-shadow-pending'], queryFn: () => api.get('/api/dtus/shadow/pending').then(r => r.data).catch(() => null), refetchInterval: 60000 });
  const { data: scopeMetrics } = useQuery({ queryKey: ['cc-scope-metrics'], queryFn: () => apiHelpers.scope.metrics().then(r => r.data).catch(() => null), refetchInterval: 30000 });

  const h = health as SystemHealth | undefined;
  const shadowCandidateCount = (shadowData?.candidates?.length || 0) + (shadowData?.pendingShadows?.length || 0);

  const scopeGlobal = scopeMetrics?.globalCount ?? 0;
  const scopeMarketplace = scopeMetrics?.marketplaceCount ?? 0;
  const scopeLocal = scopeMetrics?.localCount ?? 0;
  const scopeTotal = scopeGlobal + scopeMarketplace + scopeLocal;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">System Vitals</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat label="Uptime" value={h?.system?.uptime?.formatted || '—'} />
        <Stat label="Memory" value={h?.system?.memory?.heapUsed || '—'} sub={`of ${h?.system?.memory?.heapTotal || '?'}`} />
        <Stat label="Total DTUs" value={h?.dtus?.total ?? '—'} sub={`${h?.dtus?.shadow || 0} shadows`} />
        <Stat label="Queue Depth" value={queue?.depth ?? '—'} sub={`${queue?.processing ?? 0} active`} />
        <Stat label="p50 Latency" value={traces?.p50 ? `${traces.p50}ms` : '—'} />
        <Stat label="p99 Latency" value={traces?.p99 ? `${traces.p99}ms` : '—'} />
      </div>

      {/* Scope Distribution */}
      {scopeTotal > 0 && (
        <div className="bg-lattice-deep rounded-lg p-3 border border-lattice-border space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-400 uppercase">Scope Distribution</p>
            <span className="text-[10px] text-gray-400">{scopeTotal} scoped</span>
          </div>
          <div className="h-3 rounded-full overflow-hidden flex bg-lattice-surface">
            {scopeGlobal > 0 && (
              <div className="bg-amber-500 h-full" style={{ width: `${(scopeGlobal / scopeTotal) * 100}%` }} title={`Global: ${scopeGlobal}`} />
            )}
            {scopeMarketplace > 0 && (
              <div className="bg-blue-500 h-full" style={{ width: `${(scopeMarketplace / scopeTotal) * 100}%` }} title={`Marketplace: ${scopeMarketplace}`} />
            )}
            {scopeLocal > 0 && (
              <div className="bg-gray-500 h-full" style={{ width: `${(scopeLocal / scopeTotal) * 100}%` }} title={`Local: ${scopeLocal}`} />
            )}
          </div>
          <div className="flex items-center gap-4 text-[10px] text-gray-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Global {scopeGlobal}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Marketplace {scopeMarketplace}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-500 inline-block" /> Local {scopeLocal}</span>
          </div>
        </div>
      )}

      {/* Shadow DTU pending review indicator */}
      {shadowCandidateCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-xs text-purple-300">
          <ArrowUp className="w-3.5 h-3.5" />
          <span className="font-medium">{shadowCandidateCount} shadow DTU{shadowCandidateCount !== 1 ? 's' : ''} pending review</span>
          <span className="text-purple-500 ml-auto">See Promotions tab</span>
        </div>
      )}
      {breakers?.breakers && (
        <div className="bg-lattice-deep rounded-lg p-3 space-y-2 border border-lattice-border">
          <p className="text-xs font-semibold text-gray-400 uppercase">Circuit Breakers</p>
          {Object.entries(breakers.breakers as Record<string, { state: string }>).map(([name, b]) => (
            <BreakerBadge key={name} name={name} state={b.state || 'unknown'} />
          ))}
        </div>
      )}
      <section className="mt-6 rounded-xl border border-cyan-900/20 bg-[#0a0f18] p-4">
        <ConcordVitals />
      </section>
    </div>
  );
}
