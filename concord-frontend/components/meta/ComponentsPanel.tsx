'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, ChevronDown, ChevronRight
} from 'lucide-react';
import {
  ComponentEntry,
  baseName,
  cardVariants,
  tabContentVariants,
  WiredBadge,
  SearchBar,
  LoadingSpinner,
  EmptyState
} from '@/components/meta/meta-shared';

export function ComponentsPanel() {
  const { data, isLoading } = useQuery<ComponentEntry[]>({
    queryKey: ['inventory-components'],
    queryFn: () => api.get('/api/inventory/components').then((r) => r.data),
  });

  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!search) return data;
    const q = search.toLowerCase();
    return data.filter(
      (c) => baseName(c.path).toLowerCase().includes(q) || c.directory.toLowerCase().includes(q),
    );
  }, [data, search]);

  if (isLoading) return <LoadingSpinner message="Loading components..." />;

  return (
    <motion.div {...tabContentVariants} transition={{ duration: 0.25 }} className="space-y-4">
      <SearchBar value={search} onChange={setSearch} placeholder="Search components..." />

      <p className="text-xs text-gray-400">
        {filtered.length} component{filtered.length !== 1 ? 's' : ''} shown
        {search && ` (of ${data?.length ?? 0})`}
      </p>

      <div className="space-y-1 max-h-[70vh] overflow-y-auto pr-1">
        {filtered.map((comp, i) => {
          const key = comp.path;
          const expanded = expandedId === key;
          return (
            <motion.div key={key} custom={i} variants={cardVariants} initial="hidden" animate="visible">
              <button
                onClick={() => setExpandedId(expanded ? null : key)}
                className="w-full flex items-center justify-between p-3 bg-lattice-deep rounded-lg hover:bg-lattice-surface transition-colors text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {expanded ? (
                    <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                  )}
                  <span className="text-sm font-medium truncate">{baseName(comp.path)}</span>
                  <span className="text-xs text-gray-400 truncate hidden md:inline">{comp.directory}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-gray-400 font-mono">{comp.lineCount} lines</span>
                  <WiredBadge wired={!comp.isOrphaned} />
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
                        <p className="text-xs text-gray-400 mb-1">Directory</p>
                        <p className="text-sm text-gray-300 font-mono">{comp.directory}</p>
                      </div>
                      {comp.exports.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-400 mb-1">Exports</p>
                          <div className="flex flex-wrap gap-1">
                            {comp.exports.map((e) => (
                              <span
                                key={e}
                                className="text-xs px-1.5 py-0.5 bg-lattice-surface rounded text-gray-300 font-mono"
                              >
                                {e}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {comp.usedByLenses.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-400 mb-1">Imported by</p>
                          <div className="flex flex-wrap gap-1">
                            {comp.usedByLenses.map((l) => (
                              <span
                                key={l}
                                className="text-xs px-1.5 py-0.5 bg-neon-purple/10 text-neon-purple rounded"
                              >
                                {l}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {comp.usedByLenses.length === 0 && (
                        <p className="text-xs text-yellow-400">Not imported by any lens.</p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
        {filtered.length === 0 && <EmptyState message="No components match your search." />}
      </div>
    </motion.div>
  );
}
