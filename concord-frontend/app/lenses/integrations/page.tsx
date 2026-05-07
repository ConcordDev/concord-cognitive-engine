'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiHelpers } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import type { CreateWebhookRequest } from '@/lib/api/generated-types';
import { useUIStore } from '@/store/ui';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plug, Webhook, Zap, Code, FileText, Plus, Trash2, Play, ToggleLeft, ToggleRight, Layers, ChevronDown, Link, AlertCircle, Loader2, Activity, CheckCircle, Send, Clock, Filter } from 'lucide-react';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

export default function IntegrationsLensPage() {
  useLensNav('integrations');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('integrations');
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'webhooks' | 'automations' | 'services'>('webhooks');
  const [showCreate, setShowCreate] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);
  const [webhookTestResults, setWebhookTestResults] = useState<Record<string, { status: 'loading' | 'success' | 'error'; message: string }>>({});
  const [showDeliveryLog, setShowDeliveryLog] = useState<string | null>(null);
  const [showAutomationBuilder, setShowAutomationBuilder] = useState(false);

  // Action wiring
  const runAction = useRunArtifact('integrations');
  const { items: actionItems } = useLensData('integrations', 'integration', { noSeed: true });
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);

  const handleAction = async (action: string) => {
    const targetId = actionItems[0]?.id;
    if (!targetId) return;
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    finally { setIsRunning(null); }
  };

  const { data: webhooks, isLoading, isError: isError, error: error, refetch: refetch,} = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => apiHelpers.webhooks.list().then(r => r.data),
  });

  const { items: automationItems, isError: isError2, error: error2, refetch: refetch2, create: createAutomation } = useLensData('integrations', 'automation', { noSeed: true });
  const { items: integrationItems, isError: isError3, error: error3, refetch: refetch3 } = useLensData('integrations', 'integration', { noSeed: true });

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
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      enabled ? apiHelpers.webhooks.deactivate(id) : api.post(`/api/webhooks/${id}/activate`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['webhooks'] }),
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const runAutomationMutation = useMutation({
    mutationFn: (id: string) => apiHelpers.lens.run('integrations', id, { action: 'run' }),
    onError: (err) => {
      console.error('Automation run failed:', err instanceof Error ? err.message : err);
    },
  });

  const testWebhookMutation = useMutation({
    mutationFn: async (wh: { id: string; url: string; events: string[] }) => {
      const testPayload = {
        event: wh.events?.[0] || 'test.ping',
        timestamp: new Date().toISOString(),
        data: { message: 'Test payload from Concord', webhookId: wh.id },
      };
      return api.post(`/api/webhooks/${wh.id}/test`, testPayload);
    },
    onMutate: (wh) => {
      setWebhookTestResults((prev) => ({ ...prev, [wh.id]: { status: 'loading', message: 'Sending test payload...' } }));
    },
    onSuccess: (_data, wh) => {
      setWebhookTestResults((prev) => ({ ...prev, [wh.id]: { status: 'success', message: 'Test delivered successfully' } }));
      setTimeout(() => setWebhookTestResults((prev) => { const n = { ...prev }; delete n[wh.id]; return n; }), 5000);
    },
    onError: (err, wh) => {
      const msg = err instanceof Error ? err.message : 'Test delivery failed';
      setWebhookTestResults((prev) => ({ ...prev, [wh.id]: { status: 'error', message: msg } }));
      setTimeout(() => setWebhookTestResults((prev) => { const n = { ...prev }; delete n[wh.id]; return n; }), 8000);
    },
  });

  const { data: deliveryLog } = useQuery({
    queryKey: ['webhook-deliveries', showDeliveryLog],
    queryFn: () => showDeliveryLog ? apiHelpers.webhooks.deliveries(showDeliveryLog).then(r => r.data) : null,
    enabled: !!showDeliveryLog,
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

  if (isError || isError2 || isError3) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message || error3?.message} onRetry={() => { refetch(); refetch2(); refetch3(); }} />
      </div>
    );
  }
  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Plug className="w-8 h-8 text-neon-green" />
          <div>
            <h1 className="text-xl font-bold">Integrations</h1>
            <p className="text-sm text-gray-400">
              Webhooks, automations, and external services
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
        <button onClick={() => activeTab === 'automations' ? setShowAutomationBuilder(true) : setShowCreate(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Add {activeTab === 'webhooks' ? 'Webhook' : 'Automation'}
        </button>
      </header>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }} className="panel p-3 flex items-center gap-3">
          <Link className="w-5 h-5 text-neon-green" />
          <div><p className="text-lg font-bold">{integrationItems?.length || 0}</p><p className="text-xs text-gray-400">Connected</p></div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="panel p-3 flex items-center gap-3">
          <Zap className="w-5 h-5 text-neon-cyan" />
          <div><p className="text-lg font-bold">{automationItems?.length || 0}</p><p className="text-xs text-gray-400">Active Syncs</p></div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="panel p-3 flex items-center gap-3">
          <Webhook className="w-5 h-5 text-neon-purple" />
          <div><p className="text-lg font-bold">{webhooks?.count || 0}</p><p className="text-xs text-gray-400">Webhooks</p></div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="panel p-3 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400" />
          <div><p className="text-lg font-bold">{realtimeAlerts.length}</p><p className="text-xs text-gray-400">Error Count</p></div>
        </motion.div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-lattice-border">
        {[
          { id: 'webhooks', label: 'Webhooks', icon: <Webhook className="w-4 h-4" />, count: webhooks?.count },
          { id: 'automations', label: 'Automations', icon: <Zap className="w-4 h-4" />, count: automationItems?.length },
          { id: 'services', label: 'Services', icon: <Plug className="w-4 h-4" />, count: integrationItems?.length },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`flex items-center gap-2 px-4 py-2 border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-neon-green text-neon-green'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            {tab.icon}
            {tab.label}
            <span className="text-xs bg-lattice-surface px-1.5 py-0.5 rounded">{tab.count || 0}</span>
          </button>
        ))}
      </div>

      {/* Content */}
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
                  >
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
                      <p className="text-xs text-gray-500">No deliveries recorded yet.</p>
                    ) : (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {(Array.isArray(deliveryLog) ? deliveryLog : (deliveryLog as Record<string, unknown>)?.deliveries as Record<string, unknown>[] || []).slice(0, 20).map((d: Record<string, unknown>, i: number) => (
                          <div key={i} className="flex items-center justify-between bg-lattice-surface rounded px-2 py-1.5 text-xs">
                            <span className="text-gray-400 font-mono">{String(d.event || d.type || 'delivery')}</span>
                            <span className={`${Number(d.statusCode || d.status) >= 200 && Number(d.statusCode || d.status) < 300 ? 'text-green-400' : 'text-red-400'}`}>
                              {String(d.statusCode || d.status || '—')}
                            </span>
                            <span className="text-gray-500">{d.timestamp ? new Date(String(d.timestamp)).toLocaleString() : d.createdAt ? new Date(String(d.createdAt)).toLocaleString() : '—'}</span>
                            <span className="text-gray-500">{d.duration ? `${d.duration}ms` : '—'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            ))
          )}
        </div>
      )}

      {activeTab === 'automations' && (
        <div className="space-y-3">
          {automationItems?.length === 0 && !showAutomationBuilder ? (
            <EmptyState icon={<Zap />} message="No automations configured" />
          ) : (
            automationItems?.map((auto) => (
              <div key={auto.id} className="panel p-4 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{String((auto.data as Record<string, unknown>)?.name ?? auto.title)}</h3>
                  <p className="text-xs text-gray-400">Trigger: {String((auto.data as Record<string, unknown>)?.trigger ?? '')} | Actions: {String((auto.data as Record<string, unknown>)?.actionCount ?? 0)}</p>
                  <p className="text-xs text-gray-500 mt-1">Runs: {String((auto.data as Record<string, unknown>)?.runCount ?? 0)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => runAutomationMutation.mutate(auto.id)}
                    disabled={runAutomationMutation.isPending}
                    className="btn-secondary text-sm flex items-center gap-1"
                  >
                    <Play className="w-4 h-4" />
                    Run
                  </button>
                  <span className={`w-2 h-2 rounded-full ${(auto.data as Record<string, unknown>)?.enabled ? 'bg-green-500' : 'bg-gray-500'}`} />
                </div>
              </div>
            ))
          )}
          {showAutomationBuilder && (
            <AutomationBuilderPanel
              onSave={async (data) => {
                await createAutomation({ title: data.name, data: data as unknown as Partial<Record<string, unknown>> });
                setShowAutomationBuilder(false);
              }}
              onCancel={() => setShowAutomationBuilder(false)}
            />
          )}
        </div>
      )}

      {activeTab === 'services' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {integrationItems?.map((svc) => {
            const svcData = svc.data as Record<string, unknown> | undefined;
            const svcId = svcData?.id as string | undefined ?? svc.id;
            return (
            <div key={svc.id} className="panel p-4">
              <div className="flex items-center gap-3 mb-2">
                {svcId === 'vscode' && <Code className="w-6 h-6 text-blue-400" />}
                {svcId === 'obsidian' && <FileText className="w-6 h-6 text-purple-400" />}
                {svcId === 'notion' && <FileText className="w-6 h-6 text-white" />}
                {!['vscode', 'obsidian', 'notion'].includes(svcId ?? '') && <Plug className="w-6 h-6 text-gray-400" />}
                <div>
                  <h3 className="font-semibold">{String(svcData?.name ?? svc.title)}</h3>
                  <span className={`text-xs ${String(svcData?.status) === 'available' ? 'text-green-400' : 'text-yellow-400'}`}>
                    {String(svcData?.status ?? '')}
                  </span>
                </div>
              </div>
              <p className="text-sm text-gray-400">{String(svcData?.description ?? '')}</p>
              <p className="text-xs text-gray-500 mt-2">Type: {String(svcData?.type ?? '')}</p>
            </div>
            );
          })}
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

      {/* Backend Action Panel */}
      <div className="panel p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Activity className="w-4 h-4 text-neon-green" />
          Integration Analysis
        </h2>
        <div className="flex flex-wrap gap-2">
          {['apiHealthCheck', 'dataFlowMapping', 'compatibilityCheck'].map((action) => (
            <button
              key={action}
              onClick={() => handleAction(action)}
              disabled={!!isRunning || !actionItems[0]}
              className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50"
            >
              {isRunning === action ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {action === 'apiHealthCheck' ? 'API Health Check' : action === 'dataFlowMapping' ? 'Data Flow Map' : 'Compatibility Check'}
            </button>
          ))}
        </div>
        {!actionItems[0] && <p className="text-xs text-gray-500">Create an integration artifact to run analysis actions.</p>}
        {actionResult && (
          <div className="bg-lattice-deep rounded-lg p-4 space-y-3 text-sm">
            {'overallStatus' in actionResult && (
              <>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-neon-green" />
                  <span className="font-semibold">Overall Status: <span className={String(actionResult.overallStatus) === 'healthy' ? 'text-neon-green' : 'text-yellow-400'}>{String(actionResult.overallStatus)}</span></span>
                  <span className="text-gray-400">Score: {String(actionResult.overallHealthScore)}</span>
                </div>
                {actionResult.summary && (
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    {Object.entries(actionResult.summary as Record<string,unknown>).map(([k,v]) => (
                      <div key={k} className="bg-lattice-surface rounded p-2 text-center">
                        <div className="font-bold">{String(v)}</div>
                        <div className="text-gray-400 capitalize">{k}</div>
                      </div>
                    ))}
                  </div>
                )}
                {Array.isArray(actionResult.endpoints) && (
                  <div className="space-y-1">
                    {(actionResult.endpoints as Record<string,unknown>[]).slice(0,5).map((ep, i) => (
                      <div key={i} className="flex items-center justify-between bg-lattice-surface rounded p-2 text-xs">
                        <span className="font-mono">{String(ep.name)}</span>
                        <span className={String(ep.status) === 'healthy' ? 'text-neon-green' : 'text-yellow-400'}>{String(ep.status)}</span>
                        <span className="text-gray-400">Score: {String(ep.healthScore)}</span>
                        <span className="text-gray-400">Avail: {String(ep.availability)}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {'nodes' in actionResult && Array.isArray(actionResult.nodes) && (
              <>
                <div className="font-semibold text-neon-cyan">Data Flow Analysis</div>
                {actionResult.metrics && (
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {Object.entries(actionResult.metrics as Record<string,unknown>).map(([k,v]) => (
                      <div key={k} className="bg-lattice-surface rounded p-2">
                        <div className="text-gray-400 capitalize">{k.replace(/([A-Z])/g,' $1').toLowerCase()}</div>
                        <div className="font-bold">{String(v)}</div>
                      </div>
                    ))}
                  </div>
                )}
                {Array.isArray(actionResult.bottlenecks) && actionResult.bottlenecks.length > 0 && (
                  <div>
                    <div className="text-xs text-yellow-400 font-semibold mb-1">Bottlenecks:</div>
                    {(actionResult.bottlenecks as Record<string,unknown>[]).map((b, i) => (
                      <div key={i} className="text-xs text-gray-300">{String(b.node)} — score: {String(b.bottleneckScore)}</div>
                    ))}
                  </div>
                )}
              </>
            )}
            {'apis' in actionResult && Array.isArray(actionResult.apis) && (
              <>
                <div className="font-semibold text-neon-cyan">Compatibility Report</div>
                {actionResult.summary && (
                  <div className="text-xs text-gray-400">
                    {String((actionResult.summary as Record<string,unknown>).totalApis)} APIs · {String((actionResult.summary as Record<string,unknown>).compatible)} compatible · {String((actionResult.summary as Record<string,unknown>).totalEstimatedHours)}h estimated migration
                  </div>
                )}
                <div className="space-y-1">
                  {(actionResult.apis as Record<string,unknown>[]).map((api, i) => (
                    <div key={i} className="flex items-center justify-between bg-lattice-surface rounded p-2 text-xs">
                      <span>{String(api.name)}</span>
                      <span className="text-gray-400">{String(api.currentVersion)} → {String(api.targetVersion)}</span>
                      <span className={api.backwardCompatible ? 'text-neon-green' : 'text-red-400'}>{api.backwardCompatible ? 'Compatible' : 'Breaking'}</span>
                      <span className="text-gray-400">{String((api.migration as Record<string,unknown>)?.level)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {'message' in actionResult && <p className="text-gray-400">{String(actionResult.message)}</p>}
          </div>
        )}
      </div>

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="integrations" />
          </div>
        )}
      </div>
    </div>
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
          className="px-3 py-1 text-xs rounded bg-neon-green/20 text-neon-green border border-neon-green/30 hover:bg-neon-green/30 transition-colors whitespace-nowrap"
        >
          {copied ? 'Copied!' : 'Copy URL'}
        </button>
      </div>
      <details className="text-xs text-gray-500">
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

interface AutomationFormData {
  name: string;
  trigger: string;
  action: string;
  condition: string;
  enabled: boolean;
  actionCount: number;
  runCount: number;
}

const TRIGGER_OPTIONS = [
  { value: 'dtu.created', label: 'DTU Created' },
  { value: 'dtu.updated', label: 'DTU Updated' },
  { value: 'webhook.received', label: 'Webhook Received' },
  { value: 'schedule.cron', label: 'Scheduled (Cron)' },
  { value: 'lens.alert', label: 'Lens Alert Fired' },
  { value: 'integration.error', label: 'Integration Error' },
  { value: 'manual', label: 'Manual Trigger' },
];

const ACTION_OPTIONS = [
  { value: 'send_webhook', label: 'Send Webhook' },
  { value: 'create_dtu', label: 'Create DTU' },
  { value: 'run_analysis', label: 'Run Analysis' },
  { value: 'send_notification', label: 'Send Notification' },
  { value: 'transform_data', label: 'Transform Data' },
  { value: 'sync_external', label: 'Sync to External Service' },
  { value: 'log_event', label: 'Log Event' },
];

function AutomationBuilderPanel({ onSave, onCancel }: { onSave: (data: AutomationFormData) => Promise<void>; onCancel: () => void }) {
  const [form, setForm] = useState<AutomationFormData>({
    name: '',
    trigger: 'dtu.created',
    action: 'send_webhook',
    condition: '',
    enabled: true,
    actionCount: 1,
    runCount: 0,
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.name) return;
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="panel p-5 border-l-4 border-neon-cyan space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Zap className="w-4 h-4 text-neon-cyan" />
          New Automation
        </h3>
        <button onClick={onCancel} className="text-gray-400 hover:text-white text-sm">Cancel</button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Name</label>
          <input
            type="text"
            placeholder="e.g. Notify on new DTU"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Trigger Event</label>
            <select
              value={form.trigger}
              onChange={(e) => setForm({ ...form, trigger: e.target.value })}
              className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm"
            >
              {TRIGGER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Action</label>
            <select
              value={form.action}
              onChange={(e) => setForm({ ...form, action: e.target.value })}
              className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm"
            >
              {ACTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">
            <Filter className="w-3 h-3 inline mr-1" />
            Condition / Filter (optional)
          </label>
          <input
            type="text"
            placeholder='e.g. domain == "integrations" && tags.includes("critical")'
            value={form.condition}
            onChange={(e) => setForm({ ...form, condition: e.target.value })}
            className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-sm font-mono"
          />
          <p className="text-xs text-gray-500 mt-1">Leave blank to trigger on all matching events.</p>
        </div>
      </div>

      {form.name && (
        <div className="bg-lattice-surface rounded p-3 text-xs text-gray-400 space-y-1">
          <p className="text-gray-300 font-semibold">Preview:</p>
          <p>When <span className="text-neon-cyan">{TRIGGER_OPTIONS.find(o => o.value === form.trigger)?.label}</span> occurs{form.condition ? <> and <span className="text-yellow-400 font-mono">{form.condition}</span></> : null}, execute <span className="text-neon-green">{ACTION_OPTIONS.find(o => o.value === form.action)?.label}</span>.</p>
        </div>
      )}

      <div className="flex gap-3 justify-end">
        <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
        <button
          onClick={handleSave}
          disabled={saving || !form.name}
          className="btn-primary text-sm flex items-center gap-1"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          {saving ? 'Creating...' : 'Create Automation'}
        </button>
      </div>
    </motion.div>
  );
}
