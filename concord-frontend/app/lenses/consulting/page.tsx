'use client';

/**
 * Consulting — one practice-management desk.
 *
 * Single view union. Inline engagements/proposals/etc CRUD extracted to
 * ConsultingDeskPanel; firm reference / tracker / workbench folded into the
 * active union (no accordion booleans). Page is a thin shell.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  BarChart3, BookOpen, Briefcase, Building2, Clock, FileText, LayoutGrid,
  Lightbulb, Target, Timer, TrendingUp, Users,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensPageShell } from '@/components/lens/LensPageShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';
import { ConsultingDeskPanel } from '@/components/consulting/ConsultingDeskPanel';
import { ConsultingFirmReference } from '@/components/consulting/ConsultingFirmReference';
import { EngagementTracker } from '@/components/consulting/EngagementTracker';
import { ConsultingWorkbench } from '@/components/consulting/ConsultingWorkbench';
import { type ConsultingView, type ModeTab } from '@/components/consulting/consulting-shared';

const VIEWS: { id: ConsultingView; label: string; keys: string; hint: string; icon: typeof Lightbulb }[] = [
  // Labeled "Engagement Records" (not the bare "Engagements") to disambiguate
  // from the "Tracker" tab below — this is the generic DTU-backed CRUD list
  // (briefs/scope/fee terms), distinct storage from EngagementTracker's live
  // STATE.consultingLens.engagements. See ConsultingDeskPanel's matching
  // subtitle when this tab is active. docs/lens-specs/consulting-capability-map.md.
  { id: 'engagements', label: 'Engagement Records', keys: '1', hint: 'Engagement records', icon: Briefcase },
  { id: 'proposals', label: 'Proposals', keys: '2', hint: 'Proposals', icon: FileText },
  { id: 'deliverables', label: 'Deliverables', keys: '3', hint: 'Deliverables', icon: Target },
  { id: 'clients', label: 'Clients', keys: '4', hint: 'Clients', icon: Users },
  { id: 'timesheets', label: 'Timesheets', keys: '5', hint: 'Timesheets', icon: Clock },
  { id: 'frameworks', label: 'Frameworks', keys: '6', hint: 'Frameworks', icon: BookOpen },
  { id: 'pipeline', label: 'Pipeline', keys: '7', hint: 'Pipeline', icon: TrendingUp },
  { id: 'dashboard', label: 'Dashboard', keys: 'd', hint: 'Ops overview', icon: BarChart3 },
  { id: 'firm', label: 'Firm Ref', keys: 'f', hint: 'Firm reference', icon: Building2 },
  { id: 'tracker', label: 'Tracker', keys: 't', hint: 'Engagement tracker', icon: Timer },
  { id: 'workbench', label: 'Workbench', keys: 'w', hint: 'Practice workbench', icon: LayoutGrid },
];

const DESK_MODES = new Set<ConsultingView>([
  'engagements', 'proposals', 'deliverables', 'clients', 'timesheets', 'frameworks', 'pipeline', 'dashboard',
]);

export default function ConsultingLensPage() {
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<ConsultingView>('engagements');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'consulting' },
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
    body = <ConsultingDeskPanel mode={active as ModeTab | 'dashboard'} />;
  } else if (active === 'firm') {
    body = <ConsultingFirmReference />;
  } else if (active === 'tracker') {
    body = <EngagementTracker />;
  } else {
    body = <ConsultingWorkbench />;
  }

  return (
    <LensShell lensId="consulting" asMain={false}>
      <FirstRunTour lensId="consulting" />
      <DepthBadge lensId="consulting" size="sm" className="ml-2" />
      <LensPageShell
        domain="consulting"
        title="Consulting"
        description="Engagements, proposals, deliverables, clients, and frameworks"
        headerIcon={<Lightbulb className="w-6 h-6" />}
      >
        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto pb-1"
          aria-label="Consulting views"
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
                    ? 'border-neon-blue text-neon-blue'
                    : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600',
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
            {body}
          </motion.div>
        </AnimatePresence>
      </LensPageShell>
      <a href="#consulting-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to consulting content</a>
      <CrossLensRecentsPanel lensId="consulting" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
