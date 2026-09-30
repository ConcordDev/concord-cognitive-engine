'use client';

import { useMemo, useState } from 'react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { Table2, Search, Columns, Key, Link2, Eye, List } from 'lucide-react';
import { formatBytes, type TableInfo } from './db-utils';

export function TableBrowserPanel({ onQueryTable }: { onQueryTable?: (sql: string) => void }) {
  const { items: tableItems } = useLensData('database', 'table', { noSeed: true });
  const tables: TableInfo[] = useMemo(() => tableItems?.map(i => i.data as unknown as TableInfo) ?? [], [tableItems]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState('');

  const filteredTables = useMemo(() => {
    if (!tableFilter) return tables;
    const q = tableFilter.toLowerCase();
    return tables.filter(t => t.name.toLowerCase().includes(q));
  }, [tables, tableFilter]);

  const selectedTableInfo = useMemo(
    () => tables.find(t => t.name === selectedTable) ?? null,
    [tables, selectedTable],
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="panel p-4 space-y-3 lg:col-span-1">
        <h2 className="text-sm font-semibold flex items-center gap-2 text-neon-cyan">
          <List className="w-4 h-4" />
          Tables ({tables.length})
        </h2>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={tableFilter}
            onChange={e => setTableFilter(e.target.value)}
            className="input-lattice w-full pl-9 text-sm"
            placeholder="Filter tables..."
          />
        </div>
        <div className="space-y-1 max-h-[500px] overflow-y-auto">
          {filteredTables.map(t => (
            <button
              key={t.name}
              onClick={() => setSelectedTable(t.name === selectedTable ? null : t.name)}
              className={`w-full text-left px-3 py-2 rounded text-sm flex items-center justify-between transition-colors ${
                selectedTable === t.name
                  ? 'bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30'
                  : 'hover:bg-lattice-surface text-gray-300 border border-transparent'
              }`}
            >
              <span className="flex items-center gap-2">
                <Table2 className="w-3.5 h-3.5" />
                {t.name}
              </span>
              <span className="text-xs text-gray-400">{t.rowCount.toLocaleString()} rows</span>
            </button>
          ))}
        </div>
      </div>

      <div className="panel p-4 space-y-3 lg:col-span-2">
        {selectedTableInfo ? (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold flex items-center gap-2 text-neon-green">
                <Columns className="w-4 h-4" />
                {selectedTableInfo.schema}.{selectedTableInfo.name}
              </h2>
              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span>{selectedTableInfo.rowCount.toLocaleString()} rows</span>
                <span>{formatBytes(selectedTableInfo.sizeBytes)}</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-lattice-border">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-400">Column</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-400">Type</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-400">Nullable</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-400">Default</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-400">Key</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedTableInfo.columns.map(col => (
                    <tr key={col.name} className="border-b border-lattice-border/40 hover:bg-lattice-surface/60 transition-colors">
                      <td className="px-3 py-2 font-mono text-xs text-gray-200 flex items-center gap-1.5">
                        {col.isPrimary && <Key className="w-3 h-3 text-neon-yellow" />}
                        {col.isForeign && !col.isPrimary && <Link2 className="w-3 h-3 text-neon-blue" />}
                        {col.name}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-neon-purple">{col.type}</td>
                      <td className="px-3 py-2 text-xs">{col.nullable ? <span className="text-gray-400">YES</span> : <span className="text-neon-pink">NOT NULL</span>}</td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-400">{col.defaultValue ?? '-'}</td>
                      <td className="px-3 py-2 text-xs">
                        {col.isPrimary && <span className="px-1.5 py-0.5 bg-neon-yellow/10 text-neon-yellow rounded text-[10px] font-bold">PK</span>}
                        {col.isForeign && <span className="px-1.5 py-0.5 bg-neon-blue/10 text-neon-blue rounded text-[10px] font-bold ml-1">FK</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              onClick={() => onQueryTable?.(`SELECT *\nFROM ${selectedTableInfo.name}\nLIMIT 100;`)}
              className="flex items-center gap-2 text-xs text-neon-cyan hover:underline mt-2"
            >
              <Eye className="w-3 h-3" />
              Query this table
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <Table2 className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm">Select a table to view its schema</p>
          </div>
        )}
      </div>
    </div>
  );
}

