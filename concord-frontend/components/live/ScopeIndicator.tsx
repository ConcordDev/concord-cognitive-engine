'use client';

import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { Globe, Home, Store } from 'lucide-react';

interface ScopeMetrics {
  local?: number;
  marketplace?: number;
  global?: number;
  total?: number;
  [key: string]: unknown;
}

function ScopeIndicator() {
  const { data } = useQuery({
    queryKey: ['scope-metrics'],
    queryFn: () => apiHelpers.scope.metrics().then((r) => r.data as ScopeMetrics),
    refetchInterval: 30000,
    retry: false,
  });

  const metrics = data || {};
  const local = metrics.local ?? 0;
  const marketplace = metrics.marketplace ?? 0;
  const global = metrics.global ?? 0;
  const total = metrics.total ?? local + marketplace + global;

  return (
    <div
      className="flex items-center gap-3 text-xs"
      title={`${total} total DTUs across all scopes`}
    >
      <div className="flex items-center gap-1.5" title={`${local} Local DTUs`}>
        <Home className="w-3.5 h-3.5 text-neon-blue" />
        <span className="font-mono text-gray-300">{local}</span>
        <span className="text-gray-500 hidden sm:inline">Local</span>
      </div>
      <div className="flex items-center gap-1.5" title={`${marketplace} Marketplace DTUs`}>
        <Store className="w-3.5 h-3.5 text-neon-purple" />
        <span className="font-mono text-gray-300">{marketplace}</span>
        <span className="text-gray-500 hidden sm:inline">Market</span>
      </div>
      <div className="flex items-center gap-1.5" title={`${global} Global DTUs`}>
        <Globe className="w-3.5 h-3.5 text-neon-green" />
        <span className="font-mono text-gray-300">{global}</span>
        <span className="text-gray-500 hidden sm:inline">Global</span>
      </div>
      <div
        className="flex items-center gap-1.5 border-l border-gray-700 pl-3"
        title={`${total} Total DTUs`}
      >
        <span className="font-mono text-white font-medium">{total}</span>
        <span className="text-gray-500 hidden sm:inline">Total</span>
      </div>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedScopeIndicator = withErrorBoundary(ScopeIndicator);
export { _WrappedScopeIndicator as ScopeIndicator };
