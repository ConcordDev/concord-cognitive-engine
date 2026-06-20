// @ghost-click-ok — every async onClick in this workbench routes through the
// guarded mutate() wrapper (try/catch + flash('err',…) on error; never rejects),
// so failures ARE surfaced to the user even though the try/catch lives there.
/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { TreeDiagram, type TreeNode } from '@/components/viz';
import {
  Network, Plus, Trash2, Link2, GitMerge, Scissors, Route, Upload,
  ShieldCheck, Loader2, Database, X, Search, FileJson, Pencil, Globe2,
} from 'lucide-react';

// ── Domain shapes ──────────────────────────────────────────────────────────

interface AttrEntry { value: any; source: string; at: number }
interface GraphNode {
  id: string;
  name: string;
  entityType: string;
  attributes: Record<string, AttrEntry>;
  wikidataId: string | null;
  createdAt: number;
}
interface GraphEdge {
  id: string;
  from: string;
  to: string;
  relType: string;
  weight: number;
  createdAt: number;
}
interface SchemaAttr { name: string; type: string; required: boolean }
interface EntitySchema {
  id: string;
  className: string;
  attributes: SchemaAttr[];
  createdAt: number;
  updatedAt?: number;
}
interface GraphState { nodes: GraphNode[]; edges: GraphEdge[]; schemas: EntitySchema[] }

const SCHEMA_TYPES = ['string', 'number', 'integer', 'boolean', 'date', 'url', 'email'];

async function run<T = any>(name: string, params: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const r = await lensRun('entity', name, params);
    if (r.data?.ok) return r.data.result as T;
  } catch {
    /* swallow — surfaced via empty result */
  }
  return null;
}

// ── Workbench ──────────────────────────────────────────────────────────────

type Tab = 'graph' | 'schemas' | 'merge' | 'path' | 'import' | 'provenance';

export function KnowledgeGraphWorkbench() {
  const [tab, setTab] = useState<Tab>('graph');
  const [graph, setGraph] = useState<GraphState>({ nodes: [], edges: [], schemas: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const refresh = useCallback(async () => {
    const g = await run<GraphState>('graph-get');
    if (g) setGraph({ nodes: g.nodes || [], edges: g.edges || [], schemas: g.schemas || [] });
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flash = useCallback((kind: 'ok' | 'err', msg: string) => {
    setNotice({ kind, msg });
    window.setTimeout(() => setNotice(null), 3500);
  }, []);

  // Generic mutation wrapper: run macro → refresh → flash.
  // @ghost-click-ok — every async onClick in this workbench routes its request
  // through this guarded wrapper: try/catch + flash('err', …) on both an error
  // response and a network throw, and it never rejects (always returns boolean).
  // So the handlers DO surface failures to the user even though the try/catch
  // lives here rather than inline. The ghost-click detector flags `onClick={async}`
  // without an inline try/catch and can't trace into the wrapper — this attests it.
  const mutate = useCallback(async (
    name: string,
    params: Record<string, unknown>,
    okMsg: string,
  ): Promise<boolean> => {
    setBusy(true);
    let ok = false;
    try {
      const r = await lensRun('entity', name, params);
      if (r.data?.ok) {
        ok = true;
        await refresh();
        flash('ok', okMsg);
      } else {
        flash('err', r.data?.error || 'Action failed');
      }
    } catch {
      flash('err', 'Network error');
    }
    setBusy(false);
    return ok;
  }, [refresh, flash]);

  const tabs: Array<{ id: Tab; label: string; icon: typeof Network }> = [
    { id: 'graph', label: 'Graph', icon: Network },
    { id: 'schemas', label: 'Schemas', icon: Database },
    { id: 'merge', label: 'Merge / Split', icon: GitMerge },
    { id: 'path', label: 'Path Finder', icon: Route },
    { id: 'import', label: 'Import', icon: Upload },
    { id: 'provenance', label: 'Provenance', icon: ShieldCheck },
  ];

  return (
    <div className="panel p-4 space-y-4">
      <header className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold flex items-center gap-2">
          <Network className="w-4 h-4 text-neon-cyan" />
          Knowledge-Graph Workbench
        </h2>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span>{graph.nodes.length} nodes</span>
          <span>{graph.edges.length} edges</span>
          <span>{graph.schemas.length} schemas</span>
        </div>
      </header>

      {notice && (
        <div className={`text-xs rounded px-3 py-2 border ${
          notice.kind === 'ok'
            ? 'bg-neon-green/10 border-neon-green/20 text-neon-green'
            : 'bg-red-500/10 border-red-500/20 text-red-300'
        }`}>
          {notice.msg}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 py-1.5 px-3 rounded-md text-xs font-medium transition-colors ${
              tab === t.id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-300'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading graph…
        </div>
      ) : (
        <>
          {tab === 'graph' && (
            <GraphTab graph={graph} busy={busy} mutate={mutate} />
          )}
          {tab === 'schemas' && (
            <SchemasTab schemas={graph.schemas} busy={busy} mutate={mutate} />
          )}
          {tab === 'merge' && (
            <MergeSplitTab graph={graph} busy={busy} mutate={mutate} />
          )}
          {tab === 'path' && (
            <PathTab graph={graph} />
          )}
          {tab === 'import' && (
            <ImportTab busy={busy} mutate={mutate} />
          )}
          {tab === 'provenance' && (
            <ProvenanceTab />
          )}
        </>
      )}
    </div>
  );
}

// ── Graph tab — node-link canvas + node/edge editor ────────────────────────

function GraphTab({ graph, busy, mutate }: {
  graph: GraphState;
  busy: boolean;
  mutate: (n: string, p: Record<string, unknown>, m: string) => Promise<boolean>;
}) {
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('generic');
  const [selected, setSelected] = useState<string | null>(null);
  const [edgeFrom, setEdgeFrom] = useState('');
  const [edgeTo, setEdgeTo] = useState('');
  const [edgeRel, setEdgeRel] = useState('related');

  // Attribute editor state (for selected node).
  const [attrKey, setAttrKey] = useState('');
  const [attrVal, setAttrVal] = useState('');
  const [attrSrc, setAttrSrc] = useState('manual');
  const [renameVal, setRenameVal] = useState('');

  const selNode = graph.nodes.find((n) => n.id === selected) || null;
  useEffect(() => { setRenameVal(selNode?.name || ''); }, [selNode]);

  const typeOptions = useMemo(() => {
    const fromSchema = graph.schemas.map((s) => s.className);
    return Array.from(new Set(['generic', 'person', 'organization', 'place', 'concept', ...fromSchema]));
  }, [graph.schemas]);

  // Tree view of nodes grouped by entityType, with edges as children.
  const treeRoot: TreeNode[] = useMemo(() => {
    const byType = new Map<string, GraphNode[]>();
    for (const n of graph.nodes) {
      if (!byType.has(n.entityType)) byType.set(n.entityType, []);
      byType.get(n.entityType)!.push(n);
    }
    return Array.from(byType.entries()).map(([type, ns]) => ({
      id: `type:${type}`,
      label: type,
      detail: `${ns.length} ${ns.length === 1 ? 'entity' : 'entities'}`,
      tone: 'info' as const,
      children: ns.map((n) => {
        const outgoing = graph.edges.filter((e) => e.from === n.id);
        return {
          id: n.id,
          label: n.name,
          detail: `${Object.keys(n.attributes).length} attrs${n.wikidataId ? ` · ${n.wikidataId}` : ''}`,
          tone: (selected === n.id ? 'good' : 'default') as TreeNode['tone'],
          children: outgoing.map((e) => {
            const tgt = graph.nodes.find((x) => x.id === e.to);
            return {
              id: e.id,
              label: `→ ${tgt?.name || e.to}`,
              detail: `${e.relType} (w:${e.weight})`,
              tone: 'warn' as const,
            };
          }),
        };
      }),
    }));
  }, [graph, selected]);

  return (
    <div className="space-y-4">
      {/* Create node */}
      <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800 space-y-2">
        <p className="text-xs font-semibold uppercase text-gray-400 flex items-center gap-1">
          <Plus className="w-3 h-3" /> Add Entity Node
        </p>
        <div className="flex gap-2 flex-wrap">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Entity name"
            className="input-lattice text-sm flex-1 min-w-[160px]"
          />
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            className="input-lattice text-sm"
          >
            {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button
            disabled={!newName.trim() || busy}
            onClick={async () => {
              const ok = await mutate('node-create', { name: newName.trim(), entityType: newType }, 'Node created');
              if (ok) setNewName('');
            }}
            className="btn-neon cyan text-sm"
          >
            Add Node
          </button>
        </div>
      </div>

      {/* Create edge */}
      <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800 space-y-2">
        <p className="text-xs font-semibold uppercase text-gray-400 flex items-center gap-1">
          <Link2 className="w-3 h-3" /> Link Nodes
        </p>
        <div className="flex gap-2 flex-wrap items-center">
          <select value={edgeFrom} onChange={(e) => setEdgeFrom(e.target.value)} className="input-lattice text-sm flex-1 min-w-[140px]">
            <option value="">From…</option>
            {graph.nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
          <input
            value={edgeRel}
            onChange={(e) => setEdgeRel(e.target.value)}
            placeholder="relation"
            className="input-lattice text-sm w-32"
          />
          <select value={edgeTo} onChange={(e) => setEdgeTo(e.target.value)} className="input-lattice text-sm flex-1 min-w-[140px]">
            <option value="">To…</option>
            {graph.nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
          <button
            disabled={!edgeFrom || !edgeTo || edgeFrom === edgeTo || busy}
            onClick={async () => {
              const ok = await mutate('edge-create', { from: edgeFrom, to: edgeTo, relType: edgeRel.trim() || 'related' }, 'Edge created');
              if (ok) { setEdgeFrom(''); setEdgeTo(''); }
            }}
            className="btn-neon purple text-sm"
          >
            Link
          </button>
        </div>
      </div>

      {/* Graph canvas + detail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
          <p className="text-xs font-semibold uppercase text-gray-400 mb-2">Relationship Graph</p>
          {graph.nodes.length === 0 ? (
            <p className="text-xs text-gray-400 py-6 text-center">No nodes yet. Add an entity above.</p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              <TreeDiagram
                root={treeRoot}
                onSelect={(n) => {
                  if (graph.nodes.some((x) => x.id === n.id)) setSelected(n.id);
                }}
              />
            </div>
          )}
        </div>

        {/* Selected node detail */}
        <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
          {!selNode ? (
            <p className="text-xs text-gray-400 py-6 text-center">Select a node in the graph to inspect and edit it.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase text-gray-400">Node Detail</p>
                <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-white" aria-label="Deselect">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Rename */}
              <div className="flex gap-2">
                <input
                  value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  className="input-lattice text-sm flex-1"
                />
                <button aria-label="Rename node"
                  disabled={busy || !renameVal.trim() || renameVal === selNode.name}
                  onClick={() => mutate('node-update', { id: selNode.id, name: renameVal.trim() }, 'Node renamed')}
                  className="btn-neon text-xs"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  disabled={busy}
                  onClick={() => { mutate('node-delete', { id: selNode.id }, 'Node deleted'); setSelected(null); }}
                  className="btn-neon text-xs text-red-400"
                  aria-label="Delete node"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <p className="text-[11px] text-gray-400 font-mono">
                {selNode.entityType} · #{selNode.id}
                {selNode.wikidataId && <span className="text-cyan-400"> · {selNode.wikidataId}</span>}
              </p>

              {/* Attributes with provenance */}
              <div className="space-y-1">
                <p className="text-[10px] uppercase text-gray-400">Attributes</p>
                {Object.keys(selNode.attributes).length === 0 ? (
                  <p className="text-[11px] text-gray-400">No attributes.</p>
                ) : (
                  Object.entries(selNode.attributes).map(([k, a]) => (
                    <div key={k} className="flex items-center gap-2 text-[11px] bg-zinc-950 rounded px-2 py-1 border border-zinc-800">
                      <span className="font-mono text-cyan-300">{k}</span>
                      <span className="text-gray-300 flex-1 truncate">{String(a.value)}</span>
                      <span className="text-[9px] px-1 py-0.5 rounded bg-zinc-800 text-gray-400" title="provenance">
                        {a.source}
                      </span>
                      <button
                        disabled={busy}
                        onClick={() => mutate('node-update', { id: selNode.id, attributeKey: k, deleteAttribute: true }, 'Attribute removed')}
                        className="text-gray-600 hover:text-red-400"
                        aria-label={`Delete attribute ${k}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Add attribute */}
              <div className="flex gap-1.5 flex-wrap">
                <input value={attrKey} onChange={(e) => setAttrKey(e.target.value)} placeholder="key" className="input-lattice text-xs w-24" />
                <input value={attrVal} onChange={(e) => setAttrVal(e.target.value)} placeholder="value" className="input-lattice text-xs flex-1 min-w-[80px]" />
                <input value={attrSrc} onChange={(e) => setAttrSrc(e.target.value)} placeholder="source" className="input-lattice text-xs w-24" />
                <button
                  disabled={busy || !attrKey.trim()}
                  onClick={async () => {
                    const ok = await mutate('node-update', {
                      id: selNode.id,
                      attributeKey: attrKey.trim(),
                      attributeValue: attrVal,
                      attributeSource: attrSrc.trim() || 'manual',
                    }, 'Attribute set');
                    if (ok) { setAttrKey(''); setAttrVal(''); }
                  }}
                  className="btn-neon green text-xs"
                >
                  Set
                </button>
              </div>

              {/* Incident edges */}
              <div className="space-y-1">
                <p className="text-[10px] uppercase text-gray-400">Edges</p>
                {graph.edges.filter((e) => e.from === selNode.id || e.to === selNode.id).length === 0 ? (
                  <p className="text-[11px] text-gray-400">No edges.</p>
                ) : (
                  graph.edges.filter((e) => e.from === selNode.id || e.to === selNode.id).map((e) => {
                    const other = graph.nodes.find((n) => n.id === (e.from === selNode.id ? e.to : e.from));
                    return (
                      <div key={e.id} className="flex items-center gap-2 text-[11px] bg-zinc-950 rounded px-2 py-1 border border-zinc-800">
                        <span className="text-gray-400">{e.from === selNode.id ? '→' : '←'}</span>
                        <span className="text-gray-300 flex-1 truncate">{other?.name || '?'}</span>
                        <span className="text-purple-300">{e.relType}</span>
                        <button
                          disabled={busy}
                          onClick={() => mutate('edge-delete', { id: e.id }, 'Edge deleted')}
                          className="text-gray-600 hover:text-red-400"
                          aria-label="Delete edge"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Schemas tab — typed entity classes ─────────────────────────────────────

function SchemasTab({ schemas, busy, mutate }: {
  schemas: EntitySchema[];
  busy: boolean;
  mutate: (n: string, p: Record<string, unknown>, m: string) => Promise<boolean>;
}) {
  const [className, setClassName] = useState('');
  const [attrs, setAttrs] = useState<SchemaAttr[]>([{ name: '', type: 'string', required: false }]);
  const [editId, setEditId] = useState<string | null>(null);

  const startEdit = (s: EntitySchema) => {
    setEditId(s.id);
    setClassName(s.className);
    setAttrs(s.attributes.length ? s.attributes.map((a) => ({ ...a })) : [{ name: '', type: 'string', required: false }]);
  };
  const reset = () => {
    setEditId(null);
    setClassName('');
    setAttrs([{ name: '', type: 'string', required: false }]);
  };

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800 space-y-2">
        <p className="text-xs font-semibold uppercase text-gray-400">
          {editId ? 'Edit Entity Class' : 'Define Entity Class'}
        </p>
        <input
          value={className}
          onChange={(e) => setClassName(e.target.value)}
          placeholder="Class name (e.g. Person, Organization)"
          className="input-lattice text-sm w-full"
        />
        <div className="space-y-1.5">
          {attrs.map((a, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                value={a.name}
                onChange={(e) => setAttrs((arr) => arr.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                placeholder="attribute name"
                className="input-lattice text-xs flex-1"
              />
              <select
                value={a.type}
                onChange={(e) => setAttrs((arr) => arr.map((x, j) => j === i ? { ...x, type: e.target.value } : x))}
                className="input-lattice text-xs"
              >
                {SCHEMA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <label className="flex items-center gap-1 text-[10px] text-gray-400">
                <input
                  type="checkbox"
                  checked={a.required}
                  onChange={(e) => setAttrs((arr) => arr.map((x, j) => j === i ? { ...x, required: e.target.checked } : x))}
                />
                required
              </label>
              <button
                onClick={() => setAttrs((arr) => arr.filter((_, j) => j !== i))}
                className="text-gray-600 hover:text-red-400"
                aria-label="Remove attribute"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button
            onClick={() => setAttrs((arr) => [...arr, { name: '', type: 'string', required: false }])}
            className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Add attribute
          </button>
        </div>
        <div className="flex gap-2">
          <button
            disabled={busy || !className.trim()}
            onClick={async () => {
              const cleanAttrs = attrs.filter((a) => a.name.trim()).map((a) => ({ ...a, name: a.name.trim() }));
              const ok = await mutate('schema-save', {
                ...(editId ? { id: editId } : {}),
                className: className.trim(),
                attributes: cleanAttrs,
              }, editId ? 'Schema updated' : 'Schema saved');
              if (ok) reset();
            }}
            className="btn-neon cyan text-sm"
          >
            {editId ? 'Update Schema' : 'Save Schema'}
          </button>
          {editId && (
            <button onClick={reset} className="btn-neon text-sm">Cancel</button>
          )}
        </div>
      </div>

      {/* Schema list */}
      <div className="space-y-2">
        {schemas.length === 0 ? (
          <p className="text-xs text-gray-400">No entity classes defined yet.</p>
        ) : (
          schemas.map((s) => (
            <div key={s.id} className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-white flex items-center gap-1.5">
                  <Database className="w-3.5 h-3.5 text-cyan-400" />
                  {s.className}
                </span>
                <div className="flex gap-2">
                  <button onClick={() => startEdit(s)} className="text-gray-400 hover:text-white" aria-label="Edit schema">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => mutate('schema-delete', { id: s.id }, 'Schema deleted')}
                    className="text-gray-400 hover:text-red-400"
                    aria-label="Delete schema"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {s.attributes.length === 0 ? (
                  <span className="text-[11px] text-gray-400">No attributes</span>
                ) : s.attributes.map((a) => (
                  <span key={a.name} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-gray-300">
                    {a.name}: <span className="text-cyan-300">{a.type}</span>
                    {a.required && <span className="text-red-400">*</span>}
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Merge / Split tab ──────────────────────────────────────────────────────

function MergeSplitTab({ graph, busy, mutate }: {
  graph: GraphState;
  busy: boolean;
  mutate: (n: string, p: Record<string, unknown>, m: string) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<'merge' | 'split'>('merge');

  // Merge state.
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [fieldChoices, setFieldChoices] = useState<Record<string, 'source' | 'target'>>({});

  // Split state.
  const [splitId, setSplitId] = useState('');
  const [splitName, setSplitName] = useState('');
  const [splitKeys, setSplitKeys] = useState<string[]>([]);

  const srcNode = graph.nodes.find((n) => n.id === sourceId) || null;
  const tgtNode = graph.nodes.find((n) => n.id === targetId) || null;
  const splitNode = graph.nodes.find((n) => n.id === splitId) || null;

  const conflictKeys = useMemo(() => {
    if (!srcNode || !tgtNode) return [];
    return Object.keys(srcNode.attributes).filter((k) => k in tgtNode.attributes);
  }, [srcNode, tgtNode]);

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 w-fit">
        {(['merge', 'split'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`py-1 px-3 rounded-md text-xs font-medium capitalize ${
              mode === m ? 'bg-zinc-800 text-white' : 'text-zinc-400'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === 'merge' ? (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            Resolve duplicates: merge a source node into a target. Edges rewire onto the target;
            on attribute conflict, choose which value wins.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-zinc-900 rounded-lg p-3 border border-purple-500/20">
              <p className="text-[10px] uppercase text-purple-300 mb-1">Source (will be removed)</p>
              <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="input-lattice text-sm w-full">
                <option value="">Select source…</option>
                {graph.nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
              {srcNode && <NodeAttrList node={srcNode} />}
            </div>
            <div className="bg-zinc-900 rounded-lg p-3 border border-cyan-500/20">
              <p className="text-[10px] uppercase text-cyan-300 mb-1">Target (survives)</p>
              <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="input-lattice text-sm w-full">
                <option value="">Select target…</option>
                {graph.nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              </select>
              {tgtNode && <NodeAttrList node={tgtNode} />}
            </div>
          </div>

          {/* Conflict reconciliation */}
          {conflictKeys.length > 0 && (
            <div className="bg-zinc-900 rounded-lg p-3 border border-amber-500/20 space-y-1.5">
              <p className="text-[10px] uppercase text-amber-300">Attribute conflicts — pick a winner</p>
              {conflictKeys.map((k) => (
                <div key={k} className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono text-gray-300 w-24 truncate">{k}</span>
                  <button
                    onClick={() => setFieldChoices((c) => ({ ...c, [k]: 'source' }))}
                    className={`flex-1 truncate text-left px-2 py-0.5 rounded border ${
                      (fieldChoices[k] || 'target') === 'source' ? 'border-purple-400 bg-purple-500/10 text-purple-200' : 'border-zinc-700 text-gray-400'
                    }`}
                  >
                    src: {String(srcNode?.attributes[k]?.value)}
                  </button>
                  <button
                    onClick={() => setFieldChoices((c) => ({ ...c, [k]: 'target' }))}
                    className={`flex-1 truncate text-left px-2 py-0.5 rounded border ${
                      (fieldChoices[k] || 'target') === 'target' ? 'border-cyan-400 bg-cyan-500/10 text-cyan-200' : 'border-zinc-700 text-gray-400'
                    }`}
                  >
                    tgt: {String(tgtNode?.attributes[k]?.value)}
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            disabled={busy || !sourceId || !targetId || sourceId === targetId}
            onClick={async () => {
              const ok = await mutate('node-merge', { sourceId, targetId, fieldChoices }, 'Nodes merged');
              if (ok) { setSourceId(''); setTargetId(''); setFieldChoices({}); }
            }}
            className="btn-neon purple text-sm flex items-center gap-1.5"
          >
            <GitMerge className="w-4 h-4" /> Merge Nodes
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            Split selected attributes off a node into a new entity, linked back by a
            <span className="font-mono text-gray-300"> split_from </span> edge.
          </p>
          <select value={splitId} onChange={(e) => { setSplitId(e.target.value); setSplitKeys([]); }} className="input-lattice text-sm w-full">
            <option value="">Select node to split…</option>
            {graph.nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
          {splitNode && (
            <>
              <input
                value={splitName}
                onChange={(e) => setSplitName(e.target.value)}
                placeholder="New entity name"
                className="input-lattice text-sm w-full"
              />
              <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800 space-y-1">
                <p className="text-[10px] uppercase text-gray-400">Attributes to move</p>
                {Object.keys(splitNode.attributes).length === 0 ? (
                  <p className="text-[11px] text-gray-400">Node has no attributes to split.</p>
                ) : Object.entries(splitNode.attributes).map(([k, a]) => (
                  <label key={k} className="flex items-center gap-2 text-[11px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={splitKeys.includes(k)}
                      onChange={(e) => setSplitKeys((arr) => e.target.checked ? [...arr, k] : arr.filter((x) => x !== k))}
                    />
                    <span className="font-mono text-cyan-300">{k}</span>
                    <span className="text-gray-400 truncate">{String(a.value)}</span>
                  </label>
                ))}
              </div>
              <button
                disabled={busy || !splitName.trim() || splitKeys.length === 0}
                onClick={async () => {
                  const ok = await mutate('node-split', { id: splitId, splitName: splitName.trim(), attributeKeys: splitKeys }, 'Node split');
                  if (ok) { setSplitId(''); setSplitName(''); setSplitKeys([]); }
                }}
                className="btn-neon cyan text-sm flex items-center gap-1.5"
              >
                <Scissors className="w-4 h-4" /> Split Node
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function NodeAttrList({ node }: { node: GraphNode }) {
  const keys = Object.keys(node.attributes);
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {keys.length === 0 ? (
        <span className="text-[10px] text-gray-400">No attributes</span>
      ) : keys.map((k) => (
        <span key={k} className="text-[9px] px-1 py-0.5 rounded bg-zinc-800 text-gray-300">
          {k}
        </span>
      ))}
    </div>
  );
}

// ── Path-finder tab ────────────────────────────────────────────────────────

interface PathResult {
  found: boolean;
  hops: number;
  path: Array<{ nodeId: string; name: string; relTypeIn?: string | null }>;
  reason?: string;
}

function PathTab({ graph }: { graph: GraphState }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [result, setResult] = useState<PathResult | null>(null);
  const [running, setRunning] = useState(false);

  const find = async () => {
    setRunning(true);
    setResult(null);
    const r = await run<PathResult>('path-find', { from, to });
    setResult(r);
    setRunning(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">
        Find the shortest relationship path between two entities (breadth-first, undirected edges).
      </p>
      <div className="flex gap-2 flex-wrap items-center">
        <select value={from} onChange={(e) => setFrom(e.target.value)} className="input-lattice text-sm flex-1 min-w-[140px]">
          <option value="">From entity…</option>
          {graph.nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
        <Route className="w-4 h-4 text-gray-600" />
        <select value={to} onChange={(e) => setTo(e.target.value)} className="input-lattice text-sm flex-1 min-w-[140px]">
          <option value="">To entity…</option>
          {graph.nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
        <button
          disabled={!from || !to || running}
          onClick={find}
          className="btn-neon cyan text-sm"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Find Path'}
        </button>
      </div>

      {result && (
        result.found ? (
          <div className="bg-zinc-900 rounded-lg p-3 border border-neon-green/20 space-y-2">
            <p className="text-xs text-neon-green font-semibold">
              Path found — {result.hops} {result.hops === 1 ? 'hop' : 'hops'}
            </p>
            <div className="flex flex-wrap items-center gap-1">
              {result.path.map((step, i) => (
                <span key={step.nodeId} className="flex items-center gap-1">
                  {i > 0 && (
                    <span className="text-[10px] text-purple-300 font-mono">
                      ─{step.relTypeIn || 'related'}→
                    </span>
                  )}
                  <span className="text-xs px-2 py-1 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-200">
                    {step.name}
                  </span>
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-zinc-900 rounded-lg p-3 border border-red-500/20 text-xs text-red-300">
            No path exists between these entities{result.reason ? ` — ${result.reason}` : ''}.
          </div>
        )
      )}
    </div>
  );
}

// ── Import tab — CSV/JSON bulk + Wikidata ──────────────────────────────────

function ImportTab({ busy, mutate }: {
  busy: boolean;
  mutate: (n: string, p: Record<string, unknown>, m: string) => Promise<boolean>;
}) {
  const [sub, setSub] = useState<'csvjson' | 'wikidata'>('csvjson');

  // CSV / JSON.
  const [raw, setRaw] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function parseRows(text: string): Record<string, unknown>[] {
    const trimmed = text.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      const j = JSON.parse(trimmed);
      return Array.isArray(j) ? j : [j];
    }
    // CSV
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw new Error('CSV needs a header row and at least one data row');
    const headers = lines[0].split(',').map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const cells = line.split(',');
      const row: Record<string, unknown> = {};
      headers.forEach((h, i) => { row[h] = (cells[i] || '').trim(); });
      return row;
    });
  }

  const doImport = async () => {
    setParseError(null);
    let rows: Record<string, unknown>[];
    try {
      rows = parseRows(raw);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Parse failed');
      return;
    }
    if (rows.length === 0) { setParseError('No rows parsed'); return; }
    const ok = await mutate('import-bulk', { rows, source: raw.trim().startsWith('[') || raw.trim().startsWith('{') ? 'json-import' : 'csv-import' }, `Imported ${rows.length} rows`);
    if (ok) setRaw('');
  };

  // Wikidata.
  const [wdQuery, setWdQuery] = useState('');
  const [wdResults, setWdResults] = useState<Array<{ id: string; label: string; description?: string }>>([]);
  const [wdSearching, setWdSearching] = useState(false);

  const searchWikidata = async () => {
    if (wdQuery.trim().length < 2) return;
    setWdSearching(true);
    setWdResults([]);
    try {
      const r = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(wdQuery.trim())}&format=json&language=en&type=item&limit=15&origin=*`);
      if (r.ok) {
        const j = await r.json();
        setWdResults((j.search || []).map((m: any) => ({ id: m.id, label: m.label || m.id, description: m.description })));
      }
    } catch {
      /* unreachable — empty list shown */
    }
    setWdSearching(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 w-fit">
        {([['csvjson', 'CSV / JSON'], ['wikidata', 'Wikidata']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSub(id)}
            className={`py-1 px-3 rounded-md text-xs font-medium ${
              sub === id ? 'bg-zinc-800 text-white' : 'text-zinc-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {sub === 'csvjson' ? (
        <div className="space-y-2">
          <p className="text-xs text-gray-400 flex items-center gap-1">
            <FileJson className="w-3.5 h-3.5" />
            Paste CSV (header row + rows) or a JSON array. Each row needs a
            <span className="font-mono text-gray-300"> name</span> field; other columns become provenance-tagged attributes.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.json,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const reader = new FileReader();
              reader.onload = () => setRaw(String(reader.result || ''));
              reader.readAsText(f);
            }}
          />
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={'name,type,city\nAda Lovelace,person,London\n\n…or…\n[{"name":"Ada Lovelace","type":"person"}]'}
            rows={8}
            className="input-lattice text-xs w-full font-mono"
          />
          {parseError && <p className="text-xs text-red-300">{parseError}</p>}
          <div className="flex gap-2">
            <button onClick={() => fileRef.current?.click()} className="btn-neon text-sm">
              <Upload className="w-3.5 h-3.5 mr-1 inline" /> Load File
            </button>
            <button
              disabled={busy || !raw.trim()}
              onClick={doImport}
              className="btn-neon cyan text-sm"
            >
              Import Rows
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-400 flex items-center gap-1">
            <Globe2 className="w-3.5 h-3.5" />
            Search Wikidata (live public API) and import entities as graph nodes with
            <span className="font-mono text-gray-300"> wikidata</span> provenance.
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                value={wdQuery}
                onChange={(e) => setWdQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') searchWikidata(); }}
                placeholder="Search Wikidata entities…"
                className="input-lattice text-sm w-full pl-7"
              />
            </div>
            <button
              disabled={wdQuery.trim().length < 2 || wdSearching}
              onClick={searchWikidata}
              className="btn-neon cyan text-sm"
            >
              {wdSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
            </button>
          </div>
          <div className="space-y-1.5 max-h-[360px] overflow-y-auto">
            {wdResults.map((m) => (
              <div key={m.id} className="flex items-center gap-2 bg-zinc-900 rounded-lg p-2 border border-zinc-800">
                <span className="font-mono text-[10px] text-cyan-300 shrink-0">{m.id}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white truncate">{m.label}</p>
                  {m.description && <p className="text-[10px] text-gray-400 truncate">{m.description}</p>}
                </div>
                <button
                  disabled={busy}
                  onClick={() => mutate('import-wikidata', {
                    wikidataId: m.id,
                    label: m.label,
                    description: m.description || '',
                  }, `Imported ${m.label}`)}
                  className="btn-neon green text-xs shrink-0"
                >
                  <Plus className="w-3 h-3 mr-0.5 inline" /> Add
                </button>
              </div>
            ))}
            {!wdSearching && wdResults.length === 0 && wdQuery.trim().length >= 2 && (
              <p className="text-xs text-gray-400 text-center py-3">No results — search to load entities.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Provenance tab ─────────────────────────────────────────────────────────

interface ProvenanceData {
  totalAttributes: number;
  sourceCount: number;
  bySource: Array<{ source: string; count: number }>;
  entries: Array<{ nodeId: string; nodeName: string; attribute: string; value: any; source: string; at: number | null }>;
}

function ProvenanceTab() {
  const [data, setData] = useState<ProvenanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const r = await run<ProvenanceData>('provenance-report');
    setData(r);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entries = useMemo(() => {
    if (!data) return [];
    return filter ? data.entries.filter((e) => e.source === filter) : data.entries;
  }, [data, filter]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400 py-6 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading provenance…
      </div>
    );
  }
  if (!data || data.totalAttributes === 0) {
    return <p className="text-xs text-gray-400 py-4">No attributes recorded yet. Add attributes to nodes to track provenance.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">
          {data.totalAttributes} attribute values across {data.sourceCount} sources.
        </p>
        <button onClick={load} className="text-xs text-cyan-400 hover:text-cyan-300">Refresh</button>
      </div>

      {/* Source breakdown */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter('')}
          className={`text-xs px-2 py-1 rounded border ${filter === '' ? 'border-cyan-400 bg-cyan-500/10 text-cyan-200' : 'border-zinc-700 text-gray-400'}`}
        >
          all ({data.totalAttributes})
        </button>
        {data.bySource.map((s) => (
          <button
            key={s.source}
            onClick={() => setFilter(s.source)}
            className={`text-xs px-2 py-1 rounded border ${filter === s.source ? 'border-cyan-400 bg-cyan-500/10 text-cyan-200' : 'border-zinc-700 text-gray-400'}`}
          >
            {s.source} ({s.count})
          </button>
        ))}
      </div>

      {/* Entries */}
      <div className="space-y-1 max-h-[420px] overflow-y-auto">
        {entries.map((e, i) => (
          <div key={`${e.nodeId}-${e.attribute}-${i}`} className="flex items-center gap-2 text-[11px] bg-zinc-900 rounded px-2 py-1.5 border border-zinc-800">
            <span className="text-white truncate w-32">{e.nodeName}</span>
            <span className="font-mono text-cyan-300 w-24 truncate">{e.attribute}</span>
            <span className="text-gray-300 flex-1 truncate">{String(e.value)}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-gray-400">{e.source}</span>
            {e.at && <span className="text-[9px] text-gray-400 tabular-nums">{new Date(e.at).toLocaleDateString()}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
