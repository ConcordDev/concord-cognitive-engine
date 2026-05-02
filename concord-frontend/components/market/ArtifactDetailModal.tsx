'use client';

/**
 * ArtifactDetailModal — Full artifact detail with preview, entity info,
 * lineage, quality tier, and purchase/download actions.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { X, Download } from 'lucide-react';
import { ArtifactRenderer } from '@/components/artifact/ArtifactRenderer';
import { EntityAttributionCard } from './EntityAttributionCard';
import { QualityTierBadge } from './QualityTierBadge';
import { PurchaseButton } from './PurchaseButton';
import { PipelineTrail } from './PipelineTrail';

interface ArtifactDetailModalProps {
  artifactId: string;
  onClose: () => void;
}

function ArtifactDetailModal({ artifactId, onClose }: ArtifactDetailModalProps) {
  const { data: artifact, isLoading } = useQuery({
    queryKey: ['artifact-detail', artifactId],
    queryFn: () => api.get(`/api/marketplace/listings/${artifactId}`).then((r) => r.data),
    enabled: !!artifactId,
  });

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-lattice-surface border border-lattice-border rounded-xl p-8 shadow-xl">
          <div className="animate-pulse text-zinc-400">Loading artifact...</div>
        </div>
      </div>
    );
  }

  if (!artifact) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className="bg-lattice-surface border border-lattice-border rounded-xl shadow-2xl
        w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-lattice-border">
          <h2 className="text-lg font-bold text-white truncate">{artifact.title || 'Artifact'}</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6">
            {/* Left: Preview (2 cols on lg) */}
            <div className="lg:col-span-2">
              {artifact.artifact ? (
                <ArtifactRenderer
                  dtuId={artifact.dtuId || artifactId}
                  artifact={artifact.artifact}
                  mode="full"
                />
              ) : (
                <div className="h-64 bg-zinc-900 rounded-lg flex items-center justify-center text-zinc-500">
                  No preview available
                </div>
              )}
            </div>

            {/* Right: Details */}
            <div className="space-y-4">
              {/* Badges */}
              <div className="flex gap-2 flex-wrap">
                {artifact.domain && (
                  <span
                    className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
                    bg-neon-blue/10 text-neon-blue border border-neon-blue/30"
                  >
                    {artifact.domain}
                  </span>
                )}
                {artifact.fileType && (
                  <span
                    className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
                    bg-zinc-800 text-zinc-300 border border-zinc-700"
                  >
                    {artifact.fileType}
                  </span>
                )}
                <QualityTierBadge tier={artifact.qualityTier || 3} />
              </div>

              {/* Description */}
              {artifact.description && (
                <p className="text-sm text-zinc-300 leading-relaxed">{artifact.description}</p>
              )}

              {/* Entity attribution */}
              {artifact.createdBy && <EntityAttributionCard entityId={artifact.createdBy} />}

              {/* Actions */}
              <div className="flex gap-3">
                <a
                  href={`/api/artifact/${artifact.dtuId || artifactId}/download`}
                  download
                  className="flex items-center gap-2 px-4 py-2 rounded-lg
                    bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan
                    hover:bg-neon-cyan/20 transition-all text-sm"
                >
                  <Download className="w-4 h-4" />
                  Download
                </a>
                {artifact.price > 0 && (
                  <PurchaseButton
                    artifactId={artifactId}
                    price={artifact.price}
                    currency={artifact.currency || 'tokens'}
                  />
                )}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2 text-xs text-zinc-400">
                {artifact.downloadCount != null && (
                  <div className="flex items-center gap-1">
                    <Download className="w-3 h-3" />
                    {artifact.downloadCount} downloads
                  </div>
                )}
                {artifact.rating != null && (
                  <div className="flex items-center gap-1">
                    <span className="text-amber-400">{'\u2605'}</span>
                    {artifact.rating.toFixed(1)}
                  </div>
                )}
              </div>

              {/* Pipeline trail */}
              {artifact.pipelineTrail?.length > 0 && (
                <PipelineTrail trail={artifact.pipelineTrail} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedArtifactDetailModal = withErrorBoundary(ArtifactDetailModal);
export { _WrappedArtifactDetailModal as ArtifactDetailModal };
export default _WrappedArtifactDetailModal;
