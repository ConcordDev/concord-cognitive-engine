'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, Building2, Loader2, Radio, Satellite, Siren } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useLensStatePersistence } from '@/lib/lens-state-persistence';
import { cn } from '@/lib/utils';
import { AgencyMutualAidPanel } from './AgencyMutualAidPanel';
import { CADConsole } from './CADConsole';
import { EmergencyServicesActionPanel } from './EmergencyServicesActionPanel';
import { QuakeFeed } from './QuakeFeed';

type BoardTool = 'board' | 'agency' | 'field' | 'seismic';

interface DashboardResult {
  incidents: number;
  openIncidents: number;
  units: number;
  availableUnits: number;
  byKind: Record<string, number>;
}

const TOOLS: { id: BoardTool; label: string; icon: typeof Radio; key: string }[] = [
  { id: 'board', label: 'Call board', icon: Radio, key: '1' },
  { id: 'agency', label: 'Agency', icon: Building2, key: '2' },
  { id: 'field', label: 'Field tools', icon: Activity, key: '3' },
  { id: 'seismic', label: 'Seismic', icon: Satellite, key: '4' },
];
const TOOL_IDS = new Set(TOOLS.map((tool) => tool.id));

function isBoardTool(value: unknown): value is BoardTool {
  return typeof value === 'string' && TOOL_IDS.has(value as BoardTool);
}

export function EmergencyWorkspace({ who }: { who: string }) {
  useLensIdentity('emergency-services');
  const { restore, persist } = useLensStatePersistence('emergency-services');
  const [initialState] = useState(() => restore());
  const [tool, setTool] = useState<BoardTool>(() => isBoardTool(initialState?.tool) ? initialState.tool : 'board');
  const [boardOpened, setBoardOpened] = useState(() => initialState?.boardOpened === true);
  const [dashboard, setDashboard] = useState<DashboardResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadBoard = useCallback(async () => {
    setLoading(true);
    try {
      const response = await lensRun<DashboardResult>('emergency-services', 'ems-dashboard', {});
      if (response.data?.ok === false) {
        throw new Error(response.data.error || 'The dispatch board could not be loaded.');
      }
      const next = response.data?.result || null;
      setDashboard(next);
      setLoadError(null);
      if ((next?.openIncidents || 0) > 0) setBoardOpened(true);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'The dispatch board could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => { void loadBoard(); });
    return () => cancelAnimationFrame(frame);
  }, [loadBoard]);

  const selectTool = useCallback((next: BoardTool) => {
    setTool(next);
    setBoardOpened(true);
    persist({ tool: next, boardOpened: true });
  }, [persist]);

  const openBoard = useCallback(() => {
    setBoardOpened(true);
    setTool('board');
    persist({ tool: 'board', boardOpened: true });
  }, [persist]);

  useLensCommand(
    TOOLS.map((item) => ({
      id: `emergency-services-${item.id}`,
      keys: item.key,
      description: `Open Emergency Services ${item.label}`,
      category: 'navigation' as const,
      action: () => selectTool(item.id),
    })),
    { lensId: 'emergency-services' },
  );

  return (
    <div data-lens-theme="emergency-services" className="relative min-h-full bg-[#070707] px-4 pb-28 pt-6 sm:px-8">
      <header>
        <p className="text-sm text-zinc-600">Emergency Services</p>
        <h1 className="font-vault mt-1 text-4xl leading-tight text-zinc-100 sm:text-5xl">
          The call{who ? `, ${who}` : ''}
        </h1>
        {boardOpened && dashboard && (
          <p className="mt-2 text-sm text-zinc-500">
            {dashboard.openIncidents} open · {dashboard.availableUnits} available · {dashboard.units} rostered
          </p>
        )}
      </header>

      {loading ? (
        <div role="status" aria-live="polite" className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the call board...
        </div>
      ) : loadError ? (
        <div role="alert" className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
          <p className="max-w-md text-sm text-rose-300">{loadError}</p>
          <button type="button" onClick={() => void loadBoard()} className="rounded-full border border-rose-400/30 px-4 py-2 text-sm text-rose-200">
            Retry
          </button>
        </div>
      ) : !boardOpened ? (
        <EmptyCallBoard onOpen={openBoard} />
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-[9rem_minmax(0,1fr)]">
          <nav aria-label="Call board tools" className="flex gap-1 overflow-x-auto border-b border-white/10 pb-2 lg:flex-col lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4">
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
            {tool === 'board' && <CADConsole />}
            {tool === 'agency' && <AgencyMutualAidPanel />}
            {tool === 'field' && <EmergencyServicesActionPanel />}
            {tool === 'seismic' && <QuakeFeed />}
          </motion.main>
        </div>
      )}
    </div>
  );
}

function EmptyCallBoard({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="relative flex min-h-[66vh] flex-col items-center justify-center overflow-hidden text-center">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-16 space-y-5 opacity-45">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="h-px bg-gradient-to-r from-transparent via-zinc-800 to-transparent" />
        ))}
      </div>
      <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="relative">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-500/20 bg-rose-500/[0.06]">
          <Siren className="h-6 w-6 text-rose-300" />
        </div>
        <h2 className="mt-5 text-xl font-medium text-zinc-200">No call on the board.</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-600">
          Open the live board to log an incident, position units, and dispatch the nearest available crew.
        </p>
        <button
          type="button"
          onClick={onOpen}
          className="mt-7 rounded-full bg-zinc-100 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition-transform active:scale-[0.98]"
        >
          Open the board
        </button>
      </motion.div>
    </div>
  );
}
