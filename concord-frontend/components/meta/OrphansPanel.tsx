'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  FolderTree, AlertTriangle, CheckCircle, Copy
} from 'lucide-react';
import {
  OrphanEntry,
  baseName,
  cardVariants,
  tabContentVariants,
  LoadingSpinner,
  copyToClipboard
} from '@/components/meta/meta-shared';

export function OrphansPanel() {
  const { data, isLoading } = useQuery<OrphanEntry[]>({
    queryKey: ['inventory-orphans'],
    queryFn: () => api.get('/api/inventory/orphans').then((r) => r.data),
  });

  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const grouped = useMemo(() => {
    if (!data) return {};
    const groups: Record<string, OrphanEntry[]> = {};
    for (const entry of data) {
      const dir = entry.directory || 'unknown';
      if (!groups[dir]) groups[dir] = [];
      groups[dir].push(entry);
    }
    return groups;
  }, [data]);

  const handleWire = useCallback(
    (entry: OrphanEntry) => {
      const importPath = entry.path
        .replace(/\.tsx?$/, '')
        .replace(/\/index$/, '');
      // The scanner (server/lib/codebase-inventory.js#extractExports) records
      // real identifier names for `export default function X` too (X, not the
      // literal string "default"), so we can't reliably tell default vs. named
      // apart from this list alone — fall back to the file's own base name for
      // the no-named-exports case, which is what a default import is almost
      // always written as by convention in this codebase.
      const namedExports = entry.exports.filter((e) => e !== 'default');
      const fallbackName = baseName(entry.path);

      let importStatement = '';
      if (namedExports.length > 0) {
        importStatement = `import { ${namedExports.join(', ')} } from '${importPath}';`;
      } else {
        importStatement = `import ${fallbackName} from '${importPath}';`;
      }

      copyToClipboard(importStatement);
      setCopiedPath(entry.path);
      setTimeout(() => setCopiedPath(null), 2000);
    },
    [],
  );

  if (isLoading) return <LoadingSpinner message="Loading orphaned components..." />;

  const dirs = Object.keys(grouped).sort();

  return (
    <motion.div {...tabContentVariants} transition={{ duration: 0.25 }} className="space-y-6">
      {data && data.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {data.length} orphaned component{data.length !== 1 ? 's' : ''} found -- not imported by any lens.
        </div>
      )}

      {dirs.map((dir) => (
        <div key={dir} className="panel p-4">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <FolderTree className="w-4 h-4 text-neon-cyan" />
            {dir}
            <span className="text-xs text-gray-400 font-normal">({grouped[dir].length})</span>
          </h3>
          <div className="space-y-2">
            {grouped[dir].map((entry, i) => (
              <motion.div
                key={entry.path}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                className="flex items-center justify-between p-3 bg-lattice-deep rounded-lg"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{baseName(entry.path)}</p>
                  <p className="text-xs text-gray-400 font-mono truncate">{entry.path}</p>
                  {entry.exports.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {entry.exports.map((e) => (
                        <span
                          key={e}
                          className="text-xs px-1.5 py-0.5 bg-lattice-surface rounded text-gray-400 font-mono"
                        >
                          {e}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-gray-400 mt-1">{entry.lineCount} lines</p>
                </div>
                <button
                  onClick={() => handleWire(entry)}
                  className={cn(
                    'ml-3 shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                    copiedPath === entry.path
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                      : 'bg-neon-purple/20 text-neon-purple border border-neon-purple/30 hover:bg-neon-purple/30',
                  )}
                >
                  <Copy className="w-3 h-3" />
                  {copiedPath === entry.path ? 'Copied!' : 'Wire this'}
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      ))}

      {dirs.length === 0 && (
        <div className="text-center py-10 text-green-400 text-sm border border-dashed border-green-500/20 rounded-lg">
          <CheckCircle className="w-6 h-6 mx-auto mb-2" />
          All components are wired. No orphans detected.
        </div>
      )}
    </motion.div>
  );
}
