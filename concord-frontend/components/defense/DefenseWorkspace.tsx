'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  Activity, AlertTriangle, Crosshair, FileSearch, Map, Radio, Satellite,
  Shield, Target, Truck, Users,
} from 'lucide-react';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { PipingProvider } from '@/components/panel-polish';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useLensStatePersistence } from '@/lib/lens-state-persistence';
import { cn } from '@/lib/utils';
import { AssetReadiness } from './AssetReadiness';
import { CommsLog } from './CommsLog';
import { CommonOperatingPicture } from './CommonOperatingPicture';
import { ContractSearch } from './ContractSearch';
import { DashboardStats } from './DashboardStats';
import { DefenseActionPanel } from './DefenseActionPanel';
import { LogisticsBoard } from './LogisticsBoard';
import { MissionPlanner } from './MissionPlanner';
import { PersonnelRoster } from './PersonnelRoster';
import { ResourceAllocationPanel } from './ResourceAllocationPanel';
import { ThreatBoard } from './ThreatBoard';

type BriefTool =
  | 'overview' | 'map' | 'missions' | 'assets' | 'threats' | 'personnel'
  | 'logistics' | 'communications' | 'analysis' | 'contracts' | 'live';

const TOOLS: { id: BriefTool; label: string; icon: typeof Shield; key: string }[] = [
  { id: 'overview', label: 'Overview', icon: Shield, key: '1' },
  { id: 'map', label: 'Map', icon: Map, key: '2' },
  { id: 'missions', label: 'Missions', icon: Target, key: '3' },
  { id: 'assets', label: 'Assets', icon: Crosshair, key: '4' },
  { id: 'threats', label: 'Threats', icon: AlertTriangle, key: '5' },
  { id: 'personnel', label: 'Personnel', icon: Users, key: '6' },
  { id: 'logistics', label: 'Logistics', icon: Truck, key: '7' },
  { id: 'communications', label: 'Comms log', icon: Radio, key: '8' },
  { id: 'analysis', label: 'Analysis', icon: Activity, key: '9' },
  { id: 'contracts', label: 'Contracts', icon: FileSearch, key: '0' },
  { id: 'live', label: 'Live feed', icon: Satellite, key: 'l' },
];
const TOOL_IDS = new Set(TOOLS.map((tool) => tool.id));

function isBriefTool(value: unknown): value is BriefTool {
  return typeof value === 'string' && TOOL_IDS.has(value as BriefTool);
}

export function DefenseWorkspace({ who }: { who: string }) {
  useLensIdentity('defense');
  const { restore, persist } = useLensStatePersistence('defense');
  const [initialState] = useState(() => restore());
  const [opened, setOpened] = useState(() => initialState?.opened === true);
  const [tool, setTool] = useState<BriefTool>(() => isBriefTool(initialState?.tool) ? initialState.tool : 'overview');
  const { latestData, isLive, lastUpdated, insights } = useRealtimeLens('defense');

  const selectTool = useCallback((next: BriefTool) => {
    setOpened(true);
    setTool(next);
    persist({ opened: true, tool: next });
  }, [persist]);

  const openBrief = useCallback(() => {
    setOpened(true);
    setTool('overview');
    persist({ opened: true, tool: 'overview' });
  }, [persist]);

  useLensCommand(
    TOOLS.map((item) => ({
      id: `defense-${item.id}`,
      keys: item.key,
      description: `Open Defense ${item.label}`,
      category: 'navigation' as const,
      action: () => selectTool(item.id),
    })),
    { lensId: 'defense' },
  );

  let body: ReactNode;
  if (tool === 'overview') body = <DashboardStats />;
  else if (tool === 'map') body = <CommonOperatingPicture />;
  else if (tool === 'missions') body = <MissionPlanner />;
  else if (tool === 'assets') body = <AssetReadiness />;
  else if (tool === 'threats') body = <ThreatBoard />;
  else if (tool === 'personnel') body = <PersonnelRoster />;
  else if (tool === 'logistics') body = <LogisticsBoard />;
  else if (tool === 'communications') body = <CommsLog />;
  else if (tool === 'analysis') {
    body = (
      <div className="space-y-4">
        <PipingProvider><DefenseActionPanel /></PipingProvider>
        <div>
          <p className="mb-2 text-xs text-zinc-500">What-if allocation workspace. Inputs remain transient until added to a mission plan.</p>
          <ResourceAllocationPanel />
        </div>
      </div>
    );
  } else if (tool === 'contracts') body = <ContractSearch />;
  else {
    body = (
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <div>
            <p className="text-sm font-medium text-zinc-200">Defense domain event feed</p>
            <p className="text-xs text-zinc-500">Platform events only; this is not authenticated military telemetry.</p>
          </div>
          <div className="flex items-center gap-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="defense" data={latestData || {}} compact />
          </div>
        </div>
        <RealtimeDataPanel domain="defense" data={latestData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      </div>
    );
  }

  return (
    <div data-lens-theme="defense" className="relative min-h-full bg-[#07090b] px-4 pb-28 pt-6 sm:px-8">
      <header>
        <p className="text-sm text-zinc-600">Defense</p>
        <h1 className="font-vault mt-1 text-4xl leading-tight text-zinc-100 sm:text-5xl">
          The brief{who ? `, ${who}` : ''}
        </h1>
      </header>

      {!opened ? (
        <EmptyBrief onOpen={openBrief} />
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-[9.5rem_minmax(0,1fr)]">
          <nav aria-label="Defense brief tools" className="flex gap-1 overflow-x-auto border-b border-white/10 pb-2 lg:flex-col lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4">
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
    </div>
  );
}

function EmptyBrief({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="relative flex min-h-[66vh] flex-col items-center justify-center overflow-hidden text-center">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(255,255,255,.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.03)_1px,transparent_1px)] [background-size:44px_44px]" />
      <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="relative">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.06]">
          <Shield className="h-6 w-6 text-cyan-200" />
        </div>
        <h2 className="mt-5 text-xl font-medium text-zinc-200">No brief open.</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-600">
          Open the command brief to map operations, plan missions, track readiness, and record decisions against the real workspace.
        </p>
        <button type="button" onClick={onOpen} className="mt-7 rounded-full bg-zinc-100 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition-transform active:scale-[0.98]">
          Open a brief
        </button>
      </motion.div>
    </div>
  );
}
