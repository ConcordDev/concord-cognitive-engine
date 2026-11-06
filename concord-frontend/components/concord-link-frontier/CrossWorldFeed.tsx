'use client';

/**
 * CrossWorldFeed — the federation's news layer, mounted in the
 * Concord-Link-Frontier lens on the founder's ruling (2026-11-06):
 * the lens carries the surface its card describes.
 *
 * Reads the standing REST surface — the same source /explore consumes:
 *   GET /api/cross-world/feed          (public)    notable events across worlds
 *   GET /api/cross-world/royalty-flow  (signed-in) citations whose parent
 *                                        and child DTUs live in different
 *                                        worlds, with the coin that moved
 *
 * Every state reads as itself — loading, an honest empty window, and a
 * failed read all say so. Nothing is substituted.
 */

import { useCallback, useEffect, useState } from 'react';

interface FeedEvent {
  kind: string;
  worldId: string;
  ts: number; // unix seconds
  summary: string;
}

interface RoyaltyFlow {
  citationId: string;
  parentDtuId: string;
  parentTitle: string | null;
  parentWorldId: string;
  childDtuId: string;
  childTitle: string | null;
  childWorldId: string;
  amountCC: number;
}

type Load<T> =
  | { state: 'loading' }
  | { state: 'ready'; data: T }
  | { state: 'error'; message: string }
  | { state: 'signed-out' };

const WINDOW_MS = 86_400_000; // 24 hours — the window /explore reads

function relTime(tsSeconds: number): string {
  const diff = Date.now() - tsSeconds * 1000;
  if (!Number.isFinite(diff) || diff < 0) return '';
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function kindLabel(kind: string): string {
  return kind.replace(/:/g, ' · ').replace(/-/g, ' ');
}

function cc(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString('en-US');
}

export function CrossWorldFeed() {
  const [feed, setFeed] = useState<Load<{ events: FeedEvent[]; worlds: number }>>({ state: 'loading' });
  const [royalty, setRoyalty] = useState<Load<{ flows: RoyaltyFlow[]; totalRoyaltyCC: number }>>({ state: 'loading' });

  const load = useCallback(async () => {
    setFeed({ state: 'loading' });
    setRoyalty({ state: 'loading' });
    try {
      const res = await fetch(`/api/cross-world/feed?limit=30&sinceMs=${WINDOW_MS}`, { credentials: 'omit' });
      const body = await res.json().catch(() => null) as { ok?: boolean; error?: string; events?: FeedEvent[]; worlds?: number } | null;
      if (!res.ok || !body?.ok) throw new Error(body?.error || `the feed answered ${res.status}`);
      setFeed({ state: 'ready', data: { events: Array.isArray(body.events) ? body.events : [], worlds: body.worlds || 0 } });
    } catch (e) {
      setFeed({ state: 'error', message: e instanceof Error ? e.message : 'unavailable' });
    }
    try {
      const res = await fetch(`/api/cross-world/royalty-flow?limit=20&sinceMs=${WINDOW_MS}`, { credentials: 'include' });
      if (res.status === 401) {
        setRoyalty({ state: 'signed-out' });
        return;
      }
      const body = await res.json().catch(() => null) as { ok?: boolean; error?: string; flows?: RoyaltyFlow[]; totalRoyaltyCC?: number } | null;
      if (!res.ok || !body?.ok) throw new Error(body?.error || `the ledger answered ${res.status}`);
      setRoyalty({ state: 'ready', data: { flows: Array.isArray(body.flows) ? body.flows : [], totalRoyaltyCC: body.totalRoyaltyCC || 0 } });
    } catch (e) {
      setRoyalty({ state: 'error', message: e instanceof Error ? e.message : 'unavailable' });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="mt-12 space-y-12">
      <section data-testid="clf-feed">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-[15px] font-medium text-zinc-100">Cross-world feed</h2>
          {feed.state === 'ready' && (
            <span className="text-[12px] text-zinc-500">
              {feed.data.worlds} world{feed.data.worlds === 1 ? '' : 's'} · last 24 hours
            </span>
          )}
          <button type="button" onClick={() => { void load(); }} className="text-[13px] text-zinc-300 underline underline-offset-4 hover:text-white">
            Refresh
          </button>
        </div>
        {feed.state === 'loading' && <p className="mt-3 text-[14px] text-zinc-500">Reading the worlds…</p>}
        {feed.state === 'error' && (
          <p className="mt-3 text-[14px] text-zinc-400">
            The cross-world feed did not answer ({feed.message}).{' '}
            <button type="button" onClick={() => { void load(); }} className="text-zinc-100 underline underline-offset-4">Retry the feed</button>
          </p>
        )}
        {feed.state === 'ready' && feed.data.events.length === 0 && (
          <p className="mt-3 text-[14px] text-zinc-400">No cross-world events in the last 24 hours.</p>
        )}
        {feed.state === 'ready' && feed.data.events.length > 0 && (
          <ul className="mt-3 space-y-3 border-t border-white/10 pt-4">
            {feed.data.events.map((e, i) => (
              <li key={`${e.kind}-${e.ts}-${i}`}>
                <p className="text-[14px] text-zinc-200">{e.summary}</p>
                <p className="mt-0.5 text-[12px] text-zinc-500">
                  <span title={e.kind}>{kindLabel(e.kind)}</span> · {e.worldId}
                  {relTime(e.ts) ? <> · {relTime(e.ts)}</> : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-testid="clf-royalty">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-[15px] font-medium text-zinc-100">Royalty flow</h2>
          {royalty.state === 'ready' && royalty.data.flows.length > 0 && (
            <span className="text-[12px] text-zinc-500">
              {cc(royalty.data.totalRoyaltyCC)} CC across {royalty.data.flows.length} cross-world citation{royalty.data.flows.length === 1 ? '' : 's'} · last 24 hours
            </span>
          )}
        </div>
        {royalty.state === 'loading' && <p className="mt-3 text-[14px] text-zinc-500">Reading the ledger…</p>}
        {royalty.state === 'signed-out' && (
          <p className="mt-3 text-[14px] text-zinc-400">Royalty flow is visible to signed-in accounts.</p>
        )}
        {royalty.state === 'error' && (
          <p className="mt-3 text-[14px] text-zinc-400">
            The royalty ledger did not answer ({royalty.message}).{' '}
            <button type="button" onClick={() => { void load(); }} className="text-zinc-100 underline underline-offset-4">Retry the ledger</button>
          </p>
        )}
        {royalty.state === 'ready' && royalty.data.flows.length === 0 && (
          <p className="mt-3 text-[14px] text-zinc-400">No cross-world royalty flow in the last 24 hours.</p>
        )}
        {royalty.state === 'ready' && royalty.data.flows.length > 0 && (
          <ul className="mt-3 space-y-3 border-t border-white/10 pt-4">
            {royalty.data.flows.map((f) => (
              <li key={f.citationId}>
                <p className="text-[14px] text-zinc-200">
                  {f.childTitle || f.childDtuId} <span className="text-zinc-500">({f.childWorldId})</span> cites{' '}
                  {f.parentTitle || f.parentDtuId} <span className="text-zinc-500">({f.parentWorldId})</span>
                </p>
                <p className="mt-0.5 text-[12px] text-zinc-500">{cc(f.amountCC)} CC moved</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
