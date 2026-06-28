'use client';

/**
 * FoundryWorldsPanel — the page-level wiring surface for the Foundry lens.
 *
 * This is the panel the lens page mounts to make the foundry.* macro
 * surface reachable straight from the lens route (the page used to mount
 * only deeper studio components; this brings the create → list → open →
 * delete loop to the front door).
 *
 * Every read/write goes through the REAL foundry.* macros via lensRun:
 *   foundry.list   → the caller's worlds
 *   foundry.create → a new draft
 *   foundry.get    → open one (validates ownership server-side)
 *   foundry.delete → remove a draft
 *
 * Honest by construction: there is NO setInterval / fake progress / mock
 * data. The four UX states (loading / error / empty / populated) are each
 * a pure function of the real macro result. The persisted-artifact exhaust
 * count is read from the generic lens-artifact store via useLensData.
 */

import { useCallback, useEffect, useState } from 'react';
import { Boxes, Loader2, Plus, RefreshCw, Trash2, ArrowUpRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { EmptyState, ErrorState } from '@/components/common/EmptyState';

export interface FoundryWorldRow {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'published';
  publishedWorldId: string | null;
  updatedAt: number;
}

type LoadState = 'loading' | 'error' | 'ready';

/** Unwrap a foundry macro envelope into a typed payload (or throw). */
async function foundry<T>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  const { data } = await lensRun<T>('foundry', name, input);
  if (!data || data.ok === false || data.result == null) {
    throw new Error(data?.error || `foundry.${name} failed`);
  }
  return data.result as T;
}

export function FoundryWorldsPanel() {
  const [worlds, setWorlds] = useState<FoundryWorldRow[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Real persisted-artifact exhaust for the foundry domain (generic lens
  // artifact store). Read-only here — surfaces the DTU exhaust count.
  const { total: exhaustTotal } = useLensData('foundry', 'foundry_world', { noSeed: true });

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const r = await foundry<{ ok: boolean; worlds: FoundryWorldRow[] }>('list', { limit: 100 });
      setWorlds(Array.isArray(r.worlds) ? r.worlds : []);
      setState('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the Foundry backend.');
      setState('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      await foundry<{ ok: boolean; world: FoundryWorldRow }>('create', { name });
      setNewName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed.');
    } finally {
      setCreating(false);
    }
  }, [newName, load]);

  const remove = useCallback(async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await foundry<{ ok: boolean; deleted: string }>('delete', { id });
      setWorlds((prev) => prev.filter((w) => w.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed.');
    } finally {
      setBusyId(null);
    }
  }, []);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (state === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span>Loading your foundry worlds…</span>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (state === 'error') {
    return (
      <div role="alert" className="py-8">
        <ErrorState error={error ?? 'Foundry is unreachable.'} onRetry={load} />
      </div>
    );
  }

  // ── Create row (shared by empty + populated) ───────────────────────────────
  const createRow = (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => { e.preventDefault(); create(); }}
    >
      <label htmlFor="foundry-new-world" className="sr-only">New world name</label>
      <input
        id="foundry-new-world"
        type="text"
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        placeholder="New world name"
        maxLength={200}
        className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
      />
      <button
        type="submit"
        disabled={creating || !newName.trim()}
        className="flex items-center gap-1.5 rounded-md border border-sky-600/50 bg-sky-600/20 px-3 py-1.5 text-xs font-medium text-sky-200 hover:bg-sky-600/40 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-40"
      >
        {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
        Create world
      </button>
      <button
        type="button"
        onClick={load}
        aria-label="Refresh worlds"
        className="flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </form>
  );

  // ── Empty ──────────────────────────────────────────────────────────────────
  if (worlds.length === 0) {
    return (
      <div className="space-y-4">
        {createRow}
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        <EmptyState
          icon={<Boxes className="h-8 w-8" aria-hidden="true" />}
          title="Build a world from scratch."
          description="Foundry worlds compose Concord's systems — terrain, NPCs, combat, economies — into a persistent, cross-world game. Name one above to begin."
          action={{ label: 'Create your first world', onClick: () => { document.getElementById('foundry-new-world')?.focus(); } }}
        />
      </div>
    );
  }

  // ── Populated ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {createRow}
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
      <div className="flex items-center justify-between text-[11px] text-slate-400">
        <span>{worlds.length} world{worlds.length === 1 ? '' : 's'}</span>
        <span>{exhaustTotal} persisted artifact{exhaustTotal === 1 ? '' : 's'}</span>
      </div>
      <ul className="space-y-2" aria-label="Your foundry worlds">
        {worlds.map((w) => (
          <li
            key={w.id}
            className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-slate-100">{w.name}</span>
                <span
                  className={`rounded-full px-1.5 py-px text-[9px] font-medium ${
                    w.status === 'published'
                      ? 'border border-sky-600/40 bg-sky-500/10 text-sky-300'
                      : 'border border-slate-600/40 bg-slate-500/10 text-slate-300'
                  }`}
                >
                  {w.status}
                </span>
              </div>
              {w.description && (
                <p className="truncate text-xs text-slate-400">{w.description}</p>
              )}
            </div>
            {w.publishedWorldId && (
              <a
                href={`/lenses/world?worldId=${encodeURIComponent(w.publishedWorldId)}`}
                className="flex items-center gap-1 rounded-md border border-sky-700/40 px-2 py-1 text-[11px] text-sky-200 hover:bg-sky-900/30 focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                Open <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              </a>
            )}
            <button
              type="button"
              onClick={() => remove(w.id)}
              disabled={busyId === w.id || w.status === 'published'}
              aria-label={`Delete ${w.name}`}
              title={w.status === 'published' ? 'Unpublish before deleting' : `Delete ${w.name}`}
              className="rounded p-1.5 text-slate-400 hover:bg-red-600/20 hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              {busyId === w.id
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default FoundryWorldsPanel;
