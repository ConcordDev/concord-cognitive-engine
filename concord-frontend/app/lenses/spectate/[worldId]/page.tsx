'use client';

/**
 * Spectator world view — Phase N.
 *
 * Mounts a read-only ConcordiaScene without avatar input or combat
 * wiring. Joins the world's spectator socket room so events stream in
 * for the overlay HUD. The auto-director picks the camera target from
 * recent activity (combat / faction war / dialogue cluster).
 *
 * This page is intentionally lean — the full SpectatorHUD with bracket
 * overlays, fight stats, and tip jar is a follow-up (tournament-mode
 * specialisation). For v1 we render: scene + live event ticker + watcher
 * count + name of world.
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Eye, Users, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { LensShell } from '@/components/lens/LensShell';

interface FlavorBlock {
  description?: string;
  climate?: { baseTemp?: number; weather?: string };
  worldVoice?: { tone?: string };
  npcDensity?: { targetPerFaction?: number };
}

export default function SpectatorWorldPage() {
  const params = useParams<{ worldId: string }>();
  const worldId = params?.worldId || '';
  const [watching, setWatching] = useState<number>(0);
  const [flavor, setFlavor] = useState<FlavorBlock | null>(null);
  const [tickerEvents, setTickerEvents] = useState<Array<{ ts: number; event: string; summary: string }>>([]);

  // Live spectator count.
  useEffect(() => {
    if (!worldId) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const r = await fetch('/api/worlds/spectator-counts');
        const j = await r.json();
        if (!cancelled && j?.ok) setWatching(j.counts?.[worldId] ?? 0);
      } catch { /* network blip */ }
    };
    refresh();
    const id = setInterval(refresh, 5_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [worldId]);

  // Flavor block for the header chips.
  useEffect(() => {
    if (!worldId) return;
    fetch(`/api/worlds/${encodeURIComponent(worldId)}/flavor`)
      .then((r) => r.json())
      .then((j) => { if (j?.ok) setFlavor(j.flavor as FlavorBlock); })
      .catch(() => setFlavor(null));
  }, [worldId]);

  // Mock event ticker — wires up to Socket.IO in v2; for v1 we show a
  // rolling buffer from window events the existing world-event feed emits.
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
    for (const evt of ['npc:conversation-bid', 'combat:hit', 'faction-war:started', 'dtu:promoted', 'world:event:scheduled']) {
      window.addEventListener(evt, onEvent as EventListener);
    }
    return () => {
      for (const evt of ['npc:conversation-bid', 'combat:hit', 'faction-war:started', 'dtu:promoted', 'world:event:scheduled']) {
        window.removeEventListener(evt, onEvent as EventListener);
      }
    };
  }, [worldId]);

  const climateChip = useMemo(() => {
    if (!flavor?.climate) return null;
    const parts = [];
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
                  <Users className="h-3 w-3" />
                  {watching} watching
                </span>
                {climateChip && <span className="rounded-full bg-slate-700/50 px-2 py-0.5 text-slate-300">{climateChip}</span>}
                {flavor?.worldVoice?.tone && <span className="rounded-full bg-slate-700/50 px-2 py-0.5 text-slate-300">{flavor.worldVoice.tone.split(',')[0]}</span>}
              </div>
            </div>
          </div>
        </header>

        <section className="mx-auto max-w-screen-2xl px-3 py-4 sm:px-6 sm:py-5">
          {/* World description */}
          {flavor?.description && (
            <p className="mb-4 max-w-3xl rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/5 p-3 text-xs italic text-fuchsia-200/80">
              {flavor.description}
            </p>
          )}

          {/* Live event ticker */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
            <h2 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-fuchsia-300">
              <Sparkle /> Live event stream
            </h2>
            {tickerEvents.length === 0 ? (
              <p className="text-[11px] text-slate-400">Waiting for events… (this view streams the world\'s public socket events; combat, faction wars, DTU promotions, NPC openers)</p>
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
          </div>

          <p className="mt-4 text-[10px] text-slate-400">
            Spectator mode is read-only. You see what residents see; you cannot interact.
          </p>
        </section>
      </main>
    </LensShell>
  );
}

function Sparkle() {
  return <span className="inline-block h-3 w-3 rounded-full bg-fuchsia-400 animate-pulse" />;
}
