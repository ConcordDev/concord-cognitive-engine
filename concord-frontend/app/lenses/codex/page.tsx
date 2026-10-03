'use client';

/**
 * The Codex — authored cosmology reader.
 * Thin shell + one `active` union; panels own lore.* macros + bookmarks.
 */

import { LensShell } from '@/components/lens/LensShell';
import { BookOpen, Landmark, Plus } from 'lucide-react';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { lensRun } from '@/lib/api/client';
import { useLensCommand } from '@/hooks/useLensCommand';
import { DeepLinkModal } from '@/components/codex/DeepLinkModal';
import { SpinePanel } from '@/components/codex/SpinePanel';
import { BrowsePanel } from '@/components/codex/BrowsePanel';
import { type Facets, type LoreEvent } from '@/components/codex/types';
import { cn } from '@/lib/utils';

type CodexView = 'spine' | 'browse';

const TABS: { id: CodexView; label: string; keys: string; title: string; hint: string; icon: typeof BookOpen }[] = [
  { id: 'browse', label: 'Browse canon', keys: 'b', title: 'The codex page', hint: 'Search and filter every recorded truth', icon: BookOpen },
  { id: 'spine', label: 'The Pillars', keys: 'p', title: 'The three pillars', hint: 'The load-bearing events of the canon', icon: Landmark },
];

function CodexLensInner() {
  const searchParams = useSearchParams();
  const deepLinkId = searchParams.get('id');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<CodexView>('browse');
  const [facets, setFacets] = useState<Facets | null>(null);
  const [spine, setSpine] = useState<LoreEvent[]>([]);

  const openPage = useCallback(() => {
    setActive('browse');
    let tries = 0;
    const focus = () => {
      const el = document.querySelector<HTMLInputElement>('[data-lens-theme="codex"] input');
      if (el) el.focus();
      else if (tries++ < 20) requestAnimationFrame(focus);
    };
    requestAnimationFrame(focus);
  }, []);

  useLensCommand(
    [
      { id: 'codex-spine', keys: 'p', description: 'The Three Pillars', category: 'navigation', action: () => setActive('spine') },
      { id: 'codex-browse', keys: 'b', description: 'Browse canon', category: 'navigation', action: () => setActive('browse') },
      { id: 'codex-open', keys: 'o', description: 'Open a codex page (search)', category: 'actions', action: openPage },
    ],
    { lensId: 'codex' },
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const f = await lensRun('lore', 'facets', {});
      if (cancelled) return;
      if (f.data?.ok && f.data.result) setFacets((f.data.result as { facets: Facets }).facets);
      const s = await lensRun('lore', 'spine', {});
      if (cancelled) return;
      if (s.data?.ok && s.data.result) setSpine((s.data.result as { events: LoreEvent[] }).events || []);
    })();
    return () => { cancelled = true; };
  }, []);

  const current = TABS.find((t) => t.id === active)!;
  const onFacets = useCallback((f: Facets) => setFacets(f), []);

  return (
    <LensShell lensId="codex" asMain={false}>
      <FirstRunTour lensId="codex" />
      <DepthBadge lensId="codex" size="sm" className="ml-2" />
      <div data-lens-theme="codex" className="relative min-h-full px-8 pb-28 pt-6">
        {deepLinkId && <DeepLinkModal deepLinkId={deepLinkId} />}

        <p className="text-[14px] text-zinc-500">Codex</p>
        <h1 className="mb-2 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          {current.title}{active === 'browse' && who ? `, ${who}` : ''}
        </h1>
        <p className="mb-5 text-[14px] text-zinc-500">
          The canon of Concordia — {facets?.count ?? '…'} recorded truths across {facets?.worlds.length ?? '…'} worlds.
        </p>

        <nav aria-label="Codex views" className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = active === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActive(t.id)}
                aria-current={on ? 'page' : undefined}
                title={`${t.hint} (${t.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{t.keys}</kbd>
              </button>
            );
          })}
        </nav>

        {active === 'spine' && <SpinePanel spine={spine} />}
        {active === 'browse' && <BrowsePanel facets={facets} onFacets={onFacets} />}

        <CrossLensRecentsPanel lensId="codex" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={openPage}
          title="Open a codex page (O)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          Open a page
        </button>
      </div>
    </LensShell>
  );
}

export default function CodexLensPage() {
  return (
    <Suspense fallback={null}>
      <CodexLensInner />
    </Suspense>
  );
}
