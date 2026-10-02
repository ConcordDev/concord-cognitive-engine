'use client';

/**
 * Literary — one Literary Resonance Lattice research desk.
 *
 * Single view union (search | crystals | annotations | lattice). Inline
 * search/annotate/crystals/lattice surfaces extracted to panels. Page is a
 * thin shell (paper/government gold).
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { BookOpen, Gem, Library, Network, Search } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { cn } from '@/lib/utils';
import { SearchPanel } from '@/components/literary/SearchPanel';
import { CrystalsPanel } from '@/components/literary/CrystalsPanel';
import { AnnotationsPanel } from '@/components/literary/AnnotationsPanel';
import { LatticePanel } from '@/components/literary/LatticePanel';

type LiteraryView = 'search' | 'crystals' | 'annotations' | 'lattice';

const VIEWS: { id: LiteraryView; label: string; hint: string; icon: typeof BookOpen }[] = [
  { id: 'search', label: 'Corpus', hint: 'Hybrid corpus search', icon: Search },
  { id: 'crystals', label: 'Crystals', hint: 'Salience candidates', icon: Gem },
  { id: 'annotations', label: 'Annotations', hint: 'Saved notes', icon: Library },
  { id: 'lattice', label: 'Lattice', hint: 'Resonance graph', icon: Network },
];

const PANELS: Record<LiteraryView, ComponentType> = {
  search: SearchPanel,
  crystals: CrystalsPanel,
  annotations: AnnotationsPanel,
  lattice: LatticePanel,
};

export default function LiteraryLensPage() {
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<LiteraryView>('search');


  const Panel = PANELS[active];
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
    <LensShell lensId="literary">
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-purple-950/10 text-slate-100 p-6 space-y-6">
        <header className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-violet-300" />
          <h1 className="text-lg font-semibold tracking-wide">Literary Lattice</h1>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-zinc-800 overflow-x-auto"
          aria-label="Literary views"
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
                  'flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                  on
                    ? 'border-violet-400 text-white'
                    : 'border-transparent text-zinc-400 hover:text-white hover:border-zinc-600',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="w-4 h-4" />
                {v.label}
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps}>
            <Panel />
          </motion.div>
        </AnimatePresence>
      </main>
    </LensShell>
  );
}
