'use client';

/**
 * DataModelDesigner — tables, fields and relations editor for a maker
 * project. Backed by the `app-maker` data.* macros.
 */

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Database, Plus, Trash2, Link2, Loader2 } from 'lucide-react';
import { TreeDiagram, type TreeNode } from '@/components/viz';

interface Field { id: string; name: string; type: string; required?: boolean; primary?: boolean }
interface Table { id: string; name: string; fields: Field[] }
interface Relation { id: string; fromTable: string; toTable: string; fromName: string; toName: string; kind: string }

export function DataModelDesigner({
  projectId,
  onChanged,
}: {
  projectId: string;
  onChanged: () => void;
}) {
  const [tables, setTables] = useState<Table[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [fieldTypes, setFieldTypes] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [relForm, setRelForm] = useState({ from: '', to: '', kind: 'one-to-many' });

  async function refresh() {
    const r = await lensRun('app-maker', 'projectGet', { projectId });
    if (r.data?.ok) {
      setTables(r.data.result?.project?.dataModel?.tables ?? []);
      setRelations(r.data.result?.project?.dataModel?.relations ?? []);
    }
  }

  useEffect(() => {
    lensRun('app-maker', 'dataFieldTypes', {}).then((r) => {
      if (r.data?.ok) setFieldTypes(r.data.result?.fieldTypes ?? []);
    });
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const sel = tables.find((t) => t.id === selected) ?? null;

  async function addTable() {
    setBusy(true);
    const r = await lensRun('app-maker', 'dataAddTable', { projectId });
    setBusy(false);
    if (r.data?.ok) { await refresh(); setSelected(r.data.result?.table?.id ?? null); onChanged(); }
  }

  async function saveTable(table: Table) {
    const r = await lensRun('app-maker', 'dataSaveTable', {
      projectId, tableId: table.id, name: table.name, fields: table.fields,
    });
    if (r.data?.ok) { await refresh(); onChanged(); }
  }

  async function deleteTable(id: string) {
    const r = await lensRun('app-maker', 'dataDeleteTable', { projectId, tableId: id });
    if (r.data?.ok) { setSelected(null); await refresh(); onChanged(); }
  }

  async function addRelation() {
    if (!relForm.from || !relForm.to) return;
    const r = await lensRun('app-maker', 'dataAddRelation', {
      projectId, fromTable: relForm.from, toTable: relForm.to, kind: relForm.kind,
    });
    if (r.data?.ok) { await refresh(); onChanged(); }
  }

  async function deleteRelation(id: string) {
    const r = await lensRun('app-maker', 'dataDeleteRelation', { projectId, relationId: id });
    if (r.data?.ok) { await refresh(); onChanged(); }
  }

  function patchField(idx: number, patch: Partial<Field>) {
    if (!sel) return;
    const next = { ...sel, fields: sel.fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)) };
    setTables((prev) => prev.map((t) => (t.id === sel.id ? next : t)));
  }

  function addField() {
    if (!sel) return;
    const next = { ...sel, fields: [...sel.fields, { id: `f_${Date.now()}`, name: 'field', type: 'text' }] };
    setTables((prev) => prev.map((t) => (t.id === sel.id ? next : t)));
  }

  function removeField(idx: number) {
    if (!sel) return;
    const next = { ...sel, fields: sel.fields.filter((_, i) => i !== idx) };
    setTables((prev) => prev.map((t) => (t.id === sel.id ? next : t)));
  }

  // Schema tree for the viz panel.
  const schemaTree: TreeNode = {
    id: 'schema', label: 'Data Model',
    children: tables.map((t) => ({
      id: t.id, label: `${t.name} (${t.fields.length})`,
      children: t.fields.map((f) => ({ id: f.id, label: `${f.name}: ${f.type}` })),
    })),
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-pink-300">
            <Database className="h-4 w-4" /> Tables
          </h3>
          <button
            onClick={addTable}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded bg-pink-600 px-2 py-1 text-[11px] text-white hover:bg-pink-500 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Table
          </button>
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {tables.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelected(t.id)}
              className={`rounded px-2 py-1 text-[11px] ${
                selected === t.id ? 'bg-pink-700/50 text-pink-100' : 'bg-pink-950/30 text-pink-500 hover:text-pink-300'
              }`}
            >
              {t.name}
            </button>
          ))}
          {!tables.length && <span className="text-[11px] text-pink-700">No tables yet.</span>}
        </div>

        {sel && (
          <div className="rounded-lg border border-pink-900/40 bg-pink-950/10 p-3">
            <div className="mb-2 flex items-center gap-2">
              <input
                value={sel.name}
                onChange={(e) => setTables((prev) => prev.map((t) => (t.id === sel.id ? { ...t, name: e.target.value } : t)))}
                className="flex-1 rounded border border-pink-900/40 bg-black/40 px-2 py-1 font-mono text-sm text-pink-100"
              />
              <button aria-label="Delete" onClick={() => deleteTable(sel.id)} className="text-rose-400 hover:text-rose-300">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-pink-700">
                  <th className="pb-1">Field</th><th className="pb-1">Type</th><th className="pb-1">Req</th><th />
                </tr>
              </thead>
              <tbody>
                {sel.fields.map((f, i) => (
                  <tr key={f.id}>
                    <td className="py-0.5 pr-1">
                      <input
                        value={f.name}
                        onChange={(e) => patchField(i, { name: e.target.value })}
                        className="w-full rounded border border-pink-900/40 bg-black/40 px-1.5 py-0.5 text-pink-100"
                      />
                    </td>
                    <td className="py-0.5 pr-1">
                      <select
                        value={f.type}
                        onChange={(e) => patchField(i, { type: e.target.value })}
                        className="w-full rounded border border-pink-900/40 bg-black/40 px-1 py-0.5 text-pink-100"
                      >
                        {fieldTypes.map((ft) => <option key={ft} value={ft}>{ft}</option>)}
                      </select>
                    </td>
                    <td className="py-0.5">
                      <input type="checkbox" checked={!!f.required} onChange={(e) => patchField(i, { required: e.target.checked })} />
                    </td>
                    <td className="py-0.5">
                      <button aria-label="Delete" onClick={() => removeField(i)} className="text-rose-400 hover:text-rose-300">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 flex gap-2">
              <button onClick={addField} className="rounded bg-pink-950/40 px-2 py-1 text-[11px] text-pink-300 hover:text-pink-100">
                + Field
              </button>
              <button onClick={() => saveTable(sel)} className="rounded bg-pink-600 px-2 py-1 text-[11px] text-white hover:bg-pink-500">
                Save table
              </button>
            </div>
          </div>
        )}

        {/* Relations */}
        <div className="mt-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-pink-300">
            <Link2 className="h-4 w-4" /> Relations
          </h3>
          <div className="mb-2 flex flex-wrap gap-1.5">
            <select value={relForm.from} onChange={(e) => setRelForm((p) => ({ ...p, from: e.target.value }))}
              className="rounded border border-pink-900/40 bg-black/40 px-1.5 py-1 text-[11px] text-pink-100">
              <option value="">From…</option>
              {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={relForm.kind} onChange={(e) => setRelForm((p) => ({ ...p, kind: e.target.value }))}
              className="rounded border border-pink-900/40 bg-black/40 px-1.5 py-1 text-[11px] text-pink-100">
              <option value="one-to-one">1:1</option>
              <option value="one-to-many">1:N</option>
              <option value="many-to-many">N:N</option>
            </select>
            <select value={relForm.to} onChange={(e) => setRelForm((p) => ({ ...p, to: e.target.value }))}
              className="rounded border border-pink-900/40 bg-black/40 px-1.5 py-1 text-[11px] text-pink-100">
              <option value="">To…</option>
              {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button onClick={addRelation} className="rounded bg-pink-600 px-2 py-1 text-[11px] text-white hover:bg-pink-500">
              Link
            </button>
          </div>
          <ul className="space-y-1">
            {relations.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded border border-pink-900/30 bg-pink-950/10 px-2 py-1 text-[11px]">
                <span className="text-pink-200">{r.fromName}</span>
                <span className="text-pink-600">—{r.kind}—</span>
                <span className="text-pink-200">{r.toName}</span>
                <button aria-label="Delete" onClick={() => deleteRelation(r.id)} className="ml-auto text-rose-400 hover:text-rose-300">
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            ))}
            {!relations.length && <li className="text-[11px] text-pink-700">No relations.</li>}
          </ul>
        </div>
      </div>

      <aside className="rounded-lg border border-pink-900/40 bg-pink-950/10 p-2">
        <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-pink-500">Schema</h4>
        <TreeDiagram root={schemaTree} />
      </aside>
    </div>
  );
}
