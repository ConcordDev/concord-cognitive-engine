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
  Table2, Columns, FileSpreadsheet, FileJson, GitBranch, Move, Loader2, Pencil,
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

interface DatasetRelation {
  id: string;
  fromDataset: string;
  fromColumn: string;
  toDataset: string;
  toColumn: string;
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
  explain?: ExplainResult;
  needsConfirm?: boolean;
  destructive?: string;
  truncated?: boolean;
  cap?: number;
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

  const [relations, setRelations] = useState<DatasetRelation[]>([]);
  // E-DB-1: a `<table>_id` column with NO real relation behind it is
  // drawn dashed on the ER canvas — a relation by naming, not by law.
  const impliedRelations = useMemo(() => {
    const out: { from: Dataset; to: Dataset; column: string }[] = [];
    for (const d of datasets) {
      for (const c of d.columns) {
        const m = c.name.match(/^(.+)_id$/);
        if (!m) continue;
        const base = m[1];
        const target = datasets.find((x) => x.id !== d.id && (x.name === base || x.name === `${base}s` || x.name.replace(/s$/, '') === base));
        if (!target) continue;
        const real = relations.some((r) => r.fromDataset === d.name && r.fromColumn === c.name && r.toDataset === target.name);
        if (!real) out.push({ from: d, to: target, column: c.name });
      }
    }
    return out;
  }, [datasets, relations]);
  const loadDatasets = useCallback(async (connId: string) => {
    const r = await lensRun<{ datasets: Dataset[]; relations?: DatasetRelation[] }>('database', 'dataset-list', { connectionId: connId });
    if (r.data.ok && r.data.result) {
      setDatasets(r.data.result.datasets);
      setRelations(r.data.result.relations || []);
    } else { setDatasets([]); setRelations([]); }
  }, []);

  useEffect(() => { loadConns(); }, [loadConns]);
  useEffect(() => { if (activeConnId) loadDatasets(activeConnId); else { setDatasets([]); setRelations([]); } }, [activeConnId, loadDatasets]);

  // ── dataset relations (S4) ─────────────────────────────────────────────
  const [relForm, setRelForm] = useState({ fromDataset: '', fromColumn: '', toDataset: '', toColumn: '' });
  const addRelation = useCallback(async () => {
    if (!activeConnId || !relForm.fromDataset || !relForm.fromColumn || !relForm.toDataset || !relForm.toColumn) return;
    setBusy(true);
    const r = await lensRun('database', 'dataset-relation-add', { connectionId: activeConnId, ...relForm });
    setBusy(false);
    if (r.data.ok) {
      flash('ok', 'Relation added');
      setRelForm({ fromDataset: '', fromColumn: '', toDataset: '', toColumn: '' });
      loadDatasets(activeConnId);
    } else flash('err', r.data.error || 'Could not add relation');
  }, [activeConnId, relForm, flash, loadDatasets]);
  const deleteRelation = useCallback(async (relationId: string) => {
    if (!activeConnId) return;
    const r = await lensRun('database', 'dataset-relation-delete', { connectionId: activeConnId, relationId });
    if (r.data.ok) { flash('ok', 'Relation removed'); loadDatasets(activeConnId); }
    else flash('err', r.data.error || 'Could not remove relation');
  }, [activeConnId, flash, loadDatasets]);

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

  const [armedConnDelete, setArmedConnDelete] = useState<string | null>(null);
  const deleteConn = useCallback(async (id: string) => {
    // S5: two-step confirm, naming the object class in the armed state.
    if (armedConnDelete !== id) { setArmedConnDelete(id); return; }
    setArmedConnDelete(null);
    setBusy(true);
    const r = await lensRun('database', 'connection-delete', { id });
    setBusy(false);
    if (r.data.ok) { flash('ok', 'Connection deleted'); loadConns(); }
    else flash('err', r.data.error || 'Delete failed');
  }, [flash, loadConns, armedConnDelete]);

  const testConn = useCallback(async (id: string) => {
    setBusy(true);
    const r = await lensRun<{ connected: boolean; datasets: number; remoteContacted?: boolean }>('database', 'connection-test', { id });
    setBusy(false);
    if (r.data.ok && r.data.result) flash('ok', `Workspace copy readable — ${r.data.result.datasets} dataset(s). No remote server was contacted.`);
    else flash('err', r.data.error || 'Test failed');
  }, [flash]);

  const toggleReadOnly = useCallback(async (c: Connection) => {
    const r = await lensRun('database', 'connection-update', { id: c.id, readOnly: !c.readOnly });
    // M7: every mutation acknowledges quietly — the toggle used to be
    // silent, leaving the user to spot the pill change themselves.
    if (r.data.ok) { flash('ok', c.readOnly ? 'Connection is now writable' : 'Connection is now read-only'); loadConns(); }
    else flash('err', r.data.error || 'Toggle failed');
  }, [loadConns, flash]);

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

  // ── CSV import (S7) ────────────────────────────────────────────────────
  const [importText, setImportText] = useState('');
  const [importTarget, setImportTarget] = useState('');
  const [importName, setImportName] = useState('');
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const runImport = useCallback(async () => {
    if (!activeConnId || !importText.trim()) return;
    setBusy(true);
    const r = await lensRun<{
      dataset: string; imported: number; rejected: number; totalRows: number;
      errors: { row: number; error: string }[];
    }>('database', 'dataset-import-csv', {
      connectionId: activeConnId,
      csv: importText,
      ...(importTarget ? { datasetId: importTarget } : { name: importName || 'imported' }),
    });
    setBusy(false);
    if (r.data.ok && r.data.result) {
      const res = r.data.result;
      const firstErr = res.errors[0] ? ` First rejection — row ${res.errors[0].row}: ${res.errors[0].error}` : '';
      setImportMsg({
        ok: res.rejected === 0,
        text: `Imported ${res.imported} of ${res.totalRows} row(s) into ${res.dataset}${res.rejected ? ` · ${res.rejected} rejected` : ''}.${firstErr}`,
      });
      loadConns();
      loadDatasets(activeConnId);
    } else {
      setImportMsg({ ok: false, text: r.data.error || 'Import failed' });
    }
  }, [activeConnId, importText, importTarget, importName, loadConns, loadDatasets]);

  // Dataset rename (S10): inline in the dataset list; the macro
  // cascades the new name into relations and indexes.
  const [renamingDataset, setRenamingDataset] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const commitDatasetRename = useCallback(async () => {
    if (!activeConnId || !renamingDataset) return;
    const name = renameDraft.trim();
    const id = renamingDataset;
    setRenamingDataset(null);
    if (!name) return;
    const r = await lensRun('database', 'dataset-rename', { connectionId: activeConnId, datasetId: id, name });
    if (r.data.ok) { flash('ok', 'Dataset renamed'); loadDatasets(activeConnId); loadConns(); }
    else flash('err', r.data.error || 'Rename failed');
  }, [activeConnId, renamingDataset, renameDraft, flash, loadDatasets, loadConns]);

  const transferDataset = useCallback(async (datasetId: string, toConnectionId: string) => {
    if (!activeConnId || !toConnectionId) return;
    setBusy(true);
    const r = await lensRun('database', 'dataset-transfer', {
      fromConnectionId: activeConnId, toConnectionId, datasetId,
    });
    setBusy(false);
    if (r.data.ok) { flash('ok', 'Dataset moved'); loadConns(); loadDatasets(activeConnId); }
    else flash('err', r.data.error || 'Move failed');
  }, [activeConnId, flash, loadConns, loadDatasets]);

  const [armedDatasetDelete, setArmedDatasetDelete] = useState<string | null>(null);
  const deleteDataset = useCallback(async (datasetId: string) => {
    if (!activeConnId) return;
    if (armedDatasetDelete !== datasetId) { setArmedDatasetDelete(datasetId); return; }
    setArmedDatasetDelete(null);
    setBusy(true);
    const r = await lensRun('database', 'dataset-delete', { connectionId: activeConnId, datasetId });
    setBusy(false);
    if (r.data.ok) { flash('ok', 'Dataset deleted'); loadConns(); loadDatasets(activeConnId); }
    else flash('err', r.data.error || 'Delete failed');
  }, [activeConnId, flash, loadConns, loadDatasets, armedDatasetDelete]);

  // ── SQL editor + autocomplete ──────────────────────────────────────────
  const [sql, setSql] = useState('SELECT * FROM users;');
  const [result, setResult] = useState<QueryRunResult | null>(null);
  const [explain, setExplain] = useState<ExplainResult | null>(null);
  const [suggests, setSuggests] = useState<AutoSuggest[]>([]);
  const [showSuggests, setShowSuggests] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const editorPanelRef = useRef<HTMLDivElement>(null);
  // The token the user deliberately dismissed the dropdown on (Escape /
  // click-away / Tab-accept). The keyup refetch must not instantly
  // resurrect the dropdown for that same token (F3).
  const dismissedTokenRef = useRef<string | null>(null);

  const dismissSuggests = useCallback(() => {
    const ta = taRef.current;
    const upto = ta ? ta.value.slice(0, ta.selectionStart) : '';
    const m = upto.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
    dismissedTokenRef.current = m ? m[1] : '';
    setShowSuggests(false);
  }, []);

  // Click-away dismisses the autocomplete dropdown (F3).
  useEffect(() => {
    if (!showSuggests) return;
    const onDown = (e: MouseEvent) => {
      if (editorPanelRef.current && !editorPanelRef.current.contains(e.target as Node)) dismissSuggests();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showSuggests, dismissSuggests]);

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
      // A deliberate dismiss (Escape / click-away) sticks for that token;
      // typing a different token re-arms the dropdown.
      if (dismissedTokenRef.current !== prefix) {
        setShowSuggests(r.data.result.suggestions.length > 0);
      }
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

  const [pendingDestructive, setPendingDestructive] = useState<{ sql: string; message: string } | null>(null);
  const runQuery = useCallback(async (confirmDestructive = false) => {
    if (!activeConnId || !sql.trim()) return;
    setBusy(true);
    setExplain(null);
    const r = await lensRun<QueryRunResult>('database', 'query-run', {
      connectionId: activeConnId, sql,
      ...(confirmDestructive ? { confirmDestructive: true } : {}),
    });
    setBusy(false);
    setShowSuggests(false);
    if (r.data.ok && r.data.result) {
      if (r.data.result.needsConfirm) {
        // S5 guard: nothing ran. Show exactly what would happen and let
        // the user confirm or walk away.
        setPendingDestructive({ sql, message: r.data.result.error || 'This statement affects every row.' });
        setResult(null);
        return;
      }
      setPendingDestructive(null);
      setResult(r.data.result);
      if (!r.data.result.success) flash('err', r.data.result.error || 'Query failed');
      else if (r.data.result.op === 'EXPLAIN' && r.data.result.explain) {
        // Typed EXPLAIN runs through query-run; render its plan in the
        // same plan view the EXPLAIN button uses.
        setExplain(r.data.result.explain);
      }
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
    else if (e.ctrlKey && e.key === ' ') { e.preventDefault(); dismissedTokenRef.current = null; fetchSuggests(); }
    else if (e.key === 'Escape') { e.preventDefault(); dismissSuggests(); }
    else if (e.key === 'Tab' && showSuggests && suggests.length > 0) {
      // Tab accepts the top suggestion instead of throwing focus out of
      // the editor into the view nav (F3).
      e.preventDefault();
      applySuggest(suggests[0]);
    }
  }, [runQuery, fetchSuggests, dismissSuggests, showSuggests, suggests, applySuggest]);

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

  // ── S5 staged edits: grid edits stage locally, preview as the exact
  // SQL they will run, and commit only on an explicit Commit. The
  // preview names _rid because that is the row identity row-update
  // addresses — the preview must match execution character-for-character
  // in substance, so it shows the real key, not an invented one.
  interface StagedEdit { rid: number; col: string; value: string; sql: string }
  const [stagedEdits, setStagedEdits] = useState<StagedEdit[]>([]);
  const [showSqlPreview, setShowSqlPreview] = useState(false);
  const sqlLiteral = (v: string) => {
    if (v === '') return 'NULL';
    if (/^-?\d+(\.\d+)?$/.test(v.trim())) return v.trim();
    if (/^(true|false)$/i.test(v.trim())) return v.trim().toLowerCase();
    return `'${v.replace(/'/g, "''")}'`;
  };
  const stageCellEdit = useCallback(() => {
    if (!editCell || !resultDataset) { setEditCell(null); return; }
    const sqlText = `UPDATE ${resultDataset.name} SET ${editCell.col} = ${sqlLiteral(editVal)} WHERE _rid = ${editCell.rid}`;
    setStagedEdits((prev) => [
      ...prev.filter((e) => !(e.rid === editCell.rid && e.col === editCell.col)),
      { rid: editCell.rid, col: editCell.col, value: editVal, sql: sqlText },
    ]);
    setEditCell(null);
  }, [editCell, editVal, resultDataset]);
  const commitStagedEdits = useCallback(async () => {
    if (!activeConnId || !resultDataset || stagedEdits.length === 0) return;
    setBusy(true);
    const remaining: StagedEdit[] = [];
    let committed = 0;
    for (const e of stagedEdits) {
      const r = await lensRun('database', 'row-update', {
        connectionId: activeConnId, datasetId: resultDataset.id,
        rid: e.rid, column: e.col, value: e.value,
      });
      if (r.data.ok) committed++;
      else { remaining.push(e); flash('err', r.data.error || `Update failed for ${e.col}`); }
    }
    setBusy(false);
    setStagedEdits(remaining);
    if (committed > 0) flash('ok', `${committed} change${committed === 1 ? '' : 's'} committed`);
    if (remaining.length === 0) { setShowSqlPreview(false); runQuery(); }
  }, [activeConnId, resultDataset, stagedEdits, flash, runQuery]);
  const discardStagedEdits = useCallback(() => { setStagedEdits([]); setShowSqlPreview(false); }, []);

  const [armedRowDelete, setArmedRowDelete] = useState<number | null>(null);
  const deleteResultRow = useCallback(async (rid: number) => {
    if (!activeConnId || !resultDataset) return;
    // S5: first click arms (button asks), second click executes.
    if (armedRowDelete !== rid) { setArmedRowDelete(rid); return; }
    setArmedRowDelete(null);
    setBusy(true);
    const r = await lensRun('database', 'row-delete', {
      connectionId: activeConnId, datasetId: resultDataset.id, rid,
    });
    setBusy(false);
    if (r.data.ok) { flash('ok', 'Row deleted'); runQuery(); loadConns(); }
    else flash('err', r.data.error || 'Delete failed');
  }, [activeConnId, resultDataset, flash, runQuery, loadConns, armedRowDelete]);

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
              <p className="text-xs text-gray-400 py-4 text-center">No connections yet — add one to begin. Connections are workspace copies held by Concord; no remote server is contacted.</p>
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
                      onBlur={() => setArmedConnDelete((a) => (a === c.id ? null : a))}
                      className={armedConnDelete === c.id ? 'px-1.5 py-0.5 rounded bg-rose-500 text-white text-[10px] font-semibold' : 'p-0.5 text-gray-400 hover:text-red-400'}
                      aria-label={armedConnDelete === c.id ? `Confirm delete connection ${c.name}` : 'Delete connection'}
                    >
                      {armedConnDelete === c.id ? `Delete ${c.name}?` : <Trash2 className="w-3 h-3" />}
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
                {/* F14: the honesty sentence is the card's permanent state
                    line, not a transient toast from the test button. */}
                <p className="mt-1 text-[10px] text-gray-500">Workspace copy — no remote server is contacted.</p>
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
                    {renamingDataset === d.id ? (
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void commitDatasetRename(); if (e.key === 'Escape') setRenamingDataset(null); }}
                        onBlur={() => void commitDatasetRename()}
                        aria-label={`Rename dataset ${d.name}`}
                        className="w-24 bg-lattice-bg border border-neon-cyan/50 rounded px-1 py-0.5 text-[11px] text-gray-100"
                      />
                    ) : (
                      <button
                        onClick={() => { setRenamingDataset(d.id); setRenameDraft(d.name); }}
                        className="p-0.5 text-gray-500 hover:text-gray-300"
                        aria-label={`Rename dataset ${d.name}`}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                    {conns.length > 1 && (
                      <select
                        value=""
                        onChange={(e) => { if (e.target.value) transferDataset(d.id, e.target.value); }}
                        className="bg-lattice-surface border border-lattice-border rounded px-1 py-0.5 text-[10px] text-gray-400"
                        aria-label={`Move dataset ${d.name} to another connection`}
                      >
                        <option value="">Move to…</option>
                        {conns.filter((c) => c.id !== activeConnId).map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    )}
                    <button
                      onClick={() => deleteDataset(d.id)}
                      onBlur={() => setArmedDatasetDelete((a) => (a === d.id ? null : a))}
                      className={armedDatasetDelete === d.id ? 'px-1.5 py-0.5 rounded bg-rose-500 text-white text-[10px] font-semibold' : 'p-0.5 text-gray-400 hover:text-red-400'}
                      aria-label={armedDatasetDelete === d.id ? `Confirm delete dataset ${d.name}` : 'Delete dataset'}
                    >
                      {armedDatasetDelete === d.id ? `Delete ${d.name}?` : <Trash2 className="w-3 h-3" />}
                    </button>
                  </div>
                ))}
                {datasets.length === 0 && (
                  <p className="text-[10px] text-gray-400 text-center py-2">No datasets in this connection.</p>
                )}
              </div>

              {/* CSV import (S7): file or paste, into an existing dataset
                  or a new one typed from the data. Bad rows are reported
                  by row number — never silently skipped. */}
              <div className="space-y-1.5 border-t border-lattice-border pt-2">
                <p className="text-[10px] font-semibold text-gray-400">Import CSV</p>
                <div className="flex items-center gap-1.5">
                  <label className="px-2 py-1 text-[10px] border border-lattice-border rounded hover:bg-lattice-surface text-gray-300 cursor-pointer">
                    Choose file
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        setImportName(f.name.replace(/\.csv$/i, ''));
                        void f.text().then(setImportText);
                      }}
                    />
                  </label>
                  <select
                    value={importTarget}
                    onChange={(e) => setImportTarget(e.target.value)}
                    className="bg-lattice-surface border border-lattice-border rounded px-1 py-1 text-[10px] text-gray-300 flex-1"
                    aria-label="Import target dataset"
                  >
                    <option value="">New dataset…</option>
                    {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  {!importTarget && (
                    <input
                      value={importName}
                      onChange={(e) => setImportName(e.target.value)}
                      placeholder="new table name"
                      className="input-lattice text-[10px] w-24"
                    />
                  )}
                </div>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={'Paste CSV here, or choose a file\ne.g. id,name\n1,Ada'}
                  rows={3}
                  spellCheck={false}
                  className="input-lattice w-full font-mono text-[10px]"
                />
                <button
                  onClick={runImport}
                  disabled={busy || !importText.trim()}
                  className="btn-neon w-full text-[11px] disabled:opacity-40"
                >
                  Import
                </button>
                {importMsg && (
                  <p className={`text-[10px] ${importMsg.ok ? 'text-emerald-300' : 'text-amber-300'}`}>{importMsg.text}</p>
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
                  <div ref={editorPanelRef} className="panel p-3 space-y-2 relative">
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
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => runQuery()}
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
                          {result.op} · {result.affected ?? result.rowCount} row(s) · {result.durationMs}ms{result.truncated ? ` · showing first ${result.rows.length} (result capped at ${result.cap ?? 1000})` : ''}
                        </span>
                      )}
                    </div>
                    {/* Autocomplete renders below the whole editor panel —
                        it can never cover Execute / EXPLAIN (F3). */}
                    {showSuggests && suggests.length > 0 && (
                      <div className="absolute z-20 left-3 top-full mt-1 w-64 max-h-52 overflow-y-auto bg-lattice-elevated border border-lattice-border rounded shadow-lg">
                        {suggests.map((s, i) => (
                          <button
                            key={`${s.kind}-${s.value}-${i}`}
                            onMouseDown={(e) => e.preventDefault()}
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
                  </div>

                  {/* S5 destructive-SQL confirm: nothing ran yet. */}
                  {pendingDestructive && (
                    <div className="panel p-3 border border-amber-500/40 bg-amber-500/5 space-y-2" role="alert">
                      <p className="text-xs text-amber-200">{pendingDestructive.message}</p>
                      <pre className="text-[11px] font-mono text-amber-100/80 whitespace-pre-wrap break-words">{pendingDestructive.sql}</pre>
                      <div className="flex gap-2">
                        <button onClick={() => runQuery(true)} disabled={busy} className="px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-semibold disabled:opacity-40">Run anyway</button>
                        <button onClick={() => setPendingDestructive(null)} className="px-3 py-1.5 text-xs border border-lattice-border rounded hover:bg-lattice-surface text-gray-300">Cancel</button>
                      </div>
                    </div>
                  )}

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
                                    const staged = stagedEdits.find((e) => e.rid === rid && e.col === col);
                                    return (
                                      <td
                                        key={col}
                                        className={`px-2 py-1 font-mono text-gray-300 max-w-[260px] ${staged ? 'bg-amber-500/10' : ''}`}
                                        onDoubleClick={() => {
                                          if (!canEditGrid) return;
                                          setEditCell({ rid, col });
                                          setEditVal(staged ? staged.value : row[col] == null ? '' : String(row[col]));
                                        }}
                                      >
                                        {editing ? (
                                          <span className="flex items-center gap-1">
                                            <input
                                              autoFocus
                                              value={editVal}
                                              onChange={(e) => setEditVal(e.target.value)}
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') stageCellEdit();
                                                if (e.key === 'Escape') setEditCell(null);
                                              }}
                                              className="input-lattice text-xs w-full"
                                            />
                                            <button onClick={stageCellEdit} className="text-neon-green" aria-label="Stage cell edit">
                                              <Check className="w-3 h-3" />
                                            </button>
                                          </span>
                                        ) : staged ? (
                                          <span className="block truncate text-amber-200" title={`Staged: ${staged.sql}`}>
                                            {staged.value === '' ? <span className="italic">NULL</span> : staged.value}
                                            <span className="ml-1 text-[9px] text-amber-400">staged</span>
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
                                        onBlur={() => setArmedRowDelete((a) => (a === rid ? null : a))}
                                        className={armedRowDelete === rid ? 'text-[10px] px-1.5 py-0.5 rounded bg-rose-500 text-white font-semibold' : 'text-gray-400 hover:text-red-400'}
                                        aria-label={armedRowDelete === rid ? 'Confirm delete row' : 'Delete row'}
                                      >
                                        {armedRowDelete === rid ? 'Confirm?' : <Trash2 className="w-3 h-3" />}
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

                      {/* S5 staged-changes bar: preview the SQL, then commit or discard. */}
                      {stagedEdits.length > 0 && (
                        <div className="border border-amber-500/40 bg-amber-500/5 rounded p-2 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] text-amber-200">{stagedEdits.length} staged change{stagedEdits.length === 1 ? '' : 's'} — nothing has been written yet</span>
                            <span className="ml-auto flex gap-1.5">
                              <button onClick={() => setShowSqlPreview((v) => !v)} className="px-2 py-1 text-[11px] border border-lattice-border rounded hover:bg-lattice-surface text-gray-200">
                                {showSqlPreview ? 'Hide SQL' : 'Preview SQL'}
                              </button>
                              <button onClick={discardStagedEdits} className="px-2 py-1 text-[11px] border border-lattice-border rounded hover:bg-lattice-surface text-gray-300">Discard</button>
                              <button onClick={commitStagedEdits} disabled={busy} className="px-2 py-1 text-[11px] rounded bg-amber-500 text-black font-semibold disabled:opacity-40">Commit</button>
                            </span>
                          </div>
                          {showSqlPreview && (
                            <pre className="text-[11px] font-mono text-amber-100/90 whitespace-pre-wrap break-words">{stagedEdits.map((e) => `${e.sql};`).join('\n')}</pre>
                          )}
                        </div>
                      )}

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
                  {/* Relation lines (S4): solid for real foreign keys. */}
                  <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
                    {relations.map((rel) => {
                      const f = datasets.find((d) => d.name === rel.fromDataset);
                      const t = datasets.find((d) => d.name === rel.toDataset);
                      if (!f || !t) return null;
                      const fy = f.y + 24 + f.columns.length * 8;
                      const ty = t.y + 24 + t.columns.length * 8;
                      const x1 = f.x + 176, y1 = fy, x2 = t.x, y2 = ty;
                      const mid = Math.max(24, Math.abs(x2 - x1) / 2);
                      return (
                        <g key={rel.id}>
                          <path d={`M ${x1} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2} ${y2}`} fill="none" stroke="rgba(34,211,238,0.65)" strokeWidth="1.5" />
                          <circle cx={x1} cy={y1} r="3" fill="rgba(34,211,238,0.9)" />
                          <circle cx={x2} cy={y2} r="3" fill="rgba(52,211,153,0.9)" />
                        </g>
                      );
                    })}
                    {/* E-DB-1: implied relations (a <table>_id column with
                        no real relation) render dashed, in grey. */}
                    {impliedRelations.map((imp) => {
                      const fy = imp.from.y + 24 + imp.from.columns.length * 8;
                      const ty = imp.to.y + 24 + imp.to.columns.length * 8;
                      const x1 = imp.from.x + 176, y1 = fy, x2 = imp.to.x, y2 = ty;
                      const mid = Math.max(24, Math.abs(x2 - x1) / 2);
                      return (
                        <path
                          key={`imp-${imp.from.id}-${imp.column}`}
                          d={`M ${x1} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2} ${y2}`}
                          fill="none"
                          stroke="rgba(156,163,175,0.55)"
                          strokeWidth="1.25"
                          strokeDasharray="5 4"
                        />
                      );
                    })}
                  </svg>
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
              {activeConn && datasets.length === 1 && (
                <p className="text-[11px] text-gray-500">Add a second dataset to draw relations between tables.</p>
              )}
              {activeConn && impliedRelations.length > 0 && (
                <p className="font-serif italic text-[12px] text-gray-400">
                  A relation by naming, not by law — yet. The dashed lines follow a &lt;table&gt;_id column that no declared relation backs; declare it below and the line turns solid.
                </p>
              )}
              {activeConn && datasets.length >= 2 && (
                <div className="space-y-2">
                  {relations.length > 0 && (
                    <div className="space-y-1">
                      {relations.map((rel) => (
                        <div key={rel.id} className="flex items-center gap-2 text-[11px] font-mono text-gray-300">
                          <span>{rel.fromDataset}.{rel.fromColumn} → {rel.toDataset}.{rel.toColumn}</span>
                          <button onClick={() => deleteRelation(rel.id)} className="text-rose-400 hover:text-rose-300" aria-label={`Remove relation ${rel.fromDataset}.${rel.fromColumn}`}>
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select value={relForm.fromDataset} onChange={(e) => setRelForm({ ...relForm, fromDataset: e.target.value, fromColumn: '' })}
                      className="bg-lattice-surface border border-lattice-border rounded px-1.5 py-1 text-[11px] text-gray-200" aria-label="Relation source dataset">
                      <option value="">from dataset</option>
                      {datasets.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
                    </select>
                    <select value={relForm.fromColumn} onChange={(e) => setRelForm({ ...relForm, fromColumn: e.target.value })}
                      className="bg-lattice-surface border border-lattice-border rounded px-1.5 py-1 text-[11px] text-gray-200" aria-label="Relation source column">
                      <option value="">fk column</option>
                      {(datasets.find((d) => d.name === relForm.fromDataset)?.columns || []).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                    <span className="text-gray-500 text-[11px]">→</span>
                    <select value={relForm.toDataset} onChange={(e) => setRelForm({ ...relForm, toDataset: e.target.value, toColumn: '' })}
                      className="bg-lattice-surface border border-lattice-border rounded px-1.5 py-1 text-[11px] text-gray-200" aria-label="Relation target dataset">
                      <option value="">to dataset</option>
                      {datasets.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
                    </select>
                    <select value={relForm.toColumn} onChange={(e) => setRelForm({ ...relForm, toColumn: e.target.value })}
                      className="bg-lattice-surface border border-lattice-border rounded px-1.5 py-1 text-[11px] text-gray-200" aria-label="Relation target column">
                      <option value="">column</option>
                      {(datasets.find((d) => d.name === relForm.toDataset)?.columns || []).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                    <button onClick={addRelation} disabled={busy} className="px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40">+ relation</button>
                  </div>
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
