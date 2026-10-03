'use client';

/**
 * Saved — one bookmarks/collections desk.
 *
 * Single active union (collections | social). All saved.* macros live in
 * SavedDeskPanel; legacy social BookmarkButton list in SocialBookmarksPanel.
 */

import { useCallback, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Bookmark, FolderOpen, Plus } from 'lucide-react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { SavedDeskPanel } from '@/components/saved/SavedDeskPanel';
import { SocialBookmarksPanel } from '@/components/saved/SocialBookmarksPanel';
import { cn } from '@/lib/utils';
import Link from 'next/link';

type SavedView = 'collections' | 'social';

const VIEWS: { id: SavedView; label: string; keys: string; icon: typeof FolderOpen }[] = [
  { id: 'collections', label: 'Collections', keys: '1', icon: FolderOpen },
  { id: 'social', label: 'Social bookmarks', keys: '2', icon: Bookmark },
];

export default function SavedLensPage() {
  useLensIdentity('saved');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<SavedView>('collections');
  const [saveFormOpen, setSaveFormOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const refreshRef = useRef<(() => void) | null>(null);

  const registerRefresh = useCallback((fn: () => void) => {
    refreshRef.current = fn;
  }, []);

  useLensCommand(
    [
      { id: 'save-new', keys: 'n', description: 'Save something', category: 'actions', action: () => setSaveFormOpen(true) },
      { id: 'focus-search', keys: '/', description: 'Focus search', category: 'navigation', action: () => searchInputRef.current?.focus() },
      { id: 'refresh', keys: 'r', description: 'Refresh saved items', category: 'actions', action: () => { refreshRef.current?.(); } },
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: v.label,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
    ],
    { lensId: 'saved' },
  );

  return (
    <LensShell lensId="saved" asMain={false}>
      <FirstRunTour lensId="saved" />
      <DepthBadge lensId="saved" size="sm" className="ml-2" />

      <div data-lens-theme="saved" className="relative min-h-full px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Saved</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          {active === 'collections' ? "What's worth keeping" : 'What you bookmarked'}{who ? `, ${who}` : ''}
        </h1>
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <nav className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Saved views">
            {VIEWS.map((v) => {
              const Icon = v.icon;
              const on = active === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setActive(v.id)}
                  aria-current={on ? 'page' : undefined}
                  className={cn(
                    'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                    on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {v.label}
                  <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{v.keys}</kbd>
                </button>
              );
            })}
          </nav>
          <Link href="/lenses/social" className="text-[13px] text-zinc-500 transition-colors hover:text-zinc-200">
            ← Social
          </Link>
        </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={active}
          initial={reduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.16 }}
        >
          {active === 'collections' ? (
            <SavedDeskPanel
              searchInputRef={searchInputRef}
              saveFormOpen={saveFormOpen}
              onSaveFormOpenChange={setSaveFormOpen}
              registerRefresh={registerRefresh}
            />
          ) : (
            <SocialBookmarksPanel />
          )}
        </motion.div>
      </AnimatePresence>

        <button
          type="button"
          onClick={() => { setActive('collections'); setSaveFormOpen(true); }}
          title="Save something (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          Save something
        </button>
      </div>
    </LensShell>
  );
}
