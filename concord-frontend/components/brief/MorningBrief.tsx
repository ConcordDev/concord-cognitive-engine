'use client';

/**
 * MorningBrief — AI-generated daily cognitive brief.
 *
 * Calls the subconscious brain to generate a summary of recent DTU activity,
 * active domains, stale items needing attention, and actionable suggestions.
 *
 * Usage:
 *   <MorningBrief />                    // Full card
 *   <MorningBrief compact />            // Inline summary
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useOfflineFirst } from '@/hooks/useOfflineFirst';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  Sparkles,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Sun,
  TrendingUp,
  AlertTriangle,
  Lightbulb,
  BarChart3,
} from 'lucide-react';

interface BriefData {
  content: string;
  generatedAt: string;
  stats: {
    totalDTUs: number;
    recentDTUs: number;
    topDomains: Array<{ domain: string; count: number }>;
    staleDTUs: number;
  };
  confidence: {
    score: number;
    label: string;
  };
  source: string;
  model?: string;
}

interface MorningBriefProps {
  compact?: boolean;
  className?: string;
}

function MorningBrief({ compact = false, className }: MorningBriefProps) {
  const [expanded, setExpanded] = useState(true);
  const queryClient = useQueryClient();

  // Offline-first: instantly show cached brief from localStorage while server refreshes
  const {
    data: offlineBrief,
    source: offlineSource,
    stale: offlineBriefStale,
  } = useOfflineFirst<{ ok: boolean; brief: BriefData | null }>('/api/brief/latest', {
    cacheKey: 'morning-brief',
    cacheTTL: 5 * 60 * 1000,
  });

  // Fetch latest brief (authoritative)
  const { data: briefData, isLoading: isFetching } = useQuery<{
    ok: boolean;
    brief: BriefData | null;
  }>({
    queryKey: ['morning-brief'],
    queryFn: () => api.get('/api/brief/morning').then((r) => r.data),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Generate new brief
  const generateMutation = useMutation({
    mutationFn: async (force: boolean = false) => {
      const { data } = await api.post('/api/brief/generate', { force });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['morning-brief'] });
    },
  });

  const handleGenerate = useCallback(() => {
    generateMutation.mutate(true);
  }, [generateMutation]);

  const brief = generateMutation.data?.brief || briefData?.brief || offlineBrief?.brief || null;
  const isLoading = (isFetching && !offlineBrief) || generateMutation.isPending;

  // Compact mode: inline summary
  if (compact) {
    return (
      <button
        onClick={handleGenerate}
        disabled={isLoading}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors',
          'text-neon-cyan hover:bg-neon-cyan/10 border border-transparent hover:border-neon-cyan/30',
          className
        )}
      >
        {isLoading ? (
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Sun className="w-3.5 h-3.5" />
        )}
        {brief ? 'Refresh Brief' : 'Morning Brief'}
      </button>
    );
  }

  return (
    <div className={cn(ds.panel, 'space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
          <Sun className="w-5 h-5 text-neon-yellow" />
          Morning Brief
        </h3>
        <div className="flex items-center gap-2">
          {brief?.confidence && (
            <span
              className={cn(
                'text-xs px-2 py-0.5 rounded-full',
                brief.confidence.label === 'high'
                  ? 'bg-neon-green/20 text-neon-green'
                  : brief.confidence.label === 'medium'
                    ? 'bg-amber-400/20 text-amber-400'
                    : 'bg-red-400/20 text-red-400'
              )}
            >
              {Math.round(brief.confidence.score * 100)}% confident
            </span>
          )}
          <button
            onClick={handleGenerate}
            disabled={isLoading}
            className={cn(ds.btnSmall, 'text-neon-cyan hover:bg-neon-cyan/20')}
          >
            {isLoading ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            {brief ? 'Refresh' : 'Generate'}
          </button>
        </div>
      </div>

      {/* Content */}
      {brief ? (
        <>
          {/* Stats bar */}
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <BarChart3 className="w-3.5 h-3.5" />
              {brief.stats.totalDTUs} total DTUs
            </span>
            <span className="flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5 text-neon-green" />
              {brief.stats.recentDTUs} recent
            </span>
            {brief.stats.staleDTUs > 0 && (
              <span className="flex items-center gap-1 text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5" />
                {brief.stats.staleDTUs} stale
              </span>
            )}
            {brief.stats.topDomains.length > 0 && (
              <span className="flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-neon-cyan" />
                Top:{' '}
                {brief.stats.topDomains
                  .slice(0, 3)
                  .map((d: { domain: string; count: number }) => d.domain)
                  .join(', ')}
              </span>
            )}
          </div>

          {/* Brief content with expand/collapse */}
          <div className="bg-lattice-void/50 border border-lattice-border rounded-lg overflow-hidden">
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-gray-300 hover:text-white transition-colors"
            >
              <span className="flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-neon-cyan" />
                Cognitive Brief
              </span>
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {expanded && (
              <div className="px-4 pb-4">
                <div className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed prose prose-invert prose-sm max-w-none">
                  {brief.content}
                </div>
                <div className="mt-3 flex items-center gap-3 text-xs text-gray-500">
                  <span>Generated {new Date(brief.generatedAt).toLocaleString()}</span>
                  <span>via {brief.source}</span>
                  {brief.model && <span>({brief.model})</span>}
                  {!briefData && offlineSource === 'cache' && (
                    <span className="text-amber-400/70">
                      (cached{offlineBriefStale ? ', refreshing' : ''})
                    </span>
                  )}
                  {!briefData && offlineSource === 'offline' && (
                    <span className="text-gray-500">(offline)</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="text-center py-8">
          <Sun className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 mb-2">No brief generated yet</p>
          <p className="text-sm text-gray-500 mb-4">
            Generate an AI-powered summary of your recent cognitive activity
          </p>
          <button onClick={handleGenerate} disabled={isLoading} className={cn(ds.btnPrimary)}>
            {isLoading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate Morning Brief
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedMorningBrief = withErrorBoundary(MorningBrief);
export { _WrappedMorningBrief as MorningBrief };
