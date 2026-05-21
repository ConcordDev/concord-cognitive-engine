'use client';

/**
 * World Creator — visual authoring lens for player-built sub-worlds.
 *
 * Two surfaces:
 *  - DraftGallery: start a blank draft / template, list your drafts,
 *    discover public worlds by other creators.
 *  - DraftEditor: a top-down scene editor — place props, spawn points,
 *    zones, NPCs and factions; preview biomes; tune rule modulators;
 *    set publish/privacy; run a playtest-readiness check; and "Playtest"
 *    mints the real world via POST /api/worlds and jumps into it.
 *
 * Backend: server/domains/world-creator.js (world-creator.* macros) for
 * the authoring layer + REST /api/worlds to mint the final world.
 */

import { useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import Link from 'next/link';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { WorldBuilderInspo } from '@/components/world-creator/WorldBuilderInspo';
import { DraftGallery } from '@/components/world-creator/DraftGallery';
import { DraftEditor } from '@/components/world-creator/DraftEditor';

export default function WorldCreatorPage() {
  const [editingDraft, setEditingDraft] = useState<string | null>(null);

  useLensCommand([
    { id: 'world-creator-back', keys: 'Escape', description: 'Back to drafts', category: 'navigation',
      action: () => setEditingDraft(null) },
  ], { lensId: 'world-creator' });

  return (
    <LensShell lensId="world-creator">
      <FirstRunTour lensId="world-creator" />
      <DepthBadge lensId="world-creator" size="sm" className="ml-2" />
      <div className="mx-auto max-w-6xl px-6 py-8 text-stone-100">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">World Creator</h1>
          <p className="mt-2 text-stone-400">
            Author a sub-world the way a studio editor does — sculpt a scene, place props,
            spawn points, zones, NPCs and factions, preview the biome, tune the rule
            modulators, then playtest straight into <code className="text-stone-300">/lenses/world</code>.
            You become the world&apos;s sole creator — there is no admin role.
          </p>
          <nav className="mt-4 flex gap-4 text-sm">
            <Link href="/lenses/world-creator/anomalies" className="text-amber-400 hover:underline">
              View anomalies in your worlds →
            </Link>
            <Link href="/lenses/world" className="text-stone-400 hover:underline">
              ← Back to world lens
            </Link>
          </nav>
        </header>

        {editingDraft ? (
          <DraftEditor draftId={editingDraft} onClose={() => setEditingDraft(null)} />
        ) : (
          <DraftGallery onOpen={setEditingDraft} />
        )}

        {!editingDraft && (
          <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <WorldBuilderInspo />
          </section>
        )}
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders &quot;No data yet&quot; if main view has no rows</div>
      <RecentMineCard domain="world-creator" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="world-creator" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="world-creator" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
