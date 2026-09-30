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
  MessageSquare, Receipt, Thermometer, Users, Wrench,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensPageShell } from '@/components/lens/LensPageShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';
import { Icon as SvgIcon } from '@/components/icons/Icon';
import { HvacDeskPanel } from '@/components/hvac/HvacDeskPanel';
import { FieldService } from '@/components/hvac/FieldService';
import { HvacFeed } from '@/components/hvac/HvacFeed';
import { ManualJCalc } from '@/components/hvac/ManualJCalc';
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
];

const DESK_MODES = new Set<HvacView>([
  'jobs', 'estimates', 'codes', 'materials', 'clients', 'invoices', 'inspections', 'certs', 'dashboard',
]);

export default function HVACLensPage() {
  const reduceMotion = useReducedMotion();
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
  } else {
    body = <ManualJCalc />;
  }

  return (
    <LensShell lensId="hvac" asMain={false}>
      <FirstRunTour lensId="hvac" />
      <DepthBadge lensId="hvac" size="sm" className="ml-2" />
      <LensPageShell
        domain="hvac"
        title="HVAC"
        description="Jobs, estimates, codes, materials, CRM, invoicing, inspections, and certifications"
        headerIcon={<SvgIcon name="hvac-duct" size={24} />}
      >
        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto pb-1"
          aria-label="HVAC views"
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
      <a href="#hvac-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to hvac content</a>
      <CrossLensRecentsPanel lensId="hvac" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
