'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Diamond, Clock, Calendar, Loader2, RefreshCw,
  ChevronDown, ChevronUp, History,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const TYPE_CONFIG: Record<string, { icon: React.ElementType; color: string }> = {
  hourly: { icon: Clock, color: 'text-cyan-400' },
  weekly: { icon: Calendar, color: 'text-purple-400' },
  domain: { icon: Diamond, color: 'text-yellow-400' },
};

interface TimeCrystal {
  id: string;
  type: string;
  pattern: string;
  description: string;
  dimension: string;
  value: number;
  strength: number;
  detectedAt: string;
}

function TimeCrystals({ className }: { className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  const { data: crystalsData, isLoading } = useQuery({
    queryKey: ['time-crystals'],
    queryFn: () => api.get('/api/time-crystals').then(r => r.data),
  });

  const { data: archData } = useQuery({
    queryKey: ['archaeology'],
    queryFn: () => api.get('/api/archaeology').then(r => r.data),
    enabled: expanded,
  });

  const { data: diffData } = useQuery({
    queryKey: ['substrate-diff'],
    queryFn: () => api.get('/api/substrate/diff').then(r => r.data),
    enabled: expanded,
  });

  const detectMutation = useMutation({
    mutationFn: () => api.post('/api/time-crystals/detect'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['time-crystals'] }),
  });

  const crystals: TimeCrystal[] = crystalsData?.crystals || [];

  if (isLoading) {
    return (
      <div className={cn('p-4 bg-lattice-surface border border-lattice-border rounded-xl animate-pulse', className)}>
        <div className="h-6 bg-lattice-deep rounded w-40" />
      </div>
    );
  }

  return (
    <div className={cn('bg-lattice-surface border border-lattice-border rounded-xl overflow-hidden', className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-lattice-border">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-cyan-500/20 rounded-lg">
            <Diamond className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h3 className="font-medium text-white">Temporal Intelligence</h3>
            <p className="text-xs text-gray-500">
              {crystals.length > 0 ? `${crystals.length} patterns discovered` : 'Recurring knowledge patterns'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => detectMutation.mutate()}
            disabled={detectMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-cyan-500/20 text-cyan-400 rounded-lg hover:bg-cyan-500/30 transition-colors disabled:opacity-50"
          >
            {detectMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Scan
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-lg hover:bg-lattice-deep text-gray-400 hover:text-white transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Time crystals */}
      <div className="p-4 space-y-2">
        {crystals.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">No patterns detected yet. Click Scan to analyze.</p>
        ) : (
          crystals.slice(0, expanded ? 20 : 4).map(crystal => {
            const typeConf = TYPE_CONFIG[crystal.type] || TYPE_CONFIG.hourly;
            const Icon = typeConf.icon;
            return (
              <div key={crystal.id} className="p-3 bg-lattice-deep rounded-lg">
                <div className="flex items-center gap-2">
                  <Icon className={cn('w-4 h-4', typeConf.color)} />
                  <p className="text-sm text-white font-medium flex-1">{crystal.pattern}</p>
                  <span className="text-[10px] text-gray-500">{Math.round(crystal.strength * 100)}% strength</span>
                </div>
                <p className="text-xs text-gray-400 mt-1 pl-6">{crystal.description}</p>
              </div>
            );
          })
        )}
      </div>

      {/* Expanded: Temporal diff + Archaeology */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {/* Substrate diff */}
            {diffData?.diff && (
              <div className="p-4 border-t border-lattice-border">
                <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                  Knowledge Growth (30 days)
                </h4>
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center">
                    <p className="text-lg font-bold text-neon-cyan">+{diffData.diff.newDTUs}</p>
                    <p className="text-[10px] text-gray-500">New DTUs</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-purple-400">{diffData.diff.newSwarms}</p>
                    <p className="text-[10px] text-gray-500">New Swarms</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-cyan-400">{diffData.diff.newCrystals}</p>
                    <p className="text-[10px] text-gray-500">New Crystals</p>
                  </div>
                </div>
                {diffData.diff.domainGrowth && Object.keys(diffData.diff.domainGrowth).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Object.entries(diffData.diff.domainGrowth)
                      .sort(([, a], [, b]) => (b as number) - (a as number))
                      .slice(0, 8)
                      .map(([domain, count]) => (
                        <span key={domain} className="px-2 py-0.5 bg-lattice-surface rounded text-[10px] text-gray-400">
                          {domain}: +{count as number}
                        </span>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* Archaeology — On This Day */}
            {archData?.memories && (
              <div className="p-4 border-t border-lattice-border">
                <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                  <History className="w-3 h-3" /> Knowledge Archaeology
                </h4>
                <div className="space-y-2">
                  {Object.entries(archData.memories)
                    .filter(([, dtus]) => (dtus as { id: string; title: string }[]).length > 0)
                    .map(([period, dtus]) => (
                      <div key={period}>
                        <p className="text-[10px] text-gray-500 mb-1">{period}</p>
                        {(dtus as { id: string; title: string }[]).slice(0, 3).map((dtu: { id: string; title: string }) => (
                          <div key={dtu.id} className="pl-3 text-xs text-gray-400 truncate">
                            {dtu.title}
                          </div>
                        ))}
                      </div>
                    ))}
                  {Object.values(archData.memories).every((dtus) => (dtus as { id: string; title: string }[]).length === 0) && (
                    <p className="text-xs text-gray-500">No memories found for these dates.</p>
                  )}
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
const _TimeCrystals = withErrorBoundary(TimeCrystals);
export { _TimeCrystals as TimeCrystals };
