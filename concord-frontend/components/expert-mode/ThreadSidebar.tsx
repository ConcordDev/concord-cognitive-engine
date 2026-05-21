'use client';

/**
 * ThreadSidebar — Perplexity-shape conversation list. Lists the
 * caller's saved expert-mode threads (expert_mode.thread_list),
 * opens one (expert_mode.thread_get via parent), and deletes
 * (expert_mode.thread_delete). Every row is a real persisted thread.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { MessageSquare, Plus, Trash2, Loader2 } from 'lucide-react';

export interface ThreadSummary {
  id: string;
  title: string;
  focus: string;
  turnCount: number;
  lastQuery: string | null;
  createdAt: number;
  updatedAt: number;
}

export function ThreadSidebar({
  activeThreadId,
  onOpen,
  onNew,
  reloadKey,
}: {
  activeThreadId: string | null;
  onOpen: (threadId: string) => void;
  onNew: () => void;
  reloadKey: number;
}) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ threads: ThreadSummary[] }>('expert_mode', 'thread_list', {});
    if (r.data.ok && r.data.result?.threads) setThreads(r.data.result.threads);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, reloadKey]);

  const remove = useCallback(async (id: string) => {
    await lensRun('expert_mode', 'thread_delete', { threadId: id });
    if (id === activeThreadId) onNew();
    await refresh();
  }, [activeThreadId, onNew, refresh]);

  return (
    <aside className="w-full">
      <div className="flex items-center gap-2 mb-2">
        <MessageSquare className="w-4 h-4 text-amber-400" />
        <h2 className="text-sm font-semibold text-zinc-200">Threads</h2>
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-600" />}
        <button
          type="button"
          onClick={onNew}
          className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-amber-500 hover:bg-amber-400 text-amber-50 font-medium"
        >
          <Plus className="w-3.5 h-3.5" /> New
        </button>
      </div>

      {threads.length === 0 ? (
        <p className="text-[11px] text-zinc-600 px-1">
          No threads yet. Ask a question to start one.
        </p>
      ) : (
        <ul className="space-y-1">
          {threads.map((t) => {
            const active = t.id === activeThreadId;
            return (
              <li
                key={t.id}
                className={
                  'group flex items-start gap-2 px-2 py-1.5 rounded border ' +
                  (active
                    ? 'border-amber-500 bg-amber-500/10'
                    : 'border-zinc-800 bg-zinc-950/50 hover:border-zinc-700')
                }
              >
                <button
                  type="button"
                  onClick={() => onOpen(t.id)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div
                    className={
                      'text-[12px] font-medium truncate ' +
                      (active ? 'text-amber-200' : 'text-zinc-200')
                    }
                  >
                    {t.title}
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    {t.turnCount} turn{t.turnCount === 1 ? '' : 's'} · {t.focus}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => remove(t.id)}
                  title="Delete thread"
                  className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-opacity"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
