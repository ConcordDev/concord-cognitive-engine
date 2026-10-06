'use client';

/**
 * Sub-Worlds — one Roblox/Rec Room discovery + hosting app.
 * Thin shell: single `active` union → panels. Macros live in panels.
 */

import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Compass, Boxes, Star, Plus, Code2 as Github } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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
      <NorthStarFrame
        lensId="sub-worlds"
        crumb="Sub-Worlds"
        title={`Worlds to explore${who ? `, ${who}` : ''}`}
        subtitle="Spawn, host, and discover user-created worlds. Each one is reachable via the existing world-travel system: author it in place, set its privacy, and track visits."
        tabs={VIEWS}
        activeTab={active}
        onTab={(id) => setActive(id as SubWorldsView)}
        tabsLabel="Sub-worlds views"
        cta={{ label: 'New world', icon: Plus, onClick: () => setActive('spawn'), title: 'Open the world spawner (4)' }}
      >
        <div className="max-w-5xl">
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
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
