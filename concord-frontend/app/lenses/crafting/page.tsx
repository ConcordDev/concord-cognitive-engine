'use client';

/**
 * Crafting — one MMO-professions workbench (WoW/FFXIV + Minecraft discovery).
 *
 * Single view union. Inline Mine/Forge/Browse/Skills piles extracted to
 * components/crafting/*Panel.tsx. Page is a thin shell.
 */

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ShoppingBag, Award, Plus, BookOpen, Wrench } from 'lucide-react';
import { Icon as SvgIcon } from '@/components/icons/Icon';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { RecipeLedger } from '@/components/crafting/RecipeLedger';
import { CraftingWorkbench } from '@/components/crafting/CraftingWorkbench';
import { CraftingStatsHeader } from '@/components/crafting/CraftingStatsHeader';
import { MinePanel } from '@/components/crafting/MinePanel';
import { ForgePanel } from '@/components/crafting/ForgePanel';
import { BrowsePanel } from '@/components/crafting/BrowsePanel';
import { SkillsPanel } from '@/components/crafting/SkillsPanel';
import { AuthorPanel } from '@/components/crafting/AuthorPanel';
import type { CraftingView } from '@/components/crafting/crafting-shared';

const TABS: { id: CraftingView; label: string; keys: string; icon: ReactNode }[] = [
  { id: 'mine', label: 'My Recipes', keys: 'm', icon: <SvgIcon name="hammer" size={14} /> },
  { id: 'forge', label: 'Forge', keys: 'f', icon: <SvgIcon name="potion" size={14} /> },
  { id: 'browse', label: 'Browse Marketplace', keys: 'b', icon: <ShoppingBag className="w-3.5 h-3.5" /> },
  { id: 'skills', label: 'Skills', keys: 's', icon: <Award className="w-3.5 h-3.5" /> },
  { id: 'workbench', label: 'Workbench', keys: 'w', icon: <Wrench className="w-3.5 h-3.5" /> },
  { id: 'author', label: 'Author New', keys: 'a', icon: <Plus className="w-3.5 h-3.5" /> },
  { id: 'ledger', label: 'Ledger', keys: 'g', icon: <BookOpen className="w-3.5 h-3.5" /> },
];

export default function CraftingPage() {
  const [active, setActive] = useState<CraftingView>('mine');
  const refreshRef = useRef<(() => void) | null>(null);
  const bump = useCallback(() => { refreshRef.current?.(); }, []);

  useLensCommand(
    TABS.map((t) => ({
      id: `tab-${t.id}`,
      keys: t.keys,
      description: t.label,
      category: 'navigation' as const,
      action: () => setActive(t.id),
    })),
    { lensId: 'crafting' },
  );

  return (
    <LensShell lensId="crafting" asMain={false}>
      <FirstRunTour lensId="crafting" />
      <DepthBadge lensId="crafting" size="sm" className="ml-2" />
      <main className="min-h-screen p-6 max-w-6xl mx-auto text-white">
        <CraftingStatsHeader refreshRef={refreshRef} />

        <nav
          className="flex gap-2 mt-5 mb-5 border-b border-white/10 pb-3 overflow-x-auto"
          aria-label="Crafting views"
        >
          {TABS.map((t) => {
            const on = active === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActive(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-all ${
                  on
                    ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300'
                    : 'bg-white/5 border border-transparent hover:bg-white/10 text-white/70'
                }`}
                aria-current={on ? 'page' : undefined}
              >
                {t.icon}{t.label}
              </button>
            );
          })}
        </nav>

        <CraftingPane active={active} onChanged={bump} onAuthorPublished={() => { setActive('mine'); bump(); }} />
      </main>
      <CrossLensRecentsPanel lensId="crafting" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

function CraftingPane({
  active,
  onChanged,
  onAuthorPublished,
}: {
  active: CraftingView;
  onChanged: () => void;
  onAuthorPublished: () => void;
}) {
  switch (active) {
    case 'mine':
      return <MinePanel onChanged={onChanged} />;
    case 'forge':
      return <ForgePanel onCrafted={onChanged} />;
    case 'browse':
      return <BrowsePanel onPurchased={onChanged} />;
    case 'skills':
      return <SkillsPanel onChanged={onChanged} />;
    case 'workbench':
      return <CraftingWorkbench />;
    case 'author':
      return <AuthorPanel onPublished={onAuthorPublished} />;
    case 'ledger':
      return <RecipeLedger />;
  }
}
