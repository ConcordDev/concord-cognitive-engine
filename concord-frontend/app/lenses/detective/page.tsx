'use client';

/**
 * Detective — one Obra-Dinn deduction board.
 *
 * Single view union (open | mine). Case browser + dossier extracted to
 * DetectiveBoardPanel. Thin shell (paper/government gold).
 */

import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Search, FolderOpen } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';
import { DetectiveBoardPanel, type DetectiveView } from '@/components/detective/DetectiveBoardPanel';

const VIEWS: { id: DetectiveView; label: string; keys: string; icon: typeof Search }[] = [
  { id: 'open', label: 'Open cases', keys: '1', icon: Search },
  { id: 'mine', label: 'My case file', keys: '2', icon: FolderOpen },
];

export default function DetectiveLensPage() {
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<DetectiveView>('open');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'detective' },
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
    <LensShell lensId="detective" asMain={false}>
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-amber-950/10 text-slate-100">
        <header className="border-b border-amber-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-3">
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2">
              <Search className="h-5 w-5 text-amber-400" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Detective board</h1>
              <p className="mt-0.5 truncate text-xs text-slate-400">Open cases. Collect evidence. Lock in three facts.</p>
            </div>
          </div>
          <nav className="mx-auto mt-3 flex max-w-screen-2xl gap-1" aria-label="Detective board sections">
            {VIEWS.map((t) => {
              const Icon = t.icon;
              return (
                <button key={t.id} type="button" onClick={() => setActive(t.id)} aria-pressed={active === t.id}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium transition-colors',
                    active === t.id ? 'bg-amber-500/20 text-amber-100' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200',
                  )}>
                  <Icon className="h-3.5 w-3.5" />
                  {t.label} <span className="ml-1 text-[9px] text-slate-500">{t.keys}</span>
                </button>
              );
            })}
          </nav>
        </header>

        <section className="mx-auto max-w-screen-2xl px-4 py-5 sm:px-6">
          <AnimatePresence mode="wait">
            <motion.div key={active} {...motionProps}>
              <DetectiveBoardPanel active={active} onActiveChange={setActive} />
            </motion.div>
          </AnimatePresence>
        </section>
      </main>
    </LensShell>
  );
}
