'use client';

/**
 * /lenses/evo — Evolution browser.
 *
 * Surfaces the evo-asset registry so players + creators can see how
 * the world's procgen + evo pool has diversified over time:
 *
 *   - Stats: totals by source + kind (how many CC0 seeds vs evolved variants)
 *   - Recent promotions: the last N variants the gate accepted into the
 *     canonical pool (what's changed in the world)
 *   - Per-asset lineage: click any row → AssetLineageTree modal
 *
 * Read-only — promotion happens in the heartbeat
 * (`emergent/evo-asset/scheduler.js`); this lens just witnesses it.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { lensRun } from '@/lib/api/client';
import { Sprout, TrendingUp, Layers, X, GitBranch } from 'lucide-react';
import { AssetLineageTree } from '@/components/evo/AssetLineageTree';
import { cn } from '@/lib/utils';

const PASS_KIND_LABEL: Record<string, string> = {
  subdivision: 'Subdivision',
  detail_maps: 'Detail maps',
  material_upgrade: 'Material upgrade',
  procedural_wear: 'Procedural wear',
  higher_lod: 'Higher LOD',
  authored_replacement: 'Authored replacement',
};

export default function EvoLensPage() {
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

  const stats = useQuery({
    queryKey: ['evo-stats'],
    queryFn: () => lensRun('evo', 'asset-stats', {}).then(r => r.data),
    refetchInterval: 30_000,
  });
  const promotions = useQuery({
    queryKey: ['evo-recent-promotions'],
    queryFn: () => lensRun('evo', 'recent-promotions', { limit: 30 }).then(r => r.data),
    refetchInterval: 30_000,
  });

  const total = stats.data?.result?.total ?? 0;
  const bySource: Array<{ source: string; n: number }> = stats.data?.result?.bySource ?? [];
  const byKind: Array<{ kind: string; n: number }> = stats.data?.result?.byKind ?? [];
  const rows: Array<{
    version_id: string;
    asset_id: string;
    version_number: number;
    pass_kind: string;
    diff_summary?: string;
    promoted_at: number;
    kind: string;
    source: string;
    category?: string;
  }> = promotions.data?.result?.promotions ?? [];

  return (
    <main className="min-h-screen bg-lattice-bg text-white p-6 lg:p-8 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Sprout className="w-6 h-6 text-emerald-400" />
          Evolution
        </h1>
        <p className="text-sm text-gray-400 mt-1 max-w-2xl">
          The world&apos;s seed pool and how it&apos;s diversifying. Each promoted
          variant is a refinement the quality gate accepted into the canonical
          pool — players + NPCs interact with these directly.
        </p>
      </header>

      {/* Stats row */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <div className="rounded-lg border border-white/10 bg-lattice-deep/50 p-4">
          <p className="text-[10px] uppercase tracking-wider text-gray-400">Total assets</p>
          <p className="text-2xl font-semibold mt-1">{total.toLocaleString()}</p>
          <p className="text-[11px] text-gray-400 mt-1">across {bySource.length} source{bySource.length === 1 ? '' : 's'}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-lattice-deep/50 p-4">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
            <Layers className="w-3 h-3" /> By kind
          </p>
          <ul className="text-xs mt-2 space-y-0.5">
            {byKind.slice(0, 6).map(k => (
              <li key={k.kind} className="flex justify-between">
                <span className="text-gray-300">{k.kind}</span>
                <span className="text-gray-400 font-mono">{k.n}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-white/10 bg-lattice-deep/50 p-4">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
            <Sprout className="w-3 h-3" /> By source
          </p>
          <ul className="text-xs mt-2 space-y-0.5">
            {bySource.slice(0, 6).map(s => (
              <li key={s.source} className="flex justify-between">
                <span className="text-gray-300 capitalize">{s.source}</span>
                <span className="text-gray-400 font-mono">{s.n}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Recent promotions */}
      <section>
        <header className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-cyan-400" />
            Recent promotions
          </h2>
          <span className="text-[11px] text-gray-400">
            {rows.length} variant{rows.length === 1 ? '' : 's'} accepted into the canonical pool
          </span>
        </header>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-white/10 bg-lattice-deep/50 p-6 text-center text-sm text-gray-400">
            No promotions yet. The evo cycle runs every ~30 minutes — variants
            need to accumulate interaction signal before the gate accepts them.
            Check back later.
          </div>
        ) : (
          <ul className="divide-y divide-white/5 rounded-lg border border-white/10 bg-lattice-deep/30 overflow-hidden">
            {rows.map((row) => (
              <li key={row.version_id}>
                <button
                  type="button"
                  onClick={() => setSelectedAssetId(row.asset_id)}
                  className="w-full text-left px-4 py-3 hover:bg-white/[0.03] transition-colors flex items-start gap-3"
                >
                  <GitBranch className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-white">
                        {row.kind} <span className="text-gray-400">·</span> v{row.version_number} <span className="text-gray-400">·</span> <span className="text-cyan-300">{PASS_KIND_LABEL[row.pass_kind] || row.pass_kind}</span>
                      </span>
                      <span className="text-[10px] text-gray-400 flex-shrink-0">
                        {row.promoted_at ? new Date(row.promoted_at * 1000).toLocaleString() : ''}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      from <span className="capitalize">{row.source}</span>
                      {row.category && <> · {row.category}</>}
                      <span className="text-gray-500"> · {row.asset_id.slice(0, 12)}…</span>
                    </div>
                    {row.diff_summary && (
                      <p className="text-[11px] text-gray-300 mt-1 leading-snug">{row.diff_summary}</p>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Lineage modal */}
      {selectedAssetId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Asset lineage"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setSelectedAssetId(null)}
        >
          <div
            className="bg-lattice-surface border border-white/10 rounded-lg shadow-2xl max-w-xl w-full max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            role="presentation"
          >
            <header className="flex items-center justify-between px-4 py-3 border-b border-white/10 sticky top-0 bg-lattice-surface">
              <h3 className="text-sm font-semibold">Asset lineage</h3>
              <button
                type="button"
                onClick={() => setSelectedAssetId(null)}
                className="text-gray-400 hover:text-white"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </header>
            <div className="p-4">
              <AssetLineageTree assetId={selectedAssetId} />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
