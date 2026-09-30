'use client';

/**
 * Bridge — one organism-bridge ops console.
 * Single view union drives tabs; panels own screen JSX. Macros preserved in
 * BridgeActionsPanel (connectionHealth/dataMapping/syncStatus/throughputAnalysis)
 * + FederationConsole + ConcordLinkWalkers.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity, ArrowLeftRight, Baby, GitMerge, Loader2, MessageSquare, Network,
  Radio, RefreshCw, Shield, Zap,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { ConcordLinkWalkers } from '@/components/bridge/ConcordLinkWalkers';
import { FederationConsole } from '@/components/bridge/FederationConsole';
import { BridgeDtuModal } from '@/components/bridge/BridgeDtuModal';
import { ActivityPanel } from '@/components/bridge/ActivityPanel';
import { OrganismsPanel } from '@/components/bridge/OrganismsPanel';
import { DebatesPanel } from '@/components/bridge/DebatesPanel';
import { LifecyclePanel } from '@/components/bridge/LifecyclePanel';
import { EmergentsPanel } from '@/components/bridge/EmergentsPanel';
import { BridgeActionsPanel } from '@/components/bridge/BridgeActionsPanel';
import { useBridgeData } from '@/components/bridge/useBridgeData';
import type { BridgeView } from '@/components/bridge/types';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';

const VIEWS: { id: BridgeView; label: string; keys: string; icon: typeof Activity }[] = [
  { id: 'activity', label: 'Activity', keys: 'a', icon: Activity },
  { id: 'organisms', label: 'Organisms', keys: 'o', icon: Network },
  { id: 'debates', label: 'Debates', keys: 'd', icon: MessageSquare },
  { id: 'lifecycle', label: 'Lifecycle', keys: 'l', icon: Baby },
  { id: 'emergents', label: 'Emergents', keys: 'e', icon: Shield },
  { id: 'federation', label: 'Federation', keys: 'f', icon: GitMerge },
  { id: 'actions', label: 'Actions', keys: 'x', icon: Zap },
];

export default function BridgeLens() {
  useLensNav('bridge');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('bridge');
  const [active, setActive] = useState<BridgeView>('activity');
  const [selectedDtuId, setSelectedDtuId] = useState<string | null>(null);
  const { organisms, log, debates, births, emergents, loading, refresh } = useBridgeData();

  useLensCommand(
    VIEWS.map((v) => ({
      id: `tab-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'bridge' },
  );

  return (
    <LensShell lensId="bridge" asMain={false}>
      <FirstRunTour lensId="bridge" />
      <DepthBadge lensId="bridge" size="sm" className="ml-2" />
      <div data-lens-theme="bridge" className={cn(ds.pageContainer, 'bg-zinc-950 text-zinc-100')}>
        <header className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center shrink-0">
              <ArrowLeftRight className="w-5 h-5 text-purple-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold">Organism Bridge</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="bridge" data={realtimeData || {}} compact />
                {realtimeAlerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                    {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className="text-sm text-zinc-400">Emergent ↔ Knowledge Organism Communication</p>
            </div>
          </div>
          <button onClick={refresh} className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500" title="Refresh">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Organisms', value: organisms.length, icon: <Network className="w-5 h-5 text-purple-400" />, color: 'text-purple-400' },
            { label: 'Bridge Events', value: log.length, icon: <Activity className="w-5 h-5 text-cyan-400" />, color: 'text-cyan-400' },
            { label: 'Debates', value: debates.length, icon: <MessageSquare className="w-5 h-5 text-amber-400" />, color: 'text-amber-400' },
            { label: 'Emergent Roles', value: emergents.length, icon: <Radio className="w-5 h-5 text-green-400" />, color: 'text-green-400' },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, duration: 0.35 }}
              className="p-4 bg-zinc-900 rounded-lg border border-zinc-800"
            >
              <div className="flex items-center gap-2 mb-2">{stat.icon}</div>
              <p className={`text-2xl font-bold font-mono ${stat.color}`}>{stat.value}</p>
              <p className="text-xs text-zinc-400">{stat.label}</p>
            </motion.div>
          ))}
        </div>

        <nav className="flex gap-1 mb-6 bg-zinc-900 rounded-lg p-1 overflow-x-auto" aria-label="Bridge views">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
                  on ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-300',
                )}
              >
                <Icon className="w-4 h-4" />
                <span className="capitalize">{v.label}</span>
                <kbd className="hidden sm:inline text-[10px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5 font-mono">{v.keys}</kbd>
              </button>
            );
          })}
        </nav>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-zinc-600" />
          </div>
        ) : (
          <BridgePane
            active={active}
            log={log}
            organisms={organisms}
            debates={debates}
            births={births}
            emergents={emergents}
            onRefresh={refresh}
            onDtuClick={setSelectedDtuId}
          />
        )}

        <RealtimeDataPanel data={realtimeInsights} />

        <BridgeDtuModal
          dtuId={selectedDtuId}
          onClose={() => setSelectedDtuId(null)}
          onNavigate={(id) => setSelectedDtuId(id)}
        />

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <ConcordLinkWalkers />
        </section>

        <CrossLensRecentsPanel lensId="bridge" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}

function BridgePane({
  active, log, organisms, debates, births, emergents, onRefresh, onDtuClick,
}: {
  active: BridgeView;
  log: import('@/components/bridge/types').BridgeLogEntry[];
  organisms: import('@/components/bridge/types').Organism[];
  debates: import('@/components/bridge/types').Debate[];
  births: import('@/components/bridge/types').BirthCert[];
  emergents: import('@/components/bridge/types').EmergentRole[];
  onRefresh: () => void;
  onDtuClick: (id: string) => void;
}) {
  if (active === 'activity') return <ActivityPanel log={log} onDtuClick={onDtuClick} />;
  if (active === 'organisms') return <OrganismsPanel organisms={organisms} onRefresh={onRefresh} />;
  if (active === 'debates') return <DebatesPanel debates={debates} onDtuClick={onDtuClick} />;
  if (active === 'lifecycle') return <LifecyclePanel births={births} />;
  if (active === 'emergents') return <EmergentsPanel emergents={emergents} />;
  if (active === 'federation') return <FederationConsole />;
  return <BridgeActionsPanel />;
}
