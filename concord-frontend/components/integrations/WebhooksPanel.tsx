'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers, lensRun } from '@/lib/api/client';
import type { CreateWebhookRequest } from '@/lib/api/generated-types';
import { useUIStore } from '@/store/ui';
import { motion } from 'framer-motion';
import {
  Webhook, Plus, Trash2, ToggleLeft, ToggleRight, AlertCircle, Loader2,
  CheckCircle, Send, Clock, ShieldCheck,
} from 'lucide-react';
import { WebhookSignatureVerifier } from '@/components/integrations/WebhookSignatureVerifier';

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
{`curl -X POST ${webhookUrl} \
  -H "Content-Type: application/json" \
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
        <input type="text" placeholder="Webhook Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded" />
        <input type="text" placeholder="URL (https://...)" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded" />
        <input type="text" placeholder="Events (comma-separated)" value={form.events} onChange={(e) => setForm({ ...form, events: e.target.value })} className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded" />
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

/** Webhooks tab — register / deactivate / activate / test / deliveries / retry. */
export function WebhooksPanel({ showCreate, setShowCreate }: { showCreate: boolean; setShowCreate: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const [webhookTestResults, setWebhookTestResults] = useState<Record<string, { status: 'loading' | 'success' | 'error'; message: string }>>({});
  const [showDeliveryLog, setShowDeliveryLog] = useState<string | null>(null);
  const [showVerifyFor, setShowVerifyFor] = useState<string | null>(null);

  const { data: webhooks } = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => apiHelpers.webhooks.list().then(r => r.data),
  });

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

  return (
    <div className="space-y-3">
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
                  aria-label="Delete"
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

      {showCreate && (
        <CreateWebhookModal
          onClose={() => setShowCreate(false)}
          onCreate={(data) => createWebhookMutation.mutate(data)}
          creating={createWebhookMutation.isPending}
        />
      )}
    </div>
  );
}
