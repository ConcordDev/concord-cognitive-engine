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
import { Icon as SvgIcon } from '@/components/icons/Icon';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
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
      <div data-lens-theme="export" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <SvgIcon name="export-package" size={28} className="text-neon-green shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Export</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="export" data={realtimeData || {}} compact />
                {realtimeAlerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                    {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className={ds.textMuted}>
                DTU, JSON, CSV, Markdown, or plain text — your data, your format.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Export views"
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

        <div className="pt-4">
          <AnimatePresence mode="wait">
            <motion.div key={active} {...motionProps}>
              <Panel />
            </motion.div>
          </AnimatePresence>
        </div>

        <CrossLensRecentsPanel lensId="export" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
