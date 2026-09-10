'use client';

/**
 * MS-P2 — System Move Builder. Thin shell + one `active` union.
 * Panels own catalog/compose/mint/list/get macros — extract, don't invent.
 */

import { useCallback, useRef, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { ComposePanel } from '@/components/move-builder/ComposePanel';
import { MintedMovesPanel, type MintedMovesHandle } from '@/components/move-builder/MintedMovesPanel';
import { cn } from '@/lib/utils';

type MoveView = 'compose' | 'library';

const TABS: { id: MoveView; label: string }[] = [
  { id: 'compose', label: 'Compose' },
  { id: 'library', label: 'Your moves' },
];

export default function MoveBuilderLensPage() {
  const [active, setActive] = useState<MoveView>('compose');
  const libraryRef = useRef<MintedMovesHandle>(null);
  const go = useCallback((id: MoveView) => setActive(id), []);

  useLensCommand(
    [
      { id: 'mb-compose', keys: 'c', description: 'Compose a move', category: 'navigation', action: () => go('compose') },
      { id: 'mb-library', keys: 'l', description: 'Your minted moves', category: 'navigation', action: () => go('library') },
    ],
    { lensId: 'move-builder' },
  );

  return (
    <LensShell lensId="move-builder">
      <div className="px-4 sm:px-6" style={{ maxWidth: 720, margin: '0 auto', paddingTop: 24, paddingBottom: 24, color: '#e8e4dc' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>System · Move Builder</h1>
        <p style={{ opacity: 0.7, fontSize: 13, marginBottom: 16 }}>
          Compose a move — element, kind, and a diminishing-returns modifier budget — preview how it animates, then mint it.
        </p>

        <nav aria-label="Move builder" className="flex gap-1 mb-4 border-b border-[#2a2a35] pb-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => go(t.id)}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-mono transition-colors',
                active === t.id
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20'
                  : 'text-gray-400 hover:text-white border border-transparent',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {active === 'compose' && (
          <ComposePanel
            onMinted={() => {
              libraryRef.current?.reload();
              go('library');
            }}
          />
        )}
        {/* Keep library mounted via hidden when compose so ref reload works after mint;
            actually remount is fine — onMinted navigates to library which loads fresh. */}
        {active === 'library' && <MintedMovesPanel ref={libraryRef} />}
      </div>
    </LensShell>
  );
}
