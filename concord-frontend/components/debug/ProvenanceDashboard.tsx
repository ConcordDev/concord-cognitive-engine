'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { CheckCircle, AlertCircle, Shield, Loader2, RefreshCw, XCircle } from 'lucide-react';

interface ProvClaim {
  id: string;
  description: string;
  status: 'unverified' | 'verified' | 'failed' | 'error';
  lastVerified: number | null;
  actualValue?: unknown;
  expectedValue?: unknown;
  detail?: string;
  error?: string;
}

interface ProvenanceReport {
  total: number;
  verified: number;
  failed: number;
  unverified: number;
  claims: ProvClaim[];
  generatedAt: number;
}

const STATUS_STYLES: Record<string, string> = {
  verified: 'text-green-400',
  failed: 'text-red-400',
  error: 'text-red-400',
  unverified: 'text-white/30',
};

function ClaimIcon({ status }: { status: string }) {
  if (status === 'verified')
    return <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />;
  if (status === 'failed' || status === 'error')
    return <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />;
  return <AlertCircle className="w-4 h-4 text-white/20 flex-shrink-0" />;
}

function ProvenanceDashboard() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery<ProvenanceReport>({
    queryKey: ['provenance-report'],
    queryFn: () => api.get('/api/audit/provenance').then((r) => r.data),
    refetchInterval: 60000,
  });

  const verifyMutation = useMutation({
    mutationFn: () => api.post('/api/audit/provenance/verify'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['provenance-report'] }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-white/40 p-4">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading provenance data...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
        <AlertCircle className="w-4 h-4 flex-shrink-0" />
        Failed to load provenance: {(error as Error)?.message || 'Unknown error'}
      </div>
    );
  }

  const claims = data?.claims || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-white/40" />
          <span className="text-sm font-semibold text-white">Substrate Provenance</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-2 text-xs">
            <span className="text-green-400">{data?.verified ?? 0} verified</span>
            {(data?.failed ?? 0) > 0 && <span className="text-red-400">{data?.failed} failed</span>}
            {(data?.unverified ?? 0) > 0 && (
              <span className="text-white/30">{data?.unverified} unverified</span>
            )}
          </div>
          <button
            onClick={() => verifyMutation.mutate()}
            disabled={verifyMutation.isPending}
            className="flex items-center gap-1 px-2 py-1 bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white text-xs rounded transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${verifyMutation.isPending ? 'animate-spin' : ''}`} />
            {verifyMutation.isPending ? 'Verifying...' : 'Run Verification'}
          </button>
        </div>
      </div>

      {verifyMutation.isError && (
        <div className="flex items-center gap-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
          <AlertCircle className="w-3 h-3" />
          Verification failed: {(verifyMutation.error as Error)?.message || 'Unknown error'}
        </div>
      )}

      <div className="space-y-1.5">
        {claims.map((claim) => (
          <div key={claim.id} className="flex items-start gap-3 p-2.5 bg-white/5 rounded-lg">
            <ClaimIcon status={claim.status} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white font-mono">{claim.id}</span>
                <span className={`text-xs ${STATUS_STYLES[claim.status]}`}>{claim.status}</span>
              </div>
              <p className="text-xs text-white/40 truncate">{claim.description}</p>
              {(claim.status === 'failed' || claim.status === 'error') && claim.detail && (
                <p className="text-xs text-red-400/70 mt-0.5">{claim.detail}</p>
              )}
              {claim.error && (
                <p className="text-xs text-red-400/70 mt-0.5 font-mono">{claim.error}</p>
              )}
            </div>
            {claim.lastVerified && (
              <span className="text-xs text-white/20 flex-shrink-0">
                {new Date(claim.lastVerified).toLocaleTimeString()}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedProvenanceDashboard = withErrorBoundary(ProvenanceDashboard);
export { _WrappedProvenanceDashboard as ProvenanceDashboard };
