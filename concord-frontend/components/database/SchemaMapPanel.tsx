'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { Layers, Key, Link2 } from 'lucide-react';
import { type TableInfo } from './db-utils';

export function SchemaMapPanel() {
  const { items: tableItems } = useLensData('database', 'table', { noSeed: true });
  const tables: TableInfo[] = useMemo(() => tableItems?.map(i => i.data as unknown as TableInfo) ?? [], [tableItems]);

  const relationships = useMemo(() => {
    const rels: { from: string; fromCol: string; to: string; toCol: string }[] = [];
    tables.forEach(t => {
      t.columns.forEach(c => {
        if (c.isForeign && c.references) {
          rels.push({ from: t.name, fromCol: c.name, to: c.references.table, toCol: c.references.column });
        }
      });
    });
    return rels;
  }, [tables]);

  return (
    <div className="panel p-4 space-y-4">
      <h2 className="text-sm font-semibold flex items-center gap-2 text-neon-purple">
        <Layers className="w-4 h-4" />
        Schema Relationships
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {tables.map(t => {
          const incoming = relationships.filter(r => r.to === t.name);
          const outgoing = relationships.filter(r => r.from === t.name);
          return (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-lattice-surface border border-lattice-border rounded-lg p-3 space-y-2"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-sm font-bold text-neon-cyan">{t.name}</h3>
                <span className="text-xs text-gray-400">{t.rowCount.toLocaleString()} rows</span>
              </div>
              <div className="space-y-0.5">
                {t.columns.map(c => (
                  <div key={c.name} className="flex items-center gap-1.5 text-xs font-mono">
                    {c.isPrimary && <Key className="w-2.5 h-2.5 text-neon-yellow flex-shrink-0" />}
                    {c.isForeign && !c.isPrimary && <Link2 className="w-2.5 h-2.5 text-neon-blue flex-shrink-0" />}
                    {!c.isPrimary && !c.isForeign && <span className="w-2.5 flex-shrink-0" />}
                    <span className="text-gray-300">{c.name}</span>
                    <span className="text-gray-600 ml-auto">{c.type}</span>
                  </div>
                ))}
              </div>
              {(incoming.length > 0 || outgoing.length > 0) && (
                <div className="pt-2 border-t border-lattice-border/50 space-y-1">
                  {outgoing.map((r, i) => (
                    <div key={`out-${i}`} className="flex items-center gap-1 text-[10px]">
                      <span className="text-neon-blue">{r.fromCol}</span>
                      <span className="text-gray-600">--&gt;</span>
                      <span className="text-neon-green">{r.to}.{r.toCol}</span>
                    </div>
                  ))}
                  {incoming.map((r, i) => (
                    <div key={`in-${i}`} className="flex items-center gap-1 text-[10px]">
                      <span className="text-neon-pink">{r.from}.{r.fromCol}</span>
                      <span className="text-gray-600">--&gt;</span>
                      <span className="text-neon-yellow">{r.toCol}</span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
      <div className="bg-lattice-surface rounded p-3">
        <h3 className="text-xs font-semibold text-gray-400 mb-2">Relationship Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><span className="text-gray-400">Tables:</span> <span className="text-neon-cyan font-bold">{tables.length}</span></div>
          <div><span className="text-gray-400">Foreign Keys:</span> <span className="text-neon-blue font-bold">{relationships.length}</span></div>
          <div><span className="text-gray-400">Total Columns:</span> <span className="text-neon-purple font-bold">{tables.reduce((s, t) => s + t.columns.length, 0)}</span></div>
          <div><span className="text-gray-400">Total Rows:</span> <span className="text-neon-green font-bold">{tables.reduce((s, t) => s + t.rowCount, 0).toLocaleString()}</span></div>
        </div>
      </div>
    </div>
  );
}
