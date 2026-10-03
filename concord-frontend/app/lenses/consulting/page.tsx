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
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { useLensNav } from '@/hooks/useLensNav';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { useLensCommand } from '@/hooks/useLensCommand';
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
  useLensNav('consulting');
  const { latestData: realtimeData, isLive, lastUpdated, insights: realtimeInsights } = useRealtimeLens('consulting');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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
      <NorthStarFrame
        lensId="consulting"
        crumb="Consulting"
        title={`Client work${who ? `, ${who}` : ''}`}
        subtitle="Engagements, proposals, deliverables, clients, timesheets and frameworks"
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="consulting" data={realtimeData || {}} compact />
          </>
        }
        tabs={VIEWS}
        activeTab={active}
        onTab={(id) => setActive(id as ConsultingView)}
        tabsLabel="Consulting views"
        cta={{ label: 'New proposal', icon: FileText, onClick: () => setActive('proposals'), title: 'Open proposals' }}
      >
        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps}>
            {body}
          </motion.div>
        </AnimatePresence>
        {realtimeData && (
          <RealtimeDataPanel domain="consulting" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={realtimeInsights} compact />
        )}
      </NorthStarFrame>
    </LensShell>
  );
}
