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
        title={`The export${who ? `, ${who}` : ''}`}
        subtitle="Your DTUs, in the format you pick. The shared library is a separate choice."
        tabs={VIEWS}
        activeTab={active}
        onTab={(id) => setActive(id as ExportView)}
        tabsLabel="Export views"
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
