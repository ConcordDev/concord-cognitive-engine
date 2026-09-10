'use client';

/**
 * Electrical — one Jobber + Mike Holt NEC desk.
 *
 * Single view union. Inline Jobs/CRM/Certs/Codes CRUD extracted to
 * ElectricalDeskPanel; trade-tool screens stay as existing panels.
 * Page is a thin shell.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Award, BarChart3, Bolt, Calculator, ClipboardList, Cpu, DollarSign,
  FileText, Receipt, ShieldCheck, Users, Wrench, Zap,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensPageShell } from '@/components/lens/LensPageShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';
import { ElectricalDeskPanel } from '@/components/electrical/ElectricalDeskPanel';
import { OpenHardwarePulse } from '@/components/electrical/OpenHardwarePulse';
import { NecCodeCalc } from '@/components/electrical/NecCodeCalc';
import { NecCalculators } from '@/components/electrical/NecCalculators';
import { PanelScheduleBuilder } from '@/components/electrical/PanelScheduleBuilder';
import { EstimateInvoiceFlow } from '@/components/electrical/EstimateInvoiceFlow';
import { OneLineDiagram } from '@/components/electrical/OneLineDiagram';
import { InspectionChecklists } from '@/components/electrical/InspectionChecklists';
import { MaterialPriceList } from '@/components/electrical/MaterialPriceList';
import { type ModeTab } from '@/components/electrical/electrical-shared';

const VIEWS: { id: ModeTab; label: string; keys: string; hint: string; icon: typeof Zap; group: 'desk' | 'tools' }[] = [
  { id: 'dashboard', label: 'Dashboard', keys: 'd', hint: 'Ops overview', icon: BarChart3, group: 'desk' },
  { id: 'jobs', label: 'Jobs', keys: 'j', hint: 'Job tracker', icon: Wrench, group: 'desk' },
  { id: 'codes', label: 'NEC Notes', keys: 'c', hint: 'Code notes', icon: FileText, group: 'desk' },
  { id: 'clients', label: 'CRM', keys: 'r', hint: 'Clients', icon: Users, group: 'desk' },
  { id: 'certs', label: 'Certs', keys: 't', hint: 'Licenses', icon: Award, group: 'desk' },
  { id: 'panels', label: 'Panel Schedule', keys: '1', hint: 'Panel builder', icon: Bolt, group: 'tools' },
  { id: 'calculators', label: 'NEC Calculators', keys: '2', hint: 'Load · fill · drop', icon: Calculator, group: 'tools' },
  { id: 'neccalc', label: 'Code Calc', keys: 'n', hint: 'NEC code calc', icon: Calculator, group: 'tools' },
  { id: 'estimating', label: 'Estimate→Invoice', keys: '3', hint: 'Estimate flow', icon: Receipt, group: 'tools' },
  { id: 'diagrams', label: 'One-Line', keys: '4', hint: 'One-line diagram', icon: ShieldCheck, group: 'tools' },
  { id: 'checklists', label: 'Inspections', keys: '5', hint: 'Checklists', icon: ClipboardList, group: 'tools' },
  { id: 'pricelist', label: 'Price List', keys: '6', hint: 'Materials', icon: DollarSign, group: 'tools' },
  { id: 'hardware', label: 'Open Hardware', keys: 'h', hint: 'Hardware pulse', icon: Cpu, group: 'tools' },
];

export default function ElectricalLensPage() {
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<ModeTab>('jobs');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'electrical' },
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
  if (active === 'dashboard' || active === 'jobs' || active === 'codes' || active === 'clients' || active === 'certs') {
    body = <ElectricalDeskPanel mode={active} />;
  } else if (active === 'panels') {
    body = <PanelScheduleBuilder />;
  } else if (active === 'calculators') {
    body = <NecCalculators />;
  } else if (active === 'neccalc') {
    body = <NecCodeCalc />;
  } else if (active === 'estimating') {
    body = <EstimateInvoiceFlow />;
  } else if (active === 'diagrams') {
    body = <OneLineDiagram />;
  } else if (active === 'checklists') {
    body = <InspectionChecklists />;
  } else if (active === 'pricelist') {
    body = <MaterialPriceList />;
  } else {
    body = <OpenHardwarePulse />;
  }

  return (
    <LensShell lensId="electrical" asMain={false}>
      <FirstRunTour lensId="electrical" />
      <DepthBadge lensId="electrical" size="sm" className="ml-2" />
      <LensPageShell
        domain="electrical"
        title="Electrical"
        description="Jobs, NEC calculators, panel schedules, estimate→invoice, and inspections"
        headerIcon={<Zap className="w-5 h-5 text-yellow-400" />}
      >
        <nav className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto pb-1" aria-label="Electrical desk">
          {VIEWS.filter((v) => v.group === 'desk').map((v) => {
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
        <nav className="flex items-center gap-2 border-b border-lattice-border pb-3 flex-wrap" aria-label="Electrical trade tools">
          <span className="px-2 text-[10px] uppercase tracking-wider text-gray-400">Trade Tools</span>
          {VIEWS.filter((v) => v.group === 'tools').map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors whitespace-nowrap',
                  on
                    ? 'bg-yellow-500/20 text-yellow-300'
                    : 'text-gray-400 hover:text-white hover:bg-lattice-elevated',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="w-3.5 h-3.5" />
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
      <a href="#electrical-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to electrical content</a>
      <CrossLensRecentsPanel lensId="electrical" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
