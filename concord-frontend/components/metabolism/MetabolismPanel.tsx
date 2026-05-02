'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { motion, AnimatePresence } from 'framer-motion';
import { Heart, Flame, Trash2, TrendingUp, Loader2, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

function MetabolismPanel({ className }: { className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['metabolism-state'],
    queryFn: () => api.get('/api/metabolism/state').then(r => r.data),
    refetchInterval: 60000,
  });

  const { data: candidatesData } = useQuery({
    queryKey: ['metabolism-candidates'],
    queryFn: () => api.get('/api/metabolism/candidates').then(r => r.data),
    enabled: expanded,
  });

  const runCycle = useMutation({
    mutationFn: () => api.post('/api/metabolism/run'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metabolism-state'] });
      queryClient.invalidateQueries({ queryKey: ['metabolism-candidates'] });
    },
  });

  const resurrectDTU = useMutation({
    mutationFn: (id: string) => api.post(`/api/metabolism/resurrect/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metabolism-state'] });
    },
  });

  if (isLoading) {
    return (
      <div className={cn('p-4 bg-lattice-surface border border-lattice-border rounded-xl animate-pulse', className)}>
        <div className="h-6 bg-lattice-deep rounded w-40" />
      </div>
    );
  }

  const stats = data?.stats || {};

  return (
    <div className={cn('bg-lattice-surface border border-lattice-border rounded-xl overflow-hidden', className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-lattice-border">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-red-500/20 rounded-lg">
            <Heart className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h3 className="font-medium text-white">DTU Metabolism</h3>
            <p className="text-xs text-gray-500">
              {data?.lastRun
                ? `Last cycle: ${new Date(data.lastRun).toLocaleString()}`
                : 'Living substrate processes'
              }
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => runCycle.mutate()}
            disabled={runCycle.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-50"
          >
            {runCycle.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RotateCcw className="w-3.5 h-3.5" />
            )}
            Run Cycle
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-lg hover:bg-lattice-deep text-gray-400 hover:text-white transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Process visualization */}
      <div className="p-4">
        <div className="flex items-center justify-between">
          {[
            { label: 'Digest', icon: Flame, value: stats.digested || 0, color: 'text-orange-400 bg-orange-500/10' },
            { label: 'Consolidate', icon: TrendingUp, value: stats.consolidated || 0, color: 'text-purple-400 bg-purple-500/10' },
            { label: 'Excrete', icon: Trash2, value: stats.excreted || 0, color: 'text-red-400 bg-red-500/10' },
            { label: 'Grow', icon: TrendingUp, value: stats.grown || 0, color: 'text-green-400 bg-green-500/10' },
          ].map((process, i) => (
            <div key={process.label} className="flex flex-col items-center gap-1">
              <div className={cn('p-2 rounded-lg', process.color.split(' ')[1])}>
                <process.icon className={cn('w-4 h-4', process.color.split(' ')[0])} />
              </div>
              <span className="text-lg font-bold text-white">{process.value}</span>
              <span className="text-xs text-gray-500">{process.label}</span>
              {i < 3 && (
                <div className="absolute hidden" /> // Visual connector handled by flex layout
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Last cycle results */}
      {runCycle.data && (
        <div className="px-4 pb-4">
          <div className="p-3 bg-lattice-deep rounded-lg text-sm">
            <p className="text-gray-300">
              Last cycle: {runCycle.data.data?.digested || 0} digested, {runCycle.data.data?.grown || 0} grown,{' '}
              {runCycle.data.data?.excreted?.length || 0} archived
            </p>
          </div>
        </div>
      )}

      {/* Expanded: consolidation candidates + excreted */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {/* Consolidation candidates */}
            {candidatesData?.candidates?.length > 0 && (
              <div className="p-4 border-t border-lattice-border">
                <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                  Consolidation Candidates
                </h4>
                <div className="space-y-2">
                  {candidatesData.candidates.slice(0, 5).map((c: { pair: string[]; titles: string[]; overlap: number; sharedTags: string[] }, i: number) => (
                    <div key={i} className="p-2 bg-lattice-deep rounded-lg">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-gray-300 truncate">{c.titles[0]}</span>
                        <span className="text-gray-600">×</span>
                        <span className="text-gray-300 truncate">{c.titles[1]}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-purple-400">{Math.round(c.overlap * 100)}% overlap</span>
                        {c.sharedTags.slice(0, 3).map(t => (
                          <span key={t} className="text-xs text-gray-500">#{t}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Excreted (archived) DTUs */}
            {(data?.excreted?.length > 0 || data?.excretedDTUs?.length > 0) && (
              <div className="p-4 border-t border-lattice-border">
                <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                  Archived DTUs ({(data.excreted || data.excretedDTUs || []).length})
                </h4>
                <div className="space-y-1 mt-2">
                  {(data.excreted || data.excretedDTUs || []).slice(0, 5).map((dtu: { id: string; title?: string }) => (
                    <div key={dtu.id} className="flex items-center justify-between p-2 bg-lattice-deep rounded-lg">
                      <span className="text-xs text-gray-400 truncate">{dtu.title || dtu.id}</span>
                      <button
                        onClick={() => resurrectDTU.mutate(dtu.id)}
                        disabled={resurrectDTU.isPending}
                        className="flex items-center gap-1 text-[10px] text-neon-cyan hover:text-neon-cyan/80 transition-colors disabled:opacity-50"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Resurrect
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _MetabolismPanel = withErrorBoundary(MetabolismPanel);
export { _MetabolismPanel as MetabolismPanel };
