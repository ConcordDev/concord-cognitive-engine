'use client';

/**
 * Spectator world view — Phase N + live betting markets.
 *
 * Read-only window onto a single world: header chips (watcher count + climate),
 * a live public-event ticker, and the world's open SPARKS prediction markets
 * with a parimutuel bet form. Betting delegates to the real spectate.bet macro
 * (→ betting-markets.placeBet); all numbers come from spectate.get.
 *
 * Spectator mode is read-only for the world simulation — you cannot interact
 * with residents. Wagering is the one explicit action (SPARKS, non-extractive).
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Eye, Users, ArrowLeft, TrendingUp, Loader2, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { LensShell } from '@/components/lens/LensShell';
import { lensRun } from '@/lib/api/client';

interface FlavorBlock {
  description?: string;
  climate?: { baseTemp?: number; weather?: string };
  worldVoice?: { tone?: string };
  npcDensity?: { targetPerFaction?: number };
}

interface Market {
  id: string;
  worldId: string | null;
  question: string;
  resolutionKind: string | null;
  poolYesSparks: number;
  poolNoSparks: number;
  totalPoolSparks: number;
  impliedYes: number;
  openedAt: number | null;
  closesAt: number | null;
}

interface Dispatch { id?: number; tone?: string; body?: string; composed_at?: number }

type LoadState = 'loading' | 'error' | 'ready';

export default function SpectatorWorldPage() {
  const params = useParams<{ worldId: string }>();
  const worldId = params?.worldId || '';
  const [watching, setWatching] = useState<number>(0);
  const [flavor, setFlavor] = useState<FlavorBlock | null>(null);
  const [tickerEvents, setTickerEvents] = useState<Array<{ ts: number; event: string; summary: string }>>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);

  // ── Live spectacle (watcher count + open markets + dispatches) ─────────────
  const refreshSpectacle = useCallback(async (isInitial: boolean) => {
    if (!worldId) return;
    if (isInitial) setState('loading');
    try {
      const res = await lensRun<{
        spectacle?: { watching: number; openMarkets: Market[]; dispatches: Dispatch[] };
      }>('spectate', 'get', { worldId });
      const node = res?.data;
      if (node?.ok && node.result?.spectacle) {
        setWatching(node.result.spectacle.watching ?? 0);
        setMarkets(node.result.spectacle.openMarkets ?? []);
        setDispatches(node.result.spectacle.dispatches ?? []);
        setError(null);
        setState('ready');
        return;
      }
      // Fallback: public watcher-count endpoint (no auth).
      const r = await fetch('/api/worlds/spectator-counts');
      const j = await r.json();
      if (j?.ok) {
        setWatching(j.counts?.[worldId] ?? 0);
        setError(null);
        setState('ready');
        return;
      }
      throw new Error(node?.error || 'Could not load spectacle');
    } catch (e) {
      if (isInitial) {
        setError(e instanceof Error ? e.message : 'Network error');
        setState('error');
      }
    }
  }, [worldId]);

  useEffect(() => {
    let cancelled = false;
    refreshSpectacle(true);
    const id = setInterval(() => { if (!cancelled) refreshSpectacle(false); }, 8_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [refreshSpectacle]);

  // Open a read-only spectator session on mount (spectate.watch → persists a
  // spectator_sessions row + hands back the WS hint the live view streams from).
  useEffect(() => {
    if (!worldId) return;
    let cancelled = false;
    lensRun('spectate', 'watch', { worldId })
      .then((res) => {
        if (cancelled) return;
        const hint = res?.data?.result?.wsHint;
        if (typeof hint === 'string') {
          // Stash the WS hint for the scene/event-stream layer to connect to.
          if (typeof window !== 'undefined') {
            (window as unknown as Record<string, unknown>).__spectateWsHint = hint;
          }
        }
      })
      .catch(() => { /* watching is best-effort; the read views still work */ });
    return () => { cancelled = true; };
  }, [worldId]);

  // Flavor block for the header chips.
  useEffect(() => {
    if (!worldId) return;
    fetch(`/api/worlds/${encodeURIComponent(worldId)}/flavor`)
      .then((r) => r.json())
      .then((j) => { if (j?.ok) setFlavor(j.flavor as FlavorBlock); })
      .catch(() => setFlavor(null));
  }, [worldId]);

  // Live event ticker — rolling buffer of the world's public socket/window
  // events (combat, faction wars, DTU promotions, NPC openers).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onEvent = (ev: Event) => {
      const detail = (ev as CustomEvent).detail || {};
      if (detail.worldId && detail.worldId !== worldId) return;
      setTickerEvents((prev) => {
        const next = [{ ts: Date.now(), event: ev.type, summary: detail.summary || JSON.stringify(detail).slice(0, 80) }, ...prev];
        return next.slice(0, 30);
      });
    };
    const evts = ['npc:conversation-bid', 'combat:hit', 'faction-war:started', 'dtu:promoted', 'world:event:scheduled'];
    for (const evt of evts) window.addEventListener(evt, onEvent as EventListener);
    return () => { for (const evt of evts) window.removeEventListener(evt, onEvent as EventListener); };
  }, [worldId]);

  const climateChip = useMemo(() => {
    if (!flavor?.climate) return null;
    const parts: string[] = [];
    if (flavor.climate.weather) parts.push(flavor.climate.weather.replace(/-/g, ' '));
    if (typeof flavor.climate.baseTemp === 'number') parts.push(`${flavor.climate.baseTemp}°C`);
    return parts.join(' · ');
  }, [flavor]);

  return (
    <LensShell lensId="spectate" asMain={false}>
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-fuchsia-950/10 text-slate-100">
        <header className="border-b border-fuchsia-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <Link href="/lenses/spectate" className="rounded-md border border-slate-700 bg-slate-800/40 p-1.5 hover:bg-slate-700/40" aria-label="Back to spectate list">
              <ArrowLeft className="h-4 w-4 text-slate-300" />
            </Link>
            <div className="rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 p-2">
              <Eye className="h-5 w-5 text-fuchsia-400" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg capitalize">Spectating {worldId.replace(/-/g, ' ')}</h1>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className="flex items-center gap-1 rounded-full bg-fuchsia-500/20 px-2 py-0.5 font-medium text-fuchsia-300">
                  <Users className="h-3 w-3" aria-hidden="true" />
                  {watching} watching
                </span>
                {climateChip && <span className="rounded-full bg-slate-700/50 px-2 py-0.5 text-slate-300">{climateChip}</span>}
                {flavor?.worldVoice?.tone && <span className="rounded-full bg-slate-700/50 px-2 py-0.5 text-slate-300">{flavor.worldVoice.tone.split(',')[0]}</span>}
              </div>
            </div>
          </div>
        </header>

        <section
          className="mx-auto max-w-screen-2xl px-3 py-4 sm:px-6 sm:py-5"
          aria-live="polite"
          aria-busy={state === 'loading'}
        >
          {/* World description */}
          {flavor?.description && (
            <p className="mb-4 max-w-3xl rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/5 p-3 text-xs italic text-fuchsia-200/80">
              {flavor.description}
            </p>
          )}

          {/* ── Loading ─────────────────────────────────────────────── */}
          {state === 'loading' && (
            <div role="status" className="flex flex-col items-center justify-center gap-3 py-16 text-fuchsia-300/70">
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
              <p className="text-sm">Loading spectacle…</p>
            </div>
          )}

          {/* ── Error ───────────────────────────────────────────────── */}
          {state === 'error' && (
            <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-6 py-10 text-center">
              <AlertTriangle className="h-6 w-6 text-red-400" aria-hidden="true" />
              <p className="text-sm font-medium text-red-200">Couldn&apos;t load this spectacle</p>
              <p className="text-xs text-red-300/70">{error}</p>
              <button
                type="button"
                onClick={() => refreshSpectacle(true)}
                className="mt-1 rounded-lg border border-red-400/40 bg-red-400/10 px-4 py-1.5 text-xs font-medium text-red-200 transition hover:bg-red-400/20"
              >
                Retry
              </button>
            </div>
          )}

          {state === 'ready' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {/* Live event ticker */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3 lg:col-span-2">
                <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-fuchsia-300">
                  <span className="inline-block h-3 w-3 rounded-full bg-fuchsia-400 animate-pulse" aria-hidden="true" /> Live event stream
                </h2>
                {tickerEvents.length === 0 ? (
                  <p className="text-[11px] text-slate-500">
                    Waiting for events — this view streams the world&apos;s public socket events (combat, faction wars, DTU promotions, NPC openers).
                  </p>
                ) : (
                  <ol className="space-y-1 font-mono text-[11px]">
                    {tickerEvents.map((e, i) => (
                      <li key={`${e.ts}-${i}`} className="flex items-start gap-2 border-b border-zinc-900/60 pb-1">
                        <span className="text-fuchsia-400/70">{new Date(e.ts).toLocaleTimeString()}</span>
                        <span className="text-fuchsia-200">{e.event}</span>
                        <span className="truncate text-slate-400">{e.summary}</span>
                      </li>
                    ))}
                  </ol>
                )}

                {dispatches.length > 0 && (
                  <div className="mt-4 border-t border-zinc-800 pt-3">
                    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300/80">Goddess dispatches</h3>
                    <ul className="space-y-1.5">
                      {dispatches.slice(0, 5).map((d, i) => (
                        <li key={d.id ?? i} className="text-[11px] italic text-amber-200/70">“{d.body}”</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Open betting markets */}
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-amber-300">
                  <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> Prediction markets
                </h2>
                {markets.length === 0 ? (
                  <p className="text-[11px] text-amber-200/50">No open markets on this world right now.</p>
                ) : (
                  <ul className="space-y-3">
                    {markets.map((m) => (
                      <MarketCard key={m.id} market={m} worldId={worldId} onPlaced={() => refreshSpectacle(false)} />
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          <p className="mt-4 text-[10px] text-slate-500">
            Spectator mode is read-only for the simulation. Wagers are placed in SPARKS (non-extractive).
          </p>
        </section>
      </main>
    </LensShell>
  );
}

function MarketCard({ market, worldId, onPlaced }: { market: Market; worldId: string; onPlaced: () => void }) {
  const [side, setSide] = useState<'yes' | 'no'>('yes');
  const [stake, setStake] = useState<string>('10');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const placeBet = async () => {
    setBusy(true);
    setResult(null);
    try {
      const stakeSparks = Number(stake);
      const res = await lensRun<{ ok?: boolean; stake?: number; reason?: string }>('spectate', 'bet', {
        marketId: market.id,
        side,
        stakeSparks,
      });
      const node = res?.data;
      if (node?.ok && node.result?.ok !== false) {
        setResult({ ok: true, msg: `Placed ${stakeSparks} SPARKS on ${side.toUpperCase()}.` });
        onPlaced();
      } else {
        const reason = node?.result?.reason || node?.error || 'bet_failed';
        setResult({ ok: false, msg: reason.replace(/_/g, ' ') });
      }
    } catch {
      setResult({ ok: false, msg: 'network error' });
    } finally {
      setBusy(false);
    }
  };

  const impliedPct = Math.round(market.impliedYes * 100);

  return (
    <li className="rounded-lg border border-amber-500/20 bg-zinc-950/40 p-2.5">
      <p className="mb-1.5 text-[12px] font-medium text-amber-100">{market.question}</p>
      <div className="mb-2 flex items-center justify-between text-[10px] text-amber-200/60">
        <span>YES {impliedPct}% · NO {100 - impliedPct}%</span>
        <span>{market.totalPoolSparks.toLocaleString()} SPARKS pool</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="flex overflow-hidden rounded-md border border-amber-500/30" role="group" aria-label="Bet side">
          <button
            type="button"
            onClick={() => setSide('yes')}
            aria-pressed={side === 'yes'}
            className={`px-2.5 py-1 text-[11px] font-medium transition ${side === 'yes' ? 'bg-emerald-500/30 text-emerald-200' : 'text-amber-200/60 hover:bg-amber-500/10'}`}
          >Yes</button>
          <button
            type="button"
            onClick={() => setSide('no')}
            aria-pressed={side === 'no'}
            className={`px-2.5 py-1 text-[11px] font-medium transition ${side === 'no' ? 'bg-rose-500/30 text-rose-200' : 'text-amber-200/60 hover:bg-amber-500/10'}`}
          >No</button>
        </div>
        <label className="sr-only" htmlFor={`stake-${market.id}`}>Stake in SPARKS</label>
        <input
          id={`stake-${market.id}`}
          type="number"
          min={1}
          value={stake}
          onChange={(e) => setStake(e.target.value)}
          className="w-16 rounded-md border border-amber-500/30 bg-zinc-900/60 px-2 py-1 text-[11px] text-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          aria-label="Stake in SPARKS"
        />
        <button
          type="button"
          onClick={placeBet}
          disabled={busy}
          className="flex-1 rounded-md border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[11px] font-medium text-amber-200 transition hover:bg-amber-400/20 disabled:opacity-50"
        >
          {busy ? 'Placing…' : 'Place bet'}
        </button>
      </div>
      {result && (
        <p
          role="status"
          className={`mt-1.5 text-[10px] ${result.ok ? 'text-emerald-300/80' : 'text-rose-300/80'}`}
        >{result.msg}</p>
      )}
    </li>
  );
}
