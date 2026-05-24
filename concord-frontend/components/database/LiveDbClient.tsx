'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * LiveDbClient — a real DBeaver/TablePlus-shape database client built on the
 * `database` domain macros. Wires every backlog item:
 *   - Connection manager (connection-create/list/update/delete/test)
 *   - Live query execution against the in-memory SQL engine (query-run)
 *   - Result-grid inline editing (row-insert/row-update/row-delete)
 *   - ER diagram canvas with draggable tables (dataset-move) + TreeDiagram
 *   - Query plan / EXPLAIN visualization (query-explain)
 *   - CSV / JSON export of query results (query-export)
 *   - Schema-aware SQL autocomplete (sql-autocomplete)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { TreeDiagram, type TreeNode } from '@/components/viz';
import {
  Database, Plus, Trash2, Play, RefreshCw, Wifi, X, Edit3, Check,
  Table2, Columns, FileSpreadsheet, FileJson, GitBranch, Move, Loader2,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

interface Connection {
  id: string;
  name: string;
  engine: string;
  host: string;
  database: string;
  username: string;
  readOnly: boolean;
  color: string;
  datasetCount: number;
  rowTotal: number;
  createdAt: string;
  lastUsedAt: string | null;
}

interface DatasetColumn { name: string; type: string }
interface Dataset {
  id: string;
  name: string;
  columns: DatasetColumn[];
  rowCount: number;
  x: number;
  y: number;
}

interface QueryRunResult {
  columns: string[];
  rows: Record<string, any>[];
  rowCount: number;
  affected: number | null;
  op: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

interface ExplainNode {
  id: string;
  label: string;
  type: string;
  rows: number;
  cost: number;
  detail: string;
  children?: string[];
}

interface ExplainResult {
  verb: string;
  table: string;
  nodes: ExplainNode[];
  totalCost: number;
  estimatedRows: number;
  warnings: string[];
  error?: string;
}

interface AutoSuggest { value: string; kind: string; table?: string; type?: string }

const COL_TYPES = ['integer', 'bigint', 'text', 'varchar', 'boolean', 'real', 'numeric', 'timestamp', 'date', 'uuid', 'json'];
const ENGINES = ['in-memory', 'sqlite', 'postgresql', 'mysql'];

// ── EXPLAIN plan → TreeDiagram converter ───────────────────────────────────

function buildPlanTree(nodes: ExplainNode[]): TreeNode | null {
  if (!nodes.length) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childIds = new Set<string>();
  for (const n of nodes) (n.children || []).forEach((c) => childIds.add(c));
  // root = node that is no one's child (the last/top operator)
  const rootNode = nodes.find((n) => !childIds.has(n.id)) || nodes[nodes.length - 1];
  const toTree = (n: ExplainNode): TreeNode => ({
    id: n.id,
    label: `${n.label}  ·  cost ${n.cost}`,
    detail: `${n.rows} row${n.rows !== 1 ? 's' : ''}${n.detail ? ' — ' + n.detail : ''}`,
    tone: n.type === 'scan' ? 'warn' : n.type === 'sort' ? 'info' : 'default',
    children: (n.children || []).map((c) => byId.get(c)).filter(Boolean).map((c) => toTree(c as ExplainNode)),
  });
  return toTree(rootNode);
}

// ── Component ──────────────────────────────────────────────────────────────

export function LiveDbClient() {
  const [conns, setConns] = useState<Connection[]>([]);
  const [activeConnId, setActiveConnId] = useState<string | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const activeConn = useMemo(() => conns.find((c) => c.id === activeConnId) || null, [conns, activeConnId]);

  const flash = useCallback((kind: 'ok' | 'err', msg: string) => {
    setNotice({ kind, msg });
    window.setTimeout(() => setNotice(null), 3500);
  }, []);

  // ── data loaders ──────────────────────────────────────────────────────
  const loadConns = useCallback(async () => {
    const r = await lensRun<{ connections: Connection[] }>('database', 'connection-list', {});
    if (r.data.ok && r.data.result) {
      setConns(r.data.result.connections);
      setActiveConnId((prev) => prev && r.data.result!.connections.some((c) => c.id === prev)
        ? prev
        : r.data.result!.connections[0]?.id || null);
    }
  }, []);

  const loadDatasets = useCallback(async (connId: string) => {
    const r = await lensRun<{ datasets: Dataset[] }>('database', 'dataset-list', { connectionId: connId });
    if (r.data.ok && r.data.result) setDatasets(r.data.result.datasets);
    else setDatasets([]);
  }, []);

  useEffect(() => { loadConns(); }, [loadConns]);
  useEffect(() => { if (activeConnId) loadDatasets(activeConnId); else setDatasets([]); }, [activeConnId, loadDatasets]);

  // ── connection manager ────────────────────────────────────────────────
  const [showConnForm, setShowConnForm] = useState(false);
  const [connForm, setConnForm] = useState({ name: '', engine: 'in-memory', host: 'local', database: '', username: '', readOnly: false });

  const createConn = useCallback(async () => {
    if (!connForm.name.trim()) return;
    setBusy(true);
    const r = await lensRun('database', 'connection-create', { ...connForm });
    setBusy(false);
    if (r.data.ok) {
      setShowConnForm(false);
      setConnForm({ name: '', engine: 'in-memory', host: 'local', database: '', username: '', readOnly: false });
      flash('ok', 'Connection saved');
      loadConns();
    } else flash('err', r.data.error || 'Failed to create connection');
  }, [connForm, flash, loadConns]);

  const deleteConn = useCallback(async (id: string) => {
    setBusy(true);
    const r = await lensRun('database', 'connection-delete', { id });
    setBusy(false);
    if (r.data.ok) { flash('ok', 'Connection deleted'); loadConns(); }
    else flash('err', r.data.error || 'Delete failed');
  }, [flash, loadConns]);

  const testConn = useCallback(async (id: string) => {
    setBusy(true);
    const r = await lensRun<{ connected: boolean; datasets: number }>('database', 'connection-test', { id });
    setBusy(false);
    if (r.data.ok && r.data.result) flash('ok', `Connected — ${r.data.result.datasets} dataset(s)`);
    else flash('err', r.data.error || 'Test failed');
  }, [flash]);

  const toggleReadOnly = useCallback(async (c: Connection) => {
    const r = await lensRun('database', 'connection-update', { id: c.id, readOnly: !c.readOnly });
    if (r.data.ok) loadConns();
  }, [loadConns]);

  // ── dataset (table) management ─────────────────────────────────────────
  const [showDsForm, setShowDsForm] = useState(false);
  const [dsName, setDsName] = useState('');
  const [dsCols, setDsCols] = useState<DatasetColumn[]>([{ name: 'id', type: 'integer' }]);

  const createDataset = useCallback(async () => {
    if (!activeConnId || !dsName.trim()) return;
    setBusy(true);
    const r = await lensRun('database', 'dataset-create', {
      connectionId: activeConnId, name: dsName,
      columns: dsCols.filter((c) => c.name.trim()),
    });
    setBusy(false);
    if (r.data.ok) {
      setShowDsForm(false);
      setDsName('');
      setDsCols([{ name: 'id', type: 'integer' }]);
      flash('ok', 'Dataset created');
      loadConns();
      loadDatasets(activeConnId);
    } else flash('err', r.data.error || 'Create failed');
  }, [activeConnId, dsName, dsCols, flash, loadConns, loadDatasets]);

  const deleteDataset = useCallback(async (datasetId: string) => {
    if (!activeConnId) return;
    setBusy(true);
    const r = await lensRun('database', 'dataset-delete', { connectionId: activeConnId, datasetId });
    setBusy(false);
    if (r.data.ok) { flash('ok', 'Dataset deleted'); loadConns(); loadDatasets(activeConnId); }
    else flash('err', r.data.error || 'Delete failed');
  }, [activeConnId, flash, loadConns, loadDatasets]);

  // ── SQL editor + autocomplete ──────────────────────────────────────────
  const [sql, setSql] = useState('SELECT * FROM users;');
  const [result, setResult] = useState<QueryRunResult | null>(null);
  const [explain, setExplain] = useState<ExplainResult | null>(null);
  const [suggests, setSuggests] = useState<AutoSuggest[]>([]);
  const [showSuggests, setShowSuggests] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const currentToken = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return '';
    const upto = ta.value.slice(0, ta.selectionStart);
    const m = upto.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
    return m ? m[1] : '';
  }, []);

  const fetchSuggests = useCallback(async () => {
    if (!activeConnId) return;
    const prefix = currentToken();
    const r = await lensRun<{ suggestions: AutoSuggest[] }>('database', 'sql-autocomplete', {
      connectionId: activeConnId, prefix,
    });
    if (r.data.ok && r.data.result) {
      setSuggests(r.data.result.suggestions);
      setShowSuggests(r.data.result.suggestions.length > 0);
    }
  }, [activeConnId, currentToken]);

  const applySuggest = useCallback((s: AutoSuggest) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const before = ta.value.slice(0, start).replace(/([A-Za-z_][A-Za-z0-9_]*)$/, '');
    const after = ta.value.slice(start);
    const next = `${before}${s.value} ${after}`;
    setSql(next);
    setShowSuggests(false);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = before.length + s.value.length + 1;
      ta.setSelectionRange(pos, pos);
    });
  }, []);

  const runQuery = useCallback(async () => {
    if (!activeConnId || !sql.trim()) return;
    setBusy(true);
    setExplain(null);
    const r = await lensRun<QueryRunResult>('database', 'query-run', { connectionId: activeConnId, sql });
    setBusy(false);
    setShowSuggests(false);
    if (r.data.ok && r.data.result) {
      setResult(r.data.result);
      if (!r.data.result.success) flash('err', r.data.result.error || 'Query failed');
      else if (r.data.result.op !== 'SELECT') {
        flash('ok', `${r.data.result.op} — ${r.data.result.affected ?? 0} row(s) affected`);
        loadConns();
        loadDatasets(activeConnId);
      }
    } else flash('err', r.data.error || 'Execution error');
  }, [activeConnId, sql, flash, loadConns, loadDatasets]);

  const runExplain = useCallback(async () => {
    if (!activeConnId || !sql.trim()) return;
    setBusy(true);
    const r = await lensRun<ExplainResult>('database', 'query-explain', { connectionId: activeConnId, sql });
    setBusy(false);
    if (r.data.ok && r.data.result) {
      if (r.data.result.error) flash('err', r.data.result.error);
      else setExplain(r.data.result);
    } else flash('err', r.data.error || 'EXPLAIN failed');
  }, [activeConnId, sql, flash]);

  const handleEditorKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runQuery(); }
    else if (e.ctrlKey && e.key === ' ') { e.preventDefault(); fetchSuggests(); }
    else if (e.key === 'Escape') setShowSuggests(false);
  }, [runQuery, fetchSuggests]);

  // ── result-grid inline editing ─────────────────────────────────────────
  const [editCell, setEditCell] = useState<{ rid: number; col: string } | null>(null);
  const [editVal, setEditVal] = useState('');

  // resolve which dataset the current SELECT result came from (for editing)
  const resultDataset = useMemo(() => {
    if (!result || result.op !== 'SELECT') return null;
    const m = sql.match(/\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)/i);
    if (!m) return null;
    return datasets.find((d) => d.name.toLowerCase() === m[1].toLowerCase()) || null;
  }, [result, sql, datasets]);

  const canEditGrid = !!resultDataset && !!activeConn && !activeConn.readOnly;

  const commitCellEdit = useCallback(async () => {
    if (!editCell || !activeConnId || !resultDataset) { setEditCell(null); return; }
    setBusy(true);
    const r = await lensRun('database', 'row-update', {
      connectionId: activeConnId, datasetId: resultDataset.id,
      rid: editCell.rid, column: editCell.col, value: editVal,
    });
    setBusy(false);
    if (r.data.ok) {
      flash('ok', 'Cell updated');
      runQuery();
    } else flash('err', r.data.error || 'Update failed');
    setEditCell(null);
  }, [editCell, editVal, activeConnId, resultDataset, flash, runQuery]);

  const deleteResultRow = useCallback(async (rid: number) => {
    if (!activeConnId || !resultDataset) return;
    setBusy(true);
    const r = await lensRun('database', 'row-delete', {
      connectionId: activeConnId, datasetId: resultDataset.id, rid,
    });
    setBusy(false);
    if (r.data.ok) { flash('ok', 'Row deleted'); runQuery(); loadConns(); }
    else flash('err', r.data.error || 'Delete failed');
  }, [activeConnId, resultDataset, flash, runQuery, loadConns]);

  const [newRow, setNewRow] = useState<Record<string, string>>({});
  const insertResultRow = useCallback(async () => {
    if (!activeConnId || !resultDataset) return;
    setBusy(true);
    const r = await lensRun('database', 'row-insert', {
      connectionId: activeConnId, datasetId: resultDataset.id, values: newRow,
    });
    setBusy(false);
    if (r.data.ok) {
      flash('ok', 'Row inserted');
      setNewRow({});
      runQuery();
      loadConns();
    } else flash('err', r.data.error || 'Insert failed');
  }, [activeConnId, resultDataset, newRow, flash, runQuery, loadConns]);

  // ── export ─────────────────────────────────────────────────────────────
  const exportResult = useCallback(async (format: 'csv' | 'json') => {
    if (!result || !result.columns.length) return;
    const r = await lensRun<{ content: string; format: string }>('database', 'query-export', {
      columns: result.columns, rows: result.rows, format,
    });
    if (r.data.ok && r.data.result) {
      const blob = new Blob([r.data.result.content], {
        type: format === 'csv' ? 'text/csv' : 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `query_result.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      flash('ok', `Exported ${format.toUpperCase()}`);
    } else flash('err', r.data.error || 'Export failed');
  }, [result, flash]);

  // ── ER canvas drag ─────────────────────────────────────────────────────
  const dragRef = useRef<{ id: string; offX: number; offY: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const onTableMouseDown = useCallback((e: React.MouseEvent, ds: Dataset) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      id: ds.id,
      offX: e.clientX - rect.left - ds.x,
      offY: e.clientY - rect.top - ds.y,
    };
  }, []);

  const onCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    const drag = dragRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!drag || !rect) return;
    const x = Math.max(0, Math.min(2400, e.clientX - rect.left - drag.offX));
    const y = Math.max(0, Math.min(2400, e.clientY - rect.top - drag.offY));
    setDatasets((prev) => prev.map((d) => (d.id === drag.id ? { ...d, x, y } : d)));
  }, []);

  const onCanvasMouseUp = useCallback(async () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !activeConnId) return;
    const ds = datasets.find((d) => d.id === drag.id);
    if (!ds) return;
    await lensRun('database', 'dataset-move', {
      connectionId: activeConnId, datasetId: ds.id, x: ds.x, y: ds.y,
    });
  }, [activeConnId, datasets]);

  // ── query history ──────────────────────────────────────────────────────
  interface HistEntry { id: string; sql: string; durationMs: number; rowCount: number; success: boolean; at: string }
  const [history, setHistory] = useState<HistEntry[]>([]);
  const loadHistory = useCallback(async () => {
    if (!activeConnId) { setHistory([]); return; }
    const r = await lensRun<{ history: HistEntry[] }>('database', 'query-history', {
      connectionId: activeConnId, limit: 30,
    });
    if (r.data.ok && r.data.result) setHistory(r.data.result.history);
  }, [activeConnId]);
  useEffect(() => { loadHistory(); }, [loadHistory, result]);

  const clearHistory = useCallback(async () => {
    const r = await lensRun('database', 'history-clear', {});
    if (r.data.ok) { setHistory([]); flash('ok', 'History cleared'); }
  }, [flash]);

  // ── views ──────────────────────────────────────────────────────────────
  type View = 'query' | 'er' | 'history';
  const [view, setView] = useState<View>('query');

  const planTree = useMemo(() => (explain ? buildPlanTree(explain.nodes) : null), [explain]);

  return (
    <div className="space-y-4">
      {notice && (
        <div className={`text-xs px-3 py-2 rounded border ${notice.kind === 'ok'
          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
          : 'bg-rose-500/10 border-rose-500/30 text-rose-300'}`}>
          {notice.msg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* ── Connection manager sidebar ─────────────────────────────── */}
        <div className="lg:col-span-1 panel p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2 text-neon-cyan">
              <Database className="w-4 h-4" /> Connections
            </h3>
            <button
              onClick={() => setShowConnForm((v) => !v)}
              className="p-1 rounded hover:bg-lattice-surface text-neon-green"
              aria-label="New connection"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {showConnForm && (
            <div className="space-y-2 bg-lattice-surface rounded p-2 border border-lattice-border">
              <input
                value={connForm.name}
                onChange={(e) => setConnForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Connection name"
                className="input-lattice w-full text-xs"
              />
              <select
                value={connForm.engine}
                onChange={(e) => setConnForm((f) => ({ ...f, engine: e.target.value }))}
                className="input-lattice w-full text-xs"
                aria-label="Engine"
              >
                {ENGINES.map((en) => <option key={en} value={en}>{en}</option>)}
              </select>
              <input
                value={connForm.host}
                onChange={(e) => setConnForm((f) => ({ ...f, host: e.target.value }))}
                placeholder="Host"
                className="input-lattice w-full text-xs"
              />
              <input
                value={connForm.database}
                onChange={(e) => setConnForm((f) => ({ ...f, database: e.target.value }))}
                placeholder="Database"
                className="input-lattice w-full text-xs"
              />
              <input
                value={connForm.username}
                onChange={(e) => setConnForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="Username"
                className="input-lattice w-full text-xs"
              />
              <label className="flex items-center gap-2 text-xs text-gray-400">
                <input
                  type="checkbox"
                  checked={connForm.readOnly}
                  onChange={(e) => setConnForm((f) => ({ ...f, readOnly: e.target.checked }))}
                />
                Read-only
              </label>
              <button
                onClick={createConn}
                disabled={busy || !connForm.name.trim()}
                className="btn-neon w-full text-xs disabled:opacity-40"
              >
                Save Connection
              </button>
            </div>
          )}

          <div className="space-y-1 max-h-[280px] overflow-y-auto">
            {conns.length === 0 && (
              <p className="text-xs text-gray-400 py-4 text-center">No connections yet — add one to begin.</p>
            )}
            {conns.map((c) => (
              <div
                key={c.id}
                className={`rounded border p-2 cursor-pointer transition-colors ${activeConnId === c.id
                  ? 'border-neon-cyan/40 bg-neon-cyan/5'
                  : 'border-lattice-border hover:bg-lattice-surface'}`}
                onClick={() => setActiveConnId(c.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-gray-200">
                    <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                    {c.name}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); testConn(c.id); }}
                      className="p-0.5 text-gray-400 hover:text-neon-green"
                      aria-label="Test connection"
                    >
                      <Wifi className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteConn(c.id); }}
                      className="p-0.5 text-gray-400 hover:text-red-400"
                      aria-label="Delete connection"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-400">
                  <span>{c.engine}</span>
                  <span>·</span>
                  <span>{c.datasetCount} tables</span>
                  <span>·</span>
                  <span>{c.rowTotal} rows</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleReadOnly(c); }}
                    className={`ml-auto px-1 rounded ${c.readOnly ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'}`}
                  >
                    {c.readOnly ? 'read-only' : 'writable'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Datasets of the active connection */}
          {activeConn && (
            <div className="pt-2 border-t border-lattice-border space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-neon-purple flex items-center gap-1.5">
                  <Table2 className="w-3.5 h-3.5" /> Datasets
                </h4>
                <button
                  onClick={() => setShowDsForm((v) => !v)}
                  className="p-0.5 rounded hover:bg-lattice-surface text-neon-green"
                  aria-label="New dataset"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {showDsForm && (
                <div className="space-y-2 bg-lattice-surface rounded p-2 border border-lattice-border">
                  <input
                    value={dsName}
                    onChange={(e) => setDsName(e.target.value)}
                    placeholder="table name"
                    className="input-lattice w-full text-xs"
                  />
                  {dsCols.map((col, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <input
                        value={col.name}
                        onChange={(e) => setDsCols((cs) => cs.map((c, j) => (j === i ? { ...c, name: e.target.value } : c)))}
                        placeholder="column"
                        className="input-lattice flex-1 text-xs"
                      />
                      <select
                        value={col.type}
                        onChange={(e) => setDsCols((cs) => cs.map((c, j) => (j === i ? { ...c, type: e.target.value } : c)))}
                        className="input-lattice text-xs"
                        aria-label="Column type"
                      >
                        {COL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <button
                        onClick={() => setDsCols((cs) => cs.filter((_, j) => j !== i))}
                        className="p-0.5 text-gray-400 hover:text-red-400"
                        aria-label="Remove column"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setDsCols((cs) => [...cs, { name: '', type: 'text' }])}
                    className="text-[10px] text-neon-cyan hover:underline"
                  >
                    + add column
                  </button>
                  <button
                    onClick={createDataset}
                    disabled={busy || !dsName.trim()}
                    className="btn-neon w-full text-xs disabled:opacity-40"
                  >
                    Create Dataset
                  </button>
                </div>
              )}

              <div className="space-y-1 max-h-[160px] overflow-y-auto">
                {datasets.map((d) => (
                  <div key={d.id} className="flex items-center justify-between text-xs px-2 py-1 rounded hover:bg-lattice-surface">
                    <button
                      onClick={() => { setSql(`SELECT * FROM ${d.name};`); setView('query'); }}
                      className="flex items-center gap-1.5 text-gray-300 hover:text-neon-cyan"
                    >
                      <Columns className="w-3 h-3" />
                      {d.name}
                      <span className="text-gray-600">({d.rowCount})</span>
                    </button>
                    <button
                      onClick={() => deleteDataset(d.id)}
                      className="p-0.5 text-gray-400 hover:text-red-400"
                      aria-label="Delete dataset"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {datasets.length === 0 && (
                  <p className="text-[10px] text-gray-400 text-center py-2">No datasets in this connection.</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Main work area ─────────────────────────────────────────── */}
        <div className="lg:col-span-3 space-y-3">
          <div className="flex gap-1 border-b border-lattice-border">
            {([['query', 'SQL Console'], ['er', 'ER Diagram'], ['history', 'History']] as [View, string][]).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${view === id
                  ? 'bg-lattice-surface text-neon-cyan border border-lattice-border border-b-transparent -mb-px'
                  : 'text-gray-400 hover:text-gray-200'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── SQL CONSOLE ──────────────────────────────────────────── */}
          {view === 'query' && (
            <div className="space-y-3">
              {!activeConn && (
                <p className="text-xs text-gray-400 panel p-4 text-center">
                  Select or create a connection to run live queries.
                </p>
              )}
              {activeConn && (
                <>
                  <div className="panel p-3 space-y-2 relative">
                    <textarea
                      ref={taRef}
                      value={sql}
                      onChange={(e) => setSql(e.target.value)}
                      onKeyDown={handleEditorKey}
                      onKeyUp={(e) => { if (/[A-Za-z0-9_]/.test(e.key)) fetchSuggests(); }}
                      rows={5}
                      spellCheck={false}
                      placeholder="SELECT * FROM table; — Ctrl+Enter run · Ctrl+Space autocomplete"
                      className="input-lattice w-full font-mono text-sm resize-y min-h-[100px]"
                    />
                    {showSuggests && suggests.length > 0 && (
                      <div className="absolute z-20 left-3 top-[120px] w-64 max-h-52 overflow-y-auto bg-lattice-elevated border border-lattice-border rounded shadow-lg">
                        {suggests.map((s, i) => (
                          <button
                            key={`${s.kind}-${s.value}-${i}`}
                            onClick={() => applySuggest(s)}
                            className="w-full flex items-center justify-between px-2 py-1 text-xs hover:bg-lattice-surface text-left"
                          >
                            <span className="font-mono text-gray-200">{s.value}</span>
                            <span className={`text-[9px] px-1 rounded ${s.kind === 'keyword' ? 'bg-neon-purple/20 text-neon-purple'
                              : s.kind === 'table' ? 'bg-neon-cyan/20 text-neon-cyan'
                              : 'bg-neon-green/20 text-neon-green'}`}>
                              {s.kind}{s.type ? `:${s.type}` : ''}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={runQuery}
                        disabled={busy || !sql.trim()}
                        className="btn-neon flex items-center gap-1.5 text-xs disabled:opacity-40"
                      >
                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                        Execute
                      </button>
                      <button
                        onClick={runExplain}
                        disabled={busy || !sql.trim()}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-lattice-border rounded hover:bg-lattice-surface text-neon-yellow disabled:opacity-40"
                      >
                        <GitBranch className="w-3.5 h-3.5" /> EXPLAIN
                      </button>
                      <button
                        onClick={fetchSuggests}
                        className="px-3 py-1.5 text-xs border border-lattice-border rounded hover:bg-lattice-surface text-gray-400"
                      >
                        Autocomplete
                      </button>
                      {result && (
                        <span className="text-[11px] text-gray-400 ml-auto">
                          {result.op} · {result.affected ?? result.rowCount} row(s) · {result.durationMs}ms
                        </span>
                      )}
                    </div>
                  </div>

                  {/* EXPLAIN plan */}
                  {explain && (
                    <div className="panel p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-semibold text-neon-yellow flex items-center gap-1.5">
                          <GitBranch className="w-3.5 h-3.5" /> Query Plan — total cost {explain.totalCost}, est. {explain.estimatedRows} rows
                        </h4>
                        <button onClick={() => setExplain(null)} className="text-gray-400 hover:text-gray-300" aria-label="Close plan">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <TreeDiagram root={planTree} />
                      {explain.warnings.length > 0 && (
                        <ul className="text-[11px] text-amber-300 list-disc list-inside">
                          {explain.warnings.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                      )}
                    </div>
                  )}

                  {/* Result grid */}
                  {result && result.success && result.op === 'SELECT' && (
                    <div className="panel p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-semibold text-neon-green flex items-center gap-1.5">
                          <Table2 className="w-3.5 h-3.5" /> Result — {result.rowCount} row(s)
                          {canEditGrid && <span className="text-[10px] text-gray-400">· editable</span>}
                        </h4>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => exportResult('csv')}
                            className="flex items-center gap-1 px-2 py-1 text-[11px] border border-lattice-border rounded hover:bg-lattice-surface text-neon-yellow"
                          >
                            <FileSpreadsheet className="w-3 h-3" /> CSV
                          </button>
                          <button
                            onClick={() => exportResult('json')}
                            className="flex items-center gap-1 px-2 py-1 text-[11px] border border-lattice-border rounded hover:bg-lattice-surface text-neon-blue"
                          >
                            <FileJson className="w-3 h-3" /> JSON
                          </button>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-lattice-border">
                              {result.columns.map((col) => (
                                <th key={col} className="px-2 py-1.5 text-left font-semibold text-neon-purple whitespace-nowrap">
                                  {col}
                                </th>
                              ))}
                              {canEditGrid && <th className="px-2 py-1.5" />}
                            </tr>
                          </thead>
                          <tbody>
                            {result.rows.map((row, ri) => {
                              const rid = Number(row._rid);
                              return (
                                <tr key={rid || ri} className="border-b border-lattice-border/40 hover:bg-lattice-surface/60">
                                  {result.columns.map((col) => {
                                    const editing = editCell?.rid === rid && editCell?.col === col;
                                    return (
                                      <td
                                        key={col}
                                        className="px-2 py-1 font-mono text-gray-300 max-w-[260px]"
                                        onDoubleClick={() => {
                                          if (!canEditGrid) return;
                                          setEditCell({ rid, col });
                                          setEditVal(row[col] == null ? '' : String(row[col]));
                                        }}
                                      >
                                        {editing ? (
                                          <span className="flex items-center gap-1">
                                            <input
                                              autoFocus
                                              value={editVal}
                                              onChange={(e) => setEditVal(e.target.value)}
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') commitCellEdit();
                                                if (e.key === 'Escape') setEditCell(null);
                                              }}
                                              className="input-lattice text-xs w-full"
                                            />
                                            <button onClick={commitCellEdit} className="text-neon-green" aria-label="Save cell">
                                              <Check className="w-3 h-3" />
                                            </button>
                                          </span>
                                        ) : (
                                          <span className="block truncate">
                                            {row[col] === null || row[col] === undefined
                                              ? <span className="text-gray-600 italic">NULL</span>
                                              : String(row[col])}
                                          </span>
                                        )}
                                      </td>
                                    );
                                  })}
                                  {canEditGrid && (
                                    <td className="px-2 py-1">
                                      <button
                                        onClick={() => deleteResultRow(rid)}
                                        className="text-gray-400 hover:text-red-400"
                                        aria-label="Delete row"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                            {result.rows.length === 0 && (
                              <tr>
                                <td colSpan={result.columns.length + 1} className="px-2 py-6 text-center text-gray-600">
                                  No rows returned.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* Inline new-row insert */}
                      {canEditGrid && resultDataset && (
                        <div className="flex items-center gap-1.5 flex-wrap border-t border-lattice-border pt-2">
                          <Edit3 className="w-3 h-3 text-neon-green" />
                          {resultDataset.columns.map((col) => (
                            <input
                              key={col.name}
                              value={newRow[col.name] || ''}
                              onChange={(e) => setNewRow((r) => ({ ...r, [col.name]: e.target.value }))}
                              placeholder={`${col.name}:${col.type}`}
                              className="input-lattice text-[11px] w-28"
                            />
                          ))}
                          <button
                            onClick={insertResultRow}
                            disabled={busy}
                            className="flex items-center gap-1 px-2 py-1 text-[11px] btn-neon disabled:opacity-40"
                          >
                            <Plus className="w-3 h-3" /> Insert Row
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* error / write feedback */}
                  {result && !result.success && (
                    <div className="panel p-3 text-xs text-rose-300 border border-rose-500/30">
                      {result.error || 'Query failed.'}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── ER DIAGRAM ───────────────────────────────────────────── */}
          {view === 'er' && (
            <div className="panel p-3 space-y-2">
              <h4 className="text-xs font-semibold text-neon-cyan flex items-center gap-1.5">
                <Move className="w-3.5 h-3.5" /> ER Diagram — drag tables to reposition
              </h4>
              {!activeConn && <p className="text-xs text-gray-400">Select a connection.</p>}
              {activeConn && datasets.length === 0 && (
                <p className="text-xs text-gray-400">No datasets — create one to see the diagram.</p>
              )}
              {activeConn && datasets.length > 0 && (
                <div
                  ref={canvasRef}
                  onMouseMove={onCanvasMouseMove}
                  onMouseUp={onCanvasMouseUp}
                  onMouseLeave={onCanvasMouseUp}
                  className="relative bg-lattice-bg border border-lattice-border rounded overflow-auto"
                  style={{ height: 460 }}
                >
                  {datasets.map((d) => (
                    <div
                      key={d.id}
                      onMouseDown={(e) => onTableMouseDown(e, d)}
                      className="absolute select-none cursor-move w-44 bg-lattice-surface border border-neon-cyan/40 rounded shadow-lg"
                      style={{ left: d.x, top: d.y }}
                    >
                      <div className="bg-neon-cyan/10 px-2 py-1 text-xs font-bold text-neon-cyan border-b border-neon-cyan/30 flex items-center gap-1.5">
                        <Table2 className="w-3 h-3" /> {d.name}
                        <span className="ml-auto text-[9px] text-gray-400 font-normal">{d.rowCount} rows</span>
                      </div>
                      <div className="px-2 py-1 space-y-0.5">
                        {d.columns.map((c) => (
                          <div key={c.name} className="flex items-center justify-between text-[10px] font-mono">
                            <span className="text-gray-300">{c.name}</span>
                            <span className="text-gray-600">{c.type}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── HISTORY ──────────────────────────────────────────────── */}
          {view === 'history' && (
            <div className="panel p-3 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-neon-orange">Live Query History ({history.length})</h4>
                <div className="flex gap-2">
                  <button onClick={loadHistory} className="text-gray-400 hover:text-gray-300" aria-label="Refresh history">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  {history.length > 0 && (
                    <button onClick={clearHistory} className="text-gray-400 hover:text-red-400 flex items-center gap-1 text-[11px]">
                      <Trash2 className="w-3 h-3" /> Clear
                    </button>
                  )}
                </div>
              </div>
              {history.length === 0 && <p className="text-xs text-gray-400 py-4 text-center">No executed queries yet.</p>}
              <div className="space-y-1.5 max-h-[440px] overflow-y-auto">
                {history.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => { setSql(h.sql); setView('query'); }}
                    className="w-full text-left bg-lattice-surface border border-lattice-border/50 rounded p-2 hover:bg-lattice-elevated"
                  >
                    <div className="flex items-center gap-2 text-[10px] text-gray-400">
                      <span className={h.success ? 'text-emerald-400' : 'text-rose-400'}>
                        {h.success ? '✓' : '✗'}
                      </span>
                      <span>{new Date(h.at).toLocaleTimeString()}</span>
                      <span>·</span>
                      <span>{h.durationMs}ms</span>
                      <span>·</span>
                      <span>{h.rowCount} rows</span>
                    </div>
                    <pre className="text-[11px] font-mono text-gray-300 whitespace-pre-wrap break-all mt-1">{h.sql}</pre>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
