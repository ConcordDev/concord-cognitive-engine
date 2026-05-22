'use client';

/* eslint-disable react-hooks/exhaustive-deps */

/**
 * IssueInbox — Sentry-style live error stream / issue inbox.
 *
 * Wires the `debug` domain macros:
 *   issue-ingest · issue-list · issue-detail · issue-update · issue-delete
 *
 * Every value rendered comes from a real macro response.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import {
  AlertTriangle,
  Bug,
  CheckCircle,
  EyeOff,
  Loader2,
  RefreshCw,
  Trash2,
  User,
} from 'lucide-react';

interface Breadcrumb {
  at: string;
  category: string;
  message: string;
  level: string;
}
interface Issue {
  id: string;
  fingerprint: string;
  type: string;
  message: string;
  culprit: string | null;
  level: string;
  status: 'open' | 'resolved' | 'ignored';
  assignee: string | null;
  regressed: boolean;
  count: number;
  breadcrumbs: Breadcrumb[];
  releases: string[];
  stack?: string | null;
  firstSeen: string;
  lastSeen: string;
}
interface IssueSummary {
  open: number;
  resolved: number;
  ignored: number;
  totalOccurrences: number;
}
interface SparkPoint {
  hour: string;
  count: number;
}

const LEVEL_TONE: Record<string, string> = {
  fatal: 'text-red-400 bg-red-500/10 border-red-500/30',
  error: 'text-red-400 bg-red-500/10 border-red-500/30',
  warning: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  info: 'text-neon-blue bg-neon-blue/10 border-neon-blue/30',
};

export function IssueInbox() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [summary, setSummary] = useState<IssueSummary | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | 'open' | 'resolved' | 'ignored'>('open');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Issue | null>(null);
  const [sparkline, setSparkline] = useState<SparkPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Quick-ingest form
  const [form, setForm] = useState({
    type: 'TypeError',
    message: '',
    culprit: '',
    level: 'error',
    release: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun('debug', 'issue-list', {
      status: statusFilter || undefined,
      query: query || undefined,
      sort: 'last',
    });
    if (r.data?.ok && r.data.result) {
      setIssues(r.data.result.issues || []);
      setSummary(r.data.result.summary || null);
    } else {
      setError(r.data?.error || 'Failed to load issues');
    }
    setLoading(false);
  }, [statusFilter, query]);

  useEffect(() => {
    load();
  }, [statusFilter]);

  const ingest = useCallback(async () => {
    if (!form.message.trim()) return;
    setBusyId('ingest');
    const r = await lensRun('debug', 'issue-ingest', {
      type: form.type,
      message: form.message,
      culprit: form.culprit || undefined,
      level: form.level,
      release: form.release || undefined,
      breadcrumbs: [
        { category: 'navigation', message: 'lens.debug opened', level: 'info' },
        { category: 'console', message: form.message, level: form.level },
      ],
    });
    setBusyId(null);
    if (r.data?.ok) {
      setForm((f) => ({ ...f, message: '', culprit: '' }));
      load();
    } else {
      setError(r.data?.error || 'Ingest failed');
    }
  }, [form, load]);

  const openDetail = useCallback(async (issue: Issue) => {
    setSelected(issue);
    setSparkline([]);
    const r = await lensRun('debug', 'issue-detail', { id: issue.id });
    if (r.data?.ok && r.data.result) {
      setSelected(r.data.result.issue);
      setSparkline(r.data.result.sparkline || []);
    }
  }, []);

  const updateIssue = useCallback(
    async (id: string, patch: { status?: string; assignee?: string }) => {
      setBusyId(id);
      const r = await lensRun('debug', 'issue-update', { id, ...patch });
      setBusyId(null);
      if (r.data?.ok && r.data.result) {
        const updated = r.data.result.issue as Issue;
        setIssues((prev) => prev.map((i) => (i.id === id ? updated : i)));
        if (selected?.id === id) setSelected(updated);
        load();
      }
    },
    [selected, load]
  );

  const deleteIssue = useCallback(
    async (id: string) => {
      setBusyId(id);
      const r = await lensRun('debug', 'issue-delete', { id });
      setBusyId(null);
      if (r.data?.ok) {
        setIssues((prev) => prev.filter((i) => i.id !== id));
        if (selected?.id === id) setSelected(null);
        load();
      }
    },
    [selected, load]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Bug className="w-4 h-4 text-red-400" /> Issue Inbox
        </h3>
        <button
          onClick={load}
          className="text-xs text-neon-cyan hover:underline flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-4 gap-2">
          <div className="p-2 bg-lattice-deep rounded text-center">
            <p className="text-lg font-bold text-red-400">{summary.open}</p>
            <p className="text-[10px] text-gray-500">Open</p>
          </div>
          <div className="p-2 bg-lattice-deep rounded text-center">
            <p className="text-lg font-bold text-neon-green">{summary.resolved}</p>
            <p className="text-[10px] text-gray-500">Resolved</p>
          </div>
          <div className="p-2 bg-lattice-deep rounded text-center">
            <p className="text-lg font-bold text-gray-400">{summary.ignored}</p>
            <p className="text-[10px] text-gray-500">Ignored</p>
          </div>
          <div className="p-2 bg-lattice-deep rounded text-center">
            <p className="text-lg font-bold text-neon-purple">{summary.totalOccurrences}</p>
            <p className="text-[10px] text-gray-500">Occurrences</p>
          </div>
        </div>
      )}

      {/* Quick ingest */}
      <div className="bg-lattice-deep rounded-lg p-3 border border-lattice-border space-y-2">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Report Exception</p>
        <div className="grid grid-cols-2 gap-2">
          <input
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            placeholder="Error type"
            className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs font-mono"
          />
          <select
            value={form.level}
            onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
            className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs"
          >
            <option value="error">error</option>
            <option value="fatal">fatal</option>
            <option value="warning">warning</option>
            <option value="info">info</option>
          </select>
        </div>
        <input
          value={form.message}
          onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
          placeholder="Exception message"
          className="w-full px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            value={form.culprit}
            onChange={(e) => setForm((f) => ({ ...f, culprit: e.target.value }))}
            placeholder="Culprit (file/fn)"
            className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs font-mono"
          />
          <input
            value={form.release}
            onChange={(e) => setForm((f) => ({ ...f, release: e.target.value }))}
            placeholder="Release (e.g. v1.2.0)"
            className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs font-mono"
          />
        </div>
        <button
          onClick={ingest}
          disabled={!form.message.trim() || busyId === 'ingest'}
          className="w-full px-3 py-1.5 text-xs rounded bg-red-500/15 border border-red-500/30 text-red-300 hover:bg-red-500/25 disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {busyId === 'ingest' ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <AlertTriangle className="w-3 h-3" />
          )}
          Ingest Exception
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="px-2 py-1 bg-lattice-surface border border-lattice-border rounded text-xs"
        >
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
          <option value="ignored">Ignored</option>
        </select>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          placeholder="Search issues..."
          className="flex-1 px-2 py-1 bg-lattice-surface border border-lattice-border rounded text-xs"
        />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Issue list */}
      {loading ? (
        <div className="text-center py-8 text-gray-500 text-sm flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading issues...
        </div>
      ) : issues.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          <Bug className="w-7 h-7 mx-auto mb-2 opacity-40" />
          No issues match this filter
        </div>
      ) : (
        <div className="space-y-2 max-h-[420px] overflow-y-auto">
          {issues.map((issue) => (
            <div
              key={issue.id}
              className={`rounded-lg border p-3 ${
                issue.level === 'error' || issue.level === 'fatal'
                  ? 'border-red-500/20 bg-red-500/[0.03]'
                  : 'border-lattice-border bg-lattice-deep'
              }`}
            >
              <div className="flex items-start gap-2">
                <button onClick={() => openDetail(issue)} className="flex-1 text-left min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${
                        LEVEL_TONE[issue.level] || LEVEL_TONE.info
                      }`}
                    >
                      {issue.level}
                    </span>
                    <span className="text-sm font-mono text-gray-200 truncate">{issue.type}</span>
                    {issue.regressed && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400">
                        regression
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 truncate mt-0.5">{issue.message}</p>
                  {issue.culprit && (
                    <p className="text-[10px] text-gray-600 font-mono truncate">{issue.culprit}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-500">
                    <span className="text-neon-purple font-bold">{issue.count}×</span>
                    <span>last {new Date(issue.lastSeen).toLocaleTimeString()}</span>
                    {issue.assignee && (
                      <span className="flex items-center gap-0.5">
                        <User className="w-2.5 h-2.5" />
                        {issue.assignee}
                      </span>
                    )}
                    {(issue.releases || []).slice(0, 2).map((rel) => (
                      <span key={rel} className="text-neon-cyan font-mono">
                        {rel}
                      </span>
                    ))}
                  </div>
                </button>
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    onClick={() => updateIssue(issue.id, { status: 'resolved' })}
                    disabled={busyId === issue.id || issue.status === 'resolved'}
                    title="Resolve"
                    className="p-1 rounded text-neon-green hover:bg-neon-green/10 disabled:opacity-30"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => updateIssue(issue.id, { status: 'ignored' })}
                    disabled={busyId === issue.id || issue.status === 'ignored'}
                    title="Ignore"
                    className="p-1 rounded text-gray-400 hover:bg-gray-400/10 disabled:opacity-30"
                  >
                    <EyeOff className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => deleteIssue(issue.id)}
                    disabled={busyId === issue.id}
                    title="Delete"
                    className="p-1 rounded text-red-400 hover:bg-red-400/10 disabled:opacity-30"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4">
          <div className="bg-lattice-void border border-lattice-border rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <h3 className="font-bold text-gray-100 font-mono">{selected.type}</h3>
                <p className="text-xs text-gray-400 mt-1">{selected.message}</p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-gray-400 hover:text-white text-sm shrink-0 ml-3"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="p-2 bg-lattice-deep rounded">
                <p className="text-gray-500 text-[10px]">Occurrences</p>
                <p className="text-neon-purple font-bold">{selected.count}</p>
              </div>
              <div className="p-2 bg-lattice-deep rounded">
                <p className="text-gray-500 text-[10px]">Status</p>
                <p className="text-gray-200">{selected.status}</p>
              </div>
              <div className="p-2 bg-lattice-deep rounded">
                <p className="text-gray-500 text-[10px]">First Seen</p>
                <p className="text-gray-200">
                  {new Date(selected.firstSeen).toLocaleDateString()}
                </p>
              </div>
            </div>

            {/* Occurrence sparkline (24h) */}
            {sparkline.length > 0 && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                  Occurrences — last 24h
                </p>
                <ChartKit
                  kind="bar"
                  height={140}
                  data={sparkline.map((p) => ({
                    hour: new Date(p.hour).getHours() + 'h',
                    count: p.count,
                  }))}
                  xKey="hour"
                  series={[{ key: 'count', label: 'Events', color: '#ef4444' }]}
                  showLegend={false}
                />
              </div>
            )}

            {/* Assignee */}
            <div className="flex items-center gap-2">
              <input
                defaultValue={selected.assignee || ''}
                placeholder="Assign to..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    updateIssue(selected.id, { assignee: (e.target as HTMLInputElement).value });
                  }
                }}
                className="flex-1 px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs"
              />
              <span className="text-[10px] text-gray-600">↵ to assign</span>
            </div>

            {/* Breadcrumbs */}
            {selected.breadcrumbs?.length > 0 && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                  Breadcrumbs
                </p>
                <div className="space-y-1">
                  {selected.breadcrumbs.map((b, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-[11px] bg-lattice-deep rounded px-2 py-1"
                    >
                      <span className="text-gray-600 font-mono w-16 shrink-0">{b.category}</span>
                      <span className="text-gray-300 truncate flex-1">{b.message}</span>
                      <span
                        className={`shrink-0 ${
                          b.level === 'error'
                            ? 'text-red-400'
                            : b.level === 'warning'
                              ? 'text-yellow-400'
                              : 'text-gray-500'
                        }`}
                      >
                        {b.level}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Stack */}
            {selected.stack && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">
                  Stack Trace
                </p>
                <pre className="bg-lattice-deep p-2 rounded text-[10px] text-gray-400 overflow-auto max-h-40 font-mono">
                  {selected.stack}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
