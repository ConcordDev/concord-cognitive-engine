'use client';

/**
 * Poetry lens — one writing-desk / workshop app.
 *
 * Single view union (collection | compose | discover | studio | forms |
 * workshop). Inline Collection/Compose piles extracted to panels. Page is
 * a thin shell; panels own their macros and loading/empty/error.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  AlignLeft, BookOpen, Compass, Feather, Globe, Plus, Wand2,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { FeedBanner } from '@/components/lens/FeedBanner';
import { cn } from '@/lib/utils';
import { CollectionPanel } from '@/components/poetry/CollectionPanel';
import { ComposePanel, type ComposeIntent } from '@/components/poetry/ComposePanel';
import { DiscoverPanel } from '@/components/poetry/DiscoverPanel';
import { FormsPanel } from '@/components/poetry/FormsPanel';
import { StudioPanel } from '@/components/poetry/StudioPanel';
import { WorkshopPanel } from '@/components/poetry/WorkshopPanel';
import type { PoemForm } from '@/components/poetry/poetry-craft';

type PoetryView = 'collection' | 'compose' | 'discover' | 'studio' | 'forms' | 'workshop';

const VIEWS: { id: PoetryView; label: string; keys: string; hint: string; icon: typeof Feather }[] = [
  { id: 'collection', label: 'Collection', keys: 'c', hint: 'Notebook list', icon: BookOpen },
  { id: 'compose', label: 'Compose', keys: 'o', hint: 'Writing desk', icon: Feather },
  { id: 'discover', label: 'Discover', keys: 'd', hint: 'Poem-a-day · PoetryDB', icon: Compass },
  { id: 'studio', label: 'Studio', keys: 's', hint: 'Forms · audio · chapbook', icon: Wand2 },
  { id: 'forms', label: 'Forms', keys: 'f', hint: 'Poetic forms guide', icon: AlignLeft },
  { id: 'workshop', label: 'Workshop', keys: 'w', hint: 'Peer critique', icon: Globe },
];

export default function PoetryPage() {
  useLensNav('poetry');
  useLensIdentity('poetry');
  const { isLive, lastUpdated } = useRealtimeLens('poetry');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<PoetryView>('collection');
  const [composeIntent, setComposeIntent] = useState<ComposeIntent>({ nonce: 0, poemId: null });
  const searchInputRef = useRef<HTMLInputElement>(null);

  const goCompose = useCallback((opts?: { poemId?: string | null; form?: PoemForm }) => {
    setComposeIntent((prev) => ({
      nonce: prev.nonce + 1,
      poemId: opts?.poemId ?? null,
      form: opts?.form,
    }));
    setActive('compose');
  }, []);

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      {
        id: 'focus-search',
        keys: '/',
        description: 'Focus search',
        category: 'navigation' as const,
        action: () => {
          setActive('collection');
          queueMicrotask(() => searchInputRef.current?.focus());
        },
      },
      {
        id: 'new-poem',
        keys: 'n',
        description: 'New poem',
        category: 'actions' as const,
        action: () => goCompose({ poemId: null }),
      },
    ],
    { lensId: 'poetry' },
  );

  const motionProps = useMemo(
    () => (reduceMotion
      ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          exit: { opacity: 0, y: -6 },
          transition: { duration: 0.16 },
        }),
    [reduceMotion],
  );

  return (
    <LensShell lensId="poetry" asMain={false}>
      <FirstRunTour lensId="poetry" />
      <DepthBadge lensId="poetry" size="sm" className="ml-2" />
      <div data-lens-theme="poetry" className="min-h-screen">
        <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
          <header className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <Feather className="w-6 h-6 text-rose-400 shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-bold">Poetry</h1>
                  <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
                </div>
                <p className="text-xs text-gray-400">
                  Writing desk — notebook, compose, discover, studio, workshop.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <DTUExportButton domain="poetry" data={{}} compact />
              <button
                type="button"
                onClick={() => goCompose({ poemId: null })}
                className="px-3 py-1.5 text-xs bg-rose-500/20 border border-rose-500/30 rounded-lg hover:bg-rose-500/30 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> New Poem
              </button>
            </div>
          </header>

          <FeedBanner domain="poetry" />

          <nav
            className="flex gap-1 bg-white/5 p-1 rounded-lg border border-white/10 overflow-x-auto"
            aria-label="Poetry views"
          >
            {VIEWS.map((v) => {
              const Icon = v.icon;
              const on = active === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setActive(v.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors whitespace-nowrap',
                    on ? 'bg-rose-500/20 text-rose-400' : 'text-gray-400 hover:text-white hover:bg-white/5',
                  )}
                  aria-current={on ? 'page' : undefined}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {v.label}
                  <kbd className="hidden sm:inline-block text-[10px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5 font-mono ml-0.5">
                    {v.keys}
                  </kbd>
                </button>
              );
            })}
          </nav>

          <AnimatePresence mode="wait">
            <motion.div key={active} {...motionProps}>
              {active === 'collection' && (
                <CollectionPanel
                  searchInputRef={searchInputRef}
                  onOpenPoem={(id) => goCompose({ poemId: id })}
                  onNewPoem={() => goCompose({ poemId: null })}
                />
              )}
              {active === 'compose' && <ComposePanel intent={composeIntent} />}
              {active === 'discover' && <DiscoverPanel />}
              {active === 'studio' && <StudioPanel />}
              {active === 'forms' && (
                <FormsPanel onTryForm={(form) => goCompose({ poemId: null, form })} />
              )}
              {active === 'workshop' && <WorkshopPanel />}
            </motion.div>
          </AnimatePresence>
        </div>

        <CrossLensRecentsPanel lensId="poetry" sinceDays={7} limit={6} hideWhenEmpty className="mt-6" />
      </div>
    </LensShell>
  );
}
