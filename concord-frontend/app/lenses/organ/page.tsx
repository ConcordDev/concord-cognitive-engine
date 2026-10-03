'use client';

/**
 * Organ — one ChartHop + Concord self-model app.
 *
 * Single view union (designer | analysis | self-model | anatomy). Accordion
 * booleans for OrgDesigner/AnatomyExplorer are folded into active. Page is a
 * thin shell.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Heart, Network, Activity, BookOpen } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { OrgDesigner } from '@/components/organ/OrgDesigner';
import { OrgAnalysisPanel } from '@/components/organ/OrgAnalysisPanel';
import { SelfModelPanel } from '@/components/organ/SelfModelPanel';
import { AnatomyExplorer } from '@/components/organ/AnatomyExplorer';

type OrganView = 'designer' | 'analysis' | 'self-model' | 'anatomy';

const VIEWS: { id: OrganView; label: string; keys: string; hint: string; icon: typeof Heart }[] = [
  { id: 'designer', label: 'Org designer', keys: '1', hint: 'Headcount, HRIS, comp', icon: Network },
  { id: 'analysis', label: 'Analysis', keys: '2', hint: 'Span / skills / comms', icon: Activity },
  { id: 'self-model', label: 'Self-model', keys: '3', hint: 'Concord organ registry', icon: Heart },
  { id: 'anatomy', label: 'Anatomy', keys: '4', hint: 'Wikipedia reference', icon: BookOpen },
];

const PANELS: Record<OrganView, ComponentType> = {
  designer: OrgDesigner,
  analysis: OrgAnalysisPanel,
  'self-model': SelfModelPanel,
  anatomy: AnatomyExplorer,
};

export default function OrganLensPage() {
  useLensNav('organ');
  const { latestData: realtimeData, alerts: realtimeAlerts, isLive, lastUpdated } = useRealtimeLens('organ');
  const reduceMotion = useReducedMotion();
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<OrganView>('designer');

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      { id: 'organ-grid', keys: 'v', description: 'Self-model grid view', category: 'view' as const, action: () => setActive('self-model') },
      { id: 'organ-timeline', keys: 'g', description: 'Self-model timeline view', category: 'view' as const, action: () => setActive('self-model') },
    ],
    { lensId: 'organ' },
  );

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
    <LensShell lensId="organ" asMain={false}>
      <FirstRunTour lensId="organ" />
      <DepthBadge lensId="organ" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="organ"
        crumb="Organ"
        title={`Organizations and organs${active === 'designer' && who ? `, ${who}` : ''}`}
        subtitle="Org design plus Concord's own self-model organ registry"
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="organ" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </>
        }
        tabs={VIEWS}
        activeTab={active}
        onTab={(id) => setActive(id as OrganView)}
        tabsLabel="Organ views"
        cta={{ label: 'Open self-model', icon: Heart, onClick: () => setActive('self-model'), title: 'Concord organ registry' }}
      >
        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps} className="pt-4">
            <Panel />
          </motion.div>
        </AnimatePresence>
      </NorthStarFrame>
    </LensShell>
  );
}
