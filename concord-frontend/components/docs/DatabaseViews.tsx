'use client';

/**
 * DatabaseViews — Notion-style structured-data pages. Wires the full
 * docs.db-* macro family: create/list/detail/delete databases,
 * db-column-add, and db-row add/update/delete. Rows render as an
 * editable grid (table view) plus a grouped board view by the first
 * select column.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Table2, Loader2, Plus, Trash2, LayoutGrid, Rows3,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { DbColumn, DocDatabase } from './types';

interface DbMeta { id: string; name: string; columnCount: number; rowCount: number; updatedAt: string }
const COL_TYPES: DbColumn['type'][] = ['text', 'number', 'select', 'checkbox', 'date'];

export function DatabaseViews() {
  const [list, setList] = useState<DbMeta[]>([]);
  const [active, setActive] = useState<DocDatabase | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'table' | 'board'>('table');
  const [newName, setNewName] = useState('');
  const [newColName, setNewColName] = useState('');
  const [newColType, setNewColType] = useState<DbColumn['type']>('text');

  const refresh = useCallback(async () => {
    const r = await lensRun('docs', 'db-list', {});
    setList((r.data?.result?.databases as DbMeta[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const open = useCallback(async (id: string) => {
    const r = await lensRun('docs', 'db-detail', { id });
    if (r.data?.ok) setActive(r.data.result?.database as DocDatabase);
  }, []);
  const reloadActive = useCallback(async () => {
    if (active) await open(active.id);
  }, [active, open]);

  async function createDb() {
    if (!newName.trim()) return;
    const r = await lensRun('docs', 'db-create', { name: newName.trim() });
    setNewName('');
    await refresh();
    const id = r.data?.result?.database?.id as string | undefined;
    if (id) await open(id);
  }
  async function deleteDb(id: string) {
    await lensRun('docs', 'db-delete', { id });
    if (active?.id === id) setActive(null);
    await refresh();
  }
  async function addColumn() {
    if (!active || !newColName.trim()) return;
    await lensRun('docs', 'db-column-add', { id: active.id, name: newColName.trim(), type: newColType });
    setNewColName('');
    await reloadActive();
  }
  async function addRow() {
    if (!active) return;
    await lensRun('docs', 'db-row-add', { id: active.id, cells: {} });
    await reloadActive();
    await refresh();
  }
  async function updateCell(rowId: string, colId: string, value: string | number | boolean) {
    if (!active) return;
    await lensRun('docs', 'db-row-update', { id: active.id, rowId, cells: { [colId]: value } });
    await reloadActive();
  }
  async function deleteRow(rowId: string) {
    if (!active) return;
    await lensRun('docs', 'db-row-delete', { id: active.id, rowId });
    await reloadActive();
    await refresh();
  }

  if (loading) {
    return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  }

  return (
    <div className="grid sm:grid-cols-[220px_1fr] gap-3">
      {/* db list */}
      <div>
        <div className="flex gap-1 mb-2">
          <input value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void createDb(); }}
            placeholder="New database"
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
          <button aria-label="Add" onClick={createDb} className="px-1.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        <ul className="space-y-0.5">
          {list.length === 0 && <li className="text-[11px] text-zinc-400 italic">No databases — create one.</li>}
          {list.map(d => (
            <li key={d.id}
              className={cn('group flex items-center gap-1 rounded px-1.5 py-1 hover:bg-zinc-800', active?.id === d.id && 'bg-zinc-800')}>
              <button onClick={() => open(d.id)} className="flex-1 text-left text-xs text-zinc-300 truncate">
                <Table2 className="w-3 h-3 inline mr-1 text-zinc-400" />{d.name}
                <span className="text-[10px] text-zinc-400 ml-1">{d.rowCount} rows</span>
              </button>
              <button aria-label="Delete" onClick={() => deleteDb(d.id)} className="opacity-0 group-hover:opacity-100 text-rose-400">
                <Trash2 className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* active db */}
      {active ? (
        <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-3">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <h4 className="text-sm font-bold text-zinc-100">{active.name}</h4>
            <div className="ml-auto flex items-center gap-1 rounded border border-zinc-800 p-0.5">
              <button onClick={() => setView('table')}
                className={cn('px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1', view === 'table' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400')}>
                <Rows3 className="w-3 h-3" /> Table
              </button>
              <button onClick={() => setView('board')}
                className={cn('px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1', view === 'board' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400')}>
                <LayoutGrid className="w-3 h-3" /> Board
              </button>
            </div>
          </div>

          {/* column adder */}
          <div className="flex items-center gap-1 mb-2">
            <input value={newColName} onChange={e => setNewColName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void addColumn(); }}
              placeholder="New column"
              className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-[11px] text-zinc-200 w-32" />
            <select value={newColType} onChange={e => setNewColType(e.target.value as DbColumn['type'])}
              className="bg-zinc-950 border border-zinc-800 rounded text-[10px] text-zinc-300 px-1 py-0.5">
              {COL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button onClick={addColumn} className="text-[10px] text-zinc-400 hover:text-zinc-100 border border-zinc-800 rounded px-1.5 py-0.5">
              + column
            </button>
            <button onClick={addRow} className="text-[10px] text-indigo-300 hover:text-indigo-200 border border-indigo-800 rounded px-1.5 py-0.5 ml-auto">
              + row
            </button>
          </div>

          {view === 'table' ? (
            <DbTable db={active} onUpdate={updateCell} onDelete={deleteRow} />
          ) : (
            <DbBoard db={active} onUpdate={updateCell} />
          )}
        </div>
      ) : (
        <div className="bg-zinc-900/20 border border-dashed border-zinc-800 rounded-lg flex items-center justify-center text-xs text-zinc-400 min-h-[160px]">
          Select or create a database.
        </div>
      )}
    </div>
  );
}

function DbCell({ col, value, onChange }: {
  col: DbColumn;
  value: string | number | boolean | undefined;
  onChange: (v: string | number | boolean) => void;
}) {
  if (col.type === 'checkbox') {
    return <input type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} className="accent-emerald-500" />;
  }
  if (col.type === 'select') {
    return (
      <select value={String(value ?? '')} onChange={e => onChange(e.target.value)}
        className="w-full bg-transparent text-xs text-zinc-200 focus:outline-none">
        <option value="">—</option>
        {col.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <input
      type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
      value={String(value ?? '')}
      onChange={e => onChange(col.type === 'number' ? Number(e.target.value) : e.target.value)}
      className="w-full bg-transparent text-xs text-zinc-200 focus:outline-none focus:bg-zinc-800/50 rounded px-1" />
  );
}

function DbTable({ db, onUpdate, onDelete }: {
  db: DocDatabase;
  onUpdate: (rowId: string, colId: string, v: string | number | boolean) => void;
  onDelete: (rowId: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            {db.columns.map(c => (
              <th key={c.id} className="border border-zinc-800 px-1.5 py-1 text-left font-semibold text-zinc-300">
                {c.name} <span className="text-[9px] text-zinc-400">{c.type}</span>
              </th>
            ))}
            <th className="w-6" />
          </tr>
        </thead>
        <tbody>
          {db.rows.length === 0 && (
            <tr><td colSpan={db.columns.length + 1} className="text-[11px] text-zinc-400 italic py-2 text-center">No rows yet.</td></tr>
          )}
          {db.rows.map(r => (
            <tr key={r.id}>
              {db.columns.map(c => (
                <td key={c.id} className="border border-zinc-800 px-1 py-0.5">
                  <DbCell col={c} value={r.cells[c.id]} onChange={(v) => onUpdate(r.id, c.id, v)} />
                </td>
              ))}
              <td className="text-center">
                <button aria-label="Delete" onClick={() => onDelete(r.id)} className="text-zinc-700 hover:text-rose-400">
                  <Trash2 className="w-3 h-3" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DbBoard({ db, onUpdate }: {
  db: DocDatabase;
  onUpdate: (rowId: string, colId: string, v: string | number | boolean) => void;
}) {
  const selectCol = db.columns.find(c => c.type === 'select');
  if (!selectCol) {
    return <p className="text-[11px] text-zinc-400 italic py-2">Board view needs a &ldquo;select&rdquo; column to group by.</p>;
  }
  const titleCol = db.columns.find(c => c.type === 'text') || db.columns[0];
  const groups = ['', ...selectCol.options];
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {groups.map(g => {
        const rows = db.rows.filter(r => String(r.cells[selectCol.id] ?? '') === g);
        return (
          <div key={g || '(none)'} className="min-w-[150px] rounded border border-zinc-800 bg-zinc-950/40 p-2">
            <p className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1.5">{g || '(no value)'} · {rows.length}</p>
            <div className="space-y-1">
              {rows.map(r => (
                <div key={r.id} className="rounded border border-zinc-800 bg-zinc-900/60 px-1.5 py-1">
                  <p className="text-[11px] text-zinc-200 truncate">{String(r.cells[titleCol.id] ?? '(untitled)')}</p>
                  <select value={g} onChange={e => onUpdate(r.id, selectCol.id, e.target.value)}
                    className="mt-0.5 w-full bg-transparent text-[10px] text-zinc-400 focus:outline-none">
                    <option value="">—</option>
                    {selectCol.options.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
