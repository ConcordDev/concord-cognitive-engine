'use client';

/**
 * Spectate index — Phase N + live spectacle/betting wire-up.
 *
 * Grid view of the authored sub-worlds + any world that is a live spectacle
 * (has watchers and/or open SPARKS betting markets). Each card shows the live
 * watcher count and the open-market count, and links to /lenses/spectate/[worldId].
 *
 * Data sources (both REAL backends):
 *   • spectate.list           — merged watcher counts + open markets per world
 *   • /api/worlds/spectator-counts — public watcher-count fallback (no auth)
 *
 * Twitch-shape: faction wars in sovereign-ruins, cyber election night,
 * lattice-crucible PvP tournaments. Read-only — no new substrate.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Eye, Users, Sparkles, AlertTriangle, Loader2, TrendingUp, History } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { lensRun } from '@/lib/api/client';

const AUTHORED_WORLDS: Record<string, { name: string; desc: string }> = {
  'concordia-hub':         { name: 'Concordia Hub',     desc: 'The walled city of the four-faction Compact.' },
  'tunya':                 { name: 'Tunya',             desc: 'Tropical mythopoesis — the long rains and green hours.' },
  'sovereign-ruins':       { name: 'Sovereign Ruins',   desc: 'Post-apocalyptic ash — what\'s left of what was.' },
  'crime':                 { name: 'Crime',             desc: 'Urban noir — every street has a price.' },
  'cyber':                 { name: 'Cyber',             desc: 'Neon dystopia — the corps own the air.' },
  'superhero':             { name: 'Superhero',         desc: 'Capeworld — headlines change in ninety seconds.' },
  'fantasy':               { name: 'Fantasy',           desc: 'High-fantasy realms — thee, thou, and the Wyrd.' },
  'lattice-crucible':      { name: 'Lattice Crucible',  desc: 'Experimental arena — every move is iteration.' },
  'concord-link-frontier': { name: 'Concord-Link Frontier', desc: 'Cross-world news + federation showcase.' },
};

interface Spectacle {
  worldId: string;
  watching: number;
  openMarketCount: number;
  totalPoolSparks: number;
  live: boolean;
  authored: boolean;
}

// Real spectate.my_positions macro shape (server/domains/spectate.js →
// lib/betting-markets.js#userPositions) — a caller's SPARKS wager history,
// open + resolved. Registered but never surfaced on the frontend until this
// pass; wiring it here instead of leaving it dead backend capability.
interface Position {
  id: number;
  market_id: string;
  side: 'yes' | 'no';
  stake_sparks: number;
  payout_sparks: number | null;
  placed_at: number;
  paid_at: number | null;
  question: string;
  status: 'open' | 'resolved';
  resolved_outcome: 'yes' | 'no' | null;
}

type LoadState = 'loading' | 'error' | 'ready';

export default function SpectateIndexPage() {
  const [spectacles, setSpectacles] = useState<Spectacle[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);

  const refresh = useCallback(async (isInitial: boolean) => {
    if (isInitial) setState('loading');
    try {
      // Primary: the spectate.list macro merges watchers + open markets per world.
      const res = await lensRun<{ spectacles?: Spectacle[] }>('spectate', 'list', {});
      const node = res?.data;
      if (node?.ok && node.result && Array.isArray(node.result.spectacles)) {
        setSpectacles(node.result.spectacles);
        setError(null);
        setState('ready');
        return;
      }
      // Fallback: public watcher counts (no auth) — degrade to a watcher-only grid.
      const r = await fetch('/api/worlds/spectator-counts');
      const j = await r.json();
      if (j?.ok) {
        const counts: Record<string, number> = j.counts || {};
        const merged: Spectacle[] = Object.keys(AUTHORED_WORLDS).map((worldId) => ({
          worldId,
          watching: counts[worldId] ?? 0,
          openMarketCount: 0,
          totalPoolSparks: 0,
          live: (counts[worldId] ?? 0) > 0,
          authored: true,
        }));
        setSpectacles(merged);
        setError(null);
        setState('ready');
        return;
      }
      throw new Error(node?.error || 'Could not load spectacles');
    } catch (e) {
      // Only surface a hard error on the initial load; background refresh blips
      // shouldn't blank a populated grid.
      if (isInitial) {
        setError(e instanceof Error ? e.message : 'Network error');
        setState('error');
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    refresh(true);
    const id = setInterval(() => { if (!cancelled) refresh(false); }, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [refresh]);

  // My positions — real spectate.my_positions macro (actor-gated). Anonymous
  // browsing is legitimate for this lens, so a `no_actor` failure is silent
  // (no error state, no empty-state placeholder) — the section just doesn't
  // render. Refreshed alongside the spectacle grid so a bet placed on a
  // world page shows up here without a manual reload.
  const refreshPositions = useCallback(async () => {
    try {
      const res = await lensRun<{ positions?: Position[] }>('spectate', 'my_positions', {});
      const node = res?.data;
      if (node?.ok && Array.isArray(node.result?.positions)) {
        setPositions(node.result.positions);
      }
    } catch { /* best-effort; anonymous visitors have no positions to show */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    refreshPositions();
    const id = setInterval(() => { if (!cancelled) refreshPositions(); }, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [refreshPositions]);

  // Order: live spectacles first, then by watchers, then named worlds.
  const ordered = [...spectacles].sort((a, b) =>
    Number(b.live) - Number(a.live) ||
    b.watching - a.watching ||
    b.openMarketCount - a.openMarketCount ||
    a.worldId.localeCompare(b.worldId));

  const liveCount = ordered.filter((s) => s.live).length;

  return (
    <LensShell lensId="spectate" asMain={false}>      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-fuchsia-950/10 text-slate-100">
        <header className="border-b border-fuchsia-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <div className="rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 p-2">
              <Eye className="h-5 w-5 text-fuchsia-400" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Spectate any world</h1>
              <p className="mt-0.5 hidden truncate text-xs text-slate-400 sm:block">
                Live faction wars, PvP tournaments, election nights — read-only. No interaction, just watch.
              </p>
            </div>
            {state === 'ready' && (
              <span
                className="rounded-full bg-fuchsia-500/20 px-2.5 py-1 text-[11px] font-medium text-fuchsia-300"
                aria-label={`${liveCount} live spectacles`}
              >
                {liveCount} live
              </span>
            )}
          </div>
        </header>

        <section
          className="mx-auto max-w-screen-2xl px-3 py-4 sm:px-6 sm:py-5"
          aria-live="polite"
          aria-busy={state === 'loading'}
        >
          {/* ── My positions (spectate.my_positions) ───────────────────
              Only rendered when the caller has real wager history — an
              anonymous visitor or a signed-in user with no bets sees no
              placeholder at all, per the honest-empty-state rule. */}
          {positions.length > 0 && (
            <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
              <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-amber-300">
                <History className="h-3.5 w-3.5" aria-hidden="true" /> My positions
              </h2>
              <ul className="space-y-1.5">
                {positions.slice(0, 6).map((p) => {
                  const won = p.status === 'resolved' && p.resolved_outcome === p.side;
                  const lost = p.status === 'resolved' && p.resolved_outcome !== null && p.resolved_outcome !== p.side;
                  return (
                    <li key={p.id} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="min-w-0 flex-1 truncate text-amber-100">{p.question}</span>
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 font-medium ${p.side === 'yes' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                        {p.side.toUpperCase()} · {p.stake_sparks.toLocaleString()}
                      </span>
                      <span className={`shrink-0 text-[10px] ${won ? 'text-emerald-300/80' : lost ? 'text-rose-300/70' : 'text-amber-300/60'}`}>
                        {p.status === 'open' ? 'open' : won ? `+${(p.payout_sparks ?? 0).toLocaleString()}` : lost ? 'lost' : 'resolved'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* ── Loading ─────────────────────────────────────────────── */}
          {state === 'loading' && (
            <div
              role="status"
              className="flex flex-col items-center justify-center gap-3 py-24 text-fuchsia-300/70"
            >
              <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" />
              <p className="text-sm">Loading live spectacles…</p>
            </div>
          )}

          {/* ── Error ───────────────────────────────────────────────── */}
          {state === 'error' && (
            <div
              role="alert"
              className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-6 py-12 text-center"
            >
              <AlertTriangle className="h-7 w-7 text-red-400" aria-hidden="true" />
              <p className="text-sm font-medium text-red-200">Couldn&apos;t load spectacles</p>
              <p className="text-xs text-red-300/70">{error}</p>
              <button
                type="button"
                onClick={() => refresh(true)}
                className="mt-1 rounded-lg border border-red-400/40 bg-red-400/10 px-4 py-1.5 text-xs font-medium text-red-200 transition hover:bg-red-400/20"
              >
                Retry
              </button>
            </div>
          )}

          {/* ── Empty ───────────────────────────────────────────────── */}
          {state === 'ready' && ordered.length === 0 && (
            <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 px-6 py-12 text-center">
              <Sparkles className="h-7 w-7 text-fuchsia-400/70" aria-hidden="true" />
              <p className="text-sm font-medium text-fuchsia-100">No spectacles yet</p>
              <p className="text-xs text-fuchsia-300/70">
                When a world has watchers or an open prediction market, it&apos;ll appear here. Check back soon.
              </p>
            </div>
          )}

          {/* ── Populated ───────────────────────────────────────────── */}
          {state === 'ready' && ordered.length > 0 && (
            <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
              {ordered.map((s) => {
                const meta = AUTHORED_WORLDS[s.worldId];
                const name = meta?.name || s.worldId;
                const desc = meta?.desc || 'A spectacle in progress.';
                return (
                  <li key={s.worldId}>
                    <Link
                      href={`/lenses/spectate/${s.worldId}`}
                      className="group flex h-full flex-col rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-4 transition hover:bg-fuchsia-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400"
                      aria-label={`Watch ${name} — ${s.watching} watching, ${s.openMarketCount} open markets`}
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold text-fuchsia-100">{name}</span>
                        <span className="flex shrink-0 items-center gap-1 rounded-full bg-fuchsia-500/20 px-2 py-0.5 text-[10px] font-medium text-fuchsia-300">
                          <Users className="h-3 w-3" aria-hidden="true" />
                          {s.watching}
                        </span>
                      </div>
                      <p className="text-[11px] text-fuchsia-300/80">{desc}</p>
                      <div className="mt-3 flex items-center justify-between gap-1 text-[10px]">
                        {s.openMarketCount > 0 ? (
                          <span className="flex items-center gap-1 text-amber-300/90">
                            <TrendingUp className="h-3 w-3" aria-hidden="true" />
                            {s.openMarketCount} market{s.openMarketCount === 1 ? '' : 's'} · {s.totalPoolSparks.toLocaleString()} SPARKS
                          </span>
                        ) : <span className="text-fuchsia-300/40">No open markets</span>}
                        <span className="flex items-center gap-1 text-fuchsia-300/60 group-hover:text-fuchsia-200">
                          <Sparkles className="h-3 w-3" aria-hidden="true" />
                          Watch
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </LensShell>
  );
}
