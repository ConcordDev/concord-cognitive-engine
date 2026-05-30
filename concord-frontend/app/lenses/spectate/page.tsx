'use client';

/**
 * Spectate index — Phase N.
 *
 * Grid view of the 8+1 authored sub-worlds + any UGC worlds, with live
 * spectator count and a "Watch" CTA. Click → /lenses/spectate/[worldId].
 *
 * Twitch-shape: faction wars in sovereign-ruins, cyber election night,
 * lattice-crucible PvP tournaments. Zero new substrate — this is just
 * the read-only socket scope made user-visible.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Eye, Users, Sparkles, Loader2 } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';

const AUTHORED_WORLDS = [
  { id: 'concordia-hub',      name: 'Concordia Hub',     desc: 'The walled city of the four-faction Compact.' },
  { id: 'tunya',              name: 'Tunya',             desc: 'Tropical mythopoesis — the long rains and green hours.' },
  { id: 'sovereign-ruins',    name: 'Sovereign Ruins',   desc: 'Post-apocalyptic ash — what\'s left of what was.' },
  { id: 'crime',              name: 'Crime',             desc: 'Urban noir — every street has a price.' },
  { id: 'cyber',              name: 'Cyber',             desc: 'Neon dystopia — the corps own the air.' },
  { id: 'superhero',          name: 'Superhero',         desc: 'Capeworld — headlines change in ninety seconds.' },
  { id: 'fantasy',            name: 'Fantasy',           desc: 'High-fantasy realms — thee, thou, and the Wyrd.' },
  { id: 'lattice-crucible',   name: 'Lattice Crucible',  desc: 'Experimental arena — every move is iteration.' },
  { id: 'concord-link-frontier', name: 'Concord-Link Frontier', desc: 'Cross-world news + federation showcase.' },
];

export default function SpectateIndexPage() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async (initial: boolean) => {
      if (initial) { setLoading(true); setError(null); }
      try {
        const r = await fetch('/api/worlds/spectator-counts', { credentials: 'include' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (cancelled) return;
        if (j?.ok) {
          setCounts(j.counts || {});
          setError(null);
        } else {
          throw new Error('Bad response');
        }
      } catch {
        if (!cancelled && initial) setError('Could not load live spectator counts. Retrying…');
      } finally {
        if (!cancelled && initial) setLoading(false);
      }
    };
    refresh(true);
    const id = setInterval(() => refresh(false), 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const hasWorlds = AUTHORED_WORLDS.length > 0;

  return (
    <LensShell lensId="spectate" asMain={false}>
      <ManifestActionBar />
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-fuchsia-950/10 text-slate-100">
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
          </div>
        </header>

        <section className="mx-auto max-w-screen-2xl px-3 py-4 sm:px-6 sm:py-5">
          {error && (
            <div
              role="alert"
              className="mb-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
            >
              {error}
            </div>
          )}

          {loading && Object.keys(counts).length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-fuchsia-300/70">
              <Loader2 className="h-5 w-5 animate-spin text-fuchsia-400" aria-hidden="true" />
              Loading worlds…
            </div>
          ) : !hasWorlds ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-fuchsia-300/70">
              <Eye className="h-6 w-6 text-fuchsia-400/60" aria-hidden="true" />
              <p>No worlds are available to spectate right now.</p>
              <p className="text-xs text-slate-400">Check back once a world goes live.</p>
            </div>
          ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {AUTHORED_WORLDS.map((w) => {
              const watching = counts[w.id] ?? 0;
              return (
                <Link
                  key={w.id}
                  href={`/lenses/spectate/${w.id}`}
                  className="group flex flex-col rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-4 transition-colors hover:bg-fuchsia-500/10"
                >
                  <div className="mb-2 flex items-start justify-between">
                    <span className="text-sm font-semibold text-fuchsia-100">{w.name}</span>
                    <span className="flex items-center gap-1 rounded-full bg-fuchsia-500/20 px-2 py-0.5 text-[10px] font-medium text-fuchsia-300">
                      <Users className="h-3 w-3" />
                      {watching}
                    </span>
                  </div>
                  <p className="text-[11px] text-fuchsia-300/80">{w.desc}</p>
                  <div className="mt-3 flex items-center justify-end gap-1 text-[10px] text-fuchsia-300/60 group-hover:text-fuchsia-200">
                    <Sparkles className="h-3 w-3" />
                    Watch live
                  </div>
                </Link>
              );
            })}
          </div>
          )}
        </section>
      </main>
    </LensShell>
  );
}
