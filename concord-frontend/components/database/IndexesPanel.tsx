'use client';

import { useState } from 'react';
import { Key, CheckCircle, Trash2, Plus } from 'lucide-react';
import { formatBytes, MetricCard } from './db-utils';
import { useWorkspaceIndexes } from './use-workspace-indexes';

export function IndexesPanel() {
  // S6/S8: indexes are real per-connection objects in the workspace
  // store (index-create / dataset-list / index-delete) — the same store
  // the Live Client writes, not a lens-data bucket nothing wrote to.
  const { indexes, tables, createIndex, deleteIndex, busy } = useWorkspaceIndexes();
  const [form, setForm] = useState({ tableKey: '', column: '' });
  const [error, setError] = useState<string | null>(null);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);

  const selectedTable = tables.find((t) => `${t.connectionId}:${t.dataset}` === form.tableKey);

  async function onCreate() {
    if (!selectedTable || !form.column) return;
    const r = await createIndex(selectedTable.connectionId, selectedTable.dataset, form.column);
    if (!r.data.ok) setError(r.data.error || 'Could not create index');
    else { setError(null); setForm({ tableKey: '', column: '' }); }
  }

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
      <p className="text-[11px] text-gray-500">
        Across {tables.length} table{tables.length === 1 ? '' : 's'} in the workspace store — the same datasets the Live Client shows.
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={form.tableKey}
          onChange={(e) => setForm({ tableKey: e.target.value, column: '' })}
          className="bg-lattice-surface border border-lattice-border rounded px-1.5 py-1 text-[11px] text-gray-200"
          aria-label="Index table"
        >
          <option value="">table</option>
          {tables.map((t) => (
            <option key={`${t.connectionId}:${t.dataset}`} value={`${t.connectionId}:${t.dataset}`}>
              {t.dataset} ({t.connectionName})
            </option>
          ))}
        </select>
        <select
          value={form.column}
          onChange={(e) => setForm({ ...form, column: e.target.value })}
          className="bg-lattice-surface border border-lattice-border rounded px-1.5 py-1 text-[11px] text-gray-200"
          aria-label="Index column"
        >
          <option value="">column</option>
          {(selectedTable?.columns || []).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button
          onClick={onCreate}
          disabled={busy || !selectedTable || !form.column}
          className="flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40"
        >
          <Plus className="w-3 h-3" /> Create index
        </button>
        {error && <span className="text-[11px] text-rose-300">{error}</span>}
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
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {indexes.map((idx) => (
              <tr key={idx.id} className="border-b border-lattice-border/40 hover:bg-lattice-surface/60 transition-colors">
                <td className="px-3 py-2 font-mono text-xs text-gray-200">{idx.name}</td>
                <td className="px-3 py-2 text-xs text-neon-cyan">{idx.dataset} <span className="text-gray-500">({idx.connectionName})</span></td>
                <td className="px-3 py-2 font-mono text-xs text-gray-300">{idx.columns.join(', ')}</td>
                <td className="px-3 py-2 text-xs">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-neon-green/10 text-neon-green">{idx.type.toUpperCase()}</span>
                </td>
                <td className="px-3 py-2 text-xs">
                  {idx.unique ? <CheckCircle className="w-3.5 h-3.5 text-neon-yellow" /> : <span className="text-gray-600">-</span>}
                </td>
                <td className="px-3 py-2 text-xs text-gray-400 text-right font-mono">{formatBytes(idx.sizeBytes)}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={async () => {
                      if (armedDelete !== idx.id) { setArmedDelete(idx.id); return; }
                      setArmedDelete(null);
                      await deleteIndex(idx.connectionId, idx.id);
                    }}
                    onBlur={() => setArmedDelete((a) => (a === idx.id ? null : a))}
                    className={armedDelete === idx.id ? 'px-1.5 py-0.5 rounded bg-rose-500 text-white text-[10px] font-semibold' : 'text-gray-400 hover:text-red-400'}
                    aria-label={armedDelete === idx.id ? `Confirm delete index ${idx.name}` : `Delete index ${idx.name}`}
                  >
                    {armedDelete === idx.id ? 'Delete?' : <Trash2 className="w-3 h-3" />}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {indexes.length === 0 && (
          <p className="text-xs text-gray-500 text-center py-4">No indexes yet — create one above, or apply an Index Recommendation.</p>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {['btree', 'gin', 'ivfflat', 'hash'].map((type) => {
          const count = indexes.filter((i) => i.type === type).length;
          return <MetricCard key={type} label={`${type.toUpperCase()} Indexes`} value={count} />;
        })}
      </div>
    </div>
  );
}
