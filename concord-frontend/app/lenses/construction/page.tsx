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
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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
      <NorthStarFrame
        lensId="construction"
        crumb="Construction"
        title={`Run the job site${active === 'jobs' && who ? `, ${who}` : ''}`}
        subtitle="Jobs, estimates, inspections, field paperwork, OSHA and Procore in one GC desk."
        tabs={SHELL_VIEWS}
        activeTab={active}
        onTab={(id) => setActive(id as ConstrView)}
        tabsLabel="Construction views"
        cta={{ label: 'Open job board', icon: HardHat, onClick: () => setActive('jobs'), title: 'Open the job board (J)' }}
      >
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
      </NorthStarFrame>
    </LensShell>
  );
}
