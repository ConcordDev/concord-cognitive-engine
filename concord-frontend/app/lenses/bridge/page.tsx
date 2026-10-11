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
  Activity, Baby, GitMerge, Loader2, MessageSquare, Network,
  Radio, RefreshCw, Shield, Zap,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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
import type {
  BirthCert, BridgeLogAccess, BridgeLogEntry, BridgeView, CatalogStatus, Debate, EmergentRole, Organism,
} from '@/components/bridge/types';

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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [selectedDtuId, setSelectedDtuId] = useState<string | null>(null);
  const {
    organisms, organismStatus,
    log, logAccess,
    debates, debateStatus,
    births, birthStatus,
    emergents, emergentStatus,
    loading, refresh,
  } = useBridgeData();

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

  const titles: Record<BridgeView, string> = {
    activity: `Watch the bridge${who ? `, ${who}` : ''}`,
    organisms: 'Meet the organisms',
    debates: 'Hear the debates',
    lifecycle: 'Follow the births',
    emergents: 'See what emerged',
    federation: 'Connect the federation',
    actions: 'Act on the bridge',
  };

  return (
    <LensShell lensId="bridge" asMain={false}>
      <FirstRunTour lensId="bridge" />
      <DepthBadge lensId="bridge" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="bridge"
        crumb="Organism Bridge"
        title={titles[active]}
        subtitle="Emergent ↔ Knowledge Organism communication"
        actions={(
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="bridge" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2.5 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </>
        )}
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys }))}
        activeTab={active}
        onTab={(id) => setActive(id as BridgeView)}
        tabsLabel="Bridge views"
        cta={{ label: loading ? 'Refreshing…' : 'Refresh bridge', icon: RefreshCw, onClick: refresh, disabled: loading, title: 'Re-read organisms, debates and events' }}
      >

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { id: 'organisms', label: 'Organisms', value: catalogCount(organismStatus, organisms.length), icon: <Network className="w-5 h-5 text-purple-400" />, color: 'text-purple-400' },
            { id: 'events', label: 'Bridge Events', value: eventCount(logAccess, log.length), icon: <Activity className="w-5 h-5 text-cyan-400" />, color: 'text-cyan-400' },
            { id: 'debates', label: 'Debates', value: catalogCount(debateStatus, debates.length), icon: <MessageSquare className="w-5 h-5 text-amber-400" />, color: 'text-amber-400' },
            { id: 'emergents', label: 'Emergent Roles', value: catalogCount(emergentStatus, emergents.length), icon: <Radio className="w-5 h-5 text-green-400" />, color: 'text-green-400' },
          ].map((stat, i) => {
            const numeric = /^\d+$/.test(stat.value);
            return (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08, duration: 0.35 }}
                className="rounded-2xl border border-white/10 bg-[#111] p-4"
              >
                <div className="flex items-center gap-2 mb-2">{stat.icon}</div>
                <p
                  data-testid={`bridge-stat-${stat.id}`}
                  role="status"
                  className={numeric ? `text-2xl font-bold font-mono ${stat.color}` : 'text-sm font-semibold tracking-tight text-zinc-200'}
                >
                  {stat.value}
                </p>
                <p className="text-xs text-zinc-400">{stat.label}</p>
              </motion.div>
            );
          })}
        </div>


        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-zinc-600" />
          </div>
        ) : (
          <BridgePane
            active={active}
            log={log}
            logAccess={logAccess}
            organisms={organisms}
            organismStatus={organismStatus}
            debates={debates}
            debateStatus={debateStatus}
            births={births}
            birthStatus={birthStatus}
            emergents={emergents}
            emergentStatus={emergentStatus}
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

        <section className="mt-6 rounded-2xl border border-white/10 bg-[#111] p-4">
          <ConcordLinkWalkers />
        </section>

      </NorthStarFrame>
    </LensShell>
  );
}

function catalogCount(status: CatalogStatus, count: number): string {
  if (status === 'loading') return '…';
  if (status === 'unavailable') return 'unavailable';
  return String(count);
}

function eventCount(access: BridgeLogAccess, count: number): string {
  if (access === 'pending') return '…';
  if (access === 'operator-only') return 'operator-only';
  if (access === 'unavailable') return 'unavailable';
  return String(count);
}

function BridgePane({
  active, log, logAccess, organisms, organismStatus, debates, debateStatus, births, birthStatus, emergents, emergentStatus, onRefresh, onDtuClick,
}: {
  active: BridgeView;
  log: BridgeLogEntry[];
  logAccess: BridgeLogAccess;
  organisms: Organism[];
  organismStatus: CatalogStatus;
  debates: Debate[];
  debateStatus: CatalogStatus;
  births: BirthCert[];
  birthStatus: CatalogStatus;
  emergents: EmergentRole[];
  emergentStatus: CatalogStatus;
  onRefresh: () => void;
  onDtuClick: (id: string) => void;
}) {
  if (active === 'activity') return <ActivityPanel log={log} access={logAccess} onDtuClick={onDtuClick} />;
  if (active === 'organisms') return <OrganismsPanel organisms={organisms} status={organismStatus} onRefresh={onRefresh} />;
  if (active === 'debates') return <DebatesPanel debates={debates} status={debateStatus} onDtuClick={onDtuClick} />;
  if (active === 'lifecycle') return <LifecyclePanel births={births} status={birthStatus} />;
  if (active === 'emergents') return <EmergentsPanel emergents={emergents} status={emergentStatus} />;
  if (active === 'federation') return <FederationConsole />;
  return <BridgeActionsPanel />;
}
