'use client';

/**
 * Literary — one Literary Resonance Lattice research desk.
 *
 * North-star look (serif title, pill views, teal floating CTA) over the four
 * real panels. The CTA jumps to the corpus search and focuses its input.
 */

import { useCallback, useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Gem, Library, Network, Search } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import { SearchPanel } from '@/components/literary/SearchPanel';
import { CrystalsPanel } from '@/components/literary/CrystalsPanel';
import { AnnotationsPanel } from '@/components/literary/AnnotationsPanel';
import { LatticePanel } from '@/components/literary/LatticePanel';

type LiteraryView = 'search' | 'crystals' | 'annotations' | 'lattice';

const VIEWS: { id: LiteraryView; label: string; keys: string; title: string; hint: string; icon: typeof Search }[] = [
  { id: 'search', label: 'Corpus', keys: '1', title: 'The passage', hint: 'Hybrid corpus search', icon: Search },
  { id: 'crystals', label: 'Crystals', keys: '2', title: 'What stands out', hint: 'Salience candidates', icon: Gem },
  { id: 'annotations', label: 'Annotations', keys: '3', title: 'What you noted', hint: 'Saved notes', icon: Library },
  { id: 'lattice', label: 'Lattice', keys: '4', title: 'How the texts resonate', hint: 'Resonance graph', icon: Network },
];

const PANELS: Record<LiteraryView, ComponentType> = {
  search: SearchPanel,
  crystals: CrystalsPanel,
  annotations: AnnotationsPanel,
  lattice: LatticePanel,
};

function focusCorpusSearch(tries = 6) {
  const el = document.querySelector<HTMLInputElement>('input[placeholder^="Search themes"]');
  if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  if (tries > 0) requestAnimationFrame(() => focusCorpusSearch(tries - 1));
}

export default function LiteraryLensPage() {
  useLensNav('literary');
  useLensIdentity('literary');
  const reduceMotion = useReducedMotion();
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<LiteraryView>('search');

  const openText = useCallback(() => {
    setActive('search');
    requestAnimationFrame(() => focusCorpusSearch());
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
      { id: 'literary-open', keys: '/', description: 'Search the corpus', category: 'actions' as const, action: openText },
    ],
    { lensId: 'literary' },
  );

  const Panel = PANELS[active];
  const view = VIEWS.find((v) => v.id === active)!;
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
    <LensShell lensId="literary" asMain={false}>
      <FirstRunTour lensId="literary" />
      <DepthBadge lensId="literary" size="sm" className="ml-2" />
      <div data-lens-theme="literary" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Literary</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {view.title}{active === 'search' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <DTUExportButton domain="literary" data={{}} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Literary views">
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
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{v.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps}>
            <Panel />
          </motion.div>
        </AnimatePresence>

        <CrossLensRecentsPanel lensId="literary" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={openText}
          title="Search the corpus (/)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Search className="h-4 w-4" />
          Open a text
        </button>
      </div>
    </LensShell>
  );
}
