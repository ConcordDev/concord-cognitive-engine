'use client';

/**
 * Concord Link Frontier Lens
 *
 * `GET /api/cross-world/feed` and `GET /api/cross-world/royalty-flow`
 * (`server/lib/cross-world-feed.js`, mounted in `server.js`) are real,
 * tested, working routes — but before this lens they were consumed ONLY by
 * the pre-login `/explore` marketing page. A logged-in player never saw the
 * cross-world news ticker or the royalty-flow ledger in-game; there was no
 * `/lenses/concord-link-frontier` at all. This closes that gap.
 *
 * REST-backed by design (same posture as `/lenses/ops-telemetry` and
 * `/lenses/world-observatory`) — there is no `concord-link-frontier` macro
 * domain, so this page calls the two real HTTP routes directly with
 * `credentials: 'include'` (the established pattern for authenticated,
 * non-macro lens fetches — see `app/lenses/ops-telemetry/page.tsx`).
 *
 * `/api/cross-world/feed` is public-read (no PII in server-generated event
 * summaries); `/api/cross-world/royalty-flow` requires auth. Both are called
 * the same way here since a logged-in player always has the auth cookie.
 *
 * Honest-empty-state invariant: when the feed or royalty-flow window is
 * genuinely quiet, this renders the fact plainly ("no cross-world activity
 * yet" / "no cross-world royalty flow yet") — never a fabricated ticker row
 * or placeholder flow, matching the pattern in `/lenses/world-observatory`.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useUIStore } from '@/store/ui';
import { Globe, Coins, RefreshCcw, AlertTriangle } from 'lucide-react';

// ── Real response shapes (server/lib/cross-world-feed.js) ──────────────────

interface CrossWorldEvent {
  kind: string;
  worldId: string;
  ts: number;
  summary: string;
  ref?: Record<string, unknown>;
  notability: number;
}

interface CrossWorldRoyaltyFlow {
  citationId: string;
  parentDtuId: string;
  parentTitle: string | null;
  parentWorldId: string;
  parentCreator: string | null;
  childDtuId: string;
  childTitle: string | null;
  childWorldId: string;
  childCreator: string | null;
  amountCC: number;
  payoutTs: number | null;
  createdAt: string | number;
}

const REFRESH_MS = 15_000;

function formatKind(kind: string): string {
  return kind.replace(/[:_-]/g, ' ');
}

function formatTs(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return '';
  // Event/citation timestamps are unix seconds; royalty payoutTs likewise.
  const ms = ts > 1e12 ? ts : ts * 1000;
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '';
  }
}

type LinkView = 'feed' | 'royalty';

export default function ConcordLinkFrontierPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<LinkView>('feed');
  const [events, setEvents] = useState<CrossWorldEvent[]>([]);
  const [worldsActive, setWorldsActive] = useState(0);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);

  const [flows, setFlows] = useState<CrossWorldRoyaltyFlow[]>([]);
  const [totalRoyaltyCC, setTotalRoyaltyCC] = useState(0);
  const [flowLoading, setFlowLoading] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);

  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refresh = useCallback(async (announce = false) => {
    setFeedLoading(true);
    setFlowLoading(true);
    setFeedError(null);
    setFlowError(null);
    try {
      const [feedRes, flowRes] = await Promise.all([
        fetch('/api/cross-world/feed?limit=50&sinceMs=3600000', { credentials: 'include' }),
        fetch('/api/cross-world/royalty-flow?limit=50&sinceMs=86400000', { credentials: 'include' }),
      ]);

      if (feedRes.status === 403 || feedRes.status === 401) {
        setFeedError('Sign in to see the cross-world feed.');
      } else {
        const feedJson = await feedRes.json().catch(() => null);
        if (feedJson?.ok) {
          setEvents(Array.isArray(feedJson.events) ? feedJson.events : []);
          setWorldsActive(typeof feedJson.worlds === 'number' ? feedJson.worlds : 0);
        } else {
          setFeedError(feedJson?.error || 'Failed to load cross-world feed');
        }
      }

      if (flowRes.status === 403 || flowRes.status === 401) {
        setFlowError('Sign in to see cross-world royalty flow.');
      } else {
        const flowJson = await flowRes.json().catch(() => null);
        if (flowJson?.ok) {
          setFlows(Array.isArray(flowJson.flows) ? flowJson.flows : []);
          setTotalRoyaltyCC(typeof flowJson.totalRoyaltyCC === 'number' ? flowJson.totalRoyaltyCC : 0);
        } else {
          setFlowError(flowJson?.error || 'Failed to load cross-world royalty flow');
        }
      }

      setHasLoadedOnce(true);
      setLastRefresh(new Date());
      if (announce) useUIStore.getState().addToast({ type: 'success', message: 'Cross-world feed synced.' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFeedError((prev) => prev ?? msg);
      setFlowError((prev) => prev ?? msg);
      setHasLoadedOnce(true);
      if (announce) useUIStore.getState().addToast({ type: 'error', message: 'Could not sync the cross-world feed.' });
    } finally {
      setFeedLoading(false);
      setFlowLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => refresh());
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        refresh();
      }
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);

  useLensCommand(
    [
      { id: 'view-feed', keys: '1', description: 'Cross-world feed', category: 'navigation', action: () => setView('feed') },
      { id: 'view-royalty', keys: '2', description: 'Cross-world royalty flow', category: 'navigation', action: () => setView('royalty') },
      { id: 'refresh', keys: 'r', description: 'Refresh the cross-world feed now', category: 'actions', action: () => { void refresh(true); } },
    ],
    { lensId: 'concord-link-frontier' },
  );

  const loading = feedLoading || flowLoading;
  const titles: Record<LinkView, string> = {
    feed: 'What is happening across worlds',
    royalty: 'Where the royalties are flowing',
  };

  return (
    <LensShell lensId="concord-link-frontier" asMain={false}>
      <DepthBadge lensId="concord-link-frontier" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="concord-link-frontier"
        crumb="Concord Link Frontier"
        title={`${titles[view]}${view === 'feed' && who ? `, ${who}` : ''}`}
        subtitle="The news layer of the federation: notable cross-world events and citation royalty flow, live."
        tabs={[
          { id: 'feed', label: `Cross-world feed (${events.length})`, icon: Globe, keys: '1', hint: 'Notable events across worlds' },
          { id: 'royalty', label: `Royalty flow (${flows.length})`, icon: Coins, keys: '2', hint: 'Citations whose parent and child live in different worlds' },
        ]}
        activeTab={view}
        onTab={(id) => {
          setView(id as LinkView);
          document.getElementById(id === 'feed' ? 'link-feed' : 'link-royalty')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
        tabsLabel="Frontier views"
        cta={{ label: loading ? 'Syncing…' : 'Sync the feed', icon: RefreshCcw, onClick: () => { void refresh(true); }, disabled: loading, title: 'Refresh the cross-world feed now (R)' }}
      >
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-zinc-500 sm:gap-3">
          {lastRefresh && <span>last synced {lastRefresh.toLocaleTimeString()}</span>}
          <span aria-hidden="true">·</span>
          <span>{worldsActive} world{worldsActive === 1 ? '' : 's'} active in the feed window</span>
          <span aria-hidden="true">·</span>
          <span>{totalRoyaltyCC.toLocaleString()} CC in cross-world royalties (24h)</span>
        </div>
        {!hasLoadedOnce && loading && (
          <div role="status" aria-busy="true" aria-label="Loading Concord Link Frontier" className="mb-4 rounded-2xl border border-white/10 bg-[#111] p-4 text-sm text-zinc-400">
            Tuning in to the federation…
          </div>
        )}
        <section className="grid gap-4 xl:grid-cols-2">
<div id="link-feed" className="scroll-mt-24 rounded-2xl border border-white/10 bg-[#111] p-4 transition-colors hover:border-white/20">
            <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-cyan-300">
              <Globe className="h-4 w-4" /> Cross-world feed
            </h2>
            {feedError && (
              <div role="alert" className="mb-2 flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-200">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> <span className="flex-1 break-words">{feedError}</span>
              </div>
            )}
            {!feedError && events.length === 0 ? (
              <p className="text-[11px] text-slate-500">No cross-world activity yet.</p>
            ) : (
              <div className="divide-y divide-zinc-900" role="list" aria-label="Cross-world event feed">
                {events.map((e, i) => (
                  <div key={`${e.kind}:${e.worldId}:${e.ts}:${i}`} className="flex items-start gap-3 py-2">
                    <span className="mt-0.5 shrink-0 text-cyan-400"><Globe className="h-3.5 w-3.5" aria-hidden="true" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] text-slate-200">{e.summary}</p>
                      <p className="mt-0.5 text-[10px] text-slate-500">
                        {formatKind(e.kind)} · <span className="font-mono">{e.worldId}</span>
                        {e.ts ? ` · ${formatTs(e.ts)}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>



<div id="link-royalty" className="scroll-mt-24 rounded-2xl border border-white/10 bg-[#111] p-4 transition-colors hover:border-white/20">
            <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-emerald-300">
              <Coins className="h-4 w-4" /> Cross-world royalty flow
            </h2>
            {flowError && (
              <div role="alert" className="mb-2 flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-200">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> <span className="flex-1 break-words">{flowError}</span>
              </div>
            )}
            {!flowError && flows.length === 0 ? (
              <p className="text-[11px] text-slate-500">No cross-world royalty flow yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]" aria-label="Cross-world royalty flow">
                  <caption className="sr-only">Citations where the parent and child DTU live in different worlds</caption>
                  <thead>
                    <tr className="border-b border-zinc-800 text-left text-slate-400">
                      <th scope="col" className="px-2 py-1">parent</th>
                      <th className="px-2 py-1">child</th>
                      <th className="px-2 py-1 text-right">amount (CC)</th>
                      <th className="px-2 py-1">when</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flows.map((f) => (
                      <tr key={f.citationId} className="border-b border-zinc-900">
                        <td className="px-2 py-1 text-slate-200">
                          <span>{f.parentTitle || f.parentDtuId}</span>
                          <span className="ml-1 font-mono text-[9px] text-emerald-300/60">{f.parentWorldId}</span>
                        </td>
                        <td className="px-2 py-1 text-slate-200">
                          <span>{f.childTitle || f.childDtuId}</span>
                          <span className="ml-1 font-mono text-[9px] text-emerald-300/60">{f.childWorldId}</span>
                        </td>
                        <td className="px-2 py-1 text-right font-mono text-emerald-200">
                          {f.amountCC ? f.amountCC.toLocaleString() : '—'}
                        </td>
                        <td className="px-2 py-1 text-slate-400">{formatTs(f.payoutTs ?? (typeof f.createdAt === 'number' ? f.createdAt : null))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </section>
      </NorthStarFrame>
    </LensShell>
  );
}
