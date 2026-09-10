'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, ChevronRight, Server
} from 'lucide-react';
import {
  LensEntry,
  cardVariants,
  tabContentVariants,
  LoadingSpinner,
  EmptyState
} from '@/components/meta/meta-shared';

export function LensesPanel() {
  const { data, isLoading } = useQuery<LensEntry[]>({
    queryKey: ['inventory-lenses'],
    queryFn: () => api.get('/api/inventory/lenses').then((r) => r.data),
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (isLoading) return <LoadingSpinner message="Loading lenses..." />;

  return (
    <motion.div {...tabContentVariants} transition={{ duration: 0.25 }} className="space-y-4">
      <p className="text-xs text-gray-400">{data?.length ?? 0} lenses</p>

      <div className="space-y-1 max-h-[70vh] overflow-y-auto pr-1">
        {(data ?? []).map((lens, i) => {
          const expanded = expandedId === lens.name;
          const lensPath = `concord-frontend/app/lenses/${lens.name}/page.tsx`;
          return (
            <motion.div key={lens.name} custom={i} variants={cardVariants} initial="hidden" animate="visible">
              <button
                onClick={() => setExpandedId(expanded ? null : lens.name)}
                className="w-full flex items-center justify-between p-3 bg-lattice-deep rounded-lg hover:bg-lattice-surface transition-colors text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {expanded ? (
                    <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                  )}
                  <span className="text-sm font-medium truncate">{lens.name}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-gray-400 font-mono">{lens.lineCount} lines</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-neon-cyan/20 text-neon-cyan font-mono">
                    {lens.imports.length} imports
                  </span>
                </div>
              </button>
              <AnimatePresence>
                {expanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="p-4 ml-7 border-l border-white/5 space-y-3">
                      <div>
                        <p className="text-xs text-gray-400 mb-1">Path</p>
                        <p className="text-sm text-gray-300 font-mono">{lensPath}</p>
                      </div>
                      {lens.imports.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-400 mb-1">Imported Components</p>
                          <div className="flex flex-wrap gap-1">
                            {lens.imports.map((c) => (
                              <span
                                key={c}
                                className="text-xs px-1.5 py-0.5 bg-neon-blue/10 text-neon-blue rounded font-mono"
                              >
                                {c}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {lens.serverRoutes.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-400 mb-1">Server Routes</p>
                          <div className="flex flex-wrap gap-1">
                            {lens.serverRoutes.map((r) => (
                              <span
                                key={r}
                                className="text-xs px-1.5 py-0.5 bg-neon-green/10 text-neon-green rounded font-mono"
                              >
                                {r}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {lens.serverRoutes.length === 0 && (
                        <p className="text-xs text-yellow-400">No direct /api/ calls detected in this page.</p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
        {(!data || data.length === 0) && <EmptyState message="No lens data available." />}
      </div>
    </motion.div>
  );
}
