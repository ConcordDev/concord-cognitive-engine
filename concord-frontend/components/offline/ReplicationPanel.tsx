'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useState } from 'react';
import {
  Database,
  Plus,
  Upload,
  Download,
  RefreshCw,
  Loader2,
  Trash2,
  CloudOff,
  ArrowLeftRight,
  Pencil,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { TimelineView, type TimelineEvent } from '@/components/viz';
import {
  allDocs,
  dirtyDocs,
  putDoc,
  deleteDocLocal,
  markClean,
  applyServerChange,
  clearLocal,
  localBytes,
  type LocalDoc,
} from './local-store';

interface PushResult {
  applied: { id: string; rev: string; seq: number; deleted: boolean }[];
  conflicts: {
    id: string;
    serverRev: string;
    serverBody: any;
    clientRev: string | null;
    clientBody: any;
    reason: string;
  }[];
  appliedCount: number;
  conflictCount: number;
  updateSeq: number;
}

interface PullChange {
  seq: number;
  id: string;
  rev: string;
  deleted: boolean;
  doc: Record<string, unknown> | null;
  updatedAt: string;
}

interface PullResult {
  changes: PullChange[];
  lastSeq: number;
  pending: number;
  updateSeq: number;
}

interface StatusResult {
  docCount: number;
  updateSeq: number;
  changeCount: number;
  approxBytes: number;
}

const CKPT_ID = 'offline-lens-replication';

/**
 * Bidirectional PouchDB-style replication surface.
 *
 * Writes go to IndexedDB FIRST (offline-durable), then push/pull against the
 * `offline.replication*` macros. A monotonic `update_seq` checkpoint drives an
 * incremental continuous changes feed. Conflicts surface to the parent for the
 * side-by-side merge picker.
 */
export function ReplicationPanel({
  onConflicts,
  onStateChange,
}: {
  onConflicts: (c: PushResult['conflicts']) => void;
  onStateChange?: () => void;
}) {
  const [docs, setDocs] = useState<LocalDoc[]>([]);
  const [serverStatus, setServerStatus] = useState<StatusResult | null>(null);
  const [localSize, setLocalSize] = useState(0);
  const [sinceSeq, setSinceSeq] = useState(0);
  const [feed, setFeed] = useState<TimelineEvent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [continuous, setContinuous] = useState(false);
  const [draftId, setDraftId] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reloadLocal = useCallback(async () => {
    const [d, b] = await Promise.all([allDocs(), localBytes()]);
    setDocs(d);
    setLocalSize(b);
  }, []);

  const loadStatus = useCallback(async () => {
    const r = await lensRun<StatusResult>('offline', 'replicationStatus', {});
    if (r.data.ok && r.data.result) setServerStatus(r.data.result);
    const cp = await lensRun<{ seq: number }>('offline', 'syncCheckpoint', {
      replicationId: CKPT_ID,
    });
    if (cp.data.ok && cp.data.result) setSinceSeq(cp.data.result.seq);
  }, []);

  useEffect(() => {
    reloadLocal();
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logFeed = useCallback((label: string, tone: TimelineEvent['tone'], detail?: string) => {
    setFeed((f) =>
      [
        { id: `${Date.now()}-${Math.random()}`, label, time: Date.now(), tone, detail },
        ...f,
      ].slice(0, 30),
    );
  }, []);

  /** Push every dirty local doc to the server. */
  const push = useCallback(async (): Promise<PushResult | null> => {
    setBusy('push');
    setErr(null);
    try {
      const dirty = await dirtyDocs();
      if (dirty.length === 0) {
        logFeed('Push skipped — nothing dirty', 'info');
        return null;
      }
      const payload = dirty.map((d) => ({
        id: d.id,
        body: d.body,
        baseRev: d.baseRev,
        deleted: d.deleted,
      }));
      const r = await lensRun<PushResult>('offline', 'replicationPush', { docs: payload });
      if (!r.data.ok || !r.data.result) {
        setErr(r.data.error || 'push failed');
        return null;
      }
      const res = r.data.result;
      for (const a of res.applied) {
        await markClean(a.id, a.rev, a.deleted);
      }
      logFeed(
        `Pushed ${res.appliedCount} doc${res.appliedCount === 1 ? '' : 's'}`,
        res.conflictCount > 0 ? 'warn' : 'good',
        res.conflictCount > 0 ? `${res.conflictCount} conflict(s) held` : undefined,
      );
      if (res.conflictCount > 0) onConflicts(res.conflicts);
      await reloadLocal();
      await loadStatus();
      onStateChange?.();
      return res;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'push error');
      return null;
    } finally {
      setBusy(null);
    }
  }, [logFeed, onConflicts, reloadLocal, loadStatus, onStateChange]);

  /** Pull all server changes after the saved checkpoint into IndexedDB. */
  const pull = useCallback(async (): Promise<number> => {
    setBusy('pull');
    setErr(null);
    try {
      let since = sinceSeq;
      let total = 0;
      let guard = 0;
      // Drain the changes feed in pages until pending hits 0.
      for (;;) {
        const r = await lensRun<PullResult>('offline', 'replicationPull', {
          since,
          limit: 200,
        });
        if (!r.data.ok || !r.data.result) {
          setErr(r.data.error || 'pull failed');
          break;
        }
        const res = r.data.result;
        for (const c of res.changes) {
          await applyServerChange(c.id, c.rev, c.doc, c.deleted);
        }
        total += res.changes.length;
        since = res.lastSeq;
        if (res.pending <= 0 || res.changes.length === 0 || ++guard > 50) break;
      }
      // Persist the checkpoint so the next pull is incremental.
      await lensRun('offline', 'syncCheckpoint', { replicationId: CKPT_ID, seq: since });
      setSinceSeq(since);
      logFeed(
        total > 0 ? `Pulled ${total} change${total === 1 ? '' : 's'}` : 'Pull — up to date',
        total > 0 ? 'good' : 'info',
        `checkpoint @ seq ${since}`,
      );
      await reloadLocal();
      await loadStatus();
      onStateChange?.();
      return total;
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'pull error');
      return 0;
    } finally {
      setBusy(null);
    }
  }, [sinceSeq, logFeed, reloadLocal, loadStatus, onStateChange]);

  /** Full bidirectional sync: push local writes, then pull server changes. */
  const syncBoth = useCallback(async () => {
    await push();
    await pull();
  }, [push, pull]);

  // Continuous replication — PouchDB-style live changes feed on a poll loop.
  useEffect(() => {
    if (!continuous) return;
    const tick = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        syncBoth();
      }
    };
    const handle = setInterval(tick, 12000);
    return () => clearInterval(handle);
  }, [continuous, syncBoth]);

  const saveDraft = useCallback(async () => {
    const id = draftId.trim();
    if (!id) {
      setErr('document id required');
      return;
    }
    let body: Record<string, unknown>;
    try {
      body = draftBody.trim() ? JSON.parse(draftBody) : {};
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new Error('body must be a JSON object');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'invalid JSON body');
      return;
    }
    await putDoc(id, body);
    setDraftId('');
    setDraftBody('');
    setEditing(null);
    setErr(null);
    logFeed(`Wrote ${id} locally`, 'good', 'dirty — awaiting push');
    await reloadLocal();
  }, [draftId, draftBody, logFeed, reloadLocal]);

  const startEdit = useCallback((d: LocalDoc) => {
    setEditing(d.id);
    setDraftId(d.id);
    setDraftBody(JSON.stringify(d.body, null, 2));
  }, []);

  const removeDoc = useCallback(
    async (id: string) => {
      await deleteDocLocal(id);
      logFeed(`Tombstoned ${id}`, 'warn', 'dirty delete — awaiting push');
      await reloadLocal();
    },
    [logFeed, reloadLocal],
  );

  const wipeLocal = useCallback(async () => {
    await clearLocal();
    logFeed('Cleared local IndexedDB store', 'warn');
    await reloadLocal();
  }, [logFeed, reloadLocal]);

  const dirtyCount = docs.filter((d) => d.dirty).length;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-cyan-300" />
          <div>
            <h2 className="text-sm font-semibold text-white">
              Bidirectional replication · IndexedDB write-through
            </h2>
            <p className="text-[11px] text-zinc-400">
              Local-first writes · continuous changes-feed sync to the server
            </p>
          </div>
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-300">
          <input
            type="checkbox"
            checked={continuous}
            onChange={(e) => setContinuous(e.target.checked)}
            className="accent-cyan-500"
          />
          Continuous (12s)
        </label>
      </header>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Local docs</div>
          <div className="mt-0.5 font-mono text-lg text-zinc-200">{docs.length}</div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Dirty (unpushed)</div>
          <div
            className={`mt-0.5 font-mono text-lg ${dirtyCount > 0 ? 'text-amber-400' : 'text-zinc-200'}`}
          >
            {dirtyCount}
          </div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Server seq</div>
          <div className="mt-0.5 font-mono text-lg text-zinc-200">
            {serverStatus?.updateSeq ?? '—'}
          </div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Checkpoint</div>
          <div className="mt-0.5 font-mono text-lg text-zinc-200">{sinceSeq}</div>
        </div>
      </div>

      {/* Draft / write surface */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          <Pencil className="h-3.5 w-3.5" />
          {editing ? `Editing ${editing}` : 'New offline document'}
        </div>
        <input
          value={draftId}
          onChange={(e) => setDraftId(e.target.value)}
          disabled={!!editing}
          placeholder="document id (e.g. note:trip-plan)"
          className="mb-2 w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-white placeholder:text-zinc-600 disabled:opacity-60"
        />
        <textarea
          value={draftBody}
          onChange={(e) => setDraftBody(e.target.value)}
          rows={4}
          placeholder='{"title": "...", "value": 42}'
          className="mb-2 w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 font-mono text-[11px] text-white placeholder:text-zinc-600"
        />
        <div className="flex gap-2">
          <button
            onClick={saveDraft}
            className="flex items-center gap-1.5 rounded bg-cyan-500/15 px-3 py-1.5 text-xs text-cyan-300 hover:bg-cyan-500/25"
          >
            <Plus className="h-3.5 w-3.5" />
            {editing ? 'Save edit locally' : 'Write locally'}
          </button>
          {editing && (
            <button
              onClick={() => {
                setEditing(null);
                setDraftId('');
                setDraftBody('');
              }}
              className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-white"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Sync controls */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={syncBoth}
          disabled={!!busy}
          className="flex items-center gap-1.5 rounded bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowLeftRight className="h-3.5 w-3.5" />}
          Sync (push + pull)
        </button>
        <button
          onClick={push}
          disabled={!!busy}
          className="flex items-center gap-1.5 rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:text-white disabled:opacity-50"
        >
          {busy === 'push' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Push ({dirtyCount})
        </button>
        <button
          onClick={pull}
          disabled={!!busy}
          className="flex items-center gap-1.5 rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:text-white disabled:opacity-50"
        >
          {busy === 'pull' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Pull
        </button>
        <button
          onClick={wipeLocal}
          disabled={!!busy || docs.length === 0}
          className="flex items-center gap-1.5 rounded border border-red-500/30 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Wipe local
        </button>
        <span className="flex items-center text-[11px] text-zinc-500">
          local store {(localSize / 1024).toFixed(1)} KB
        </span>
      </div>

      {err && (
        <p className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] text-red-300">
          {err}
        </p>
      )}

      {/* Local document list */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          Local documents
        </div>
        {docs.length === 0 && (
          <div className="rounded border border-dashed border-zinc-800 px-3 py-4 text-center text-[11px] text-zinc-500">
            <CloudOff className="mx-auto mb-1 h-4 w-4" />
            No local documents. Write one above — it persists in IndexedDB even
            with no network.
          </div>
        )}
        {docs.map((d) => (
          <div
            key={d.id}
            className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12px] text-zinc-100">{d.id}</span>
                {d.dirty && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-400">
                    {d.deleted ? 'delete' : 'dirty'}
                  </span>
                )}
                {!d.dirty && d.rev && (
                  <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] text-emerald-400">
                    {d.rev}
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-500">
                {JSON.stringify(d.body)}
              </p>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => startEdit(d)}
                className="rounded border border-zinc-700 p-1.5 text-zinc-400 hover:text-white"
                aria-label={`Edit ${d.id}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => removeDoc(d.id)}
                className="rounded border border-red-500/30 p-1.5 text-red-300 hover:bg-red-500/10"
                aria-label={`Delete ${d.id}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Replication event feed */}
      {feed.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            <RefreshCw className="h-3.5 w-3.5" /> Replication log
          </div>
          <TimelineView events={feed} />
        </div>
      )}
    </div>
  );
}
