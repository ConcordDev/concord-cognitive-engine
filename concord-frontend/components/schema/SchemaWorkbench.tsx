'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * SchemaWorkbench — JSON-Schema-tooling / Hasura / dbdiagram parity surface.
 * Versioned registry + visual editor + sample-data generator + migration
 * codegen + live-data conformance + ER visualization + schema inference.
 * Every value rendered comes from a real `schema.*` macro.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { lensRun } from '@/lib/api/client';
import { TreeDiagram, TreeNode } from '@/components/viz';
import {
  Database, Plus, Trash2, GitBranch, Beaker, FileCode2, ShieldCheck,
  Network, Download, Loader2, X, Save, RefreshCw, AlertTriangle, Check,
} from 'lucide-react';

const DOMAIN = 'schema';

export type FieldType = 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object';

export interface SchemaField {
  name: string;
  type: FieldType;
  required: boolean;
  pattern?: string;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  enumStr?: string;
  ref?: string;
  description?: string;
}

interface RegistryEntry {
  id: string;
  name: string;
  description: string;
  versionCount: number;
  latestVersion: string;
  fieldCount: number;
  createdAt: string;
  updatedAt: string;
}

interface SchemaVersion {
  version: string;
  schema: { fields: Record<string, any> };
  note: string;
  createdAt: string;
}

interface FullEntry extends RegistryEntry {
  versions: SchemaVersion[];
}

/* ── helpers ─────────────────────────────────────────────────────── */

// Convert the editor's flat field array into a schema-macro fields object.
export function fieldsToSchema(fields: SchemaField[]): { fields: Record<string, any> } {
  const out: Record<string, any> = {};
  for (const f of fields) {
    const name = f.name.trim();
    if (!name) continue;
    const def: Record<string, any> = { type: f.type };
    if (f.required) def.required = true;
    if (f.pattern) def.pattern = f.pattern;
    if (f.min !== undefined && !Number.isNaN(f.min)) def.min = f.min;
    if (f.max !== undefined && !Number.isNaN(f.max)) def.max = f.max;
    if (f.minLength !== undefined && !Number.isNaN(f.minLength)) def.minLength = f.minLength;
    if (f.maxLength !== undefined && !Number.isNaN(f.maxLength)) def.maxLength = f.maxLength;
    if (f.enumStr && f.enumStr.trim()) {
      def.enum = f.enumStr.split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (f.ref) def.ref = f.ref;
    if (f.description) def.description = f.description;
    out[name] = def;
  }
  return { fields: out };
}

// Convert a schema-macro fields object back into editor field rows.
export function schemaToFields(schema: { fields?: Record<string, any> } | undefined): SchemaField[] {
  const out: SchemaField[] = [];
  for (const [name, def] of Object.entries(schema?.fields || {})) {
    const d = def as Record<string, any>;
    out.push({
      name,
      type: (d.type || 'string') as FieldType,
      required: !!d.required,
      pattern: d.pattern,
      min: d.min,
      max: d.max,
      minLength: d.minLength,
      maxLength: d.maxLength,
      enumStr: Array.isArray(d.enum) ? d.enum.join(', ') : undefined,
      ref: d.ref,
      description: d.description,
    });
  }
  return out;
}

function emptyField(): SchemaField {
  return { name: '', type: 'string', required: false };
}

function schemaToTree(name: string, schema: { fields?: Record<string, any> }): TreeNode {
  const children: TreeNode[] = Object.entries(schema?.fields || {}).map(([fname, def]) => {
    const d = def as Record<string, any>;
    const bits: string[] = [d.type];
    if (d.required) bits.push('required');
    if (d.ref) bits.push(`→ ${d.ref}`);
    if (Array.isArray(d.enum)) bits.push(`enum(${d.enum.length})`);
    return {
      id: `${name}.${fname}`,
      label: fname,
      detail: bits.join(' · '),
      tone: d.required ? 'warn' : 'default',
    };
  });
  return { id: name, label: name, detail: `${children.length} fields`, tone: 'info', children };
}

/* ── tabs ────────────────────────────────────────────────────────── */

type Tab = 'registry' | 'editor' | 'sample' | 'migration' | 'conformance' | 'er' | 'import';

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'registry', label: 'Registry', icon: Database },
  { id: 'editor', label: 'Visual Editor', icon: FileCode2 },
  { id: 'sample', label: 'Sample Data', icon: Beaker },
  { id: 'migration', label: 'Migration', icon: GitBranch },
  { id: 'conformance', label: 'Conformance', icon: ShieldCheck },
  { id: 'er', label: 'ER Diagram', icon: Network },
  { id: 'import', label: 'Import', icon: Download },
];

export function SchemaWorkbench() {
  const [tab, setTab] = useState<Tab>('registry');
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorFields, setEditorFields] = useState<SchemaField[]>([emptyField()]);
  const [editorName, setEditorName] = useState('');
  const [editorDesc, setEditorDesc] = useState('');
  const [editorNote, setEditorNote] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshRegistry = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const r = await lensRun(DOMAIN, 'registryList', {});
    if (r.data?.ok && r.data.result) {
      setRegistry((r.data.result as { schemas: RegistryEntry[] }).schemas || []);
    } else {
      setErr(r.data?.error || 'Failed to load registry');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refreshRegistry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load a registry schema into the visual editor.
  const loadIntoEditor = useCallback(async (id: string) => {
    setBusy(true);
    const r = await lensRun(DOMAIN, 'registryGet', { id });
    if (r.data?.ok && r.data.result) {
      const entry = r.data.result as FullEntry;
      const latest = entry.versions[entry.versions.length - 1];
      setEditorFields(schemaToFields(latest.schema));
      setEditorName(entry.name);
      setEditorDesc(entry.description);
      setEditorNote('');
      setSelectedId(id);
      setTab('editor');
    }
    setBusy(false);
  }, []);

  const startNewSchema = useCallback(() => {
    setSelectedId(null);
    setEditorFields([emptyField()]);
    setEditorName('');
    setEditorDesc('');
    setEditorNote('');
    setTab('editor');
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 border-b border-cyan-500/15 pb-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                tab === t.id
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                  : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'registry' && (
        <RegistryPanel
          registry={registry}
          loading={loading}
          err={err}
          onRefresh={refreshRegistry}
          onOpen={loadIntoEditor}
          onNew={startNewSchema}
          busy={busy}
        />
      )}
      {tab === 'editor' && (
        <VisualEditor
          fields={editorFields}
          setFields={setEditorFields}
          name={editorName}
          setName={setEditorName}
          description={editorDesc}
          setDescription={setEditorDesc}
          note={editorNote}
          setNote={setEditorNote}
          selectedId={selectedId}
          onSaved={(id) => {
            setSelectedId(id);
            refreshRegistry();
          }}
        />
      )}
      {tab === 'sample' && <SamplePanel registry={registry} editorFields={editorFields} editorName={editorName} />}
      {tab === 'migration' && <MigrationPanel registry={registry} />}
      {tab === 'conformance' && <ConformancePanel registry={registry} />}
      {tab === 'er' && <ERPanel registry={registry} />}
      {tab === 'import' && (
        <ImportPanel
          onAdopt={(name, fields) => {
            setEditorName(name);
            setEditorFields(fields.length ? fields : [emptyField()]);
            setSelectedId(null);
            setTab('editor');
          }}
        />
      )}
    </div>
  );
}

/* ── registry panel ──────────────────────────────────────────────── */

function RegistryPanel({
  registry, loading, err, onRefresh, onOpen, onNew, busy,
}: {
  registry: RegistryEntry[];
  loading: boolean;
  err: string | null;
  onRefresh: () => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  busy: boolean;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const [history, setHistory] = useState<FullEntry | null>(null);

  const handleDelete = async (id: string) => {
    setDeleting(id);
    const r = await lensRun(DOMAIN, 'registryDelete', { id });
    if (r.data?.ok) onRefresh();
    setDeleting(null);
  };

  const viewHistory = async (id: string) => {
    const r = await lensRun(DOMAIN, 'registryGet', { id });
    if (r.data?.ok && r.data.result) setHistory(r.data.result as FullEntry);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Schema Registry</h3>
        <div className="flex gap-2">
          <button onClick={onRefresh} className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800">
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
          <button onClick={onNew} disabled={busy} className="flex items-center gap-1 rounded bg-cyan-500/20 border border-cyan-500/40 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50">
            <Plus className="h-3 w-3" /> New Schema
          </button>
        </div>
      </div>

      {loading && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading registry…</div>}
      {err && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{err}</div>}
      {!loading && !err && registry.length === 0 && (
        <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-400">
          No schemas registered. Click <span className="text-cyan-400">New Schema</span> to define your first one in the visual editor.
        </div>
      )}

      <div className="space-y-2">
        {registry.map((s) => (
          <div key={s.id} className="rounded-lg border border-cyan-500/15 bg-cyan-500/5 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-zinc-100">{s.name}</span>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">v{s.latestVersion}</span>
                </div>
                {s.description && <p className="mt-0.5 text-[11px] text-zinc-400">{s.description}</p>}
                <div className="mt-1 flex gap-3 text-[10px] text-zinc-400">
                  <span>{s.fieldCount} fields</span>
                  <span>{s.versionCount} version{s.versionCount !== 1 ? 's' : ''}</span>
                  <span>updated {new Date(s.updatedAt).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button onClick={() => viewHistory(s.id)} className="rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800">History</button>
                <button onClick={() => onOpen(s.id)} className="rounded border border-cyan-500/30 px-2 py-1 text-[10px] text-cyan-300 hover:bg-cyan-500/15">Edit</button>
                <button onClick={() => handleDelete(s.id)} disabled={deleting === s.id} className="rounded border border-red-500/30 px-2 py-1 text-red-300 hover:bg-red-500/15 disabled:opacity-50">
                  {deleting === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {history && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setHistory(null)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-cyan-500/20 bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-white">{history.name} — version history</h4>
              <button aria-label="Close" onClick={() => setHistory(null)} className="text-zinc-400 hover:text-zinc-200"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-2">
              {[...history.versions].reverse().map((v) => (
                <div key={v.version} className="rounded border border-zinc-800 bg-zinc-900/60 p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-cyan-300">v{v.version}</span>
                    <span className="text-[10px] text-zinc-400">{new Date(v.createdAt).toLocaleString()}</span>
                  </div>
                  {v.note && <p className="mt-0.5 text-[11px] text-zinc-400">{v.note}</p>}
                  <p className="mt-1 text-[10px] text-zinc-400">{Object.keys(v.schema?.fields || {}).length} fields: {Object.keys(v.schema?.fields || {}).join(', ') || '—'}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── visual editor ───────────────────────────────────────────────── */

const FIELD_TYPES: FieldType[] = ['string', 'integer', 'number', 'boolean', 'array', 'object'];

function VisualEditor({
  fields, setFields, name, setName, description, setDescription, note, setNote, selectedId, onSaved,
}: {
  fields: SchemaField[];
  setFields: (f: SchemaField[]) => void;
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
  selectedId: string | null;
  onSaved: (id: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [resultOk, setResultOk] = useState(true);

  const update = (idx: number, patch: Partial<SchemaField>) => {
    const next = fields.slice();
    next[idx] = { ...next[idx], ...patch };
    setFields(next);
  };
  const addField = () => setFields([...fields, emptyField()]);
  const removeField = (idx: number) => setFields(fields.filter((_, i) => i !== idx));

  const namedCount = fields.filter((f) => f.name.trim()).length;
  const tree = useMemo(() => schemaToTree(name || 'schema', fieldsToSchema(fields)), [name, fields]);

  const save = async () => {
    setSaving(true);
    setResult(null);
    const schema = fieldsToSchema(fields);
    if (selectedId) {
      const r = await lensRun(DOMAIN, 'registrySaveVersion', { id: selectedId, schema, note: note || 'editor save' });
      if (r.data?.ok && r.data.result) {
        const res = r.data.result as { version: string; bump: string };
        setResultOk(true);
        setResult(`Saved new version v${res.version} (${res.bump} bump)`);
        onSaved(selectedId);
      } else {
        setResultOk(false);
        setResult(r.data?.error || 'Save failed');
      }
    } else {
      const r = await lensRun(DOMAIN, 'registryCreate', { name: name.trim(), description, schema, note: note || 'initial version' });
      if (r.data?.ok && r.data.result) {
        const res = r.data.result as { id: string; version: string };
        setResultOk(true);
        setResult(`Created "${name}" v${res.version}`);
        onSaved(res.id);
      } else {
        setResultOk(false);
        setResult(r.data?.error || 'Create failed');
      }
    }
    setSaving(false);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <FileCode2 className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">{selectedId ? 'Edit Schema' : 'Define Schema'}</h3>
          {selectedId && <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">new version on save</span>}
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!!selectedId}
          placeholder="Schema name (e.g. user_profile)"
          className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-white disabled:opacity-60"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={!!selectedId}
          placeholder="Description (optional)"
          className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-300 disabled:opacity-60"
        />

        <div className="space-y-2">
          {fields.map((f, idx) => (
            <div key={idx} className="rounded border border-zinc-800 bg-zinc-900/50 p-2 space-y-1.5">
              <div className="flex gap-1.5">
                <input
                  value={f.name}
                  onChange={(e) => update(idx, { name: e.target.value })}
                  placeholder="field name"
                  className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white"
                />
                <select
                  value={f.type}
                  onChange={(e) => update(idx, { type: e.target.value as FieldType })}
                  className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white"
                >
                  {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <label className="flex items-center gap-1 text-[10px] text-zinc-400">
                  <input type="checkbox" checked={f.required} onChange={(e) => update(idx, { required: e.target.checked })} />
                  req
                </label>
                <button aria-label="Remove" onClick={() => removeField(idx)} className="text-zinc-600 hover:text-red-400"><X className="h-3.5 w-3.5" /></button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {f.type === 'string' && (
                  <>
                    <input value={f.pattern || ''} onChange={(e) => update(idx, { pattern: e.target.value })} placeholder="regex pattern" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-300" />
                    <input value={f.enumStr || ''} onChange={(e) => update(idx, { enumStr: e.target.value })} placeholder="enum: a, b, c" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-300" />
                    <input type="number" value={f.minLength ?? ''} onChange={(e) => update(idx, { minLength: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="minLength" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-300" />
                    <input type="number" value={f.maxLength ?? ''} onChange={(e) => update(idx, { maxLength: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="maxLength" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-300" />
                  </>
                )}
                {(f.type === 'integer' || f.type === 'number') && (
                  <>
                    <input type="number" value={f.min ?? ''} onChange={(e) => update(idx, { min: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="min" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-300" />
                    <input type="number" value={f.max ?? ''} onChange={(e) => update(idx, { max: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="max" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-300" />
                  </>
                )}
                {(f.type === 'object' || f.type === 'array') && (
                  <input value={f.ref || ''} onChange={(e) => update(idx, { ref: e.target.value })} placeholder="ref: target schema name" className="col-span-2 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-300" />
                )}
              </div>
            </div>
          ))}
        </div>
        <button onClick={addField} className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300">
          <Plus className="h-3 w-3" /> Add field
        </button>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Version note (what changed)"
          rows={2}
          className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-300"
        />
        <button
          onClick={save}
          disabled={saving || !name.trim() || namedCount === 0}
          className="flex w-full items-center justify-center gap-1.5 rounded bg-cyan-500/20 border border-cyan-500/40 py-2 text-sm text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {selectedId ? 'Save New Version' : 'Create Schema'}
        </button>
        {result && (
          <div className={`rounded border px-3 py-2 text-xs ${resultOk ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
            {result}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-white">Schema Tree</h3>
        <p className="text-[11px] text-zinc-400">{namedCount} field{namedCount !== 1 ? 's' : ''} defined</p>
        <TreeDiagram root={tree} />
      </div>
    </div>
  );
}

/* ── sample-data generator ───────────────────────────────────────── */

function SchemaPicker({
  registry, value, onChange, label,
}: {
  registry: RegistryEntry[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white"
    >
      <option value="">{label}</option>
      {registry.map((s) => <option key={s.id} value={s.id}>{s.name} (v{s.latestVersion})</option>)}
    </select>
  );
}

function SamplePanel({
  registry, editorFields, editorName,
}: {
  registry: RegistryEntry[];
  editorFields: SchemaField[];
  editorName: string;
}) {
  const [id, setId] = useState('');
  const [count, setCount] = useState(5);
  const [records, setRecords] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [useEditor, setUseEditor] = useState(false);

  const generate = async () => {
    setBusy(true);
    setErr(null);
    setRecords(null);
    const payload: Record<string, unknown> = { count };
    if (useEditor) payload.schema = fieldsToSchema(editorFields);
    else if (id) payload.id = id;
    else { setErr('Pick a registry schema or use the editor draft'); setBusy(false); return; }
    const r = await lensRun(DOMAIN, 'sampleGenerate', payload);
    if (r.data?.ok && r.data.result) setRecords((r.data.result as { records: any[] }).records);
    else setErr(r.data?.error || 'Generation failed');
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Beaker className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">Sample-Data Generator</h3>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-[11px] text-zinc-400">
          <input type="checkbox" checked={useEditor} onChange={(e) => setUseEditor(e.target.checked)} />
          use editor draft{editorName ? ` (${editorName})` : ''}
        </label>
        {!useEditor && <SchemaPicker registry={registry} value={id} onChange={setId} label="Select schema" />}
        <input
          type="number"
          min={1}
          max={200}
          value={count}
          onChange={(e) => setCount(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
          className="w-20 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white"
        />
        <button onClick={generate} disabled={busy} className="flex items-center gap-1 rounded bg-cyan-500/20 border border-cyan-500/40 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Beaker className="h-3 w-3" />}
          Generate
        </button>
      </div>
      {err && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{err}</div>}
      {records && (
        <div>
          <p className="mb-1 text-[11px] text-zinc-400">{records.length} valid records generated</p>
          <pre className="max-h-80 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-3 text-[11px] text-emerald-200">
            {JSON.stringify(records, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ── migration generator ─────────────────────────────────────────── */

function MigrationPanel({ registry }: { registry: RegistryEntry[] }) {
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [dialect, setDialect] = useState<'sql' | 'json'>('sql');
  const [table, setTable] = useState('records');
  const [result, setResult] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Resolve a registry id to its latest schema fields object.
  const fetchSchema = async (id: string) => {
    const r = await lensRun(DOMAIN, 'registryGet', { id });
    if (r.data?.ok && r.data.result) {
      const entry = r.data.result as FullEntry;
      return entry.versions[entry.versions.length - 1].schema;
    }
    return null;
  };

  const run = async () => {
    setBusy(true);
    setErr(null);
    setResult(null);
    if (!fromId || !toId) { setErr('Pick a source and target schema'); setBusy(false); return; }
    const a = await fetchSchema(fromId);
    const b = await fetchSchema(toId);
    if (!a || !b) { setErr('Failed to resolve schemas'); setBusy(false); return; }
    const r = await lensRun(DOMAIN, 'migrationGenerate', { schemaA: a, schemaB: b, dialect, table });
    if (r.data?.ok && r.data.result) setResult(r.data.result);
    else setErr(r.data?.error || 'Migration generation failed');
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">Migration Generator</h3>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SchemaPicker registry={registry} value={fromId} onChange={setFromId} label="From schema" />
        <span className="text-zinc-600">→</span>
        <SchemaPicker registry={registry} value={toId} onChange={setToId} label="To schema" />
        <select value={dialect} onChange={(e) => setDialect(e.target.value as 'sql' | 'json')} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">
          <option value="sql">SQL</option>
          <option value="json">JSON ops</option>
        </select>
        <input value={table} onChange={(e) => setTable(e.target.value)} placeholder="table" className="w-32 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" />
        <button onClick={run} disabled={busy} className="flex items-center gap-1 rounded bg-cyan-500/20 border border-cyan-500/40 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitBranch className="h-3 w-3" />}
          Generate
        </button>
      </div>
      {err && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{err}</div>}
      {result && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="text-zinc-400">Operations: <span className="font-mono text-cyan-300">{result.operationCount}</span></span>
            <span className="text-zinc-400">Breaking: <span className="font-mono text-red-300">{result.breakingCount}</span></span>
            <span className={result.reversible ? 'text-emerald-300' : 'text-amber-300'}>
              {result.reversible ? '✓ reversible' : '⚠ not fully reversible'}
            </span>
          </div>
          {Array.isArray(result.operations) && result.operations.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {result.operations.map((op: any, i: number) => (
                <span key={i} className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${op.breaking ? 'bg-red-500/15 text-red-300' : 'bg-zinc-800 text-zinc-300'}`}>
                  {op.op} {op.field}
                </span>
              ))}
            </div>
          )}
          <pre className="max-h-80 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-3 text-[11px] text-cyan-200">
            {result.script}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ── conformance against live data ───────────────────────────────── */

function ConformancePanel({ registry }: { registry: RegistryEntry[] }) {
  const [id, setId] = useState('');
  const [dataText, setDataText] = useState('');
  const [result, setResult] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    setResult(null);
    if (!id) { setErr('Pick a schema'); setBusy(false); return; }
    let records: unknown;
    try {
      records = JSON.parse(dataText);
    } catch {
      setErr('Dataset must be valid JSON (array of records)');
      setBusy(false);
      return;
    }
    if (!Array.isArray(records)) { setErr('Dataset must be a JSON array'); setBusy(false); return; }
    const r = await lensRun(DOMAIN, 'conformanceCheck', { id, records });
    if (r.data?.ok && r.data.result) setResult(r.data.result);
    else setErr(r.data?.error || 'Conformance check failed');
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">Validation Against Live Data</h3>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SchemaPicker registry={registry} value={id} onChange={setId} label="Select schema" />
        <button onClick={run} disabled={busy} className="flex items-center gap-1 rounded bg-cyan-500/20 border border-cyan-500/40 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
          Check Conformance
        </button>
      </div>
      <textarea
        value={dataText}
        onChange={(e) => setDataText(e.target.value)}
        placeholder='Paste a dataset as a JSON array: [{"field": "value"}, ...]'
        rows={6}
        className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-[11px] text-zinc-300"
      />
      {err && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{err}</div>}
      {result && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="text-zinc-400">Records: <span className="font-mono text-cyan-300">{result.recordCount}</span></span>
            <span className="text-zinc-400">Conformance: <span className={`font-mono ${result.conformanceRate >= 95 ? 'text-emerald-300' : result.conformanceRate >= 70 ? 'text-amber-300' : 'text-red-300'}`}>{result.conformanceRate}%</span></span>
            <span className="text-zinc-400">Violations: <span className="font-mono text-red-300">{result.totalViolations}</span></span>
          </div>
          {Array.isArray(result.undeclaredFields) && result.undeclaredFields.length > 0 && (
            <div className="flex items-center gap-1.5 text-[11px] text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" /> Undeclared fields: {result.undeclaredFields.join(', ')}
            </div>
          )}
          <div className="overflow-x-auto rounded border border-zinc-800">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-zinc-900 text-zinc-400">
                <tr>
                  <th className="px-2 py-1">Field</th>
                  <th className="px-2 py-1">Type</th>
                  <th className="px-2 py-1">Presence</th>
                  <th className="px-2 py-1">Nulls</th>
                  <th className="px-2 py-1">Type mismatch</th>
                  <th className="px-2 py-1">Conforming</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(result.fieldStats as Record<string, any>).map(([fname, fs]) => (
                  <tr key={fname} className="border-t border-zinc-800">
                    <td className="px-2 py-1 font-mono text-zinc-200">{fname}{fs.required && <span className="text-red-400">*</span>}</td>
                    <td className="px-2 py-1 text-zinc-400">{fs.declaredType}</td>
                    <td className={`px-2 py-1 ${fs.presenceRate >= 99 ? 'text-emerald-300' : 'text-amber-300'}`}>{fs.presenceRate}%</td>
                    <td className="px-2 py-1 text-zinc-400">{fs.nullCount}</td>
                    <td className={`px-2 py-1 ${fs.typeMismatchCount > 0 ? 'text-red-300' : 'text-zinc-400'}`}>{fs.typeMismatchCount}</td>
                    <td className="px-2 py-1 text-emerald-300">{fs.conformingCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── ER diagram ──────────────────────────────────────────────────── */

function ERPanel({ registry }: { registry: RegistryEntry[] }) {
  const [result, setResult] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const build = async () => {
    setBusy(true);
    setErr(null);
    setResult(null);
    // erDiagram with no params reads the user's full registry.
    const r = await lensRun(DOMAIN, 'erDiagram', {});
    if (r.data?.ok && r.data.result) setResult(r.data.result);
    else setErr(r.data?.error || 'ER diagram build failed');
    setBusy(false);
  };

  const tree: TreeNode[] = useMemo(() => {
    if (!result?.nodes) return [];
    return (result.nodes as any[]).map((n) => ({
      id: n.id,
      label: n.label,
      detail: `${n.fieldCount} fields`,
      tone: 'info' as const,
      children: (n.fields as any[]).map((f) => {
        const edge = (result.edges as any[]).find((e) => e.from === n.id && e.field === f.name);
        return {
          id: `${n.id}.${f.name}`,
          label: f.name,
          detail: edge ? `${f.type} · ${edge.kind} → ${edge.to}${edge.resolved ? '' : ' (unresolved)'}` : `${f.type}${f.required ? ' · required' : ''}`,
          tone: edge ? (edge.resolved ? 'good' : 'bad') : (f.required ? 'warn' : 'default'),
        } as TreeNode;
      }),
    }));
  }, [result]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">Entity-Relationship Diagram</h3>
        </div>
        <button onClick={build} disabled={busy || registry.length === 0} className="flex items-center gap-1 rounded bg-cyan-500/20 border border-cyan-500/40 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Network className="h-3 w-3" />}
          Build from Registry
        </button>
      </div>
      {registry.length === 0 && <p className="text-xs text-zinc-400">Register schemas first — the ER diagram is built from your catalog.</p>}
      {err && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{err}</div>}
      {result && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="text-zinc-400">Entities: <span className="font-mono text-cyan-300">{result.entityCount}</span></span>
            <span className="text-zinc-400">Relations: <span className="font-mono text-cyan-300">{result.relationCount}</span></span>
            {Array.isArray(result.danglingRefs) && result.danglingRefs.length > 0 && (
              <span className="text-red-300">⚠ {result.danglingRefs.length} dangling ref{result.danglingRefs.length !== 1 ? 's' : ''}</span>
            )}
          </div>
          {Array.isArray(result.edges) && result.edges.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {(result.edges as any[]).map((e, i) => (
                <span key={i} className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${e.resolved ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>
                  {e.from}.{e.field} {e.kind} {e.to}
                </span>
              ))}
            </div>
          )}
          <TreeDiagram root={tree} />
        </div>
      )}
    </div>
  );
}

/* ── import / inference ──────────────────────────────────────────── */

function ImportPanel({
  onAdopt,
}: {
  onAdopt: (name: string, fields: SchemaField[]) => void;
}) {
  const [source, setSource] = useState<'json' | 'sql'>('json');
  const [text, setText] = useState('');
  const [result, setResult] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    setResult(null);
    const payload: Record<string, unknown> = { source };
    if (source === 'json') {
      let records: unknown;
      try {
        records = JSON.parse(text);
      } catch {
        setErr('Input must be valid JSON');
        setBusy(false);
        return;
      }
      payload.records = records;
    } else {
      payload.ddl = text;
    }
    const r = await lensRun(DOMAIN, 'inferSchema', payload);
    if (r.data?.ok && r.data.result) setResult(r.data.result);
    else setErr(r.data?.error || 'Inference failed');
    setBusy(false);
  };

  const tree = useMemo(() => {
    if (!result?.schema) return null;
    return schemaToTree(result.table || 'inferred', result.schema);
  }, [result]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Download className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">Import — Infer Schema from JSON / SQL</h3>
      </div>
      <div className="flex items-center gap-2">
        <select value={source} onChange={(e) => setSource(e.target.value as 'json' | 'sql')} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">
          <option value="json">JSON records</option>
          <option value="sql">SQL DDL</option>
        </select>
        <button onClick={run} disabled={busy || !text.trim()} className="flex items-center gap-1 rounded bg-cyan-500/20 border border-cyan-500/40 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          Infer
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={source === 'json'
          ? 'Paste a JSON array of records: [{"id": 1, "name": "..."}]'
          : 'Paste a CREATE TABLE statement'}
        rows={7}
        className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 font-mono text-[11px] text-zinc-300"
      />
      {err && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{err}</div>}
      {result && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">
              Inferred <span className="font-mono text-cyan-300">{result.fieldCount}</span> fields
              {result.table && <> from table <span className="font-mono text-cyan-300">{result.table}</span></>}
            </span>
            <button
              onClick={() => onAdopt(result.table || 'inferred', schemaToFields(result.schema))}
              className="flex items-center gap-1 rounded border border-cyan-500/30 px-2 py-1 text-[11px] text-cyan-300 hover:bg-cyan-500/15"
            >
              <Check className="h-3 w-3" /> Open in Editor
            </button>
          </div>
          {tree && <TreeDiagram root={tree} />}
        </div>
      )}
    </div>
  );
}
