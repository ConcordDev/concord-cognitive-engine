'use client';

/**
 * Creative Writing lens: the north-star look (serif title, pill desks, teal
 * floating CTA). The manuscript studio (real project/chapter/scene/character/
 * thread/snapshot macros), the Datamuse word tools and Project Gutenberg
 * search are all kept; the CTA focuses the real "new manuscript" input.
 *
 * The earlier generic works/prompts CRUD tabs were removed 2026-07 — they were
 * a disconnected shadow app that never reached the real macros. See
 * docs/lens-specs/creative-writing-capability-map.md.
 */

import { useCallback, useState } from 'react';
import { BookOpen, Library, Plus, SpellCheck } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { DatamusePanel } from '@/components/linguistics/DatamusePanel';
import { GutendexSearch } from '@/components/creative-writing/GutendexSearch';
import { CreativeWritingSection } from '@/components/creative-writing/CreativeWritingSection';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';

type Desk = 'studio' | 'words' | 'gutenberg';

const DESKS: { id: Desk; label: string; keys: string; title: string; hint: string; icon: typeof BookOpen }[] = [
  { id: 'studio', label: 'Studio', keys: '1', title: 'The page', hint: 'Manuscripts, chapters, scenes, characters and threads', icon: BookOpen },
  { id: 'words', label: 'Word tools', keys: '2', title: 'The right word', hint: 'Rhymes, synonyms and related words', icon: SpellCheck },
  { id: 'gutenberg', label: 'Gutenberg', keys: '3', title: 'The shelf', hint: 'Search Project Gutenberg public-domain books', icon: Library },
];

export default function CreativeWritingPage() {
  useLensNav('creative-writing');
  const { latestData: realtimeData, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('creative-writing');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [desk, setDesk] = useState<Desk>('studio');

  const newPage = useCallback(() => {
    setDesk('studio');
    let tries = 0;
    const focus = () => {
      const el = document.querySelector<HTMLInputElement>('[data-lens-theme="creative-writing"] input[placeholder="New manuscript title"]');
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); return; }
      if (++tries < 20) requestAnimationFrame(focus);
    };
    requestAnimationFrame(focus);
  }, []);

  useLensCommand(
    [
      ...DESKS.map((d) => ({
        id: `desk-${d.id}`,
        keys: d.keys,
        description: `${d.label} — ${d.hint}`,
        category: 'navigation' as const,
        action: () => setDesk(d.id),
      })),
      { id: 'new-page', keys: 'n', description: 'New manuscript', category: 'actions' as const, action: newPage },
    ],
    { lensId: 'creative-writing' },
  );

  const current = DESKS.find((d) => d.id === desk)!;

  return (
    <LensShell lensId="creative-writing" asMain={false}>
      <FirstRunTour lensId="creative-writing" />
      <DepthBadge lensId="creative-writing" size="sm" className="ml-2" />
      <div data-lens-theme="creative-writing" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Creative Writing</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{desk === 'studio' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="creative-writing" data={realtimeData || {}} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Creative writing desks">
          {DESKS.map((d) => {
            const Icon = d.icon;
            const on = desk === d.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setDesk(d.id)}
                aria-current={on ? 'page' : undefined}
                title={`${d.hint} (${d.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {d.label}
                <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{d.keys}</kbd>
              </button>
            );
          })}
        </nav>

        {desk === 'studio' && (
          <div className="space-y-5">
            <RealtimeDataPanel data={realtimeData} insights={realtimeInsights} compact />
            <CreativeWritingSection />
          </div>
        )}
        {desk === 'words' && <DatamusePanel domain="creative-writing" />}
        {desk === 'gutenberg' && (
          <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <GutendexSearch />
          </section>
        )}

        <CrossLensRecentsPanel lensId="creative-writing" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={newPage}
          title="New manuscript (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          New page
        </button>
      </div>
    </LensShell>
  );
}
