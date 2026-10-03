'use client';

/**
 * Export — one data-sovereignty export desk.
 *
 * Single view union (desk | toolkit | gallery). Accordion booleans for
 * ExportToolkit / ExportFormatGallery are gone. Each view is a panel that
 * owns its hooks. Page is a thin shell.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Download, Wrench, LayoutGrid } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { ExportDeskPanel } from '@/components/export/ExportDeskPanel';
import { ExportToolkit } from '@/components/export/ExportToolkit';
import { ExportFormatGallery } from '@/components/export/ExportFormatGallery';

type ExportView = 'desk' | 'toolkit' | 'gallery';

const VIEWS: { id: ExportView; label: string; keys: string; hint: string; icon: typeof Download }[] = [
  { id: 'desk', label: 'Desk', keys: '1', hint: 'Bulk · per-DTU · actions', icon: Download },
  { id: 'toolkit', label: 'Toolkit', keys: '2', hint: 'Schedule · encrypt · history', icon: Wrench },
  { id: 'gallery', label: 'Gallery', keys: '3', hint: 'External format reference', icon: LayoutGrid },
];

const PANELS: Record<ExportView, ComponentType> = {
  desk: ExportDeskPanel,
  toolkit: ExportToolkit,
  gallery: ExportFormatGallery,
};

export default function ExportLensPage() {
  useLensNav('export');
  useLensIdentity('export');
  const { latestData: realtimeData, alerts: realtimeAlerts, isLive, lastUpdated } = useRealtimeLens('export');
  const reduceMotion = useReducedMotion();
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<ExportView>('desk');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'export' },
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
    <LensShell lensId="export" asMain={false}>
      <FirstRunTour lensId="export" />
      <DepthBadge lensId="export" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="export"
        crumb="Export"
        title={`Take your data with you${active === 'desk' && who ? `, ${who}` : ''}`}
        subtitle="DTU, JSON, CSV, Markdown or plain text, in your format"
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="export" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </>
        }
        tabs={VIEWS}
        activeTab={active}
        onTab={(id) => setActive(id as ExportView)}
        tabsLabel="Export views"
        cta={{ label: 'Export data', icon: Download, onClick: () => setActive('desk'), title: 'Open the export desk' }}
      >
        <div className="pt-4">
          <AnimatePresence mode="wait">
            <motion.div key={active} {...motionProps}>
              <Panel />
            </motion.div>
          </AnimatePresence>
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
