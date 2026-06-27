'use client';

/**
 * TraceExports — the user's saved reasoning-trace export ledger. Lets the
 * user persist the trace they just ran as a shareable artifact, browse
 * their saved exports, inspect any one as an inference tree, copy it as
 * JSON, and delete it. All persistence is per-user via the
 * `cognition.exportTrace / listExports / getExport / deleteExport` macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Loader2, Save, Trash2, Eye, Copy, Check } from 'lucide-react';
import { ReasoningTraceTree, type ReasoningTrace } from './ReasoningTraceTree';

interface ExportMeta {
  id: string;
  title: string;
  mode: string | null;
  traceId: string | null;
  note: string;
  createdAt: string;
}

export function TraceExports({
  pendingTrace,
}: {
  pendingTrace: ReasoningTrace | null;
}) {
  const [exports, setExports] = useState<ExportMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState<ReasoningTrace | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await lensRun<{ exports: ExportMeta[]; count: number }>(
        'cognition',
        'listExports',
        {},
      );
      if (r.data?.ok && r.data.result) {
        setExports(r.data.result.exports);
      } else {
        setError(r.data?.error || 'Failed to load exports.');
      }
    } catch {
      setError('Failed to load exports.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveTrace = async () => {
    if (!pendingTrace) return;
    setSaving(true);
    setError(null);
    try {
      const r = await lensRun<{ exportId: string }>('cognition', 'exportTrace', {
        trace: pendingTrace as unknown as Record<string, unknown>,
        title: title.trim(),
        note: note.trim(),
      });
      if (r.data?.ok) {
        setTitle('');
        setNote('');
        await refresh();
      } else {
        setError(r.data?.error || 'Export failed.');
      }
    } catch {
      setError('Export request failed.');
    } finally {
      setSaving(false);
    }
  };

  const view = async (id: string) => {
    setError(null);
    try {
      const r = await lensRun<{ export: { trace: ReasoningTrace } }>(
        'cognition',
        'getExport',
        { exportId: id },
      );
      if (r.data?.ok && r.data.result) {
        setViewing(r.data.result.export.trace);
      } else {
        setError(r.data?.error || 'Failed to load export.');
      }
    } catch {
      setError('Failed to load export.');
    }
  };

  const remove = async (id: string) => {
    try {
      const r = await lensRun('cognition', 'deleteExport', { exportId: id });
      if (r.data?.ok) await refresh();
      else setError(r.data?.error || 'Delete failed.');
    } catch {
      setError('Delete request failed.');
    }
  };

  const copyJson = async () => {
    if (!viewing) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(viewing, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Clipboard unavailable.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-violet-900/40 bg-violet-950/10 p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-violet-300">
          <Save className="h-3.5 w-3.5" aria-hidden /> Export current trace
        </h3>
        {pendingTrace ? (
          <div className="mt-2 space-y-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (optional)"
              className="w-full rounded border border-violet-900/40 bg-black/40 px-2 py-1.5 text-xs text-violet-100 focus:border-violet-500 focus:outline-none"
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional)"
              className="w-full rounded border border-violet-900/40 bg-black/40 px-2 py-1.5 text-xs text-violet-100 focus:border-violet-500 focus:outline-none"
            />
            <button
              onClick={saveTrace}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded bg-violet-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-violet-400"
            >
              {saving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              Save as shareable artifact
            </button>
          </div>
        ) : (
          <p className="mt-1.5 text-xs text-violet-700">
            Run a reasoning pass first — the most recent trace can then be
            exported here.
          </p>
        )}
      </div>

      {error && (
        <div
          role="alert"
          data-testid="trace-exports-error"
          className="flex items-center justify-between gap-3 rounded border border-rose-800/40 bg-rose-950/20 px-3 py-2"
        >
          <p className="text-xs text-rose-300">{error}</p>
          <button
            onClick={refresh}
            className="shrink-0 rounded border border-rose-700/50 px-2 py-1 text-[11px] text-rose-200 hover:bg-rose-900/40 focus:outline-none focus:ring-2 focus:ring-rose-400"
          >
            Retry
          </button>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-violet-300">
            Saved exports
          </h3>
        </div>
        {loading && (
          <div
            role="status"
            aria-busy="true"
            data-testid="trace-exports-loading"
            className="flex items-center gap-2 text-xs text-violet-500"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Loading saved exports…</span>
          </div>
        )}
        {!loading && !error && exports.length === 0 && (
          <p data-testid="trace-exports-empty" className="text-xs text-violet-700">
            No exports yet — run a reasoning pass and save it above.
          </p>
        )}
        <ul data-testid="trace-exports-list" className="space-y-1">
          {exports.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-2 rounded border border-violet-900/30 bg-violet-950/10 px-3 py-2 text-xs"
            >
              <span className="truncate text-violet-100">{e.title}</span>
              {e.mode && (
                <span className="rounded bg-violet-800/30 px-1.5 py-0.5 text-[10px] text-violet-300">
                  {e.mode}
                </span>
              )}
              <span className="ml-auto shrink-0 text-[10px] text-violet-700">
                {new Date(e.createdAt).toLocaleDateString()}
              </span>
              <button
                onClick={() => view(e.id)}
                className="shrink-0 rounded p-1 text-violet-500 hover:bg-violet-800/40 hover:text-violet-200"
                aria-label="View trace"
              >
                <Eye className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => remove(e.id)}
                className="shrink-0 rounded p-1 text-violet-500 hover:bg-rose-900/40 hover:text-rose-300"
                aria-label="Delete export"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </div>

      {viewing && (
        <div className="rounded-lg border border-violet-700/40 bg-violet-900/15 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold text-violet-200">
              Exported trace
            </h4>
            <div className="flex gap-2">
              <button
                onClick={copyJson}
                className="inline-flex items-center gap-1 rounded border border-violet-700/50 px-2 py-1 text-[11px] text-violet-300 hover:bg-violet-800/40"
              >
                {copied ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                {copied ? 'Copied' : 'Copy JSON'}
              </button>
              <button
                onClick={() => setViewing(null)}
                className="rounded border border-violet-700/50 px-2 py-1 text-[11px] text-violet-400 hover:bg-violet-800/40"
              >
                Close
              </button>
            </div>
          </div>
          <ReasoningTraceTree trace={viewing} />
        </div>
      )}
    </div>
  );
}
