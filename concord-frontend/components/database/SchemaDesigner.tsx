'use client';

/**
 * SchemaDesigner — dbdiagram.io / DrawSQL-shape ER schema designer:
 * build database schemas with tables, typed columns, relations, and
 * export CREATE TABLE DDL. Wires the database.schema-*, database.table-*,
 * database.column-* and database.relation-* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Database, Plus, Trash2, Key, Loader2, Code2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Column { id: string; name: string; type: string; pk: boolean; nullable: boolean; fk: boolean }
interface Table { id: string; name: string; columns: Column[] }
interface Relation { id: string; fromTable: string; fromColumn: string; toTable: string; toColumn: string; kind: string }
interface Schema { id: string; name: string; tables: Table[]; relations: Relation[] }
interface SchemaMeta { id: string; name: string; tableCount: number; relationCount: number }

const TYPES = ['integer', 'bigint', 'text', 'varchar', 'boolean', 'real', 'numeric', 'timestamp', 'date', 'uuid', 'json'];

export function SchemaDesigner() {
  const [schemas, setSchemas] = useState<SchemaMeta[]>([]);
  const [active, setActive] = useState<Schema | null>(null);
  const [loading, setLoading] = useState(true);
  const [newSchema, setNewSchema] = useState('');
  const [newTable, setNewTable] = useState('');
  const [colForm, setColForm] = useState<Record<string, { name: string; type: string }>>({});
  const [relForm, setRelForm] = useState({ fromTable: '', fromColumn: '', toTable: '' });
  const [sql, setSql] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun('database', 'schema-list', {});
    setSchemas((r.data?.result?.schemas as SchemaMeta[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const open = useCallback(async (id: string) => {
    const r = await lensRun('database', 'schema-detail', { id });
    if (r.data?.ok) { setActive(r.data.result?.schema as Schema); setSql(null); }
  }, []);
  async function reload() { if (active) await open(active.id); }

  async function createSchema() {
    if (!newSchema.trim()) return;
    const r = await lensRun('database', 'schema-create', { name: newSchema.trim() });
    setNewSchema('');
    await refresh();
    if (r.data?.ok) await open(r.data.result?.schema.id);
  }
  async function deleteSchema(id: string) {
    if (!confirm('Delete this schema?')) return;
    await lensRun('database', 'schema-delete', { id });
    if (active?.id === id) setActive(null);
    await refresh();
  }
  async function addTable() {
    if (!active || !newTable.trim()) return;
    await lensRun('database', 'table-add', { schemaId: active.id, name: newTable.trim() });
    setNewTable('');
    await reload(); await refresh();
  }
  async function delTable(id: string) {
    if (!active) return;
    await lensRun('database', 'table-delete', { schemaId: active.id, tableId: id });
    await reload(); await refresh();
  }
  async function addColumn(tableId: string) {
    const f = colForm[tableId];
    if (!active || !f?.name?.trim()) return;
    await lensRun('database', 'column-add', { schemaId: active.id, tableId, name: f.name.trim(), type: f.type || 'text' });
    setColForm({ ...colForm, [tableId]: { name: '', type: 'text' } });
    await reload();
  }
  async function delColumn(tableId: string, columnId: string) {
    if (!active) return;
    await lensRun('database', 'column-delete', { schemaId: active.id, tableId, columnId });
    await reload();
  }
  async function addRelation() {
    if (!active || !relForm.fromTable || !relForm.toTable) return;
    await lensRun('database', 'relation-add', { schemaId: active.id, ...relForm });
    setRelForm({ fromTable: '', fromColumn: '', toTable: '' });
    await reload(); await refresh();
  }
  async function exportSql() {
    if (!active) return;
    const r = await lensRun('database', 'schema-export-sql', { id: active.id });
    if (r.data?.ok) setSql(r.data.result?.sql || '');
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Database className="w-4 h-4 text-emerald-400" />
        <h3 className="text-sm font-bold text-zinc-100">Schema Designer</h3>
        <span className="text-[11px] text-zinc-400">dbdiagram shape</span>
        {active && (
          <button onClick={exportSql} className="ml-auto px-2.5 py-1 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 inline-flex items-center gap-1">
            <Code2 className="w-3 h-3" />Export SQL
          </button>
        )}
      </div>

      <div className="flex gap-1.5 mb-3 flex-wrap">
        {schemas.map(sc => (
          <span key={sc.id} className="group inline-flex items-center gap-1">
            <button onClick={() => open(sc.id)}
              className={cn('px-2.5 py-1 text-xs rounded-lg border', active?.id === sc.id ? 'bg-emerald-600/15 border-emerald-700/50 text-emerald-200' : 'bg-zinc-900/60 border-zinc-800 text-zinc-300 hover:border-zinc-700')}>
              {sc.name} <span className="text-zinc-600">{sc.tableCount}t</span>
            </button>
            <button aria-label="Delete" onClick={() => deleteSchema(sc.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
          </span>
        ))}
        <input value={newSchema} onChange={e => setNewSchema(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void createSchema(); }}
          placeholder="New schema" className="w-28 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-zinc-200" />
        <button aria-label="Add" onClick={createSchema} className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"><Plus className="w-3.5 h-3.5" /></button>
      </div>

      {sql != null ? (
        <div>
          <pre className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-[11px] text-emerald-300 font-mono overflow-x-auto max-h-72">{sql || '-- empty schema'}</pre>
          <button onClick={() => setSql(null)} className="mt-2 text-[11px] text-zinc-400 hover:text-zinc-300">← back to designer</button>
        </div>
      ) : active ? (
        <div>
          <div className="flex gap-1.5 mb-3">
            <input value={newTable} onChange={e => setNewTable(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void addTable(); }}
              placeholder="New table name" className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <button onClick={addTable} className="px-2.5 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold inline-flex items-center gap-1">
              <Plus className="w-3 h-3" />Table
            </button>
          </div>
          <div className="grid sm:grid-cols-2 gap-2 mb-3">
            {active.tables.map(t => (
              <div key={t.id} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2">
                <div className="flex items-center gap-1 mb-1">
                  <Database className="w-3 h-3 text-emerald-400" />
                  <span className="text-xs font-bold text-zinc-100 flex-1">{t.name}</span>
                  <button aria-label="Delete" onClick={() => delTable(t.id)} className="text-rose-400"><Trash2 className="w-3 h-3" /></button>
                </div>
                {t.columns.map(c => (
                  <div key={c.id} className="group flex items-center gap-1.5 text-[11px] py-0.5">
                    {c.pk ? <Key className="w-2.5 h-2.5 text-amber-400" /> : <span className="w-2.5" />}
                    <span className="text-zinc-200 font-mono">{c.name}</span>
                    <span className="text-zinc-400">{c.type}</span>
                    {!c.nullable && <span className="text-[9px] text-zinc-400">NOT NULL</span>}
                    <button aria-label="Delete" onClick={() => delColumn(t.id, c.id)} className="ml-auto opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-2.5 h-2.5" /></button>
                  </div>
                ))}
                <div className="flex gap-1 mt-1">
                  <input value={colForm[t.id]?.name || ''} onChange={e => setColForm({ ...colForm, [t.id]: { name: e.target.value, type: colForm[t.id]?.type || 'text' } })}
                    placeholder="+ column" className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-[11px] text-zinc-200" />
                  <select value={colForm[t.id]?.type || 'text'} onChange={e => setColForm({ ...colForm, [t.id]: { name: colForm[t.id]?.name || '', type: e.target.value } })}
                    className="bg-zinc-950 border border-zinc-800 rounded px-1 py-0.5 text-[10px] text-zinc-200">
                    {TYPES.map(ty => <option key={ty} value={ty}>{ty}</option>)}
                  </select>
                  <button aria-label="Add" onClick={() => addColumn(t.id)} className="px-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"><Plus className="w-3 h-3" /></button>
                </div>
              </div>
            ))}
          </div>
          {/* Relations */}
          {active.relations.length > 0 && (
            <div className="mb-2">
              {active.relations.map(r => (
                <p key={r.id} className="text-[11px] text-zinc-400 font-mono">{r.fromTable}.{r.fromColumn} → {r.toTable}.{r.toColumn}</p>
              ))}
            </div>
          )}
          {active.tables.length >= 2 && (
            <div className="flex gap-1.5">
              <select value={relForm.fromTable} onChange={e => setRelForm({ ...relForm, fromTable: e.target.value })}
                className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-[11px] text-zinc-200">
                <option value="">from table</option>
                {active.tables.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
              <input value={relForm.fromColumn} onChange={e => setRelForm({ ...relForm, fromColumn: e.target.value })} placeholder="fk column"
                className="w-24 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-[11px] text-zinc-200" />
              <select value={relForm.toTable} onChange={e => setRelForm({ ...relForm, toTable: e.target.value })}
                className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-[11px] text-zinc-200">
                <option value="">to table</option>
                {active.tables.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
              <button onClick={addRelation} className="px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300">+ relation</button>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-zinc-900/20 border border-dashed border-zinc-800 rounded-lg flex items-center justify-center text-xs text-zinc-400 min-h-[120px]">
          Select or create a schema.
        </div>
      )}
    </div>
  );
}
