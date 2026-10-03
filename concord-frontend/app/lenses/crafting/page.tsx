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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
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

const TABS: { id: CraftingView; label: string; keys: string; title: string; icon: ReactNode }[] = [
  { id: 'mine', title: 'The piece on the bench', label: 'My Recipes', keys: 'm', icon: <SvgIcon name="hammer" size={14} /> },
  { id: 'forge', title: 'What the forge can make', label: 'Forge', keys: 'f', icon: <SvgIcon name="potion" size={14} /> },
  { id: 'browse', title: 'What others are selling', label: 'Browse Marketplace', keys: 'b', icon: <ShoppingBag className="w-3.5 h-3.5" /> },
  { id: 'skills', title: 'What your hands know', label: 'Skills', keys: 's', icon: <Award className="w-3.5 h-3.5" /> },
  { id: 'workbench', title: 'The workbench', label: 'Workbench', keys: 'w', icon: <Wrench className="w-3.5 h-3.5" /> },
  { id: 'author', title: 'A new recipe', label: 'Author New', keys: 'a', icon: <Plus className="w-3.5 h-3.5" /> },
  { id: 'ledger', title: 'Every craft, recorded', label: 'Ledger', keys: 'g', icon: <BookOpen className="w-3.5 h-3.5" /> },
];

export default function CraftingPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<CraftingView>('mine');
  const refreshRef = useRef<(() => void) | null>(null);
  const bump = useCallback(() => { refreshRef.current?.(); }, []);

  const startPiece = useCallback(() => setActive('author'), []);

  useLensCommand(
    [
      ...TABS.map((t) => ({
        id: `tab-${t.id}`,
        keys: t.keys,
        description: t.label,
        category: 'navigation' as const,
        action: () => setActive(t.id),
      })),
      { id: 'start-piece', keys: 'n', description: 'Start a piece', category: 'actions' as const, action: startPiece },
    ],
    { lensId: 'crafting' },
  );

  return (
    <LensShell lensId="crafting" asMain={false}>
      <FirstRunTour lensId="crafting" />
      <DepthBadge lensId="crafting" size="sm" className="ml-2" />
      <div data-lens-theme="crafting" className="relative min-h-full px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Crafting</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          {TABS.find((t) => t.id === active)!.title}{active === 'mine' && who ? `, ${who}` : ''}
        </h1>

        <div className="mb-5">
          <CraftingStatsHeader refreshRef={refreshRef} />
        </div>

        <nav
          className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1"
          aria-label="Crafting views"
        >
          {TABS.map((t) => {
            const on = active === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActive(t.id)}
                title={`${t.label} (${t.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
                aria-current={on ? 'page' : undefined}
              >
                {t.icon}{t.label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{t.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <CraftingPane active={active} onChanged={bump} onAuthorPublished={() => { setActive('mine'); bump(); }} />

        <CrossLensRecentsPanel lensId="crafting" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={startPiece}
          title="Start a piece (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          Start a piece
        </button>
      </div>
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
