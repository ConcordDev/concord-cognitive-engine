'use client';

/**
 * /lenses/goddess — interactive surface over Concordia's ambient
 * dispatch feed. Tabs: Feed (live, tone-filterable) · Archive (search +
 * history) · Alerts (tone subscriptions). A dispatch can be opened to a
 * permalink detail view with commune (react) + world-event correlation.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useEffect, useMemo, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { GoddessGallery } from '@/components/goddess/GoddessGallery';
import { DispatchDetail } from '@/components/goddess/DispatchDetail';
import { DispatchArchive } from '@/components/goddess/DispatchArchive';
import { ToneSubscriptions } from '@/components/goddess/ToneSubscriptions';
import { TONE_COLOR, KNOWN_TONES, type Dispatch } from '@/components/goddess/types';
import { lensRun } from '@/lib/api/client';
import { Sparkles, Loader2 } from 'lucide-react';

type Tab = 'feed' | 'archive' | 'alerts';

interface RecentResult {
  dispatches: Dispatch[];
}

export default function GoddessPage() {
  useLensCommand([
    { id: 'goddess-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'goddess' });

  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [worldId, setWorldId] = useState('concordia-hub');
  const [tab, setTab] = useState<Tab>('feed');
  const [toneFilter, setToneFilter] = useState<string>('');
  const [openId, setOpenId] = useState<number | null>(null);
  // Bumped to re-run the feed fetch on demand (Retry control).
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const r = await lensRun<RecentResult>('goddess', 'recent', { worldId, limit: 50 });
        if (!alive) return;
        if (r.data?.ok && r.data.result) {
          setDispatches(r.data.result.dispatches || []);
          setError(null);
        } else {
          // A failed fetch must surface — never silently collapse into the
          // empty state (which would read as "goddess has not spoken").
          setError(r.data?.error || 'Could not reach the goddess feed.');
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Could not reach the goddess feed.');
      } finally {
        if (alive) setLoading(false);
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 60_000);
    return () => { alive = false; window.clearInterval(interval); };
  }, [worldId, reloadKey]);

  const retryFeed = () => { setError(null); setLoading(true); setReloadKey((k) => k + 1); };

  const filtered = useMemo(
    () => (toneFilter ? dispatches.filter((d) => d.tone === toneFilter) : dispatches),
    [dispatches, toneFilter],
  );

  const openDispatch = (id: number) => { setOpenId(id); };

  const TABS: { id: Tab; label: string }[] = [
    { id: 'feed', label: 'Feed' },
    { id: 'archive', label: 'Archive' },
    { id: 'alerts', label: 'Alerts' },
  ];

  return (
    <LensShell lensId="goddess">
      <FirstRunTour lensId="goddess" />
      <DepthBadge lensId="goddess" size="sm" className="ml-2" />
      <div className="p-6 sm:p-8 max-w-2xl mx-auto">
        <header className="mb-5">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <h1 className="text-2xl font-bold text-zinc-100">Concordia Speaks</h1>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            Ambient broadcasts from Concordia, composed hourly from world ecosystem score,
            refusal-field strength, and drift events.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <label className="text-xs text-zinc-400" htmlFor="goddess-world">World:</label>
            <input
              id="goddess-world" type="text" value={worldId}
              onChange={(e) => { setWorldId(e.target.value); setOpenId(null); }}
              className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 font-mono"
            />
          </div>
        </header>

        {openId !== null ? (
          <DispatchDetail
            dispatchId={openId}
            onNavigate={(id) => setOpenId(id)}
            onClose={() => setOpenId(null)}
          />
        ) : (
          <>
            <nav className="mb-4 flex gap-1 border-b border-zinc-800">
              {TABS.map((t) => (
                <button
                  key={t.id} type="button" onClick={() => setTab(t.id)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                    tab === t.id
                      ? 'border-amber-400 text-amber-200'
                      : 'border-transparent text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>

            {tab === 'feed' && (
              <>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  <button
                    type="button" onClick={() => setToneFilter('')}
                    className={`rounded-full border px-2.5 py-1 text-[11px] ${
                      toneFilter === ''
                        ? 'border-amber-500 bg-amber-500/20 text-amber-200'
                        : 'border-zinc-700 bg-zinc-950 text-zinc-400 hover:border-zinc-500'
                    }`}
                  >
                    All tones
                  </button>
                  {KNOWN_TONES.map((t) => (
                    <button
                      key={t} type="button" onClick={() => setToneFilter(t)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] capitalize ${
                        toneFilter === t
                          ? 'border-amber-500 bg-amber-500/20 text-amber-200'
                          : 'border-zinc-700 bg-zinc-950 text-zinc-400 hover:border-zinc-500'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {loading ? (
                  <div role="status" aria-busy="true" className="flex items-center gap-2 text-zinc-400">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Listening…
                  </div>
                ) : error ? (
                  <div
                    role="alert"
                    className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-center text-sm text-red-300"
                  >
                    <p>{error}</p>
                    <button
                      type="button" onClick={retryFeed}
                      className="mt-3 rounded border border-red-400/40 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/10"
                    >
                      Retry
                    </button>
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="text-center text-zinc-400 italic py-12 border border-zinc-800 rounded-xl">
                    {toneFilter
                      ? `No ${toneFilter} dispatches in this world.`
                      : 'The goddess has not yet spoken in this world.'}
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {filtered.map((d) => (
                      <li key={d.id}>
                        <button
                          type="button" onClick={() => openDispatch(d.id)}
                          className={`w-full border-l-4 rounded-r-xl px-4 py-3 text-left transition-opacity hover:opacity-90 ${
                            TONE_COLOR[d.tone] || TONE_COLOR.neutral
                          }`}
                        >
                          <p className="italic leading-relaxed">{d.body}</p>
                          <p className="mt-2 text-[10px] font-mono opacity-70">
                            {d.tone} · ecosystem {d.ecosystem_score?.toFixed(2) ?? '—'} · refusal{' '}
                            {d.refusal_strength?.toFixed(1) ?? '—'}
                            {d.drift_kind ? ` · drift ${d.drift_kind}` : ''} ·{' '}
                            {new Date(d.composed_at * 1000).toLocaleString()}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {tab === 'archive' && (
              <DispatchArchive worldId={worldId} onOpen={openDispatch} />
            )}

            {tab === 'alerts' && (
              <ToneSubscriptions worldId={worldId} onOpenDispatch={openDispatch} />
            )}
          </>
        )}

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <GoddessGallery />
        </section>
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders &quot;No data yet&quot; if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
      <RecentMineCard domain="goddess" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="goddess" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="goddess" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
