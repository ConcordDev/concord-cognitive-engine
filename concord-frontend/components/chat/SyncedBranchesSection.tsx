'use client';

/**
 * SyncedBranchesSection — the account-saved branches made with "Sync" on a
 * message (chat.branch-fork). Lists them (chat.branches-list), opens one as a
 * conversation on this device, and deletes ones you no longer need
 * (chat.branch-delete).
 */

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, GitBranch, Loader2, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

export interface SyncedBranch {
  id: string;
  sourceThreadId: string;
  atMessageIdx: number;
  note?: string;
  seededMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string; ts?: string }>;
  createdAt: string;
}

export function SyncedBranchesSection({ onOpen, refreshKey = 0 }: { onOpen: (b: SyncedBranch) => void; refreshKey?: number }) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<SyncedBranch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ branches: SyncedBranch[] }>('chat', 'branches-list', {});
    if (!r.data.ok) setError(r.data.error || 'Could not load synced branches.');
    else { setError(null); setBranches(r.data.result?.branches || []); }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) void Promise.resolve().then(load);
  }, [open, load, refreshKey]);

  const remove = async (id: string) => {
    setBranches((xs) => xs.filter((b) => b.id !== id));
    const r = await lensRun('chat', 'branch-delete', { id });
    if (!r.data.ok) { setError(r.data.error || 'Could not delete the branch.'); void load(); }
  };

  return (
    <div className="border-t border-lattice-border px-3 py-2">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-[11px] uppercase tracking-wide text-gray-400 transition-colors hover:text-gray-200">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <GitBranch className="h-3 w-3" /> Synced branches
        {branches.length > 0 && <span className="ml-auto rounded-full bg-white/10 px-1.5 text-[10px] normal-case">{branches.length}</span>}
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          {loading && branches.length === 0 && <p role="status" className="flex items-center gap-1.5 text-[11px] text-gray-500"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</p>}
          {error && <p role="alert" className="text-[11px] text-rose-400">{error}</p>}
          {!loading && !error && branches.length === 0 && <p className="text-[11px] text-gray-500">None yet. Use Sync on a message to save a branch to your account.</p>}
          {branches.map((b) => {
            const last = b.seededMessages[b.seededMessages.length - 1];
            return (
              <div key={b.id} className="group flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/5">
                <button type="button" onClick={() => onOpen(b)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-xs text-gray-200">{b.note || (last?.content || 'Branch').slice(0, 60)}</p>
                  <p className="text-[10px] text-gray-500">{b.seededMessages.length} messages · {new Date(b.createdAt).toLocaleDateString()}</p>
                </button>
                <button type="button" aria-label="Delete synced branch" onClick={() => void remove(b.id)}
                  className="mt-0.5 text-gray-600 opacity-0 transition-opacity hover:text-rose-400 group-hover:opacity-100 focus:opacity-100">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
