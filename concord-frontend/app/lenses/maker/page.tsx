'use client';

/**
 * Maker — one Retool/Twine/creative desk.
 * Thin shell: single `active` union → panels. Macros live in panels.
 */

import { useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AppWindow, Wand2, Sparkles, Hammer, GitBranch, LayoutGrid } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';
import { ProjectBuilder } from '@/components/maker/ProjectBuilder';
import { QuestGraphEditor } from '@/components/maker/QuestGraphEditor';
import { MakerShowcase } from '@/components/maker/MakerShowcase';
import { AppsPanel } from '@/components/maker/AppsPanel';
import { QuestsPanel } from '@/components/maker/QuestsPanel';
import { CreativePanel } from '@/components/maker/CreativePanel';

type MakerView = 'builder' | 'designer' | 'apps' | 'quests' | 'creative' | 'showcase';

const VIEWS: { id: MakerView; label: string; keys: string; icon: typeof Hammer }[] = [
  { id: 'builder', label: 'Builder', keys: 'b', icon: Hammer },
  { id: 'designer', label: 'Quest Designer', keys: 'd', icon: GitBranch },
  { id: 'apps', label: 'Apps', keys: 'a', icon: AppWindow },
  { id: 'quests', label: 'Quests', keys: 'q', icon: Wand2 },
  { id: 'creative', label: 'Creative', keys: 'c', icon: Sparkles },
  { id: 'showcase', label: 'Showcase', keys: 's', icon: LayoutGrid },
];

const PANELS: Record<MakerView, ComponentType> = {
  builder: ProjectBuilder,
  designer: QuestGraphEditor,
  apps: AppsPanel,
  quests: QuestsPanel,
  creative: CreativePanel,
  showcase: MakerShowcase,
};

export default function MakerLensPage() {
  useLensNav('maker');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<MakerView>('builder');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `tab-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'maker' },
  );

  const Panel = PANELS[active];

  return (
    <LensShell lensId="maker" asMain={false}>
      <FirstRunTour lensId="maker" />
      <DepthBadge lensId="maker" size="sm" className="ml-2" />
      <LensVerticalHero lensId="maker" className="mx-6 mt-4" />
      <div className="min-h-screen bg-black pb-12 text-pink-50">
        <header className="sticky top-0 z-10 border-b border-pink-900/50 bg-black/95 px-4 py-3 backdrop-blur md:px-8">
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            <Wand2 className="h-6 w-6 text-pink-400" aria-hidden />
            <div>
              <h1 className="font-mono text-lg font-semibold tracking-wide">Maker</h1>
              <p className="text-xs text-pink-700">Apps · Quests · Creative generation</p>
            </div>
          </div>
        </header>

        <nav className="border-b border-pink-900/30 px-4 md:px-8" aria-label="Maker sections">
          <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto">
            {VIEWS.map(({ id, label, keys, icon: Icon }) => {
              const on = active === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActive(id)}
                  className={cn(
                    'flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-pink-400',
                    on
                      ? 'border-pink-400 text-pink-200'
                      : 'border-transparent text-pink-700 hover:text-pink-400',
                  )}
                  aria-pressed={on}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
                  <kbd className="hidden sm:inline-block text-[10px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5 font-mono">
                    {keys}
                  </kbd>
                </button>
              );
            })}
          </div>
        </nav>

        <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -10 }}
              transition={{ duration: reduceMotion ? 0 : 0.2 }}
            >
              {active === 'builder' && (
                <>
                  <h2 className="mb-3 text-base font-semibold text-pink-200">No-code app builder</h2>
                  <p className="mb-3 text-xs text-pink-700">
                    Drag components onto a canvas, model data, bind sources, wire workflows,
                    snapshot versions, and deploy — no code.
                  </p>
                </>
              )}
              {active === 'designer' && (
                <>
                  <h2 className="mb-3 text-base font-semibold text-pink-200">Quest designer</h2>
                  <p className="mb-3 text-xs text-pink-700">
                    Author branching quests as a node graph — steps, choices, rewards and endings —
                    and validate the structure.
                  </p>
                </>
              )}
              <Panel />
            </motion.div>
          </AnimatePresence>
        </main>

        <CrossLensRecentsPanel
          lensId="maker"
          sinceDays={7}
          limit={6}
          hideWhenEmpty
          className="mt-3 px-4 md:px-8"
        />
      </div>
    </LensShell>
  );
}
