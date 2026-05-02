'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Hexagon, Loader2, ChevronDown, ChevronUp, RefreshCw, Crown,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Swarm {
  id: string;
  name: string;
  members: string[];
  queen: string;
  size: number;
  topTags: string[];
  created: string;
  lastUpdated: string;
}

function SwarmIntelligence({ className }: { className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [selectedSwarm, setSelectedSwarm] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['swarms'],
    queryFn: () => api.get('/api/swarms').then(r => r.data),
  });

  const detectMutation = useMutation({
    mutationFn: () => api.post('/api/swarms/detect'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['swarms'] }),
  });

  const { data: detailData } = useQuery({
    queryKey: ['swarm-detail', selectedSwarm],
    queryFn: () => api.get(`/api/swarms/${selectedSwarm}`).then(r => r.data),
    enabled: !!selectedSwarm,
  });

  const swarms: Swarm[] = data?.swarms || [];

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
          <div className="p-2 bg-amber-500/20 rounded-lg">
            <Hexagon className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h3 className="font-medium text-white">DTU Swarms</h3>
            <p className="text-xs text-gray-500">
              {swarms.length > 0 ? `${swarms.length} self-organized clusters` : 'Self-organizing knowledge'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => detectMutation.mutate()}
            disabled={detectMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-amber-500/20 text-amber-400 rounded-lg hover:bg-amber-500/30 transition-colors disabled:opacity-50"
          >
            {detectMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Detect
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-lg hover:bg-lattice-deep text-gray-400 hover:text-white transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Swarm visualization */}
      <div className="p-4">
        {swarms.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">No swarms detected yet. Click Detect to find clusters.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {swarms.slice(0, expanded ? 20 : 6).map(swarm => (
              <button
                key={swarm.id}
                onClick={() => setSelectedSwarm(selectedSwarm === swarm.id ? null : swarm.id)}
                className={cn(
                  'px-3 py-2 rounded-lg border text-left transition-all',
                  selectedSwarm === swarm.id
                    ? 'border-amber-500/50 bg-amber-500/10'
                    : 'border-lattice-border hover:border-amber-500/30'
                )}
              >
                <div className="flex items-center gap-2">
                  <Hexagon className="w-4 h-4 text-amber-400" />
                  <span className="text-sm text-white font-medium">{swarm.name}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-gray-500">{swarm.size} DTUs</span>
                  {swarm.topTags?.slice(0, 2).map(t => (
                    <span key={t} className="text-[10px] text-amber-400/60">#{t}</span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selected swarm detail */}
      <AnimatePresence>
        {selectedSwarm && detailData?.swarm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 border-t border-lattice-border">
              <div className="flex items-center gap-2 mb-2">
                <Crown className="w-4 h-4 text-yellow-400" />
                <span className="text-xs text-gray-400">Queen DTU:</span>
                <span className="text-xs text-white">
                  {detailData.swarm.memberDTUs?.find((d: { id: string; title: string; tier?: string; domain?: string }) => d.id === detailData.swarm.queen)?.title || detailData.swarm.queen}
                </span>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {detailData.swarm.memberDTUs?.slice(0, 10).map((dtu: { id: string; title: string; tier?: string; domain?: string }) => (
                  <div key={dtu.id} className="flex items-center gap-2 p-1.5 bg-lattice-deep rounded text-xs">
                    <span className={cn(
                      'w-1.5 h-1.5 rounded-full',
                      dtu.tier === 'hyper' ? 'bg-yellow-400' : dtu.tier === 'mega' ? 'bg-purple-400' : 'bg-gray-400'
                    )} />
                    <span className="text-gray-300 truncate">{dtu.title}</span>
                    <span className="text-gray-600 text-[10px] ml-auto">{dtu.domain}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _SwarmIntelligence = withErrorBoundary(SwarmIntelligence);
export { _SwarmIntelligence as SwarmIntelligence };
