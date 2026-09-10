'use client';

/**
 * Construction — one Procore-shaped GC ops desk.
 *
 * Single `active` union. Accordion booleans for Field/OSHA/Procore/Workbench
 * folded into the union. Project registry extracted to ProjectRegistryPanel.
 * Page is a thin shell (paper/government gold).
 */

import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { HardHat } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { OshaIncidentSearch } from '@/components/construction/OshaIncidentSearch';
import { ProcorePanel } from '@/components/construction/ProcorePanel';
import { ConstructionActionPanel } from '@/components/construction/ConstructionActionPanel';
import { FieldManagementPanel } from '@/components/construction/FieldManagementPanel';
import { ProjectRegistryPanel } from '@/components/construction/ProjectRegistryPanel';
import {
  SHELL_VIEWS,
  type ConstrView,
  type RegistryMode,
} from '@/components/construction/construction-types';

const REGISTRY_MODES = new Set<ConstrView>([
  'dashboard',
  'jobs',
  'estimates',
  'materials',
  'inspections',
  'safety',
  'crew',
  'documents',
  'map',
]);

function isRegistry(v: ConstrView): v is RegistryMode {
  return REGISTRY_MODES.has(v);
}

export default function ConstructionLensPage() {
  useLensNav('construction');
  useLensIdentity('construction');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<ConstrView>('jobs');

  useLensCommand(
    SHELL_VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'construction' },
  );

  const motionProps = useMemo(
    () =>
      reduceMotion
        ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
        : {
            initial: { opacity: 0, y: 8 },
            animate: { opacity: 1, y: 0 },
            exit: { opacity: 0, y: -6 },
            transition: { duration: 0.16 },
          },
    [reduceMotion],
  );

  return (
    <LensShell lensId="construction" asMain={false}>
      <FirstRunTour lensId="construction" />
      <DepthBadge lensId="construction" size="sm" className="ml-2" />
      <div data-lens-theme="construction" className={ds.pageContainer}>
        <a
          href="#construction-main"
          className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none"
        >
          Skip to construction content
        </a>

        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <HardHat className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <h1 className={ds.heading1}>Construction</h1>
              <p className={ds.textMuted}>
                Jobs, field paperwork, Procore controls — one GC desk.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Construction views"
        >
          {SHELL_VIEWS.map((v) => {
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
                    ? 'border-[var(--lens-accent)] text-white'
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

        <main id="construction-main" className="pt-4 min-w-0">
          <AnimatePresence mode="wait">
            <motion.div key={active} {...motionProps}>
              {isRegistry(active) && <ProjectRegistryPanel mode={active} />}
              {active === 'field' && <FieldManagementPanel />}
              {active === 'osha' && <OshaIncidentSearch />}
              {active === 'procore' && <ProcorePanel />}
              {active === 'tools' && (
                <PipingProvider>
                  <ConstructionActionPanel />
                </PipingProvider>
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        <CrossLensRecentsPanel
          lensId="construction"
          sinceDays={7}
          limit={6}
          hideWhenEmpty
          className="mt-3"
        />
      </div>
    </LensShell>
  );
}
