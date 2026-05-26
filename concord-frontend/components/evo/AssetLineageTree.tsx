'use client';

/**
 * AssetLineageTree — renders the evolution chain of an evo_asset.
 *
 * Shape:
 *   Seed (depth 0) — the original authored / imported asset
 *      ↓
 *   v1 — first promoted refinement pass
 *      ↓
 *   v2, v3 …                                  (most recent at bottom)
 *
 * Source: `evo.lineage-for { assetId }` returns
 *   { asset, lineage: LineageNode[], lineageDepth }
 *
 * LineageNode = {
 *   depth, isSeed, versionNumber, passKind?, source?, localPath,
 *   gateVerdict?, diffSummary?, createdAt, promotedAt?
 * }
 */

import { useQuery } from '@tanstack/react-query';
import { lensRun } from '@/lib/api/client';
import { Sprout, GitCommitVertical, CheckCircle2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LineageNode {
  depth: number;
  isSeed: boolean;
  versionNumber: number;
  passKind?: string;
  source?: string;
  sourceId?: string;
  localPath?: string;
  gateVerdict?: string;
  diffSummary?: string;
  createdAt?: number;
  promotedAt?: number;
  qualityLevel?: number;
}

interface AssetLineageTreeProps {
  assetId: string;
  className?: string;
}

const PASS_KIND_LABEL: Record<string, string> = {
  subdivision: 'Subdivision',
  detail_maps: 'Detail maps',
  material_upgrade: 'Material upgrade',
  procedural_wear: 'Procedural wear',
  higher_lod: 'Higher LOD',
  authored_replacement: 'Authored replacement',
};

function fmtTs(ts?: number): string {
  if (!ts) return '';
  // unixepoch — seconds
  const d = new Date(ts * 1000);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fileName(p?: string): string {
  if (!p) return '—';
  return p.split('/').slice(-1)[0] || p;
}

export function AssetLineageTree({ assetId, className }: AssetLineageTreeProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['evo-lineage', assetId],
    queryFn: () => lensRun('evo', 'lineage-for', { assetId }).then(r => r.data),
    enabled: !!assetId,
  });

  if (isLoading) {
    return (
      <div className={cn('p-4 text-xs text-gray-400', className)}>
        Loading lineage…
      </div>
    );
  }
  if (error || !data?.ok) {
    return (
      <div className={cn('p-4 text-xs text-amber-400', className)}>
        Could not load lineage{data?.error ? `: ${data.error}` : ''}
      </div>
    );
  }

  const lineage: LineageNode[] = data?.result?.lineage ?? [];
  const lineageDepth: number = data?.result?.lineageDepth ?? 0;

  if (lineage.length === 0) {
    return (
      <div className={cn('p-4 text-xs text-gray-400', className)}>
        No lineage data for this asset.
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <header className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-white">Lineage</h3>
        <span className="text-[10px] text-gray-400">
          {lineageDepth === 0
            ? 'Seed only — no derivatives promoted yet'
            : `${lineageDepth} generation${lineageDepth === 1 ? '' : 's'} of refinement`}
        </span>
      </header>

      <ol className="space-y-2">
        {lineage.map((node) => (
          <li
            key={`${node.depth}-${node.versionNumber}`}
            className={cn(
              'flex gap-3 rounded-md border border-white/10 bg-lattice-deep/50 p-3',
              node.isSeed && 'border-emerald-500/30 bg-emerald-500/5',
            )}
          >
            <div className="flex flex-col items-center pt-0.5">
              {node.isSeed ? (
                <Sprout className="w-4 h-4 text-emerald-400" />
              ) : (
                <GitCommitVertical className="w-4 h-4 text-cyan-400" />
              )}
              {node.depth < lineage.length - 1 && (
                <div className="w-px flex-1 mt-1 bg-white/10" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-white">
                  {node.isSeed ? (
                    <>Seed <span className="text-emerald-400">({node.source || 'authored'})</span></>
                  ) : (
                    <>v{node.versionNumber} <span className="text-gray-400">·</span> <span className="text-cyan-300">{PASS_KIND_LABEL[node.passKind || ''] || node.passKind || 'refinement'}</span></>
                  )}
                </span>
                <span className="text-[10px] text-gray-400 flex items-center gap-1 flex-shrink-0">
                  {node.promotedAt ? (
                    <>
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      {fmtTs(node.promotedAt)}
                    </>
                  ) : node.createdAt ? (
                    <>
                      <Clock className="w-3 h-3" />
                      {fmtTs(node.createdAt)}
                    </>
                  ) : null}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-gray-400 font-mono truncate" title={node.localPath}>
                {fileName(node.localPath)}
              </div>
              {node.diffSummary && (
                <p className="mt-1 text-[11px] text-gray-300 leading-snug">
                  {node.diffSummary}
                </p>
              )}
              {node.gateVerdict && (
                <p className="mt-1 text-[10px] text-emerald-300/80">
                  Gate verdict: {node.gateVerdict}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
