'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Flower2, Sprout, TreeDeciduous, Plus, Sparkles, Loader2,
  ChevronDown, ChevronUp, Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const STAGE_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  seedling: { icon: Sprout, color: 'text-green-300', label: 'Seedling' },
  sprouting: { icon: Sprout, color: 'text-green-400', label: 'Sprouting' },
  blooming: { icon: Flower2, color: 'text-pink-400', label: 'Blooming' },
  thriving: { icon: TreeDeciduous, color: 'text-emerald-400', label: 'Thriving' },
  ancient: { icon: TreeDeciduous, color: 'text-yellow-400', label: 'Ancient' },
};

interface Garden {
  id: string;
  name: string;
  description: string;
  theme: string;
  dtus: string[];
  insights: { content: string; generatedAt: string }[];
  health: number;
  stage: string;
  stats: { views: number; additions: number; blooms: number; tendCount: number };
  createdAt: string;
}

function KnowledgeGardens({ className }: { className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTheme, setNewTheme] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['gardens'],
    queryFn: () => api.get('/api/gardens').then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/api/gardens', { name: newName.trim(), theme: newTheme.trim() || 'general' }),
    onSuccess: () => {
      setNewName('');
      setNewTheme('');
      setCreating(false);
      queryClient.invalidateQueries({ queryKey: ['gardens'] });
    },
  });

  const tendMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/gardens/${id}/tend`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gardens'] }),
  });

  const bloomMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/gardens/${id}/bloom`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gardens'] }),
  });

  const gardens: Garden[] = data?.gardens || [];

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
          <div className="p-2 bg-green-500/20 rounded-lg">
            <Flower2 className="w-5 h-5 text-green-400" />
          </div>
          <div>
            <h3 className="font-medium text-white">Knowledge Gardens</h3>
            <p className="text-xs text-gray-500">
              {gardens.length > 0 ? `${gardens.length} gardens growing` : 'Curated knowledge spaces'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCreating(!creating)}
            className="p-1.5 rounded-lg hover:bg-green-500/20 text-gray-400 hover:text-green-400 transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-lg hover:bg-lattice-deep text-gray-400 hover:text-white transition-colors"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Create garden form */}
      <AnimatePresence>
        {creating && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 border-b border-lattice-border space-y-2">
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Garden name..."
                className="w-full bg-lattice-deep border border-lattice-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-400"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTheme}
                  onChange={e => setNewTheme(e.target.value)}
                  placeholder="Theme (optional)"
                  className="flex-1 bg-lattice-deep border border-lattice-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-400"
                />
                <button
                  onClick={() => newName.trim() && createMutation.mutate()}
                  disabled={!newName.trim() || createMutation.isPending}
                  className="px-3 py-2 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors disabled:opacity-50 text-sm"
                >
                  {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Plant'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Garden list */}
      <div className="p-4 space-y-3">
        {gardens.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">No gardens yet. Plant one above.</p>
        ) : (
          gardens.slice(0, expanded ? 20 : 4).map(garden => {
            const stageConf = STAGE_CONFIG[garden.stage] || STAGE_CONFIG.seedling;
            const StageIcon = stageConf.icon;

            return (
              <div key={garden.id} className="p-3 bg-lattice-deep rounded-lg">
                <div className="flex items-center gap-2">
                  <StageIcon className={cn('w-5 h-5', stageConf.color)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{garden.name}</p>
                    <p className="text-[10px] text-gray-500">
                      {garden.dtus.length} DTUs · {stageConf.label} · {Math.round(garden.health * 100)}% health
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => tendMutation.mutate(garden.id)}
                      className="p-1 text-green-400 hover:bg-green-500/20 rounded transition-colors"
                      title="Tend garden"
                    >
                      <Sprout className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => bloomMutation.mutate(garden.id)}
                      className="p-1 text-pink-400 hover:bg-pink-500/20 rounded transition-colors"
                      title="Bloom (generate insight)"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                    </button>
                    <span className="flex items-center gap-0.5 text-[10px] text-gray-500" title="Views">
                      <Eye className="w-3 h-3" />
                      {garden.stats.views}
                    </span>
                  </div>
                </div>

                {/* Latest insight */}
                {garden.insights.length > 0 && (
                  <div className="mt-2 p-2 bg-lattice-surface rounded text-xs text-gray-400">
                    <span className="text-neon-cyan">Insight:</span>{' '}
                    {garden.insights[garden.insights.length - 1].content}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}


import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _KnowledgeGardens = withErrorBoundary(KnowledgeGardens);
export { _KnowledgeGardens as KnowledgeGardens };
