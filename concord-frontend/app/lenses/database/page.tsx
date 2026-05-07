'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { api, apiHelpers } from '@/lib/api/client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Database, Server, HardDrive, Cpu, RefreshCw, Play, CheckCircle, XCircle,
  AlertCircle, Table2, Search, Clock, Columns, Eye, Trash2,
  Copy, ChevronLeft, ChevronRight, List, BarChart3, Link2, Key,
  FileJson, FileSpreadsheet, Terminal, History, Layers, Loader2, Zap,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TableInfo {
  name: string;
  schema: string;
  rowCount: number;
  sizeBytes: number;
  columns: ColumnInfo[];
}

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimary: boolean;
  isForeign: boolean;
  references?: { table: string; column: string };
}

interface IndexInfo {
  name: string;
  table: string;
  columns: string[];
  unique: boolean;
  type: string;
  sizeBytes: number;
}

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  duration: number;
  error?: string;
}

interface QueryHistoryEntry {
  id: number;
  sql: string;
  timestamp: number;
  duration: number;
  rowCount: number;
  success: boolean;
}

interface PerfSnapshot {
  timestamp: number;
  heapUsed: number;
  queryRate: number;
  cacheHitRate: number;
  activeConns: number;
}

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

type TabId = 'query' | 'tables' | 'schema' | 'indexes' | 'monitor' | 'history';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'query', label: 'Query Editor', icon: <Terminal className="w-4 h-4" /> },
  { id: 'tables', label: 'Table Browser', icon: <Table2 className="w-4 h-4" /> },
  { id: 'schema', label: 'Schema Map', icon: <Layers className="w-4 h-4" /> },
  { id: 'indexes', label: 'Indexes', icon: <Key className="w-4 h-4" /> },
  { id: 'monitor', label: 'Monitoring', icon: <BarChart3 className="w-4 h-4" /> },
  { id: 'history', label: 'History', icon: <History className="w-4 h-4" /> },
];

// ---------------------------------------------------------------------------
// No fake fallback data — show only what the API returns
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
}

function formatUptime(seconds?: number): string {
  if (!seconds) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function exportCSV(columns: string[], rows: Record<string, unknown>[]) {
  const header = columns.join(',');
  const body = rows.map(r => columns.map(c => {
    const val = r[c];
    const s = val === null || val === undefined ? '' : String(val);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
  const blob = new Blob([header + '\n' + body], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'query_result.csv'; a.click();
  URL.revokeObjectURL(url);
}

function exportJSON(rows: Record<string, unknown>[]) {
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'query_result.json'; a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusCard({ title, value, icon, status, detail }: {
  title: string;
  value: string;
  icon: React.ReactNode;
  status: 'success' | 'warning' | 'error' | 'neutral';
  detail?: string;
}) {
  const colors = { success: 'text-green-400', warning: 'text-yellow-400', error: 'text-red-400', neutral: 'text-gray-400' };
  const badges = {
    success: <CheckCircle className="w-5 h-5 text-green-400" />,
    warning: <AlertCircle className="w-5 h-5 text-yellow-400" />,
    error: <XCircle className="w-5 h-5 text-red-400" />,
    neutral: null,
  };
  return (
    <div className="lens-card">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-400">{icon}</span>
        {badges[status]}
      </div>
      <p className="text-sm text-gray-400">{title}</p>
      <p className={`text-lg font-bold ${colors[status]}`}>{value}</p>
      {detail && <p className="text-xs text-gray-500 mt-1">{detail}</p>}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-lattice-surface rounded p-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}

function MiniBarChart({ data, label, color }: { data: number[]; label: string; color: string }) {
  const max = Math.max(...data, 1);
  return (
    <div className="bg-lattice-surface rounded p-3">
      <p className="text-xs text-gray-400 mb-2">{label}</p>
      <div className="flex items-end gap-[2px] h-16">
        {data.map((v, i) => (
          <div
            key={i}
            className={`flex-1 rounded-t ${color} opacity-80 hover:opacity-100 transition-opacity`}
            style={{ height: `${(v / max) * 100}%`, minHeight: '2px' }}
            title={`${v.toFixed(1)}`}
          />
        ))}
      </div>
      <p className="text-xs text-gray-500 mt-1 text-right">{data[data.length - 1]?.toFixed(1)}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function DatabaseLensPage() {
  useLensNav('database');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('database');
  const queryClient = useQueryClient();

  const { isLoading, isError: isError, error: error, refetch: refetch, items: queryItems, create: saveQuery } = useLensData('database', 'query', { seed: [] });

  // --- Domain action state ---
  const runAction = useRunArtifact('database');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);

  const handleDbAction = useCallback(async (action: string) => {
    const targetId = queryItems[0]?.id;
    if (!targetId) return;
    setActiveAction(action);
    setActionResult(null);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setActiveAction(null);
  }, [queryItems, runAction]);

  // --- Tab state ---
  const [activeTab, setActiveTab] = useState<TabId>('query');

  // --- Query editor state ---
  const [sql, setSql] = useState('SELECT id, title, tier, tags, created_at\nFROM dtus\nORDER BY created_at DESC\nLIMIT 50;');
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [resultPage, setResultPage] = useState(0);
  const ROWS_PER_PAGE = 25;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // --- Query history (local) ---
  const [queryHistory, setQueryHistory] = useState<QueryHistoryEntry[]>([]);
  const historyIdRef = useRef(0);

  // --- Table browser state ---
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState('');

  // --- Performance snapshots ---
  const [perfHistory, setPerfHistory] = useState<PerfSnapshot[]>([]);

  // --- API queries (existing monitoring) ---
  const { data: dbStatus, refetch: refetchDb, isError: isError2, error: error2,} = useQuery({
    queryKey: ['db-status'],
    queryFn: () => api.get('/api/db/status').then(r => r.data),
    refetchInterval: 10000,
  });

  const { data: redisStats, refetch: refetchRedis, isError: isError3, error: error3,} = useQuery({
    queryKey: ['redis-stats'],
    queryFn: () => api.get('/api/redis/stats').then(r => r.data),
    refetchInterval: 10000,
  });

  const { data: perfMetrics, refetch: refetchPerf, isError: isError4, error: error4,} = useQuery({
    queryKey: ['perf-metrics'],
    queryFn: () => api.get('/api/perf/metrics').then(r => r.data),
    refetchInterval: 5000,
  });

  const { data: backpressure, isError: isError5, error: error5, refetch: refetch5,} = useQuery({
    queryKey: ['backpressure'],
    queryFn: () => api.get('/api/backpressure/status').then(r => r.data),
  });

  const { items: tableItems, isError: isError6, error: error6, refetch: refetch6 } = useLensData('database', 'table', { noSeed: true });
  const { items: indexItems, isError: isError7, error: error7, refetch: refetch7 } = useLensData('database', 'index', { noSeed: true });

  // Use live data only — no fake fallbacks
  const tables: TableInfo[] = useMemo(() => tableItems?.map(i => i.data as unknown as TableInfo) ?? [], [tableItems]);
  const indexes: IndexInfo[] = useMemo(() => indexItems?.map(i => i.data as unknown as IndexInfo) ?? [], [indexItems]);

  // Accumulate perf snapshots for time-series charts
  useEffect(() => {
    if (!perfMetrics) return;
    setPerfHistory(prev => {
      const next: PerfSnapshot = {
        timestamp: Date.now(),
        heapUsed: perfMetrics.memory?.heapUsed ?? 0,
        queryRate: perfMetrics.queryRate ?? 0,
        cacheHitRate: perfMetrics.cache?.hitRate ?? 0,
        activeConns: perfMetrics.connections?.active ?? 0,
      };
      const updated = [...prev, next];
      return updated.length > 30 ? updated.slice(-30) : updated;
    });
  }, [perfMetrics]);

  // --- Mutations ---
  const migrateMutation = useMutation({
    mutationFn: () => api.post('/api/db/migrate', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['db-tables'] }),
    onError: (err) => {
      console.error('Migration failed:', err instanceof Error ? err.message : err);
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => api.post('/api/db/sync', { batchSize: 100 }),
    onError: (err) => {
      console.error('Sync failed:', err instanceof Error ? err.message : err);
    },
  });

  const executeQuery = useMutation({
    mutationFn: (query: string) => apiHelpers.graph.query(query).then(r => r.data),
    onSuccess: (data: QueryResult, query: string) => {
      setQueryResult(data);
      setResultPage(0);
      addToHistory(query, data.duration, data.rowCount, true);
    },
    onError: (err: unknown, query: string) => {
      setQueryResult({ columns: [], rows: [], rowCount: 0, duration: 0, error: err instanceof Error ? err.message : 'Query execution failed' });
      setResultPage(0);
      addToHistory(query, 0, 0, false);
    },
  });

  const addToHistory = useCallback((query: string, duration: number, rowCount: number, success: boolean) => {
    historyIdRef.current += 1;
    const entry = { id: historyIdRef.current, sql: query, timestamp: Date.now(), duration, rowCount, success };
    setQueryHistory(prev => [entry, ...prev.slice(0, 99)]);
    // Persist to lens data
    saveQuery({ title: query.slice(0, 80), data: entry as unknown as Record<string, unknown> }).catch((err) => console.error('Failed to save query to history:', err instanceof Error ? err.message : err));
  }, [saveQuery]);

  const runQuery = useCallback(() => {
    const trimmed = sql.trim();
    if (!trimmed) return;
    executeQuery.mutate(trimmed);
  }, [sql, executeQuery]);

  const refreshAll = useCallback(() => {
    refetchDb();
    refetchRedis();
    refetchPerf();
    queryClient.invalidateQueries({ queryKey: ['db-tables'] });
    queryClient.invalidateQueries({ queryKey: ['db-indexes'] });
  }, [refetchDb, refetchRedis, refetchPerf, queryClient]);

  // Keyboard shortcut: Ctrl/Cmd + Enter to execute
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runQuery();
    }
  }, [runQuery]);

  // --- Filtered tables ---
  const filteredTables = useMemo(() => {
    if (!tableFilter) return tables;
    const q = tableFilter.toLowerCase();
    return tables.filter(t => t.name.toLowerCase().includes(q));
  }, [tables, tableFilter]);

  const selectedTableInfo = useMemo(
    () => tables.find(t => t.name === selectedTable) ?? null,
    [tables, selectedTable],
  );

  // --- Paginated results ---
  const paginatedRows = useMemo(() => {
    if (!queryResult) return [];
    const start = resultPage * ROWS_PER_PAGE;
    return queryResult.rows.slice(start, start + ROWS_PER_PAGE);
  }, [queryResult, resultPage]);

  const totalPages = queryResult ? Math.max(1, Math.ceil(queryResult.rows.length / ROWS_PER_PAGE)) : 0;

  // --- Schema relationships for visualization ---
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

  // =========================================================================
  // Render
  // =========================================================================


  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError || isError2 || isError3 || isError4 || isError5 || isError6 || isError7) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message || error3?.message || error4?.message || error5?.message || error6?.message || error7?.message} onRetry={() => { refetch(); refetch5(); refetch6(); refetch7(); }} />
      </div>
    );
  }
  return (
    <div data-lens-theme="database" className="p-6 space-y-6 bg-lattice-bg min-h-screen">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Database className="w-8 h-8 text-neon-orange" />
          <div>
            <h1 className="text-xl font-bold">Database Administration</h1>
            <p className="text-sm text-gray-400">Query editor, schema browser, and performance monitoring</p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="database" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <button onClick={refreshAll} className="btn-neon flex items-center gap-2 text-sm">
          <RefreshCw className="w-4 h-4" />
          Refresh All
        </button>
      </header>

      {/* Connection status strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatusCard
          title="Storage Mode"
          value={dbStatus?.mode || 'in-memory'}
          icon={<HardDrive className="w-6 h-6" />}
          status={dbStatus?.mode === 'postgresql' ? 'success' : 'warning'}
        />
        <StatusCard
          title="PostgreSQL"
          value={dbStatus?.postgres?.connected ? 'Connected' : 'Disconnected'}
          icon={<Database className="w-6 h-6" />}
          status={dbStatus?.postgres?.connected ? 'success' : dbStatus?.postgres?.enabled ? 'error' : 'neutral'}
          detail={dbStatus?.postgres?.pool ? `Pool: ${dbStatus.postgres.pool.total} total, ${dbStatus.postgres.pool.idle} idle` : undefined}
        />
        <StatusCard
          title="Redis Cache"
          value={redisStats?.enabled ? 'Connected' : 'Fallback Mode'}
          icon={<Server className="w-6 h-6" />}
          status={redisStats?.enabled ? 'success' : 'warning'}
          detail={redisStats?.keys ? `${redisStats.keys} keys cached` : 'Using in-memory cache'}
        />
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-lattice-border flex-wrap pb-px">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-lattice-surface text-neon-cyan border border-lattice-border border-b-transparent -mb-px'
                : 'text-gray-400 hover:text-gray-200 hover:bg-lattice-surface/50'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
        >
          {/* ============================================================ */}
          {/* QUERY EDITOR TAB                                             */}
          {/* ============================================================ */}
          {activeTab === 'query' && (
            <div className="space-y-4">
              {/* Editor area */}
              <div className="panel p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold flex items-center gap-2 text-neon-cyan">
                    <Terminal className="w-4 h-4" />
                    SQL Query
                  </h2>
                  <span className="text-xs text-gray-500">Ctrl+Enter to execute</span>
                </div>
                <textarea
                  ref={textareaRef}
                  value={sql}
                  onChange={e => setSql(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={6}
                  spellCheck={false}
                  className="input-lattice w-full font-mono text-sm resize-y min-h-[120px]"
                  placeholder="SELECT * FROM dtus LIMIT 10;"
                />
                <div className="flex items-center gap-3">
                  <button
                    onClick={runQuery}
                    disabled={executeQuery.isPending || !sql.trim()}
                    className="btn-neon flex items-center gap-2 text-sm"
                  >
                    <Play className="w-4 h-4" />
                    {executeQuery.isPending ? 'Executing...' : 'Execute'}
                  </button>
                  <button
                    onClick={() => { setSql(''); setQueryResult(null); }}
                    className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 border border-lattice-border rounded transition-colors"
                  >
                    Clear
                  </button>
                  {queryResult && (
                    <span className="text-xs text-gray-500 ml-auto">
                      {queryResult.rowCount} row{queryResult.rowCount !== 1 ? 's' : ''} in {queryResult.duration}ms
                      {queryResult.error && <span className="text-red-400 ml-2">{queryResult.error}</span>}
                    </span>
                  )}
                </div>
              </div>

              {/* Results table */}
              {queryResult && queryResult.rows.length > 0 ? (
                <div className="panel p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold flex items-center gap-2">
                      <Table2 className="w-4 h-4 text-neon-green" />
                      Results
                    </h2>
                    <div className="flex items-center gap-2">
                      <button onClick={() => exportCSV(queryResult.columns, queryResult.rows)} className="flex items-center gap-1 px-2 py-1 text-xs border border-lattice-border rounded hover:bg-lattice-surface transition-colors text-neon-yellow">
                        <FileSpreadsheet className="w-3 h-3" />
                        CSV
                      </button>
                      <button onClick={() => exportJSON(queryResult.rows)} className="flex items-center gap-1 px-2 py-1 text-xs border border-lattice-border rounded hover:bg-lattice-surface transition-colors text-neon-blue">
                        <FileJson className="w-3 h-3" />
                        JSON
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-lattice-border">
                          {queryResult.columns.map(col => (
                            <th key={col} className="px-3 py-2 text-left text-xs font-semibold text-neon-purple whitespace-nowrap">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedRows.length === 0 ? (
                          <tr><td colSpan={queryResult.columns.length} className="px-3 py-8 text-center text-gray-500">No rows returned</td></tr>
                        ) : (
                          paginatedRows.map((row, ri) => (
                            <tr key={ri} className="border-b border-lattice-border/40 hover:bg-lattice-surface/60 transition-colors">
                              {queryResult.columns.map(col => (
                                <td key={col} className="px-3 py-2 text-gray-300 max-w-[300px] truncate font-mono text-xs">
                                  {row[col] === null ? <span className="text-gray-600 italic">NULL</span> : String(row[col])}
                                </td>
                              ))}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between pt-2">
                      <span className="text-xs text-gray-500">
                        Page {resultPage + 1} of {totalPages}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setResultPage(p => Math.max(0, p - 1))}
                          disabled={resultPage === 0}
                          className="p-1 rounded border border-lattice-border disabled:opacity-30 hover:bg-lattice-surface transition-colors"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setResultPage(p => Math.min(totalPages - 1, p + 1))}
                          disabled={resultPage >= totalPages - 1}
                          className="p-1 rounded border border-lattice-border disabled:opacity-30 hover:bg-lattice-surface transition-colors"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-white/10 rounded-lg">
                  <p>No query results yet. Run a query to see results here.</p>
                </div>
              )}

              {/* Saved Queries from LensData */}
              {queryItems.length > 0 && (
                <div className="panel p-4 space-y-3">
                  <h2 className="text-sm font-semibold flex items-center gap-2 text-neon-blue">
                    <FileJson className="w-4 h-4" />
                    Saved Queries ({queryItems.length})
                  </h2>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {queryItems.map(item => (
                      <button
                        key={item.id}
                        onClick={() => { setSql(String((item.data as Record<string, unknown>)?.sql || item.title)); }}
                        className="w-full text-left bg-lattice-surface border border-lattice-border/50 rounded p-2 hover:bg-lattice-elevated transition-colors"
                      >
                        <p className="text-xs font-medium text-white truncate">{item.title}</p>
                        <p className="text-[11px] text-gray-500 font-mono truncate">{String((item.data as Record<string, unknown>)?.sql || '').slice(0, 60)}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ============================================================ */}
          {/* TABLE BROWSER TAB                                            */}
          {/* ============================================================ */}
          {activeTab === 'tables' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Table list */}
              <div className="panel p-4 space-y-3 lg:col-span-1">
                <h2 className="text-sm font-semibold flex items-center gap-2 text-neon-cyan">
                  <List className="w-4 h-4" />
                  Tables ({tables.length})
                </h2>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
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
                      <span className="text-xs text-gray-500">{t.rowCount.toLocaleString()} rows</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Column details */}
              <div className="panel p-4 space-y-3 lg:col-span-2">
                {selectedTableInfo ? (
                  <>
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold flex items-center gap-2 text-neon-green">
                        <Columns className="w-4 h-4" />
                        {selectedTableInfo.schema}.{selectedTableInfo.name}
                      </h2>
                      <div className="flex items-center gap-3 text-xs text-gray-500">
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
                              <td className="px-3 py-2 text-xs">{col.nullable ? <span className="text-gray-500">YES</span> : <span className="text-neon-pink">NOT NULL</span>}</td>
                              <td className="px-3 py-2 font-mono text-xs text-gray-500">{col.defaultValue ?? '-'}</td>
                              <td className="px-3 py-2 text-xs">
                                {col.isPrimary && <span className="px-1.5 py-0.5 bg-neon-yellow/10 text-neon-yellow rounded text-[10px] font-bold">PK</span>}
                                {col.isForeign && <span className="px-1.5 py-0.5 bg-neon-blue/10 text-neon-blue rounded text-[10px] font-bold ml-1">FK</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* Quick query button */}
                    <button
                      onClick={() => {
                        setSql(`SELECT *\nFROM ${selectedTableInfo.name}\nLIMIT 100;`);
                        setActiveTab('query');
                      }}
                      className="flex items-center gap-2 text-xs text-neon-cyan hover:underline mt-2"
                    >
                      <Eye className="w-3 h-3" />
                      Query this table
                    </button>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                    <Table2 className="w-10 h-10 mb-3 opacity-30" />
                    <p className="text-sm">Select a table to view its schema</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* SCHEMA VISUALIZATION TAB                                     */}
          {/* ============================================================ */}
          {activeTab === 'schema' && (
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
                        <span className="text-xs text-gray-500">{t.rowCount.toLocaleString()} rows</span>
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
              {/* Relationship summary */}
              <div className="bg-lattice-surface rounded p-3">
                <h3 className="text-xs font-semibold text-gray-400 mb-2">Relationship Summary</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div><span className="text-gray-500">Tables:</span> <span className="text-neon-cyan font-bold">{tables.length}</span></div>
                  <div><span className="text-gray-500">Foreign Keys:</span> <span className="text-neon-blue font-bold">{relationships.length}</span></div>
                  <div><span className="text-gray-500">Total Columns:</span> <span className="text-neon-purple font-bold">{tables.reduce((s, t) => s + t.columns.length, 0)}</span></div>
                  <div><span className="text-gray-500">Total Rows:</span> <span className="text-neon-green font-bold">{tables.reduce((s, t) => s + t.rowCount, 0).toLocaleString()}</span></div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* INDEXES TAB                                                  */}
          {/* ============================================================ */}
          {activeTab === 'indexes' && (
            <div className="panel p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold flex items-center gap-2 text-neon-yellow">
                  <Key className="w-4 h-4" />
                  Indexes ({indexes.length})
                </h2>
                <span className="text-xs text-gray-500">
                  Total index size: {formatBytes(indexes.reduce((s, idx) => s + idx.sizeBytes, 0))}
                </span>
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
                    </tr>
                  </thead>
                  <tbody>
                    {indexes.map(idx => (
                      <tr key={idx.name} className="border-b border-lattice-border/40 hover:bg-lattice-surface/60 transition-colors">
                        <td className="px-3 py-2 font-mono text-xs text-gray-200">{idx.name}</td>
                        <td className="px-3 py-2 text-xs text-neon-cyan">{idx.table}</td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-300">{idx.columns.join(', ')}</td>
                        <td className="px-3 py-2 text-xs">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            idx.type === 'btree' ? 'bg-neon-green/10 text-neon-green' :
                            idx.type === 'gin' ? 'bg-neon-purple/10 text-neon-purple' :
                            idx.type === 'ivfflat' ? 'bg-neon-pink/10 text-neon-pink' :
                            'bg-gray-500/10 text-gray-400'
                          }`}>
                            {idx.type.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {idx.unique ? <CheckCircle className="w-3.5 h-3.5 text-neon-yellow" /> : <span className="text-gray-600">-</span>}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-400 text-right font-mono">{formatBytes(idx.sizeBytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Index type breakdown */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {['btree', 'gin', 'ivfflat', 'hash'].map(type => {
                  const count = indexes.filter(i => i.type === type).length;
                  return (
                    <MetricCard key={type} label={`${type.toUpperCase()} Indexes`} value={count} />
                  );
                })}
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* MONITORING TAB                                               */}
          {/* ============================================================ */}
          {activeTab === 'monitor' && (
            <div className="space-y-4">
              {/* Time-series bar charts */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <MiniBarChart data={perfHistory.map(p => p.heapUsed)} label="Heap Used (MB)" color="bg-neon-cyan" />
                <MiniBarChart data={perfHistory.map(p => p.queryRate)} label="Query Rate (q/s)" color="bg-neon-green" />
                <MiniBarChart data={perfHistory.map(p => p.cacheHitRate)} label="Cache Hit Rate (%)" color="bg-neon-purple" />
                <MiniBarChart data={perfHistory.map(p => p.activeConns)} label="Active Connections" color="bg-neon-orange" />
              </div>

              {/* Metric cards */}
              <div className="panel p-4">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-neon-cyan" />
                  Performance Metrics
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <MetricCard label="Heap Used" value={`${perfMetrics?.memory?.heapUsed || 0} MB`} />
                  <MetricCard label="Heap Total" value={`${perfMetrics?.memory?.heapTotal || 0} MB`} />
                  <MetricCard label="RSS" value={`${perfMetrics?.memory?.rss || 0} MB`} />
                  <MetricCard label="Uptime" value={formatUptime(perfMetrics?.uptime)} />
                  <MetricCard label="DTUs" value={perfMetrics?.dtus?.total || 0} />
                  <MetricCard label="Shadow DTUs" value={perfMetrics?.dtus?.shadow || 0} />
                  <MetricCard label="Cache Size" value={perfMetrics?.cache?.hot || 0} />
                  <MetricCard label="Graph Nodes" value={perfMetrics?.graph?.nodes || 0} />
                </div>
              </div>

              {/* Backpressure */}
              <div className="panel p-4">
                <h2 className="text-lg font-semibold mb-4">System Load</h2>
                <div className="flex items-center gap-4">
                  <div className={`px-4 py-2 rounded-lg font-bold text-sm ${
                    backpressure?.level === 'normal' ? 'bg-green-500/20 text-green-400' :
                    backpressure?.level === 'warning' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-red-500/20 text-red-400'
                  }`}>
                    {backpressure?.level?.toUpperCase() || 'NORMAL'}
                  </div>
                  <div className="text-sm text-gray-400">
                    {backpressure?.dtuCount || 0} DTUs
                    (Warning: {backpressure?.thresholds?.warning}, Critical: {backpressure?.thresholds?.critical})
                  </div>
                </div>
                {backpressure?.recommendations?.length > 0 && (
                  <div className="mt-3">
                    <p className="text-sm text-yellow-400 mb-1">Recommendations:</p>
                    <ul className="text-sm text-gray-400 list-disc list-inside">
                      {backpressure.recommendations.map((rec: string, i: number) => (
                        <li key={i}>{rec}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Database Actions */}
              <div className="panel p-4">
                <h2 className="text-lg font-semibold mb-4">Database Actions</h2>
                <div className="flex gap-4 flex-wrap">
                  <button
                    onClick={() => migrateMutation.mutate()}
                    disabled={migrateMutation.isPending || !dbStatus?.postgres?.connected}
                    className="btn-neon flex items-center gap-2 text-sm"
                  >
                    <Play className="w-4 h-4" />
                    {migrateMutation.isPending ? 'Running Migrations...' : 'Run Migrations'}
                  </button>
                  <button
                    onClick={() => syncMutation.mutate()}
                    disabled={syncMutation.isPending || !dbStatus?.postgres?.connected}
                    className="btn-neon flex items-center gap-2 text-sm"
                  >
                    <RefreshCw className="w-4 h-4" />
                    {syncMutation.isPending ? 'Syncing...' : 'Sync to PostgreSQL'}
                  </button>
                </div>
                {migrateMutation.data && (
                  <p className="mt-2 text-sm text-green-400">
                    Migrations complete: {(migrateMutation.data as { data?: { applied?: number; total?: number } }).data?.applied}/{(migrateMutation.data as { data?: { applied?: number; total?: number } }).data?.total}
                  </p>
                )}
                {syncMutation.data && (
                  <p className="mt-2 text-sm text-green-400">
                    Synced: {(syncMutation.data as { data?: { synced?: number; total?: number } }).data?.synced}/{(syncMutation.data as { data?: { synced?: number; total?: number } }).data?.total} DTUs
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* HISTORY TAB                                                  */}
          {/* ============================================================ */}
          {activeTab === 'history' && (
            <div className="panel p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold flex items-center gap-2 text-neon-orange">
                  <Clock className="w-4 h-4" />
                  Query History ({queryHistory.length})
                </h2>
                {queryHistory.length > 0 && (
                  <button
                    onClick={() => setQueryHistory([])}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    Clear
                  </button>
                )}
              </div>
              {queryHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-gray-500">
                  <History className="w-10 h-10 mb-3 opacity-30" />
                  <p className="text-sm">No queries executed yet</p>
                  <p className="text-xs mt-1">Execute a query in the editor and it will appear here</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {queryHistory.map(entry => (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="bg-lattice-surface border border-lattice-border/50 rounded p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs">
                          {entry.success
                            ? <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                            : <XCircle className="w-3.5 h-3.5 text-red-400" />}
                          <span className="text-gray-500">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                          <span className="text-gray-600">|</span>
                          <span className="text-gray-400">{entry.duration}ms</span>
                          <span className="text-gray-600">|</span>
                          <span className="text-gray-400">{entry.rowCount} rows</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => { navigator.clipboard.writeText(entry.sql); }}
                            className="p-1 hover:bg-lattice-border/30 rounded transition-colors"
                            title="Copy to clipboard"
                          >
                            <Copy className="w-3 h-3 text-gray-500" />
                          </button>
                          <button
                            onClick={() => { setSql(entry.sql); setActiveTab('query'); }}
                            className="p-1 hover:bg-lattice-border/30 rounded transition-colors"
                            title="Load in editor"
                          >
                            <Play className="w-3 h-3 text-neon-cyan" />
                          </button>
                        </div>
                      </div>
                      <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap break-all bg-lattice-bg/50 rounded p-2">
                        {entry.sql}
                      </pre>
                    </motion.div>
                  ))}
                </div>
              )}

      {/* ── Domain Action Panel ─────────────────────────────────────── */}
      <div className="panel p-4 space-y-4">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Zap className="w-4 h-4 text-neon-orange" /> Database Analysis Actions
        </h3>
        <div className="flex flex-wrap gap-2">
          {(['schemaAnalysis','queryOptimize','migrationPlan','indexRecommendation'] as const).map(action => (
            <button
              key={action}
              onClick={() => handleDbAction(action)}
              disabled={!!activeAction || !queryItems[0]?.id}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-neon-orange/10 border border-neon-orange/30 text-neon-orange hover:bg-neon-orange/20 disabled:opacity-40 transition-colors"
            >
              {activeAction === action ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {action === 'schemaAnalysis' ? 'Schema Analysis' : action === 'queryOptimize' ? 'Query Optimize' : action === 'migrationPlan' ? 'Migration Plan' : 'Index Recommendations'}
            </button>
          ))}
        </div>

        {/* schemaAnalysis result */}
        {actionResult && actionResult.healthScore !== undefined && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-sm font-bold text-neon-cyan">{String(actionResult.totalTables ?? 0)}</p>
                <p className="text-[10px] text-gray-500">Tables</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-sm font-bold text-neon-green">{String(actionResult.totalColumns ?? 0)}</p>
                <p className="text-[10px] text-gray-500">Columns</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className={`text-sm font-bold ${Number(actionResult.totalIssues) > 0 ? 'text-red-400' : 'text-neon-green'}`}>{String(actionResult.totalIssues ?? 0)}</p>
                <p className="text-[10px] text-gray-500">Issues</p>
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Health Score</span>
                <span className="font-bold text-neon-green">{String(actionResult.healthScore ?? 0)}/100</span>
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-neon-green rounded-full transition-all" style={{ width: `${actionResult.healthScore ?? 0}%` }} />
              </div>
            </div>
            {!!actionResult.normalizationTip && <p className="text-xs text-gray-400 italic">{String(actionResult.normalizationTip)}</p>}
            {Array.isArray(actionResult.tables) && actionResult.tables.length > 0 && (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {(actionResult.tables as Array<{table:string;columns:number;hasPrimaryKey:boolean;indexedColumns:number;issues:string[]}>).map((t, i) => (
                  <div key={i} className="flex items-center justify-between text-xs bg-lattice-surface/50 rounded px-2 py-1">
                    <span className="font-medium text-gray-200">{t.table}</span>
                    <span className="text-gray-500">{t.columns} cols</span>
                    {t.issues.length > 0 ? (
                      <span className="text-red-400">{t.issues[0]}</span>
                    ) : (
                      <span className="text-neon-green">OK</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* queryOptimize result */}
        {actionResult && actionResult.grade !== undefined && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className={`text-2xl font-bold ${actionResult.grade === 'A' ? 'text-neon-green' : actionResult.grade === 'F' ? 'text-red-400' : 'text-yellow-400'}`}>{String(actionResult.grade)}</p>
                <p className="text-[10px] text-gray-500">Query Grade</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className={`text-xl font-bold ${Number(actionResult.issueCount) > 0 ? 'text-orange-400' : 'text-neon-green'}`}>{String(actionResult.issueCount ?? 0)}</p>
                <p className="text-[10px] text-gray-500">Issues Found</p>
              </div>
            </div>
            {Array.isArray(actionResult.issues) && actionResult.issues.length > 0 && (
              <div className="space-y-1">
                {(actionResult.issues as Array<{issue:string;fix:string;severity:string}>).map((issue, i) => (
                  <div key={i} className="rounded px-3 py-2 bg-lattice-surface/50 space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-gray-200">{issue.issue}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${issue.severity === 'critical' ? 'bg-red-500/20 text-red-400' : issue.severity === 'high' ? 'bg-orange-500/20 text-orange-400' : 'bg-yellow-500/20 text-yellow-400'}`}>{issue.severity}</span>
                    </div>
                    <p className="text-[10px] text-gray-500">{issue.fix}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* migrationPlan result */}
        {actionResult && actionResult.estimatedDowntime !== undefined && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-sm font-bold text-neon-cyan">{String(actionResult.totalChanges ?? 0)}</p>
                <p className="text-[10px] text-gray-500">Changes</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className={`text-sm font-bold ${Number(actionResult.highRiskChanges) > 0 ? 'text-red-400' : 'text-neon-green'}`}>{String(actionResult.highRiskChanges ?? 0)}</p>
                <p className="text-[10px] text-gray-500">High Risk</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-xs font-bold text-yellow-400">{String(actionResult.estimatedDowntime)}</p>
                <p className="text-[10px] text-gray-500">Downtime</p>
              </div>
            </div>
            {!!actionResult.recommendation && <p className={`text-xs px-3 py-2 rounded ${Number(actionResult.highRiskChanges) > 0 ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-neon-green/10 text-neon-green border border-neon-green/20'}`}>{String(actionResult.recommendation)}</p>}
            {Array.isArray(actionResult.steps) && actionResult.steps.length > 0 && (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {(actionResult.steps as Array<{step:number;operation:string;table:string;risk:string;reversible:boolean}>).map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs bg-lattice-surface/50 rounded px-2 py-1">
                    <span className="text-gray-500">#{s.step}</span>
                    <span className="font-mono text-neon-cyan">{s.operation}</span>
                    <span className="text-gray-300 flex-1">{s.table}</span>
                    <span className={`text-[10px] px-1 rounded ${s.risk === 'high' ? 'bg-red-500/20 text-red-400' : s.risk === 'medium' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-neon-green/20 text-neon-green'}`}>{s.risk}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* indexRecommendation result */}
        {actionResult && actionResult.suggestedIndexes !== undefined && actionResult.estimatedDowntime === undefined && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-sm font-bold text-neon-cyan">{String(actionResult.queriesAnalyzed ?? 0)}</p>
                <p className="text-[10px] text-gray-500">Queries Analyzed</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center">
                <p className="text-sm font-bold text-neon-orange">{String(actionResult.suggestedIndexes ?? 0)}</p>
                <p className="text-[10px] text-gray-500">Indexes Suggested</p>
              </div>
              <div className="p-2 bg-lattice-surface rounded text-center col-span-1">
                <p className="text-xs font-bold text-neon-green">{String(actionResult.estimatedSpeedup ?? '—')}</p>
                <p className="text-[10px] text-gray-500">Speed Gain</p>
              </div>
            </div>
            {Array.isArray(actionResult.recommendations) && (actionResult.recommendations as Array<{column:string;reason:string;type:string}>).map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs bg-lattice-surface/50 rounded px-2 py-1">
                <span className="font-mono text-neon-orange">{r.column}</span>
                <span className="text-gray-400 flex-1">{r.reason}</span>
                <span className="text-[10px] px-1 rounded bg-neon-cyan/10 text-neon-cyan">{r.type}</span>
              </div>
            ))}
          </div>
        )}

        {/* message fallback */}
        {actionResult && !!actionResult.message && (
          <p className="text-xs text-gray-400 italic">{String(actionResult.message)}</p>
        )}
      </div>

      {/* Real-time Data Panel */}
      <UniversalActions domain="database" artifactId={null} compact />
      {realtimeData && (
        <RealtimeDataPanel
          domain="database"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
