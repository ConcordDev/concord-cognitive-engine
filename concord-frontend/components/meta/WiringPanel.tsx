'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { motion } from 'framer-motion';
import {
  ArrowRight
} from 'lucide-react';
import {
  WiringMapResult,
  baseName,
  cardVariants,
  tabContentVariants,
  LoadingSpinner,
  EmptyState
} from '@/components/meta/meta-shared';

export function WiringPanel() {
  const { data, isLoading } = useQuery<WiringMapResult>({
    queryKey: ['inventory-wiring'],
    queryFn: () => api.get('/api/inventory/wiring').then((r) => r.data),
  });

  const lensEntries = useMemo(
    () => Object.entries(data?.lenses ?? {}).sort((a, b) => a[0].localeCompare(b[0])),
    [data],
  );

  if (isLoading) return <LoadingSpinner message="Loading wiring map..." />;

  return (
    <motion.div {...tabContentVariants} transition={{ duration: 0.25 }} className="space-y-3">
      <p className="text-xs text-gray-400">{lensEntries.length} lens wiring entries</p>

      <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
        {lensEntries.map(([lensName, info], i) => (
          <motion.div
            key={lensName}
            custom={i}
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            className="p-3 bg-lattice-deep rounded-lg"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs px-2 py-0.5 rounded border font-semibold text-neon-purple bg-neon-purple/10 border-neon-purple/30">
                {lensName}
              </span>
              <ArrowRight className="w-3 h-3 text-gray-600" />
              <span className="text-xs text-gray-400">
                {info.components.length} component{info.components.length === 1 ? '' : 's'} &middot;{' '}
                {info.serverRoutes.length} route{info.serverRoutes.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {info.components.map((c) => (
                <span
                  key={c}
                  className="text-xs px-1.5 py-0.5 bg-lattice-surface rounded text-gray-300 font-mono"
                  title={c}
                >
                  {baseName(c)}
                </span>
              ))}
              {info.serverRoutes.map((r) => (
                <span
                  key={r}
                  className="text-xs px-1.5 py-0.5 bg-neon-green/10 text-neon-green rounded font-mono"
                >
                  {r}
                </span>
              ))}
              {info.components.length === 0 && info.serverRoutes.length === 0 && (
                <span className="text-xs text-gray-400 italic">No component imports or detected /api/ calls.</span>
              )}
            </div>
          </motion.div>
        ))}
        {lensEntries.length === 0 && <EmptyState message="No wiring data available." />}
      </div>
    </motion.div>
  );
}
