'use client';

/**
 * Integrations — Zapier-style workflows, connectors, webhooks & analysis.
 * Thin shell + one `active` union; WebhooksPanel owns webhook macros.
 */

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { IntegrationsRepos } from '@/components/integrations/IntegrationsRepos';
import { WorkflowsPanel } from '@/components/integrations/WorkflowsPanel';
import { ConnectorCatalog } from '@/components/integrations/ConnectorCatalog';
import { AnalysisPanel } from '@/components/integrations/AnalysisPanel';
import { WebhooksPanel } from '@/components/integrations/WebhooksPanel';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers, lensRun } from '@/lib/api/client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plug, Webhook, Zap, Plus, Link, ShieldCheck, Activity } from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

type Tab = 'workflows' | 'connectors' | 'webhooks' | 'analysis';

const TAB_KEYS: Record<Tab, string> = { workflows: 'Z', connectors: 'C', webhooks: 'W', analysis: 'A' };

export default function IntegrationsLensPage() {
  useLensNav('integrations');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('integrations');
  const [active, setActive] = useState<Tab>('workflows');
  const [showCreate, setShowCreate] = useState(false);

  useLensCommand(
    [
      { id: 'tab-workflows', keys: 'z', description: 'Workflows', category: 'navigation', action: () => setActive('workflows') },
      { id: 'tab-connectors', keys: 'c', description: 'Connectors', category: 'navigation', action: () => setActive('connectors') },
      { id: 'tab-webhooks', keys: 'w', description: 'Webhooks', category: 'navigation', action: () => setActive('webhooks') },
      { id: 'tab-analysis', keys: 'a', description: 'Analysis', category: 'navigation', action: () => setActive('analysis') },
    ],
    { lensId: 'integrations' }
  );

  const { data: webhooks, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => apiHelpers.webhooks.list().then(r => r.data),
  });

  const { data: connections } = useQuery({
    queryKey: ['integrations', 'connectionList'],
    queryFn: async () => {
      const r = await lensRun<{ connections: Array<{ credentialStored?: boolean }> }>('integrations', 'connectionList', {});
      return r.data.result?.connections || [];
    },
  });

  const { data: zaps } = useQuery({
    queryKey: ['integrations', 'zapList'],
    queryFn: async () => {
      const r = await lensRun<{ zaps: Array<{ enabled: boolean }> }>('integrations', 'zapList', {});
      return r.data.result?.zaps || [];
    },
  });

  const connectedCount = connections?.length || 0;
  const authorizedCount = connections?.filter((c) => c.credentialStored).length || 0;
  const activeZaps = zaps?.filter((z) => z.enabled).length || 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={() => refetch()} />
      </div>
    );
  }

  const TABS: Array<{ id: Tab; label: string; icon: React.ReactNode; count?: number }> = [
    { id: 'workflows', label: 'Workflows', icon: <Zap className="w-4 h-4" />, count: zaps?.length },
    { id: 'connectors', label: 'Connectors', icon: <Plug className="w-4 h-4" />, count: connectedCount || undefined },
    { id: 'webhooks', label: 'Webhooks', icon: <Webhook className="w-4 h-4" />, count: webhooks?.count },
    { id: 'analysis', label: 'Analysis', icon: <Activity className="w-4 h-4" />, count: undefined },
  ];

  return (
    <LensShell lensId="integrations" asMain={false}>
      <FirstRunTour lensId="integrations" />
      <DepthBadge lensId="integrations" size="sm" className="ml-2" />
      <div className="p-6 space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Plug className="w-8 h-8 text-neon-green" />
            <div>
              <h1 className="text-xl font-bold">Integrations</h1>
              <p className="text-sm text-gray-400">
                Zapier-style workflows, app connectors, webhooks &amp; integration analysis
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
              <DTUExportButton domain="integrations" data={realtimeData || {}} compact />
              {realtimeAlerts.length > 0 && (
                <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                  {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
          {active === 'webhooks' && (
            <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Add Webhook
            </button>
          )}
        </header>

        <div className="grid grid-cols-4 gap-4">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }} className="panel p-3 flex items-center gap-3">
            <Link className="w-5 h-5 text-neon-green" />
            <div><p className="text-lg font-bold">{connectedCount}</p><p className="text-xs text-gray-400">Linked apps</p></div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="panel p-3 flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-neon-cyan" />
            <div><p className="text-lg font-bold">{authorizedCount}</p><p className="text-xs text-gray-400">OAuth-authorized</p></div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="panel p-3 flex items-center gap-3">
            <Zap className="w-5 h-5 text-neon-purple" />
            <div><p className="text-lg font-bold">{activeZaps}</p><p className="text-xs text-gray-400">Active workflows</p></div>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="panel p-3 flex items-center gap-3">
            <Webhook className="w-5 h-5 text-red-400" />
            <div><p className="text-lg font-bold">{webhooks?.count || 0}</p><p className="text-xs text-gray-400">Webhooks</p></div>
          </motion.div>
        </div>

        <div className="flex gap-2 border-b border-lattice-border flex-wrap">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              title={`${tab.label} (press ${TAB_KEYS[tab.id]})`}
              className={`flex items-center gap-2 px-4 py-2 border-b-2 transition-colors ${
                active === tab.id
                  ? 'border-neon-green text-neon-green'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.count !== undefined && (
                <span className="text-xs bg-lattice-surface px-1.5 py-0.5 rounded">{tab.count || 0}</span>
              )}
              <kbd className="text-[9px] font-mono px-1 py-0.5 rounded bg-lattice-deep border border-lattice-border text-gray-500 hidden sm:inline">{TAB_KEYS[tab.id]}</kbd>
            </button>
          ))}
        </div>

        {active === 'workflows' && <WorkflowsPanel />}
        {active === 'connectors' && <ConnectorCatalog />}
        {active === 'analysis' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-400">
              Deterministic integration engines — latency percentiles, flow-graph bottleneck detection, and semver compatibility scoring. Edit the inputs and run against the real backend.
            </p>
            <AnalysisPanel />
          </div>
        )}
        {active === 'webhooks' && (
          <WebhooksPanel showCreate={showCreate} setShowCreate={setShowCreate} />
        )}

        <RealtimeDataPanel data={realtimeInsights} />

        <details className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-white">Integration tooling (external reference)</summary>
          <div className="mt-3"><IntegrationsRepos /></div>
        </details>
      </div>
      <CrossLensRecentsPanel lensId="integrations" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
