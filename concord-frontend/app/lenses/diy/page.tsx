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
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { useLensNav } from '@/hooks/useLensNav';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensCommand } from '@/hooks/useLensCommand';
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
  useLensNav('diy');
  const { latestData, isLive, lastUpdated, insights } = useRealtimeLens('diy');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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
      <NorthStarFrame
        lensId="diy"
        crumb="DIY"
        title={`What are we building${who ? `, ${who}` : ''}`}
        subtitle="Projects, tools, materials, instructions, ideas and a gallery: the whole workshop."
        actions={(
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="diy" data={{}} compact />
          </>
        )}
        tabs={VIEWS}
        activeTab={active}
        onTab={(id) => setActive(id as DiyView)}
        tabsLabel="DIY views"
        cta={{ label: 'Start a project', icon: Hammer, onClick: () => setActive('projects'), title: 'Open the project notebook (1)' }}
      >
        <div className="space-y-5">
          <AnimatePresence mode="wait">
            <motion.div key={active} {...motionProps}>
              {body}
            </motion.div>
          </AnimatePresence>
          <RealtimeDataPanel domain="diy" data={latestData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
