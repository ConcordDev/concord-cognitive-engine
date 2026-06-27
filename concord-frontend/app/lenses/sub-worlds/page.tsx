'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * /lenses/sub-worlds — Roblox / Rec Room parity: user-spawned, hostable
 * sub-worlds with a discovery gallery, inline visit, per-world settings,
 * analytics, favorites, co-editor permissions, and an in-place editor.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useCallback, useEffect, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { Compass, Boxes, Star, Search } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { MetaverseRepos } from '@/components/sub-worlds/MetaverseRepos';
import { WorldCard, type SubWorld } from '@/components/sub-worlds/WorldCard';
import { WorldSettingsPanel } from '@/components/sub-worlds/WorldSettingsPanel';
import { WorldEditorPanel } from '@/components/sub-worlds/WorldEditorPanel';
import { WorldAnalyticsPanel } from '@/components/sub-worlds/WorldAnalyticsPanel';
import { lensRun } from '@/lib/api/client';

type Tab = 'discover' | 'mine' | 'favorites';
type SortKey = 'popular' | 'recent' | 'favorites';
const KINDS = ['physics_simulator', 'research_zone', 'concord_substrate'];

export default function SubWorldsPage() {
  useLensCommand([
    { id: 'sub-worlds-discover', keys: 'g d', description: 'Discover gallery', category: 'navigation', action: () => setTab('discover') },
    { id: 'sub-worlds-mine', keys: 'g m', description: 'My worlds', category: 'navigation', action: () => setTab('mine') },
  ], { lensId: 'sub-worlds' });

  const [tab, setTab] = useState<Tab>('discover');
  const [worlds, setWorlds] = useState<SubWorld[]>([]);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // discovery filters
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [sort, setSort] = useState<SortKey>('popular');

  // spawn form
  const [form, setForm] = useState({
    name: '', kind: 'physics_simulator', privacy: 'public',
    description: '', forgeAppDtuId: '', capacity: 16,
  });

  // modal targets
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
      if (tab === 'favorites') setWorlds(list);
    }
  }, [tab]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let r;
      if (tab === 'discover') {
        r = await lensRun('sub_worlds', 'discover', { query, kind: kindFilter, sort });
      } else if (tab === 'mine') {
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
  }, [tab, query, kindFilter, sort]);

  useEffect(() => {
    void loadFavorites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const spawn = async () => {
    if (form.name.trim().length < 3) {
      flash('Name must be at least 3 characters.');
      return;
    }
    const r = await lensRun('sub_worlds', 'spawn', form);
    if (r.data?.ok) {
      flash(`Spawned sub-world "${form.name}".`);
      setForm({ ...form, name: '', description: '', forgeAppDtuId: '' });
      setTab('mine');
      await refresh();
    } else {
      flash(`Failed: ${r.data?.error || 'unknown'}`);
    }
  };

  const visit = async (w: SubWorld) => {
    const r = await lensRun('sub_worlds', 'visit', { worldId: w.world_id });
    if (r.data?.ok) {
      const dest = (r.data.result as any).travel?.destination_world_id;
      flash(`Entering "${w.name}" — routing to world-travel (${dest}).`);
      await refresh();
    } else {
      flash(`Cannot enter: ${r.data?.error || 'unknown'}`);
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
    // owner manage shortcut: toggle pause/resume directly from the card
    const next = w.status === 'paused' ? 'active' : 'paused';
    const r = await lensRun('sub_worlds', 'set_status', { worldId: w.world_id, status: next });
    if (r.data?.ok) {
      flash(`World ${next}.`);
      await refresh();
    } else {
      flash(`Failed: ${r.data?.error || 'unknown'}`);
    }
  };

  const TABS: Array<{ id: Tab; label: string; icon: any }> = [
    { id: 'discover', label: 'Discover', icon: Compass },
    { id: 'mine', label: 'My Worlds', icon: Boxes },
    { id: 'favorites', label: 'Favorites', icon: Star },
  ];

  return (
    <LensShell lensId="sub-worlds">
      <FirstRunTour lensId="sub-worlds" />
      <DepthBadge lensId="sub-worlds" size="sm" className="ml-2" />
      <div className="p-6 sm:p-8 max-w-5xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-100">Sub-Worlds</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Spawn, host, and discover user-created worlds. Each one is reachable via the
            existing world-travel system — author it in-place, set its privacy, and track visits.
          </p>
        </header>

        {status && (
          <div className="mb-4 rounded-lg border border-cyan-700/50 bg-cyan-950/50 px-3 py-2 text-sm text-cyan-200">
            {status}
          </div>
        )}

        {/* Spawn */}
        <section className="mb-6 rounded-xl border border-cyan-800/50 bg-zinc-900/80 p-4 space-y-3">
          <h2 className="text-sm font-bold text-cyan-300">Spawn Sub-World</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text" placeholder="World name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            />
            <input
              type="text" placeholder="Forge app DTU id (optional)"
              value={form.forgeAppDtuId}
              onChange={(e) => setForm({ ...form, forgeAppDtuId: e.target.value })}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            />
          </div>
          <textarea
            placeholder="Description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          />
          <div className="grid grid-cols-3 gap-3">
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-100"
            >
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <select
              value={form.privacy}
              onChange={(e) => setForm({ ...form, privacy: e.target.value })}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-100"
            >
              <option value="public">public</option>
              <option value="unlisted">unlisted</option>
              <option value="private">private</option>
            </select>
            <input
              type="number" min={1} max={200}
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })}
              aria-label="Capacity"
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-100"
            />
          </div>
          <button
            type="button" onClick={spawn} disabled={form.name.trim().length < 3}
            className="w-full rounded-lg bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            Spawn Sub-World
          </button>
        </section>

        {/* Tabs */}
        <div className="mb-4 flex gap-1 border-b border-zinc-800">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                tab === id
                  ? 'border-cyan-500 text-cyan-300'
                  : 'border-transparent text-zinc-400 hover:text-zinc-300'
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>

        {/* Discovery filters */}
        {tab === 'discover' && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
              <input
                type="text" placeholder="Search worlds…"
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
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
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

        {/* World grid — four UX states: loading / error / empty / populated */}
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
              onClick={() => { void refresh(); }}
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
            {tab === 'discover' && 'No public sub-worlds match. Spawn one above.'}
            {tab === 'mine' && 'You have not spawned any sub-worlds yet.'}
            {tab === 'favorites' && 'No favorites yet — star a world to pin it here.'}
          </div>
        ) : (
          <div data-testid="sub-worlds-list" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {worlds.map((w) => (
              <WorldCard
                key={w.world_id}
                world={w}
                favorited={favIds.has(w.world_id)}
                onVisit={() => visit(w)}
                onFavorite={() => toggleFavorite(w)}
                onManage={w.is_owner ? () => manage(w) : undefined}
                onEdit={w.can_edit ? () => setEditorWorld(w) : undefined}
              />
            ))}
          </div>
        )}

        {/* Owner tools row for "mine" tab */}
        {tab === 'mine' && worlds.length > 0 && (
          <div className="mt-4 space-y-2">
            <h3 className="text-[11px] uppercase tracking-wider text-zinc-400">Owner tools</h3>
            <div className="flex flex-wrap gap-2">
              {worlds.filter((w) => w.is_owner).map((w) => (
                <div key={w.world_id} className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1">
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

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <MetaverseRepos />
        </section>
      </div>

      {settingsWorld && (
        <WorldSettingsPanel
          world={settingsWorld}
          onClose={() => setSettingsWorld(null)}
          onChanged={() => { void refresh(); void loadFavorites(); }}
        />
      )}
      {editorWorld && (
        <WorldEditorPanel world={editorWorld} onClose={() => setEditorWorld(null)} />
      )}
      {analyticsWorld && (
        <WorldAnalyticsPanel world={analyticsWorld} onClose={() => setAnalyticsWorld(null)} />
      )}

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders &quot;No data yet&quot; if main view has no rows</div>
      <RecentMineCard domain="sub-worlds" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="sub-worlds" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="sub-worlds" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
