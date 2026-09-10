'use client';

/**
 * Saved — one bookmarks/collections desk.
 *
 * Single active union (collections | social). All saved.* macros live in
 * SavedDeskPanel; legacy social BookmarkButton list in SocialBookmarksPanel.
 */

import { useCallback, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Bookmark, FolderOpen } from 'lucide-react';
import { useLensCommand } from '@/hooks/useLensCommand';
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

      <div className="border-b border-zinc-800 bg-zinc-950/50">
        <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-2 flex-wrap">
          <nav className="flex gap-1" aria-label="Saved views">
            {VIEWS.map((v) => {
              const Icon = v.icon;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setActive(v.id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs',
                    active === v.id ? 'bg-amber-500/20 text-amber-100' : 'text-zinc-400 hover:text-amber-200',
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {v.label}
                </button>
              );
            })}
          </nav>
          <Link href="/lenses/social" className="ml-auto text-xs text-indigo-400 hover:underline">
            ← Social
          </Link>
        </div>
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
    </LensShell>
  );
}
