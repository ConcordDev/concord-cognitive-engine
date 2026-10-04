'use client';

/**
 * HVAC — one ServiceTitan / Manual-J field desk.
 *
 * Single view union. Inline Jobs/CRM/Estimates/etc CRUD extracted to
 * HvacDeskPanel; Field Service / Feed / Manual J folded into the active
 * union (no accordion booleans). Page is a thin shell.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Award, BarChart3, Calculator, CalendarDays, ClipboardList, FileText,
  MessageSquare, Receipt, Thermometer, Users, Wind, Wrench,
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
import { HvacDeskPanel } from '@/components/hvac/HvacDeskPanel';
import { FieldService } from '@/components/hvac/FieldService';
import { HvacFeed } from '@/components/hvac/HvacFeed';
import { ManualJCalc } from '@/components/hvac/ManualJCalc';
import { DuctDesigner } from '@/components/hvac/DuctDesigner';
import { type HvacView, type ModeTab } from '@/components/hvac/hvac-shared';

const VIEWS: { id: HvacView; label: string; keys: string; hint: string; icon: typeof Thermometer }[] = [
  { id: 'jobs', label: 'Jobs', keys: '1', hint: 'Job tracker', icon: Wrench },
  { id: 'estimates', label: 'Estimates', keys: '2', hint: 'Estimates', icon: Calculator },
  { id: 'codes', label: 'Codes', keys: '3', hint: 'Code refs', icon: FileText },
  { id: 'materials', label: 'Materials', keys: '4', hint: 'Materials', icon: Thermometer },
  { id: 'clients', label: 'CRM', keys: '5', hint: 'Clients', icon: Users },
  { id: 'invoices', label: 'Invoices', keys: '6', hint: 'Invoices', icon: Receipt },
  { id: 'inspections', label: 'Inspections', keys: '7', hint: 'Inspections', icon: ClipboardList },
  { id: 'certs', label: 'Certs', keys: '8', hint: 'Certifications', icon: Award },
  { id: 'dashboard', label: 'Dashboard', keys: 'd', hint: 'Ops overview', icon: BarChart3 },
  { id: 'field', label: 'Field Service', keys: 'f', hint: 'Dispatch board', icon: CalendarDays },
  { id: 'feed', label: 'Discussion', keys: 'h', hint: 'HVAC discussion', icon: MessageSquare },
  { id: 'manualj', label: 'Manual J', keys: 'j', hint: 'Load calculator', icon: Calculator },
  { id: 'ducts', label: 'Ducts', keys: 'u', hint: 'Duct sizing and hanger check', icon: Wind },
];

const DESK_MODES = new Set<HvacView>([
  'jobs', 'estimates', 'codes', 'materials', 'clients', 'invoices', 'inspections', 'certs', 'dashboard',
]);

export default function HVACLensPage() {
  const reduceMotion = useReducedMotion();
  useLensNav('hvac');
  const { latestData: realtimeData, isLive, lastUpdated, insights: realtimeInsights } = useRealtimeLens('hvac');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<HvacView>('jobs');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'hvac' },
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
    body = <HvacDeskPanel mode={active as ModeTab | 'dashboard'} />;
  } else if (active === 'field') {
    body = <FieldService />;
  } else if (active === 'feed') {
    body = <HvacFeed />;
  } else if (active === 'ducts') {
    body = <DuctDesigner />;
  } else {
    body = <ManualJCalc />;
  }

  return (
    <LensShell lensId="hvac" asMain={false}>
      <FirstRunTour lensId="hvac" />
      <DepthBadge lensId="hvac" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="hvac"
        crumb="HVAC"
        title={`Climate work${who ? `, ${who}` : ''}`}
        subtitle="Jobs, estimates, codes, materials, CRM, invoicing, inspections, certs and Manual J loads"
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="hvac" data={realtimeData || {}} compact />
          </>
        }
        tabs={VIEWS}
        activeTab={active}
        onTab={(id) => setActive(id as HvacView)}
        tabsLabel="HVAC views"
        cta={{ label: 'Estimate a job', icon: Calculator, onClick: () => setActive('estimates'), title: 'Open the estimates desk' }}
      >
        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps}>
            {body}
          </motion.div>
        </AnimatePresence>
        {realtimeData && (
          <RealtimeDataPanel domain="hvac" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={realtimeInsights} compact />
        )}
      </NorthStarFrame>
    </LensShell>
  );
}
