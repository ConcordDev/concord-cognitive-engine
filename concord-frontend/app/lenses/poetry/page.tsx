'use client';

/**
 * Poetry lens: the north-star look (serif title, pill views, teal floating CTA)
 * over the notebook, writing desk, PoetryDB discovery, studio, forms guide and
 * peer workshop. The CTA opens a blank poem on the real compose desk.
 */

import { useCallback, useRef, useState } from 'react';
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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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

const VIEWS: { id: PoetryView; label: string; keys: string; title: string; hint: string; icon: typeof Feather }[] = [
  { id: 'collection', label: 'Collection', keys: 'c', title: 'The notebook', hint: 'Notebook list', icon: BookOpen },
  { id: 'compose', label: 'Compose', keys: 'o', title: 'The poem', hint: 'Writing desk', icon: Feather },
  { id: 'discover', label: 'Discover', keys: 'd', title: 'The poem of the day', hint: 'Poem-a-day · PoetryDB', icon: Compass },
  { id: 'studio', label: 'Studio', keys: 's', title: 'The studio', hint: 'Forms · audio · chapbook', icon: Wand2 },
  { id: 'forms', label: 'Forms', keys: 'f', title: 'The forms', hint: 'Poetic forms guide', icon: AlignLeft },
  { id: 'workshop', label: 'Workshop', keys: 'w', title: 'The workshop', hint: 'Peer critique', icon: Globe },
];

export default function PoetryPage() {
  useLensNav('poetry');
  useLensIdentity('poetry');
  const { isLive, lastUpdated } = useRealtimeLens('poetry');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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

  const current = VIEWS.find((v) => v.id === active)!;

  return (
    <LensShell lensId="poetry" asMain={false}>
      <FirstRunTour lensId="poetry" />
      <DepthBadge lensId="poetry" size="sm" className="ml-2" />
      <div data-lens-theme="poetry" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Poetry</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{active === 'collection' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="poetry" data={{}} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Poetry views">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                aria-current={on ? 'page' : undefined}
                title={`${v.hint} (${v.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
                <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{v.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <FeedBanner domain="poetry" />

        <div className="mt-4">
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
        </div>

        <CrossLensRecentsPanel lensId="poetry" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={() => goCompose({ poemId: null })}
          title="New poem (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          New poem
        </button>
      </div>
    </LensShell>
  );
}
