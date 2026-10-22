'use client';

/**
 * MS-P2 — System Move Builder. Thin shell + one `active` union.
 * Panels own catalog/compose/mint/list/get macros — extract, don't invent.
 */

import { useCallback, useRef, useState } from 'react';
import { Hammer, Library, Sparkles } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensCommand } from '@/hooks/useLensCommand';
import { ComposePanel } from '@/components/move-builder/ComposePanel';
import { MintedMovesPanel, type MintedMovesHandle } from '@/components/move-builder/MintedMovesPanel';

type MoveView = 'compose' | 'library';

const TABS: { id: MoveView; label: string; keys: string; hint: string; icon: typeof Hammer }[] = [
  { id: 'compose', label: 'Compose', keys: 'c', hint: 'Element, kind and a modifier budget, with an animation preview', icon: Sparkles },
  { id: 'library', label: 'Your moves', keys: 'l', hint: 'Your minted moves and their composed detail', icon: Library },
];

export default function MoveBuilderLensPage() {
  const [active, setActive] = useState<MoveView>('compose');
  const libraryRef = useRef<MintedMovesHandle>(null);
  const go = useCallback((id: MoveView) => setActive(id), []);

  useLensCommand(
    TABS.map((t) => ({
      id: `mb-${t.id}`,
      keys: t.keys,
      description: t.hint,
      category: 'navigation' as const,
      action: () => go(t.id),
    })),
    { lensId: 'move-builder' },
  );


  return (
    <LensShell lensId="move-builder" asMain={false}>

      <DepthBadge lensId="move-builder" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="move-builder"
        crumb="Move builder"
        subtitle="Compose a move with an element, a kind and a diminishing-returns modifier budget, preview how it animates, then mint it."
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, keys: t.keys, hint: t.hint }))}
        activeTab={active}
        onTab={(id) => go(id as MoveView)}
        tabsLabel="Move builder"
        cta={active === 'library' ? { label: 'Compose a new move', icon: Sparkles, onClick: () => go('compose') } : undefined}
      >
        {active === 'compose' && (
          <ComposePanel
            onMinted={() => {
              libraryRef.current?.reload();
              go('library');
            }}
          />
        )}
        {active === 'library' && <MintedMovesPanel ref={libraryRef} />}
      </NorthStarFrame>
    </LensShell>
  );
}
