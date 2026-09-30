'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Sub-worlds gallery — discover / mine / favorites + owner modals.
 * Extracted from page.tsx so the lens shell stays thin.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { useWorldTravel } from '@/hooks/useWorldTravel';
import { PortalLoadScreen } from '@/components/world/PortalLoadScreen';
import { WorldCard, type SubWorld } from '@/components/sub-worlds/WorldCard';
import { WorldSettingsPanel } from '@/components/sub-worlds/WorldSettingsPanel';
import { WorldEditorPanel } from '@/components/sub-worlds/WorldEditorPanel';
import { WorldAnalyticsPanel } from '@/components/sub-worlds/WorldAnalyticsPanel';
import { lensRun } from '@/lib/api/client';

export type GalleryMode = 'discover' | 'mine' | 'favorites';
type SortKey = 'popular' | 'recent' | 'favorites';
const KINDS = ['physics_simulator', 'research_zone', 'concord_substrate'];

export function GalleryPanel({ mode }: { mode: GalleryMode }) {
  const router = useRouter();
  const travelHook = useWorldTravel();

  const [worlds, setWorlds] = useState<SubWorld[]>([]);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [travelingWorldId, setTravelingWorldId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [sort, setSort] = useState<SortKey>('popular');
  const [settingsWorld, setSettingsWorld] = useState<SubWorld | null>(null);
  const [editorWorld, setEditorWorld] = useState<SubWorld | null>(null);
  const [analyticsWorld, setAnalyticsWorld] = useState<SubWorld | null>(null);

  const flash = (m: string) => {
    setStatus(m);
    window.setTimeout(() => setStatus(null), 4000);
  };

  const loadFavorites = useCallback(async () => {
    const r = await lensRun('sub_worlds', 'my_favorites', {});
    if (r.data?.ok) {
      const list = (r.data.result as any).worlds || [];
      setFavIds(new Set(list.map((w: SubWorld) => w.world_id)));
      if (mode === 'favorites') setWorlds(list);
    }
  }, [mode]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let r;
      if (mode === 'discover') {
        r = await lensRun('sub_worlds', 'discover', { query, kind: kindFilter, sort });
      } else if (mode === 'mine') {
        r = await lensRun('sub_worlds', 'list', {});
      } else {
        r = await lensRun('sub_worlds', 'my_favorites', {});
      }
      if (r.data?.ok) {
        setWorlds((r.data.result as any)?.worlds || []);
      } else {
        setError(r.data?.error || 'Could not load sub-worlds.');
      }
    } catch (e: any) {
      setError(e?.message || 'Could not load sub-worlds.');
    } finally {
      setLoading(false);
    }
  }, [mode, query, kindFilter, sort]);

  useEffect(() => {
    void loadFavorites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visit = async (w: SubWorld) => {
    const r = await lensRun('sub_worlds', 'visit', { worldId: w.world_id });
    if (!r.data?.ok) {
      flash(`Cannot enter: ${r.data?.error || 'unknown'}`);
      return;
    }
    await refresh();
    setTravelingWorldId(w.world_id);
    try {
      await travelHook.travel(w.world_id);
      router.push('/lenses/world');
    } catch (e: any) {
      flash(`Could not enter "${w.name}": ${e?.message || 'travel failed'}.`);
    } finally {
      setTravelingWorldId(null);
    }
  };

  const toggleFavorite = async (w: SubWorld) => {
    const want = !favIds.has(w.world_id);
    const r = await lensRun('sub_worlds', 'favorite', { worldId: w.world_id, favorite: want });
    if (r.data?.ok) {
      await loadFavorites();
      await refresh();
    }
  };

  const manage = async (w: SubWorld) => {
    const next = w.status === 'paused' ? 'active' : 'paused';
    const r = await lensRun('sub_worlds', 'set_status', { worldId: w.world_id, status: next });
    if (r.data?.ok) {
      flash(`World ${next}.`);
      await refresh();
    } else {
      flash(`Failed: ${r.data?.error || 'unknown'}`);
    }
  };

  return (
    <>
      <PortalLoadScreen
        phase={travelHook.phase}
        targetWorldId={travelHook.targetWorldId}
        error={travelHook.error}
        onRetry={() =>
          travelHook.targetWorldId &&
          travelHook
            .travel(travelHook.targetWorldId)
            .then(() => router.push('/lenses/world'))
            .catch(() => {})
        }
      />

      {status && (
        <div className="mb-4 rounded-lg border border-cyan-700/50 bg-cyan-950/50 px-3 py-2 text-sm text-cyan-200">
          {status}
        </div>
      )}

      {mode === 'discover' && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
            <input
              type="text"
              placeholder="Search worlds…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 pl-8 pr-3 py-2 text-sm text-zinc-100"
            />
          </div>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            aria-label="Filter by kind"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-100"
          >
            <option value="">all kinds</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-100"
          >
            <option value="popular">popular</option>
            <option value="recent">recent</option>
            <option value="favorites">most favorited</option>
          </select>
        </div>
      )}

      {loading ? (
        <div
          data-testid="sub-worlds-loading"
          role="status"
          aria-busy="true"
          aria-live="polite"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
        >
          <span className="sr-only">Loading sub-worlds…</span>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              aria-hidden="true"
              className="h-32 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/60"
            />
          ))}
        </div>
      ) : error ? (
        <div
          data-testid="sub-worlds-error"
          role="alert"
          className="rounded-xl border border-red-800/60 bg-red-950/40 px-4 py-6 text-center text-sm text-red-200"
        >
          <p className="mb-3">Could not load sub-worlds: {error}</p>
          <button
            type="button"
            onClick={() => {
              void refresh();
            }}
            className="rounded-lg bg-red-800 hover:bg-red-700 px-4 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            Retry
          </button>
        </div>
      ) : worlds.length === 0 ? (
        <div
          data-testid="sub-worlds-empty"
          className="rounded-xl border border-zinc-800 py-10 text-center text-sm italic text-zinc-400"
        >
          {mode === 'discover' && 'No public sub-worlds match. Spawn one above.'}
          {mode === 'mine' && 'You have not spawned any sub-worlds yet.'}
          {mode === 'favorites' && 'No favorites yet — star a world to pin it here.'}
        </div>
      ) : (
        <div data-testid="sub-worlds-list" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {worlds.map((w) => (
            <WorldCard
              key={w.world_id}
              world={w}
              favorited={favIds.has(w.world_id)}
              traveling={travelingWorldId === w.world_id}
              onVisit={() => visit(w)}
              onFavorite={() => toggleFavorite(w)}
              onManage={w.is_owner ? () => manage(w) : undefined}
              onEdit={w.can_edit ? () => setEditorWorld(w) : undefined}
            />
          ))}
        </div>
      )}

      {mode === 'mine' && worlds.length > 0 && (
        <div className="mt-4 space-y-2">
          <h3 className="text-[11px] uppercase tracking-wider text-zinc-400">Owner tools</h3>
          <div className="flex flex-wrap gap-2">
            {worlds
              .filter((w) => w.is_owner)
              .map((w) => (
                <div
                  key={w.world_id}
                  className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1"
                >
                  <span className="text-xs text-zinc-300">{w.name}</span>
                  <button
                    type="button"
                    onClick={() => setSettingsWorld(w)}
                    className="rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-cyan-300 hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnalyticsWorld(w)}
                    className="rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-fuchsia-300 hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    Analytics
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}

      {settingsWorld && (
        <WorldSettingsPanel
          world={settingsWorld}
          onClose={() => setSettingsWorld(null)}
          onChanged={() => {
            void refresh();
            void loadFavorites();
          }}
        />
      )}
      {editorWorld && <WorldEditorPanel world={editorWorld} onClose={() => setEditorWorld(null)} />}
      {analyticsWorld && (
        <WorldAnalyticsPanel world={analyticsWorld} onClose={() => setAnalyticsWorld(null)} />
      )}
    </>
  );
}
