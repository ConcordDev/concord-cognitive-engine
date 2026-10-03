'use client';

/**
 * World Creator: visual authoring for player-built sub-worlds, in the
 * north-star look.
 *  - Drafts: DraftGallery (blank draft / template, your drafts, discover
 *    public worlds) or, once a draft is open, DraftEditor (top-down scene
 *    editor, rule modulators, readiness check; "Playtest" mints the real
 *    world via POST /api/worlds).
 *  - Inspiration: live worldbuilding chatter.
 * Backend: server/domains/world-creator.js (world-creator.* macros) plus
 * REST /api/worlds.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Hammer, Lightbulb } from 'lucide-react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { WorldBuilderInspo } from '@/components/world-creator/WorldBuilderInspo';
import { DraftGallery } from '@/components/world-creator/DraftGallery';
import { DraftEditor } from '@/components/world-creator/DraftEditor';

type CreatorView = 'drafts' | 'inspiration';

const VIEWS: { id: CreatorView; label: string; keys: string; hint: string; icon: typeof Hammer }[] = [
  { id: 'drafts', label: 'Drafts', keys: '1', hint: 'Your drafts, templates and public worlds', icon: Hammer },
  { id: 'inspiration', label: 'Inspiration', keys: '2', hint: 'Worldbuilding chatter', icon: Lightbulb },
];

export default function WorldCreatorPage() {
  const router = useRouter();
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [editingDraft, setEditingDraft] = useState<string | null>(null);
  const [view, setView] = useState<CreatorView>('drafts');

  useLensCommand([
    { id: 'world-creator-back', keys: 'Escape', description: 'Back to drafts', category: 'navigation',
      action: () => { setEditingDraft(null); setView('drafts'); } },
    ...VIEWS.map((v) => ({
      id: `world-creator-${v.id}`,
      keys: v.keys,
      description: `${v.label}: ${v.hint}`,
      category: 'navigation' as const,
      action: () => { setEditingDraft(null); setView(v.id); },
    })),
  ], { lensId: 'world-creator' });

  const title = editingDraft
    ? 'Shape the world'
    : view === 'inspiration'
      ? 'Borrow a spark'
      : `Build a world${who ? `, ${who}` : ''}`;

  return (
    <LensShell lensId="world-creator" asMain={false}>
      <FirstRunTour lensId="world-creator" />
      <DepthBadge lensId="world-creator" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="world-creator"
        crumb="World creator"
        title={title}
        subtitle="Sculpt a scene, place props, spawn points, zones, NPCs and factions, tune the rule modulators, then playtest straight into the world lens. You become the world's sole creator; there is no admin role."
        actions={(
          <Link href="/lenses/world" className="text-[13px] text-zinc-500 hover:text-zinc-200">
            Back to world lens
          </Link>
        )}
        tabs={editingDraft ? undefined : VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys, hint: v.hint }))}
        activeTab={view}
        onTab={(id) => setView(id as CreatorView)}
        tabsLabel="World creator views"
        cta={{
          label: 'Check world anomalies',
          icon: AlertTriangle,
          onClick: () => router.push('/lenses/world-creator/anomalies'),
          title: 'View anomalies in your worlds',
        }}
      >
        {editingDraft ? (
          <DraftEditor draftId={editingDraft} onClose={() => setEditingDraft(null)} />
        ) : view === 'drafts' ? (
          <DraftGallery onOpen={setEditingDraft} />
        ) : (
          <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <WorldBuilderInspo />
          </section>
        )}
      </NorthStarFrame>
    </LensShell>
  );
}
