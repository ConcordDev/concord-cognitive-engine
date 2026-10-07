'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { motion } from 'framer-motion';
import {
  FileCode, AlertTriangle, BarChart3, GitBranch, Package, Route, Eye
} from 'lucide-react';
import {
  InventoryOverview,
  baseName,
  cardVariants,
  tabContentVariants,
  StatCard,
  LoadingSpinner,
  EmptyState
} from '@/components/meta/meta-shared';

export function OverviewPanel() {
  const { data, isLoading, isError, refetch } = useQuery<InventoryOverview>({
    queryKey: ['inventory-overview'],
    queryFn: () => api.get('/api/inventory').then((r) => r.data),
  });

  if (isLoading) return <LoadingSpinner message="Loading inventory overview..." />;
  if (isError || !data) {
    return (
      <div className="text-center py-10 text-gray-400 text-sm border border-dashed border-red-500/20 rounded-lg space-y-2">
        <p>Could not load the inventory overview.</p>
        <button onClick={() => refetch()} className="text-neon-purple hover:underline text-xs">Retry</button>
      </div>
    );
  }

  return (
    <motion.div {...tabContentVariants} transition={{ duration: 0.25 }} className="space-y-6">
      {/* Stat cards — re-scan lives in the lens's primary "Refresh inventory" CTA */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard icon={Package} label="Components" value={data.totalComponents} color="text-neon-blue" index={0} />
        <StatCard icon={Eye} label="Lenses" value={data.totalLenses} color="text-neon-purple" index={1} />
        <StatCard icon={FileCode} label="Server Libs" value={data.totalServerLibs} color="text-neon-green" index={2} />
        <StatCard icon={Route} label="Routes" value={data.totalRoutes} color="text-neon-cyan" index={3} />
        <StatCard
          icon={AlertTriangle}
          label="Orphaned"
          value={data.orphanedCount}
          color={data.orphanedCount > 0 ? 'text-yellow-400' : 'text-green-400'}
          warning={data.orphanedCount > 0}
          index={4}
        />
      </div>

      {/* Largest files */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-neon-cyan" />
          Largest Files (Top 10)
        </h2>
        <div className="space-y-2">
          {(data.largestFiles ?? []).map((f, i) => (
            <motion.div
              key={f.path}
              custom={i}
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              className="flex items-center justify-between p-2 bg-lattice-deep rounded-lg"
            >
              <span className="text-sm text-gray-300 font-mono truncate max-w-[70%]">{f.path}</span>
              <span className="text-xs text-gray-400 font-mono">{(f.lineCount ?? 0).toLocaleString()} lines</span>
            </motion.div>
          ))}
          {(!data.largestFiles || data.largestFiles.length === 0) && (
            <EmptyState message="No file data available." />
          )}
        </div>
      </div>

      {/* Most imported */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-neon-purple" />
          Most-Imported Components (Top 10)
        </h2>
        <div className="space-y-2">
          {(data.mostImportedComponents ?? []).map((c, i) => (
            <motion.div
              key={c.path}
              custom={i}
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              className="flex items-center justify-between p-2 bg-lattice-deep rounded-lg"
            >
              <span className="text-sm text-gray-300 font-mono truncate max-w-[70%]" title={c.path}>{baseName(c.path)}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-neon-purple/20 text-neon-purple font-mono">
                {c.usedByCount} lens{c.usedByCount === 1 ? '' : 'es'}
              </span>
            </motion.div>
          ))}
          {(!data.mostImportedComponents || data.mostImportedComponents.length === 0) && (
            <EmptyState message="No import data available." />
          )}
        </div>
      </div>
    </motion.div>
  );
}
