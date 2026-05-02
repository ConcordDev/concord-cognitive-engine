'use client';

/**
 * MarketplaceTab — Embeddable marketplace view for any lens page.
 * Shows marketplace-ready artifacts for the current domain.
 * Can be dropped into any lens as a tab alongside domain-specific views.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { Store, Download, Star, Eye, Package } from 'lucide-react';
import { QualityTierBadge } from '@/components/market/QualityTierBadge';

interface MarketplaceTabProps {
  domain: string;
  className?: string;
}

interface MarketplaceArtifact {
  id: string;
  title: string;
  type: string;
  domain: string;
  data?: Record<string, unknown>;
  meta?: {
    status?: string;
    createdBy?: string;
    entityMaturity?: number;
    tags?: string[];
    qualityTier?: string;
  };
  createdAt?: string;
  price?: number;
}

function MarketplaceTab({ domain, className }: MarketplaceTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['marketplace-domain', domain],
    queryFn: () =>
      api
        .get('/api/lens/artifacts', {
          params: { domain, status: 'marketplace_ready', limit: 50 },
        })
        .then((r) => r.data),
    staleTime: 30000,
  });

  const artifacts: MarketplaceArtifact[] = data?.artifacts || data?.items || [];

  if (isLoading) {
    return (
      <div className={cn('p-6 text-center text-gray-500', className)}>
        <Package className="w-8 h-8 mx-auto mb-2 animate-pulse" />
        Loading marketplace...
      </div>
    );
  }

  if (artifacts.length === 0) {
    return (
      <div className={cn('p-8 text-center', className)}>
        <Store className="w-10 h-10 mx-auto mb-3 text-gray-600" />
        <p className="text-gray-400 text-sm">No marketplace items in this domain yet.</p>
        <p className="text-gray-500 text-xs mt-1">
          Create artifacts and they&apos;ll appear here once approved.
        </p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
          <Store className="w-4 h-4 text-neon-purple" />
          Marketplace
          <span className="text-xs text-gray-500">({artifacts.length} items)</span>
        </h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {artifacts.map((artifact) => (
          <button
            key={artifact.id}
            onClick={() => setSelectedId(selectedId === artifact.id ? null : artifact.id)}
            className={cn(
              ds.panel,
              'text-left p-3 hover:border-neon-purple/30 transition-all cursor-pointer',
              selectedId === artifact.id && 'border-neon-purple/50 bg-neon-purple/5'
            )}
          >
            <div className="flex items-start justify-between mb-2">
              <h4 className="text-sm font-medium text-white truncate flex-1 mr-2">
                {artifact.title}
              </h4>
              <QualityTierBadge
                tier={artifact.meta?.qualityTier || artifact.meta?.status || 'pending'}
              />
            </div>

            <p className="text-xs text-gray-500 mb-2 truncate">
              {artifact.type?.replace(/-/g, ' ')}
            </p>

            <div className="flex items-center justify-between text-xs text-gray-500">
              <div className="flex items-center gap-3">
                {artifact.meta?.createdBy && (
                  <span className="flex items-center gap-1">
                    <Star className="w-3 h-3" />
                    {artifact.meta.createdBy.startsWith('entity') ? 'Entity' : 'User'}
                  </span>
                )}
                {artifact.price != null && (
                  <span className="text-neon-green">
                    {artifact.price === 0 ? 'Free' : `${artifact.price} tokens`}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Eye className="w-3 h-3" />
                <Download className="w-3 h-3" />
              </div>
            </div>

            {selectedId === artifact.id && artifact.data && (
              <div className="mt-3 pt-3 border-t border-lattice-border">
                <pre className="text-xs text-gray-400 max-h-32 overflow-auto whitespace-pre-wrap">
                  {JSON.stringify(artifact.data, null, 2).slice(0, 500)}
                </pre>
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedMarketplaceTab = withErrorBoundary(MarketplaceTab);
export { _WrappedMarketplaceTab as MarketplaceTab };
