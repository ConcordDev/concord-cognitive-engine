'use client';

/**
 * Sub-Worlds — one Roblox/Rec Room discovery + hosting app.
 * Thin shell: single `active` union → panels. Macros live in panels.
 */

import { useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Compass, Boxes, Star, Plus, Code2 as Github } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { cn } from '@/lib/utils';
import { GalleryPanel } from '@/components/sub-worlds/GalleryPanel';
import { SpawnPanel } from '@/components/sub-worlds/SpawnPanel';
import { MetaverseRepos } from '@/components/sub-worlds/MetaverseRepos';

type SubWorldsView = 'discover' | 'mine' | 'favorites' | 'spawn' | 'repos';

const VIEWS: { id: SubWorldsView; label: string; keys: string; icon: typeof Compass }[] = [
  { id: 'discover', label: 'Discover', keys: '1', icon: Compass },
  { id: 'mine', label: 'My Worlds', keys: '2', icon: Boxes },
  { id: 'favorites', label: 'Favorites', keys: '3', icon: Star },
  { id: 'spawn', label: 'Spawn', keys: '4', icon: Plus },
  { id: 'repos', label: 'Repos', keys: '5', icon: Github },
];

export default function SubWorldsPage() {
  useLensNav('sub-worlds');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<SubWorldsView>('discover');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `sub-worlds-${v.id}`,
      keys: v.keys === '1' ? 'g d' : v.keys === '2' ? 'g m' : v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'sub-worlds' },
  );

  return (
    <LensShell lensId="sub-worlds" asMain={false}>
      <FirstRunTour lensId="sub-worlds" />
      <DepthBadge lensId="sub-worlds" size="sm" className="ml-2" />
      <div className="p-6 sm:p-8 max-w-5xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-100">Sub-Worlds</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Spawn, host, and discover user-created worlds. Each one is reachable via the
            existing world-travel system — author it in-place, set its privacy, and track visits.
          </p>
        </header>

        <nav
          className="mb-4 flex gap-1 border-b border-zinc-800 overflow-x-auto"
          aria-label="Sub-worlds views"
        >
          {VIEWS.map(({ id, label, keys, icon: Icon }) => {
            const on = active === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActive(id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-amber-500',
                  on
                    ? 'border-cyan-500 text-cyan-300'
                    : 'border-transparent text-zinc-400 hover:text-zinc-300',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="h-4 w-4" /> {label}
                <kbd className="hidden sm:inline-block text-[10px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5 font-mono">
                  {keys}
                </kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
          >
            {(active === 'discover' || active === 'mine' || active === 'favorites') && (
              <GalleryPanel mode={active} />
            )}
            {active === 'spawn' && (
              <SpawnPanel onSpawned={() => setActive('mine')} />
            )}
            {active === 'repos' && (
              <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                <h2 className="mb-3 text-sm font-semibold text-white">
                  Metaverse / virtual-world repos (GitHub)
                </h2>
                <MetaverseRepos />
              </section>
            )}
          </motion.div>
        </AnimatePresence>

        <CrossLensRecentsPanel
          lensId="sub-worlds"
          sinceDays={7}
          limit={6}
          hideWhenEmpty
          className="mt-3"
        />
      </div>
    </LensShell>
  );
}
