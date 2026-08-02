'use client';

/**
 * /explore/world — the Concordia half of the split /explore fork.
 *
 * Leads with the world/combat pitch and states 18+ once, plainly, where a
 * visitor who chose this path expects it — instead of sitting in an
 * equal-weight tile next to a "no data extraction, sovereign" pitch aimed
 * at a different audience. See `/explore/page.tsx`'s header comment for why
 * this split exists.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Sparkles, ArrowRight, Globe, Swords, Users, Coins, Activity, ShieldAlert } from 'lucide-react';

interface WorldEvent { kind?: string; summary?: string; ts?: number; worldId?: string }

const PILLARS = [
  { icon: Globe, title: 'A living 3D world', body: 'A civilization simulator with hundreds of NPCs running their own lives, factions, schemes, and wars in real time — not scripted, emergent.' },
  { icon: Swords, title: 'Real, visceral combat', body: 'Skyrim-style action combat with procedural biomechanics and momentum-based impact — a violent, bloody world.' },
  { icon: Coins, title: 'Loot, craft, and get paid', body: 'Author recipes, gear, and blueprints — earn perpetual royalties when other players build on what you made.' },
  { icon: Users, title: 'You carry an identity across it all', body: 'One inventory, one character, one economy — everywhere you go in the world stays connected.' },
];

export default function ExploreWorldPage() {
  const [events, setEvents] = useState<WorldEvent[]>([]);
  const [worlds, setWorlds] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/cross-world/feed?limit=18&sinceMs=86400000', { credentials: 'omit' });
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) {
            const evs: WorldEvent[] = Array.isArray(json?.events) ? json.events : [];
            setEvents(evs.filter((e) => e?.summary).slice(0, 12));
            if (typeof json?.worlds === 'number') setWorlds(json.worlds);
          }
        }
      } catch { /* public endpoint unreachable — fall back to static showcase */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-lattice-void text-white">
      <header className="flex items-center justify-between px-6 py-5 border-b border-lattice-border">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-neon-cyan to-neon-blue flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold">Concordos</span>
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/explore" className="text-gray-400 hover:text-white transition-colors">← Back</Link>
          <Link href="/login" className="text-gray-300 hover:text-white transition-colors">Sign in</Link>
          <Link href="/register" className="px-4 py-2 rounded-lg bg-gradient-to-r from-neon-cyan to-neon-blue text-white font-semibold hover:shadow-lg hover:shadow-neon-cyan/25 transition-all">
            Create free account
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="text-center mb-4">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold mb-5">
            <ShieldAlert className="w-3.5 h-3.5" /> Mature content — 18+
          </span>
          <h1 className="text-4xl md:text-6xl font-bold mb-5 leading-tight">
            <span className="text-white">A world that</span>{' '}
            <span className="bg-gradient-to-r from-red-400 via-orange-400 to-neon-purple bg-clip-text text-transparent">lives without you</span>
          </h1>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            Concordia — hundreds of NPCs running their own lives, real combat, real
            consequences. This is running right now, whether you&apos;re watching or not.
          </p>
        </div>

        {/* Live activity — the ghost-town antidote */}
        <section className="mt-12 mb-16">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-neon-green opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-neon-green" />
              </span>
              Live in the world right now
            </h2>
            {worlds != null && <span className="text-xs text-gray-500">{worlds} world{worlds === 1 ? '' : 's'} active</span>}
          </div>
          <div className="bg-lattice-surface border border-lattice-border rounded-xl divide-y divide-lattice-border max-h-80 overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center text-gray-500 text-sm">Tuning in to the world…</div>
            ) : events.length > 0 ? (
              events.map((e, i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-3">
                  <span className="mt-0.5 text-neon-blue shrink-0"><Globe className="w-4 h-4" /></span>
                  <div className="min-w-0">
                    <p className="text-sm text-gray-200">{e.summary}</p>
                    {e.kind && <span className="text-[11px] text-gray-500">{e.kind.replace(/[:_-]/g, ' ')}</span>}
                  </div>
                </div>
              ))
            ) : (
              <div className="p-6 text-center text-gray-400 text-sm">
                Hundreds of NPCs are living their lives, forming factions, and trading right now —
                <Link href="/register" className="text-neon-cyan hover:underline"> step in to watch it unfold.</Link>
              </div>
            )}
          </div>
          <p className="mt-3 text-center text-xs">
            <Link href={`/spectate/concordia-hub`} className="text-neon-cyan hover:underline">
              Watch the live feed without an account →
            </Link>
          </p>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-16">
          {PILLARS.map((p) => (
            <div key={p.title} className="bg-lattice-surface border border-lattice-border rounded-xl p-5">
              <p.icon className="w-6 h-6 text-red-400 mb-3" />
              <h3 className="text-white font-semibold mb-1.5">{p.title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{p.body}</p>
            </div>
          ))}
        </section>

        <section className="text-center bg-gradient-to-b from-lattice-surface to-lattice-void border border-lattice-border rounded-2xl p-10">
          <Activity className="w-8 h-8 text-red-400 mx-auto mb-4" />
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">Ready to step in?</h2>
          <p className="text-gray-400 mb-6 max-w-md mx-auto">
            Creating an account is free and takes a minute. You must be 18+ —
            Concordia is a world with mature, violent content.
          </p>
          <Link href="/register" className="inline-flex items-center gap-2 px-7 py-3 rounded-lg bg-gradient-to-r from-red-500 to-orange-500 text-white font-semibold hover:shadow-lg hover:shadow-red-500/25 transition-all">
            Create your free account <ArrowRight className="w-4 h-4" />
          </Link>
          <p className="mt-4 text-xs text-gray-500">
            Already have one? <Link href="/login" className="text-neon-cyan hover:underline">Sign in</Link>
            {' · '}
            <Link href="/explore/engine" className="text-neon-cyan hover:underline">Here for the knowledge engine instead?</Link>
          </p>
        </section>
      </main>
    </div>
  );
}
