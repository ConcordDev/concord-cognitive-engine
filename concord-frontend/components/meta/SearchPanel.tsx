'use client';

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { motion } from 'framer-motion';
import {
  Search, Loader2, Route, Server
} from 'lucide-react';
import {
  SearchResult,
  cardVariants,
  tabContentVariants,
  LoadingSpinner,
  EmptyState
} from '@/components/meta/meta-shared';

export function SearchPanel() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Simple debounce
  const handleSearch = useCallback((v: string) => {
    setQuery(v);
    const timer = setTimeout(() => setDebouncedQuery(v), 300);
    return () => clearTimeout(timer);
  }, []);

  const { data: searchResponse, isLoading, isFetching } = useQuery<{ ok: boolean; query: string; count: number; results: SearchResult[] }>({
    queryKey: ['inventory-search', debouncedQuery],
    queryFn: () =>
      api.get('/api/inventory/search', { params: { q: debouncedQuery } }).then((r) => r.data),
    enabled: debouncedQuery.length >= 2,
  });
  const data = searchResponse?.results;

  const typeBadge = (type: string) => {
    switch (type) {
      case 'component':
        return (
          <span className="text-xs px-2 py-0.5 rounded bg-neon-blue/20 text-neon-blue border border-neon-blue/30">
            Component
          </span>
        );
      case 'lens':
        return (
          <span className="text-xs px-2 py-0.5 rounded bg-neon-purple/20 text-neon-purple border border-neon-purple/30">
            Lens
          </span>
        );
      case 'serverLib':
        return (
          <span className="text-xs px-2 py-0.5 rounded bg-neon-green/20 text-neon-green border border-neon-green/30">
            Server Lib
          </span>
        );
      case 'route':
        return (
          <span className="text-xs px-2 py-0.5 rounded bg-orange-400/20 text-orange-400 border border-orange-400/30">
            Route
          </span>
        );
      default:
        return (
          <span className="text-xs px-2 py-0.5 rounded bg-gray-500/20 text-gray-400">
            {type}
          </span>
        );
    }
  };

  return (
    <motion.div {...tabContentVariants} transition={{ duration: 0.25 }} className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search components, lenses, server libs..."
          className="input-lattice w-full pl-10 pr-10"
        />
        {isFetching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />
        )}
      </div>

      {debouncedQuery.length < 2 && (
        <p className="text-xs text-gray-400 text-center py-8">
          Type at least 2 characters to search.
        </p>
      )}

      {isLoading && debouncedQuery.length >= 2 && (
        <LoadingSpinner message="Searching..." />
      )}

      {data && data.length > 0 && (
        <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1">
          <p className="text-xs text-gray-400">{data.length} result{data.length !== 1 ? 's' : ''}</p>
          {data.map((result, i) => (
            <motion.div
              key={`${result.type}-${result.path}`}
              custom={i}
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              className="flex items-center justify-between p-3 bg-lattice-deep rounded-lg"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{result.name}</p>
                <p className="text-xs text-gray-400 font-mono truncate">{result.path}</p>
                {result.matchContext && (
                  <p className="text-xs text-gray-400 mt-1 truncate">{result.matchContext}</p>
                )}
              </div>
              <div className="ml-3 shrink-0">{typeBadge(result.type)}</div>
            </motion.div>
          ))}
        </div>
      )}

      {data && data.length === 0 && debouncedQuery.length >= 2 && (
        <EmptyState message={`No results for "${debouncedQuery}".`} />
      )}
    </motion.div>
  );
}
