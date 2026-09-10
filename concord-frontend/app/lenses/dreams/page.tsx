'use client';

/**
 * /lenses/dreams — Browse, read, interpret, tag, search + publish your dreams.
 *
 * Each dream is a deterministic prose record of one night's substrate state.
 * The list comes from `dreams.recent`; the reader/interpret/tag/publish flow
 * runs through `dreams.detail` / `dreams.interpret` / `dreams.tag` /
 * `dreams.publish` / `dreams.reprice` / `dreams.unpublish`; search + timeline
 * use `dreams.search` / `dreams.tags` / `dreams.timeline`; the forward-looking
 * counterpart uses `dreams.predictions` (Layer 10 forward-sim). Currency: CC.
 *
 * Scope boundary: this lens is the player's own Layer 9 embodied-dream
 * substrate (`dreams` table, one composed record per offline pass). It does
 * NOT surface the unrelated system-level 6-phase dream-cycle (home-dashboard
 * `SubstrateDreams` widget) or the owner-only insight-capture/convergence
 * tool (`command-center`'s dream panel) — those are different substrates
 * with their own dedicated surfaces; mixing them in here would show a
 * regular player counts from a system they can't act on.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useCallback, useEffect, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { DreamPredictions } from '@/components/dreams/DreamPredictions';
import { DreamReader } from '@/components/dreams/DreamReader';
import { DreamLibrary } from '@/components/dreams/DreamLibrary';
import { lensRun } from '@/lib/api/client';

interface DreamDtu { id: string; title?: string; data?: unknown }
interface Dream {
  id: string;
  user_id?: string;
  world_id?: string;
  dream_dtu_id?: string;
  fragment_count?: number;
  composer?: string;
  composed_at: number;
  tags?: string[];
  dtu?: DreamDtu | null;
}

type Tab = 'recent' | 'library';

export default function DreamsPage() {
  useLensCommand([
    { id: 'dreams-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'dreams' });

  const [tab, setTab] = useState<Tab>('recent');
  const [dreams, setDreams] = useState<Dream[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDreamId, setOpenDreamId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(async () => {
    const r = await lensRun<{ ok: boolean; dreams?: Dream[] }>('dreams', 'recent', { limit: 30 });
    if (r.data.ok) setDreams(r.data.result?.dreams || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh, reloadKey]);

  const onChanged = () => setReloadKey((k) => k + 1);

  if (loading) return <div className="p-8 sm:p-10 text-zinc-400">Loading your dreams…</div>;

  return (
    <LensShell lensId="dreams">
      <FirstRunTour lensId="dreams" />
      <DepthBadge lensId="dreams" size="sm" className="ml-2" />
      <div className="p-6 max-w-3xl mx-auto">
        <header
          className="mb-6 rounded-xl border border-zinc-800/60 p-4 -mx-1"
          style={{
            backgroundImage:
              'radial-gradient(1px 1px at 15% 30%, rgba(196,181,253,0.7) 0, transparent 60%),' +
              'radial-gradient(1px 1px at 40% 70%, rgba(196,181,253,0.5) 0, transparent 60%),' +
              'radial-gradient(1.5px 1.5px at 70% 20%, rgba(196,181,253,0.6) 0, transparent 60%),' +
              'radial-gradient(1px 1px at 85% 55%, rgba(196,181,253,0.5) 0, transparent 60%),' +
              'radial-gradient(1px 1px at 55% 85%, rgba(196,181,253,0.4) 0, transparent 60%),' +
              'linear-gradient(180deg, rgba(88,28,135,0.12), transparent)',
          }}
        >
          <h1 className="text-2xl font-bold text-zinc-100">Dreams</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Each is a deterministic prose record of one night&apos;s substrate state. Read it, interpret it, tag it, and publish to sell on the marketplace — royalty cascade pays you on every purchase. <strong>Currency: CC.</strong>
          </p>
        </header>

        <div className="mb-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTab('recent')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              tab === 'recent' ? 'bg-purple-700 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Recent
          </button>
          <button
            type="button"
            onClick={() => setTab('library')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              tab === 'library' ? 'bg-purple-700 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Search &amp; Timeline
          </button>
        </div>

        {tab === 'recent' && (
          dreams.length === 0 ? (
            <div className="text-center text-zinc-400 italic py-12 border border-zinc-800 rounded-xl">
              Sleep generates dreams. Come back tomorrow.
            </div>
          ) : (
            <ul className="space-y-3">
              {dreams.map((d) => {
                const title = d.dtu?.title || `Dream from ${new Date(d.composed_at * 1000).toLocaleDateString()}`;
                return (
                  <li key={d.id} className="bg-zinc-900/80 border border-zinc-700/50 rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-bold text-zinc-100 truncate">{title}</h3>
                        <p className="mt-0.5 text-[10px] text-zinc-400 font-mono">
                          {d.fragment_count ?? 0} fragments · {d.composer} · {new Date(d.composed_at * 1000).toLocaleString()}
                        </p>
                        {d.tags && d.tags.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {d.tags.map((t) => (
                              <span key={t} className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-zinc-400">{t}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0">
                        <button
                          type="button"
                          onClick={() => setOpenDreamId(d.id)}
                          className="bg-purple-700 hover:bg-purple-600 text-white text-xs px-3 py-1.5 rounded font-medium"
                        >
                          Read
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        )}

        {tab === 'library' && (
          <DreamLibrary onOpen={setOpenDreamId} reloadKey={reloadKey} />
        )}

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <DreamPredictions />
        </section>
      </div>

      {openDreamId && (
        <DreamReader
          dreamId={openDreamId}
          onClose={() => setOpenDreamId(null)}
          onChanged={onChanged}
        />
      )}

      <a href="#dreams-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to dreams content</a>      <CrossLensRecentsPanel lensId="dreams" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
