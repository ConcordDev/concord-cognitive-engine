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
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { GoddessGallery } from '@/components/goddess/GoddessGallery';
import { DispatchDetail } from '@/components/goddess/DispatchDetail';
import { DispatchArchive } from '@/components/goddess/DispatchArchive';
import { ToneSubscriptions } from '@/components/goddess/ToneSubscriptions';
import { TONE_COLOR, KNOWN_TONES, type Dispatch } from '@/components/goddess/types';
import { lensRun } from '@/lib/api/client';
import { Loader2, Radio, Archive, Bell, RefreshCw } from 'lucide-react';

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
  // The World field used to accept anything silently — blank, 300 chars, or
  // '-99999999999' all just quietly changed (or emptied) the feed. World ids
  // are slug-shaped; say so at the field and never fetch for a malformed id.
  const worldTrimmed = worldId.trim();
  const worldMalformed = worldTrimmed.length > 0
    && (worldTrimmed.length > 64 || !/^[a-z0-9][a-z0-9-_]*$/i.test(worldTrimmed));
  const worldNote = !worldTrimmed
    ? 'Blank reads as concordia-hub.'
    : worldMalformed
      ? 'World ids are 1–64 characters — letters, numbers, dashes, underscores, starting with a letter or number.'
      : null;
  const [tab, setTab] = useState<Tab>('feed');
  const [toneFilter, setToneFilter] = useState<string>('');
  const [openId, setOpenId] = useState<number | null>(null);
  // Bumped to re-run the feed fetch on demand (Retry control).
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const t = worldId.trim();
      if (t && (t.length > 64 || !/^[a-z0-9][a-z0-9-_]*$/i.test(t))) {
        setError('That is not a world id — ids are 1–64 characters: letters, numbers, dashes, underscores.');
        setLoading(false);
        return;
      }
      try {
        const r = await lensRun<RecentResult>('goddess', 'recent', { worldId: t || 'concordia-hub', limit: 50 });
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

  const TABS: { id: Tab; label: string; icon: typeof Radio }[] = [
    { id: 'feed', label: 'Feed', icon: Radio },
    { id: 'archive', label: 'Archive', icon: Archive },
    { id: 'alerts', label: 'Alerts', icon: Bell },
  ];

  return (
    <LensShell lensId="goddess">

      <DepthBadge lensId="goddess" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="goddess"
        crumb="Concordia"
        subtitle="Ambient broadcasts from Concordia, composed hourly from world ecosystem score, refusal-field strength, and drift events."
        actions={
          <label className="flex items-center gap-2 text-xs text-zinc-400" htmlFor="goddess-world">
            World
            <span className="flex flex-col">
              <input
                id="goddess-world" type="text" value={worldId} maxLength={64}
                onChange={(e) => { setWorldId(e.target.value); setOpenId(null); }}
                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-xs text-zinc-100"
              />
              {worldNote && (
                <span role={worldMalformed ? 'alert' : undefined} className={`mt-0.5 text-[10px] ${worldMalformed ? 'text-amber-300' : 'text-zinc-500'}`}>
                  {worldNote}
                </span>
              )}
            </span>
          </label>
        }
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon }))}
        activeTab={tab}
        onTab={(id) => { setOpenId(null); setTab(id as Tab); }}
        tabsLabel="Goddess views"
        cta={{ label: 'Listen again', icon: RefreshCw, onClick: retryFeed, title: 'Re-fetch the latest dispatches' }}
      >
        <div className="max-w-3xl">
        {openId !== null ? (
          <DispatchDetail
            dispatchId={openId}
            onNavigate={(id) => setOpenId(id)}
            onClose={() => setOpenId(null)}
          />
        ) : (
          <>
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

        </div>
        <section className="mt-6 rounded-2xl border border-white/10 bg-[#111] p-4">
          <GoddessGallery />
        </section>
      </NorthStarFrame>
    </LensShell>
  );
}
