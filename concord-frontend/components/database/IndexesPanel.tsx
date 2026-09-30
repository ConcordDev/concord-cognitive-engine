'use client';

import { useMemo } from 'react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { Key, CheckCircle } from 'lucide-react';
import { formatBytes, MetricCard, type IndexInfo } from './db-utils';

export function IndexesPanel() {
  const { items: indexItems } = useLensData('database', 'index', { noSeed: true });
  const indexes: IndexInfo[] = useMemo(() => indexItems?.map(i => i.data as unknown as IndexInfo) ?? [], [indexItems]);

  return (
    <div className="panel p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2 text-neon-yellow">
          <Key className="w-4 h-4" />
          Indexes ({indexes.length})
        </h2>
        <span className="text-xs text-gray-400">
          Total index size: {formatBytes(indexes.reduce((s, idx) => s + idx.sizeBytes, 0))}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-lattice-border">
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-400">Name</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-400">Table</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-400">Columns</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-400">Type</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-400">Unique</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-400">Size</th>
            </tr>
          </thead>
          <tbody>
            {indexes.map(idx => (
              <tr key={idx.name} className="border-b border-lattice-border/40 hover:bg-lattice-surface/60 transition-colors">
                <td className="px-3 py-2 font-mono text-xs text-gray-200">{idx.name}</td>
                <td className="px-3 py-2 text-xs text-neon-cyan">{idx.table}</td>
                <td className="px-3 py-2 font-mono text-xs text-gray-300">{idx.columns.join(', ')}</td>
                <td className="px-3 py-2 text-xs">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    idx.type === 'btree' ? 'bg-neon-green/10 text-neon-green' :
                    idx.type === 'gin' ? 'bg-neon-purple/10 text-neon-purple' :
                    idx.type === 'ivfflat' ? 'bg-neon-pink/10 text-neon-pink' :
                    'bg-gray-500/10 text-gray-400'
                  }`}>
                    {idx.type.toUpperCase()}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">
                  {idx.unique ? <CheckCircle className="w-3.5 h-3.5 text-neon-yellow" /> : <span className="text-gray-600">-</span>}
                </td>
                <td className="px-3 py-2 text-xs text-gray-400 text-right font-mono">{formatBytes(idx.sizeBytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {['btree', 'gin', 'ivfflat', 'hash'].map(type => {
          const count = indexes.filter(i => i.type === type).length;
          return (
            <MetricCard key={type} label={`${type.toUpperCase()} Indexes`} value={count} />
          );
        })}
      </div>
    </div>
  );
}
