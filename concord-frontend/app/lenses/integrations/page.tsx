'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { IntegrationsRepos } from '@/components/integrations/IntegrationsRepos';
import { WorkflowsPanel } from '@/components/integrations/WorkflowsPanel';
import { ConnectorCatalog } from '@/components/integrations/ConnectorCatalog';
import { AnalysisPanel } from '@/components/integrations/AnalysisPanel';
import { WebhookSignatureVerifier } from '@/components/integrations/WebhookSignatureVerifier';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers, lensRun } from '@/lib/api/client';
import type { CreateWebhookRequest } from '@/lib/api/generated-types';
import { useUIStore } from '@/store/ui';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plug, Webhook, Zap, Plus, Trash2, ToggleLeft, ToggleRight, Link, AlertCircle, Loader2, CheckCircle, Send, Clock, Activity, ShieldCheck } from 'lucide-react';
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
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('workflows');

  // Lens-scoped keyboard commands (surfaced as kbd chips on each tab).
  useLensCommand(
    [
      { id: 'tab-workflows', keys: 'z', description: 'Workflows', category: 'navigation', action: () => setActiveTab('workflows') },
      { id: 'tab-connectors', keys: 'c', description: 'Connectors', category: 'navigation', action: () => setActiveTab('connectors') },
      { id: 'tab-webhooks', keys: 'w', description: 'Webhooks', category: 'navigation', action: () => setActiveTab('webhooks') },
      { id: 'tab-analysis', keys: 'a', description: 'Analysis', category: 'navigation', action: () => setActiveTab('analysis') },
    ],
    { lensId: 'integrations' }
  );
  const [showCreate, setShowCreate] = useState(false);
  const [webhookTestResults, setWebhookTestResults] = useState<Record<string, { status: 'loading' | 'success' | 'error'; message: string }>>({});
  const [showDeliveryLog, setShowDeliveryLog] = useState<string | null>(null);
  const [showVerifyFor, setShowVerifyFor] = useState<string | null>(null);

  // ── Real stat sources (replaces the prior fabricated artifact-CRUD reads) ──
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

  const createWebhookMutation = useMutation({
    mutationFn: (data: CreateWebhookRequest) => apiHelpers.webhooks.register(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      setShowCreate(false);
    },
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const deleteWebhookMutation = useMutation({
    mutationFn: (id: string) => apiHelpers.webhooks.deactivate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['webhooks'] }),
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const toggleWebhookMutation = useMutation({
    // /api/webhooks/:id/activate has no REST route — resolve via the
    // integrations domain macros (webhookActivate / webhooks.deactivate).
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      if (enabled) {
        await apiHelpers.webhooks.deactivate(id);
      } else {
        const r = await lensRun('integrations', 'webhookActivate', { webhookId: id, enabled: true });
        if (r.data.ok === false) throw new Error(r.data.error || 'Activate failed');
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['webhooks'] }),
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const testWebhookMutation = useMutation({
    // /api/webhooks/:id/test has no REST route — resolve via the integrations
    // domain webhookTest macro, which records a signed test-fire delivery. The
    // macro returns ok:false (surfaced by lensRun as r.data.ok) when there is
    // no target URL, so a fabricated success is impossible here.
    mutationFn: async (wh: { id: string; url: string; events: string[] }) => {
      const testPayload = {
        event: wh.events?.[0] || 'test.ping',
        timestamp: new Date().toISOString(),
        data: { message: 'Test payload from Concord', webhookId: wh.id },
      };
      const r = await lensRun<{ delivered: boolean; signature: string; message: string }>(
        'integrations', 'webhookTest', { webhookId: wh.id, url: wh.url, payload: testPayload },
      );
      if (r.data.ok === false) throw new Error(r.data.error || 'Test delivery failed');
      return r.data.result;
    },
    onMutate: (wh) => {
      setWebhookTestResults((prev) => ({ ...prev, [wh.id]: { status: 'loading', message: 'Sending signed test payload...' } }));
    },
    onSuccess: (data, wh) => {
      const sig = data?.signature ? ` (sig ${data.signature.slice(0, 14)}…)` : '';
      setWebhookTestResults((prev) => ({ ...prev, [wh.id]: { status: 'success', message: `Test delivered successfully${sig}` } }));
      setTimeout(() => setWebhookTestResults((prev) => { const n = { ...prev }; delete n[wh.id]; return n; }), 5000);
    },
    onError: (err, wh) => {
      const msg = err instanceof Error ? err.message : 'Test delivery failed';
      setWebhookTestResults((prev) => ({ ...prev, [wh.id]: { status: 'error', message: msg } }));
      setTimeout(() => setWebhookTestResults((prev) => { const n = { ...prev }; delete n[wh.id]; return n; }), 8000);
    },
  });

  // Delivery log: integrations.webhookDeliveries returns test-fire + retry
  // records (signed, with backoff metadata) — richer than the REST deliveries.
  const { data: deliveryLog } = useQuery({
    queryKey: ['webhook-deliveries', showDeliveryLog],
    queryFn: async () => {
      if (!showDeliveryLog) return null;
      const r = await lensRun<{ deliveries: Record<string, unknown>[] }>(
        'integrations', 'webhookDeliveries', { webhookId: showDeliveryLog, limit: 50 },
      );
      return r.data.result;
    },
    enabled: !!showDeliveryLog,
  });

  const retryDeliveryMutation = useMutation({
    mutationFn: ({ webhookId, deliveryId }: { webhookId: string; deliveryId: string }) =>
      lensRun('integrations', 'webhookRetry', { webhookId, deliveryId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['webhook-deliveries'] }),
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Retry failed or attempts exhausted.' });
    },
  });

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
      <ManifestActionBar />
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

      {/* Real-time Enhancement Toolbar */}
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
        {activeTab === 'webhooks' && (
          <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Add Webhook
          </button>
        )}
      </header>

      {/* Stats Row — real counts from connectionList / zapList / webhooks */}
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

      {/* Tabs (single-key shortcuts shown as kbd chips) */}
      <div className="flex gap-2 border-b border-lattice-border flex-wrap">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            title={`${tab.label} (press ${TAB_KEYS[tab.id]})`}
            className={`flex items-center gap-2 px-4 py-2 border-b-2 transition-colors ${
              activeTab === tab.id
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

      {/* Content */}
      {activeTab === 'workflows' && <WorkflowsPanel />}

      {activeTab === 'connectors' && <ConnectorCatalog />}

      {activeTab === 'analysis' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">
            Deterministic integration engines — latency percentiles, flow-graph bottleneck detection, and semver compatibility scoring. Edit the inputs and run against the real backend.
          </p>
          <AnalysisPanel />
        </div>
      )}

      {activeTab === 'webhooks' && (
        <div className="space-y-3">
          {/* Webhook Ingest URL */}
          <WebhookIngestInfo />

          {webhooks?.webhooks?.length === 0 ? (
            <EmptyState icon={<Webhook />} message="No webhooks configured" />
          ) : (
            webhooks?.webhooks?.map((wh: Record<string, unknown>, index: number) => (
              <motion.div key={wh.id as string} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="panel p-4">
                <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{String(wh.name)}</h3>
                  <p className="text-xs text-gray-400 truncate max-w-md">{String(wh.url)}</p>
                  <div className="flex gap-2 mt-1">
                    {(wh.events as string[])?.map((e: string) => (
                      <span key={e} className="text-xs bg-lattice-surface px-2 py-0.5 rounded">{e}</span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-400">{String(wh.triggerCount)} triggers</span>
                  <button
                    onClick={() => testWebhookMutation.mutate({ id: wh.id as string, url: wh.url as string, events: wh.events as string[] })}
                    disabled={webhookTestResults[wh.id as string]?.status === 'loading'}
                    className="btn-secondary text-xs flex items-center gap-1 px-2 py-1"
                    title="Send test payload"
                  >
                    {webhookTestResults[wh.id as string]?.status === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    Test
                  </button>
                  <button
                    onClick={() => setShowDeliveryLog(showDeliveryLog === (wh.id as string) ? null : (wh.id as string))}
                    className="text-gray-400 hover:text-neon-cyan text-xs flex items-center gap-1"
                    title="View delivery log"
                  >
                    <Clock className="w-3 h-3" />
                    Log
                  </button>
                  <button
                    onClick={() => setShowVerifyFor(showVerifyFor === (wh.id as string) ? null : (wh.id as string))}
                    className="text-gray-400 hover:text-neon-cyan text-xs flex items-center gap-1"
                    title="Verify an inbound signature"
                  >
                    <ShieldCheck className="w-3 h-3" />
                    Verify
                  </button>
                  <button
                    onClick={() => toggleWebhookMutation.mutate({ id: wh.id as string, enabled: !(wh.enabled as boolean) })}
                    disabled={toggleWebhookMutation.isPending}
                    className="text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {wh.enabled ? <ToggleRight className="w-6 h-6 text-green-500" /> : <ToggleLeft className="w-6 h-6" />}
                  </button>
                  <button
                    onClick={() => deleteWebhookMutation.mutate(wh.id as string)}
                    disabled={deleteWebhookMutation.isPending}
                    className="text-gray-400 hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Delete">
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
                </div>
                {webhookTestResults[wh.id as string] && (
                  <div className={`mt-2 text-xs px-3 py-1.5 rounded ${
                    webhookTestResults[wh.id as string].status === 'success' ? 'bg-green-500/10 text-green-400' :
                    webhookTestResults[wh.id as string].status === 'error' ? 'bg-red-500/10 text-red-400' :
                    'bg-blue-500/10 text-blue-400'
                  }`}>
                    {webhookTestResults[wh.id as string].status === 'success' && <CheckCircle className="w-3 h-3 inline mr-1" />}
                    {webhookTestResults[wh.id as string].status === 'error' && <AlertCircle className="w-3 h-3 inline mr-1" />}
                    {webhookTestResults[wh.id as string].message}
                  </div>
                )}
                {showDeliveryLog === (wh.id as string) && (
                  <div className="mt-3 border-t border-lattice-border pt-3">
                    <h4 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Recent Deliveries
                    </h4>
                    {!deliveryLog || (Array.isArray(deliveryLog) && deliveryLog.length === 0) ? (
                      <p className="text-xs text-gray-400">No deliveries recorded yet.</p>
                    ) : (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {(Array.isArray(deliveryLog) ? deliveryLog : (deliveryLog as Record<string, unknown>)?.deliveries as Record<string, unknown>[] || []).slice(0, 20).map((d: Record<string, unknown>, i: number) => {
                          const code = Number(d.statusCode || d.status);
                          const failed = !(code >= 200 && code < 300);
                          return (
                          <div key={i} className="flex items-center justify-between bg-lattice-surface rounded px-2 py-1.5 text-xs gap-2">
                            <span className="text-gray-400 font-mono">{String(d.event || d.type || 'delivery')}</span>
                            <span className="text-gray-600">a{String(d.attempt || 1)}</span>
                            <span className={failed ? 'text-red-400' : 'text-green-400'}>
                              {String(d.statusCode || d.status || '—')}
                            </span>
                            <span className="text-gray-400">{d.timestamp ? new Date(String(d.timestamp)).toLocaleString() : d.createdAt ? new Date(String(d.createdAt)).toLocaleString() : '—'}</span>
                            <span className="text-gray-400">{d.durationMs ? `${d.durationMs}ms` : d.duration ? `${d.duration}ms` : '—'}</span>
                            {failed && Boolean(d.id) && (
                              <button
                                onClick={() => retryDeliveryMutation.mutate({ webhookId: wh.id as string, deliveryId: d.id as string })}
                                disabled={retryDeliveryMutation.isPending}
                                className="text-neon-cyan hover:underline disabled:opacity-40"
                                title="Retry delivery with backoff"
                              >
                                Retry
                              </button>
                            )}
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                {showVerifyFor === (wh.id as string) && (
                  <WebhookSignatureVerifier webhookId={wh.id as string} />
                )}
              </motion.div>
            ))
          )}
        </div>
      )}

      {showCreate && activeTab === 'webhooks' && (
        <CreateWebhookModal
          onClose={() => setShowCreate(false)}
          onCreate={(data) => createWebhookMutation.mutate(data)}
          creating={createWebhookMutation.isPending}
        />
      )}

      <RealtimeDataPanel data={realtimeInsights} />

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <IntegrationsRepos />
      </section>
    </div>
          <RecentMineCard domain="integrations" limit={10} hideWhenEmpty className="mt-4" />
          <CrossLensRecentsPanel lensId="integrations" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="panel p-8 text-center text-gray-400">
      <div className="w-12 h-12 mx-auto mb-3 opacity-50">{icon}</div>
      <p>{message}</p>
    </div>
  );
}

function WebhookIngestInfo() {
  const [copied, setCopied] = useState(false);
  const [domain, setDomain] = useState('general');
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://your-concord-instance.com';
  const webhookUrl = `${baseUrl}/api/webhook/${domain}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="panel p-4 border-l-4 border-neon-green space-y-3">
      <div className="flex items-center gap-2">
        <Webhook className="w-5 h-5 text-neon-green" />
        <h3 className="font-semibold text-white">External Webhook Ingest</h3>
      </div>
      <p className="text-sm text-gray-400">
        Send data to Concord from external services. Each POST creates a DTU with source attribution.
      </p>
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-400 whitespace-nowrap">Domain:</label>
        <input
          type="text"
          value={domain}
          onChange={(e) => setDomain(e.target.value.replace(/[^a-z0-9-]/gi, '').toLowerCase())}
          className="px-2 py-1 bg-lattice-surface border border-lattice-border rounded text-sm text-white w-32"
          placeholder="domain"
        />
      </div>
      <div className="flex items-center gap-2 bg-lattice-surface rounded-lg p-2 border border-lattice-border">
        <code className="text-sm text-neon-cyan flex-1 truncate font-mono">
          POST {webhookUrl}
        </code>
        <button
          onClick={handleCopy}
          className="px-3 py-1 text-xs rounded bg-neon-green/20 text-neon-green border border-neon-green/30 hover:bg-neon-green/30 transition-colors whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          {copied ? 'Copied!' : 'Copy URL'}
        </button>
      </div>
      <details className="text-xs text-gray-400">
        <summary className="cursor-pointer hover:text-gray-300 transition-colors">Example payload</summary>
        <pre className="mt-2 bg-lattice-deep p-3 rounded text-gray-400 overflow-auto">
{`curl -X POST ${webhookUrl} \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "My insight",
    "content": "Something noteworthy happened",
    "tags": ["${domain}", "external"]
  }'`}
        </pre>
      </details>
    </div>
  );
}

function CreateWebhookModal({ onClose, onCreate, creating }: { onClose: () => void; onCreate: (data: CreateWebhookRequest) => void; creating: boolean }) {
  const [form, setForm] = useState({ name: '', url: '', events: 'dtu.created' });

  return (
    <div data-lens-theme="integrations" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-lattice-bg border border-lattice-border rounded-lg p-6 w-full max-w-md space-y-4">
        <h2 className="text-lg font-bold">Create Webhook</h2>
        <input
          type="text"
          placeholder="Webhook Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded"
        />
        <input
          type="text"
          placeholder="URL (https://...)"
          value={form.url}
          onChange={(e) => setForm({ ...form, url: e.target.value })}
          className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded"
        />
        <input
          type="text"
          placeholder="Events (comma-separated)"
          value={form.events}
          onChange={(e) => setForm({ ...form, events: e.target.value })}
          className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded"
        />
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            onClick={() => onCreate({ ...form, events: form.events.split(',').map(e => e.trim()) })}
            disabled={creating || !form.name || !form.url}
            className="btn-primary"
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
