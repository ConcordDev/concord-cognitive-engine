'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  Award, Bolt, Calculator, ClipboardList, Cpu, DollarSign, FileText,
  Receipt, ShieldCheck, Users, Wrench, Zap,
} from 'lucide-react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useLensStatePersistence } from '@/lib/lens-state-persistence';
import { cn } from '@/lib/utils';
import { ElectricalDeskPanel } from './ElectricalDeskPanel';
import { EstimateInvoiceFlow } from './EstimateInvoiceFlow';
import { InspectionChecklists } from './InspectionChecklists';
import { MaterialPriceList } from './MaterialPriceList';
import { NecCalculators } from './NecCalculators';
import { NecCodeCalc } from './NecCodeCalc';
import { OneLineDiagram } from './OneLineDiagram';
import { OpenHardwarePulse } from './OpenHardwarePulse';
import { PanelScheduleBuilder } from './PanelScheduleBuilder';

type ElectricalTool =
  | 'jobs' | 'panels' | 'calculators' | 'neccalc' | 'estimating' | 'diagrams'
  | 'checklists' | 'pricelist' | 'codes' | 'clients' | 'certs' | 'hardware';

const TOOLS: { id: ElectricalTool; label: string; icon: typeof Zap; key: string }[] = [
  { id: 'jobs', label: 'Job', icon: Wrench, key: '1' },
  { id: 'panels', label: 'Panel', icon: Bolt, key: '2' },
  { id: 'calculators', label: 'Size', icon: Calculator, key: '3' },
  { id: 'neccalc', label: 'NEC', icon: Calculator, key: '4' },
  { id: 'estimating', label: 'Estimate', icon: Receipt, key: '5' },
  { id: 'diagrams', label: 'One-line', icon: ShieldCheck, key: '6' },
  { id: 'checklists', label: 'Inspect', icon: ClipboardList, key: '7' },
  { id: 'pricelist', label: 'Materials', icon: DollarSign, key: '8' },
  { id: 'codes', label: 'Code notes', icon: FileText, key: '9' },
  { id: 'clients', label: 'CRM', icon: Users, key: 'c' },
  { id: 'certs', label: 'Certs', icon: Award, key: 't' },
  { id: 'hardware', label: 'Hardware', icon: Cpu, key: 'h' },
];
const TOOL_IDS = new Set(TOOLS.map((tool) => tool.id));

function isElectricalTool(value: unknown): value is ElectricalTool {
  return typeof value === 'string' && TOOL_IDS.has(value as ElectricalTool);
}

export function ElectricalWorkspace({ who }: { who: string }) {
  useLensIdentity('electrical');
  const { restore, persist } = useLensStatePersistence('electrical');
  const [initialState] = useState(() => restore());
  const [opened, setOpened] = useState(() => initialState?.opened === true);
  const [tool, setTool] = useState<ElectricalTool>(() => isElectricalTool(initialState?.tool) ? initialState.tool : 'jobs');
  const [createJob, setCreateJob] = useState(false);

  const selectTool = useCallback((next: ElectricalTool) => {
    setOpened(true);
    setCreateJob(false);
    setTool(next);
    persist({ opened: true, tool: next });
  }, [persist]);

  const newJob = useCallback(() => {
    setOpened(true);
    setTool('jobs');
    setCreateJob(true);
    persist({ opened: true, tool: 'jobs' });
  }, [persist]);

  useLensCommand(
    TOOLS.map((item) => ({
      id: `electrical-${item.id}`,
      keys: item.key,
      description: `Open Electrical ${item.label}`,
      category: 'navigation' as const,
      action: () => selectTool(item.id),
    })),
    { lensId: 'electrical' },
  );

  let body: ReactNode;
  if (tool === 'jobs' || tool === 'codes' || tool === 'clients' || tool === 'certs') {
    body = <ElectricalDeskPanel mode={tool} createOnMount={tool === 'jobs' && createJob} />;
  } else if (tool === 'panels') {
    body = <PanelScheduleBuilder />;
  } else if (tool === 'calculators') {
    body = <NecCalculators />;
  } else if (tool === 'neccalc') {
    body = <NecCodeCalc />;
  } else if (tool === 'estimating') {
    body = <EstimateInvoiceFlow />;
  } else if (tool === 'diagrams') {
    body = <OneLineDiagram />;
  } else if (tool === 'checklists') {
    body = <InspectionChecklists />;
  } else if (tool === 'pricelist') {
    body = <MaterialPriceList />;
  } else {
    body = <OpenHardwarePulse />;
  }

  return (
    <div data-lens-theme="electrical" className="relative min-h-full bg-[#080808] px-4 pb-28 pt-6 sm:px-8">
      <header>
        <p className="text-sm text-zinc-600">Electrical</p>
        <h1 className="font-vault mt-1 text-4xl leading-tight text-zinc-100 sm:text-5xl">
          The job{who ? `, ${who}` : ''}
        </h1>
      </header>

      {!opened ? (
        <EmptyJob onCreate={newJob} onCalculators={() => selectTool('calculators')} />
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-[9rem_minmax(0,1fr)]">
          <nav aria-label="Electrical job tools" className="flex gap-1 overflow-x-auto border-b border-white/10 pb-2 lg:flex-col lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4">
            {TOOLS.map((item) => {
              const Icon = item.icon;
              const active = item.id === tool;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectTool(item.id)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    active ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                  <kbd aria-hidden="true" className="ml-auto hidden font-mono text-[10px] text-white/25 lg:inline">{item.key}</kbd>
                </button>
              );
            })}
          </nav>
          <motion.main key={tool} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }}>
            {body}
          </motion.main>
        </div>
      )}

      {opened && tool === 'jobs' && (
        <button
          type="button"
          onClick={newJob}
          className="fixed bottom-6 right-6 z-20 rounded-full bg-emerald-300 px-5 py-3 text-sm font-semibold text-zinc-950 shadow-xl shadow-emerald-950/30 active:scale-[0.98]"
        >
          + New job
        </button>
      )}
    </div>
  );
}

function EmptyJob({ onCreate, onCalculators }: { onCreate: () => void; onCalculators: () => void }) {
  return (
    <div className="relative mt-8 min-h-[62vh] overflow-hidden rounded-2xl border border-white/10 bg-[#101014] p-8">
      <p className="text-sm text-zinc-400">No job open.</p>
      <p className="mt-2 max-w-md text-sm text-zinc-500">
        Size a feeder, conduit, or box from the code tables without opening a job.
      </p>
      <button
        type="button"
        onClick={onCalculators}
        className="mt-6 rounded-full border border-white/15 bg-zinc-900 px-5 py-3 text-sm font-semibold text-zinc-100 active:scale-[0.98]"
      >
        NEC Calculators
      </button>
      <div aria-hidden="true" className="mt-6 space-y-6 opacity-60">
        <div className="h-2 w-2/3 rounded-full bg-zinc-900" />
        <div className="h-2 w-2/5 rounded-full bg-zinc-900" />
      </div>
      <button
        type="button"
        onClick={onCreate}
        className="fixed bottom-6 right-6 z-20 rounded-full bg-emerald-300 px-5 py-3 text-sm font-semibold text-zinc-950 shadow-xl shadow-emerald-950/30 active:scale-[0.98]"
      >
        + New job
      </button>
    </div>
  );
}
