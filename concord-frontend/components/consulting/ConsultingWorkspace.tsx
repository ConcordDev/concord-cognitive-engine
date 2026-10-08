'use client';

import { useCallback, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import {
  BarChart3,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  Calculator,
  Clock3,
  FileArchive,
  FileSignature,
  Gauge,
  HeartPulse,
  Loader2,
  Receipt,
  RefreshCw,
  Repeat2,
  Share2,
  TrendingUp,
  Users,
  WalletCards,
  Plus,
} from 'lucide-react';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useLensNav } from '@/hooks/useLensNav';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { lensRun } from '@/lib/api/client';
import { useLensStatePersistence } from '@/lib/lens-state-persistence';
import { useUIStore } from '@/store/ui';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { cn } from '@/lib/utils';
import { ClientPortal } from './ClientPortal';
import { ConsultingCalculators, type ConsultingCalculatorTool } from './ConsultingCalculators';
import { ConsultingDeskPanel } from './ConsultingDeskPanel';
import { ConsultingFirmReference } from './ConsultingFirmReference';
import { EngagementTracker } from './EngagementTracker';
import { ExpenseTracker } from './ExpenseTracker';
import { InvoiceManager } from './InvoiceManager';
import { LiveTimer } from './LiveTimer';
import { ProfitabilityReport } from './ProfitabilityReport';
import { ProposalBuilder } from './ProposalBuilder';
import { RetainerManager } from './RetainerManager';
import { StaffingPlanner } from './StaffingPlanner';
import type { ModeTab } from './consulting-shared';

type ConsultingTool =
  | 'engagements'
  | 'timer'
  | 'invoices'
  | 'proposals'
  | 'staffing'
  | 'expenses'
  | 'retainers'
  | 'profitability'
  | 'portal'
  | 'engagement-records'
  | 'proposal-records'
  | 'deliverables'
  | 'clients'
  | 'time-records'
  | 'frameworks'
  | 'pipeline'
  | 'scope'
  | 'utilization'
  | 'readiness'
  | 'health'
  | 'firms'
  | 'live';

type ToolGroup = 'Practice' | 'Revenue' | 'Records' | 'Analysis';

interface EngagementOption {
  id: string;
  name: string;
}

const TOOLS: {
  id: ConsultingTool;
  label: string;
  description: string;
  group: ToolGroup;
  key: string;
  icon: typeof BriefcaseBusiness;
}[] = [
  { id: 'engagements', label: 'Engagements', description: 'Clients, budgets, rates, and logged work', group: 'Practice', key: '1', icon: BriefcaseBusiness },
  { id: 'timer', label: 'Timer', description: 'Capture billable work against an engagement', group: 'Practice', key: '2', icon: Clock3 },
  { id: 'proposals', label: 'Proposals', description: 'Build, complete, and accept proposals', group: 'Practice', key: '3', icon: FileSignature },
  { id: 'staffing', label: 'Staffing', description: 'Capacity and weekly allocations', group: 'Practice', key: '4', icon: Users },
  { id: 'invoices', label: 'Invoices', description: 'Turn unbilled time into client invoices', group: 'Revenue', key: '5', icon: WalletCards },
  { id: 'expenses', label: 'Expenses', description: 'Engagement costs and reimbursements', group: 'Revenue', key: '6', icon: Receipt },
  { id: 'retainers', label: 'Retainers', description: 'Recurring client agreements and periods', group: 'Revenue', key: '7', icon: Repeat2 },
  { id: 'profitability', label: 'Profitability', description: 'Billed revenue, cost, and margin by engagement', group: 'Revenue', key: '8', icon: TrendingUp },
  { id: 'portal', label: 'Client portal', description: 'Shared deliverables and recorded approvals', group: 'Revenue', key: '9', icon: Share2 },
  { id: 'engagement-records', label: 'Engagement notes', description: 'DTU-backed briefs and scope records', group: 'Records', key: 'e', icon: FileArchive },
  { id: 'proposal-records', label: 'Proposal archive', description: 'DTU-backed proposal reference records', group: 'Records', key: 'p', icon: FileArchive },
  { id: 'deliverables', label: 'Deliverables', description: 'DTU-backed deliverable records', group: 'Records', key: 'd', icon: FileArchive },
  { id: 'clients', label: 'Client notes', description: 'DTU-backed client records', group: 'Records', key: 'c', icon: FileArchive },
  { id: 'time-records', label: 'Time records', description: 'DTU-backed timesheet records', group: 'Records', key: 'm', icon: FileArchive },
  { id: 'frameworks', label: 'Frameworks', description: 'Reusable consulting methods and playbooks', group: 'Records', key: 'f', icon: BookOpen },
  { id: 'pipeline', label: 'Pipeline notes', description: 'DTU-backed opportunity records', group: 'Records', key: 'l', icon: BarChart3 },
  { id: 'scope', label: 'Fee & scope', description: 'Price a deliverable plan with contingency', group: 'Analysis', key: 's', icon: Calculator },
  { id: 'utilization', label: 'Utilization', description: 'Measure billable capacity against target', group: 'Analysis', key: 'u', icon: Gauge },
  { id: 'readiness', label: 'Readiness', description: 'Check proposal section completeness', group: 'Analysis', key: 'r', icon: FileSignature },
  { id: 'health', label: 'Client health', description: 'Score relationship risk from real inputs', group: 'Analysis', key: 'h', icon: HeartPulse },
  { id: 'firms', label: 'Firm reference', description: 'Live Wikipedia industry reference', group: 'Analysis', key: 'i', icon: Building2 },
  { id: 'live', label: 'Live feed', description: 'Consulting-domain platform events', group: 'Analysis', key: 'v', icon: BarChart3 },
];

const GROUPS: ToolGroup[] = ['Practice', 'Revenue', 'Records', 'Analysis'];
const TOOL_IDS = new Set(TOOLS.map((tool) => tool.id));
const RECORD_MODES: Partial<Record<ConsultingTool, ModeTab>> = {
  'engagement-records': 'engagements',
  'proposal-records': 'proposals',
  deliverables: 'deliverables',
  clients: 'clients',
  'time-records': 'timesheets',
  frameworks: 'frameworks',
  pipeline: 'pipeline',
};
const CALCULATOR_TOOLS: Partial<Record<ConsultingTool, ConsultingCalculatorTool>> = {
  scope: 'scope',
  utilization: 'utilization',
  readiness: 'proposal',
  health: 'health',
};

function isConsultingTool(value: unknown): value is ConsultingTool {
  return typeof value === 'string' && TOOL_IDS.has(value as ConsultingTool);
}

export function ConsultingWorkspace({ who }: { who: string }) {
  useLensIdentity('consulting');
  useLensNav('consulting');
  const { restore, persist } = useLensStatePersistence('consulting');
  const [initialState] = useState(() => restore());
  const [tool, setTool] = useState<ConsultingTool>(() => (
    isConsultingTool(initialState?.tool) ? initialState.tool : 'engagements'
  ));
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const { latestData, isLive, lastUpdated, insights } = useRealtimeLens('consulting');

  const { data: engagements = [], refetch: refetchEngagements } = useQuery({
    queryKey: ['consulting', 'engagement-options'],
    queryFn: async () => {
      const response = await lensRun('consulting', 'engagement-list', {});
      if (!response.data?.ok) throw new Error(response.data?.error || 'Could not load engagements');
      const result = response.data.result as { engagements?: EngagementOption[] } | null;
      return (result?.engagements || []).map(({ id, name }) => ({ id, name }));
    },
  });
  const selectTool = useCallback((next: ConsultingTool) => {
    setTool(next);
    persist({ tool: next });
  }, [persist]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refetchEngagements(),
        queryClient.refetchQueries({ type: 'active' }),
      ]);
      setRefreshKey((key) => key + 1);
      useUIStore.getState().addToast({ type: 'success', message: 'Practice data refreshed.' });
    } catch (error) {
      useUIStore.getState().addToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Refresh failed.',
      });
    } finally {
      setRefreshing(false);
    }
  }, [queryClient, refetchEngagements]);

  const onTimeLogged = useCallback(() => {
    setRefreshKey((key) => key + 1);
    void refetchEngagements();
  }, [refetchEngagements]);

  useLensCommand(
    [
      ...TOOLS.map((item) => ({
        id: `consulting-${item.id}`,
        keys: item.key,
        description: `Open Consulting ${item.label}`,
        category: 'navigation' as const,
        action: () => selectTool(item.id),
      })),
      {
        id: 'consulting-refresh',
        keys: 'shift+r',
        description: 'Refresh consulting practice data',
        category: 'actions' as const,
        action: () => void refresh(),
      },
    ],
    { lensId: 'consulting' },
  );

  const active = TOOLS.find((item) => item.id === tool) ?? TOOLS[0];
  const recordMode = RECORD_MODES[tool];
  const calculatorTool = CALCULATOR_TOOLS[tool];
  const transition = useMemo(
    () => reduceMotion
      ? { initial: false as const, animate: { opacity: 1 }, transition: { duration: 0 } }
      : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.16 } },
    [reduceMotion],
  );

  let panel: ReactNode;
  if (tool === 'engagements') panel = <EngagementTracker onChanged={() => void refetchEngagements()} />;
  else if (tool === 'timer') panel = <LiveTimer engagements={engagements} onLogged={onTimeLogged} />;
  else if (tool === 'invoices') panel = <InvoiceManager key={`invoice-${refreshKey}`} engagements={engagements} />;
  else if (tool === 'proposals') panel = <ProposalBuilder />;
  else if (tool === 'staffing') panel = <StaffingPlanner engagements={engagements} />;
  else if (tool === 'expenses') panel = <ExpenseTracker engagements={engagements} />;
  else if (tool === 'retainers') panel = <RetainerManager />;
  else if (tool === 'profitability') panel = <ProfitabilityReport key={`profit-${refreshKey}`} />;
  else if (tool === 'portal') panel = <ClientPortal engagements={engagements} />;
  else if (recordMode) panel = <ConsultingDeskPanel mode={recordMode} />;
  else if (calculatorTool) panel = <ConsultingCalculators tool={calculatorTool} showNav={false} />;
  else if (tool === 'firms') panel = <ConsultingFirmReference />;
  else panel = null;

  return (
    <NorthStarFrame
      lensId="consulting"
      crumb="Consulting"
      title={`The engagement${who ? `, ${who}` : ''}`}
      subtitle={active.description}
      actions={(
        <>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[13px] text-zinc-300 hover:bg-white/[0.06] disabled:opacity-60"
          >
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
            <kbd aria-hidden="true" className="font-mono text-[10px] text-white/30">⇧R</kbd>
          </button>
          <DTUExportButton domain="consulting" data={latestData || {}} compact />
        </>
      )}
      cta={{ label: 'New', icon: Plus, onClick: () => selectTool('engagements'), title: 'Start or open an engagement (1)' }}
    >
      <div className="grid gap-6 rounded-2xl border border-white/10 bg-zinc-950 p-4 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <nav aria-label="Consulting tools" className="flex gap-2 overflow-x-auto border-b border-amber-100/10 pb-3 lg:block lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4">
          {GROUPS.map((group) => (
            <div key={group} className="flex shrink-0 gap-1 lg:mb-5 lg:block">
              <p className="hidden px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-700 lg:block">{group}</p>
              {TOOLS.filter((item) => item.group === group).map((item) => {
                const Icon: ComponentType<{ className?: string }> = item.icon;
                const selected = item.id === tool;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectTool(item.id)}
                    aria-current={selected ? 'page' : undefined}
                    title={item.description}
                    className={cn(
                      'flex w-full shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                      selected
                        ? 'bg-amber-100/10 text-stone-50'
                        : 'text-stone-500 hover:bg-amber-50/[0.04] hover:text-stone-200',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                    <kbd aria-hidden="true" className="ml-auto hidden font-mono text-[10px] text-white/25 lg:inline">{item.key}</kbd>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <motion.main key={tool} {...transition} className="min-w-0">
          {tool === 'live' ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-100/10 bg-amber-50/[0.03] px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-stone-200">Consulting-domain event feed</p>
                  <p className="text-xs text-stone-500">Platform events only; this is not a client activity collector.</p>
                </div>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
              </div>
              <RealtimeDataPanel domain="consulting" data={latestData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
            </div>
          ) : panel}
        </motion.main>
      </div>
    </NorthStarFrame>
  );
}
