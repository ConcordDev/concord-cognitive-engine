'use client';

/**
 * DIY — one Instructables-style project workshop app.
 *
 * Single view union. Inline library CRUD extracted to DiyLibraryPanel;
 * workshop/showcase accordions folded into the active union. Page is a
 * thin shell.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  BarChart3, BookOpen, Camera, Hammer, Lightbulb, Package, Wrench, LayoutGrid,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensPageShell } from '@/components/lens/LensPageShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';
import { DiyLibraryPanel } from '@/components/diy/DiyLibraryPanel';
import { ProjectWorkshop } from '@/components/diy/ProjectWorkshop';
import { DiyShowcase } from '@/components/diy/DiyShowcase';
import { type DiyView, type ModeTab } from '@/components/diy/diy-shared';

const VIEWS: { id: DiyView; label: string; keys: string; hint: string; icon: typeof Wrench }[] = [
  { id: 'projects', label: 'Projects', keys: '1', hint: 'Project notebook', icon: Hammer },
  { id: 'tools', label: 'Tools', keys: '2', hint: 'Tool inventory', icon: Wrench },
  { id: 'materials', label: 'Materials', keys: '3', hint: 'Materials stock', icon: Package },
  { id: 'instructions', label: 'Instructions', keys: '4', hint: 'Step notes', icon: BookOpen },
  { id: 'ideas', label: 'Ideas', keys: '5', hint: 'Idea board', icon: Lightbulb },
  { id: 'gallery', label: 'Gallery', keys: '6', hint: 'Photo gallery', icon: Camera },
  { id: 'dashboard', label: 'Dashboard', keys: 'd', hint: 'Status overview', icon: BarChart3 },
  { id: 'workshop', label: 'Workshop', keys: 'w', hint: 'Project workshop', icon: LayoutGrid },
  { id: 'showcase', label: 'Showcase', keys: 's', hint: 'Published gallery', icon: Camera },
];

const DESK_MODES = new Set<DiyView>([
  'projects', 'tools', 'materials', 'instructions', 'ideas', 'gallery', 'dashboard',
]);

export default function DIYLensPage() {
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<DiyView>('projects');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'diy' },
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

  let body: ReactNode = null;
  if (DESK_MODES.has(active)) {
    body = <DiyLibraryPanel mode={active as ModeTab | 'dashboard'} />;
  } else if (active === 'workshop') {
    body = <ProjectWorkshop />;
  } else {
    body = <DiyShowcase />;
  }

  return (
    <LensShell lensId="diy" asMain={false}>
      <FirstRunTour lensId="diy" />
      <DepthBadge lensId="diy" size="sm" className="ml-2" />
      <LensPageShell
        domain="diy"
        title="DIY"
        description="Projects, tools, materials, instructions, ideas, and gallery"
        headerIcon={<Wrench className="w-5 h-5 text-white" />}
      >
        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto pb-1"
          aria-label="DIY views"
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
                    ? 'border-orange-400 text-orange-300'
                    : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="w-4 h-4" />
                {v.label}
                <kbd className="hidden sm:inline-block text-[10px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5 font-mono">
                  {v.keys}
                </kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps}>
            {body}
          </motion.div>
        </AnimatePresence>
      </LensPageShell>
      <a href="#diy-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to diy content</a>
      <CrossLensRecentsPanel lensId="diy" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
