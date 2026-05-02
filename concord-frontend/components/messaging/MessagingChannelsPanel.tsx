'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import {
  MessageSquare,
  Phone,
  Hash,
  Shield,
  Apple,
  Slack,
  Trash2,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';

interface MessagingBinding {
  id: string;
  platform: string;
  external_id: string;
  display_name: string | null;
  permission_level: 'restricted' | 'standard' | 'elevated';
  preferred: number;
  last_used_at: string | null;
  created_at: string;
}

const PLATFORM_META: Record<
  string,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    placeholder: string;
  }
> = {
  whatsapp: {
    label: 'WhatsApp',
    icon: Phone,
    color: 'text-green-400',
    placeholder: 'Phone number (e.g. +1234567890)',
  },
  telegram: {
    label: 'Telegram',
    icon: MessageSquare,
    color: 'text-sky-400',
    placeholder: 'Telegram user ID or @username',
  },
  discord: {
    label: 'Discord',
    icon: Hash,
    color: 'text-indigo-400',
    placeholder: 'Discord user ID',
  },
  signal: {
    label: 'Signal',
    icon: Shield,
    color: 'text-blue-400',
    placeholder: 'Phone number (e.g. +1234567890)',
  },
  imessage: {
    label: 'iMessage',
    icon: Apple,
    color: 'text-gray-300',
    placeholder: 'Email or phone handle',
  },
  slack: {
    label: 'Slack',
    icon: Slack,
    color: 'text-yellow-400',
    placeholder: 'Slack user ID or channel',
  },
};

const PERMISSION_LABELS = {
  restricted: 'Restricted (read-only)',
  standard: 'Standard (create, no transactions)',
  elevated: 'Elevated (full access)',
};

function BindingCard({
  binding,
  onDelete,
  onUpdate,
}: {
  binding: MessagingBinding;
  onDelete: (id: string) => void;
  onUpdate: (id: string, data: Partial<MessagingBinding>) => void;
}) {
  const meta = PLATFORM_META[binding.platform] || {
    label: binding.platform,
    icon: MessageSquare,
    color: 'text-gray-400',
    placeholder: '',
  };
  const Icon = meta.icon;

  return (
    <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/10 hover:border-white/20 transition-colors">
      <Icon className={`w-5 h-5 flex-shrink-0 ${meta.color}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">{meta.label}</span>
          {binding.preferred === 1 && (
            <span className="text-xs px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded">
              preferred
            </span>
          )}
        </div>
        <p className="text-xs text-white/50 truncate">
          {binding.display_name || binding.external_id}
        </p>
        <p className="text-xs text-white/30">{PERMISSION_LABELS[binding.permission_level]}</p>
      </div>
      <div className="flex items-center gap-2">
        <select
          value={binding.permission_level}
          onChange={(e) =>
            onUpdate(binding.id, {
              permission_level: e.target.value as MessagingBinding['permission_level'],
            })
          }
          className="text-xs bg-white/10 border border-white/20 rounded px-2 py-1 text-white/70"
        >
          <option value="restricted">Restricted</option>
          <option value="standard">Standard</option>
          <option value="elevated">Elevated</option>
        </select>
        <button
          onClick={() => onDelete(binding.id)}
          className="text-red-400/60 hover:text-red-400 transition-colors"
          title="Disconnect"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function ConnectPlatformForm({ platform, onClose }: { platform: string; onClose: () => void }) {
  const [externalId, setExternalId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [step, setStep] = useState<'input' | 'verify'>('input');
  const [token, setToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [_bindingId, setBindingId] = useState('');
  const queryClient = useQueryClient();
  const meta = PLATFORM_META[platform];

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/api/messaging/connect/${platform}`, { externalId, displayName });
      return res.data;
    },
    onSuccess: (data) => {
      setBindingId(data.bindingId);
      setToken(data.verificationToken);
      setStep('verify');
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/api/messaging/verify', { platform, token: verifyToken });
      return res.data;
    },
    onSuccess: (data) => {
      if (data.ok) {
        queryClient.invalidateQueries({ queryKey: ['messaging-bindings'] });
        onClose();
      }
    },
  });

  if (step === 'verify') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-white/70">
          Send this token to your Concord bot on{' '}
          <strong className="text-white">{meta?.label}</strong>:
        </p>
        <code className="block p-2 bg-white/5 rounded font-mono text-sm text-amber-300 select-all">
          {token}
        </code>
        <p className="text-xs text-white/50">Then paste the confirmation token below:</p>
        <input
          type="text"
          value={verifyToken}
          onChange={(e) => setVerifyToken(e.target.value)}
          placeholder="Confirmation token from bot"
          className="w-full bg-white/10 border border-white/20 rounded px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/40"
        />
        <div className="flex gap-2">
          <button
            onClick={() => verifyMutation.mutate()}
            disabled={!verifyToken || verifyMutation.isPending}
            className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded px-3 py-2 transition-colors"
          >
            {verifyMutation.isPending ? 'Verifying...' : 'Verify Connection'}
          </button>
          <button onClick={onClose} className="px-3 py-2 text-sm text-white/50 hover:text-white">
            Cancel
          </button>
        </div>
        {verifyMutation.data?.ok === false && (
          <p className="text-xs text-red-400">
            Verification failed. Check the token and try again.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={externalId}
        onChange={(e) => setExternalId(e.target.value)}
        placeholder={meta?.placeholder || 'Platform ID'}
        className="w-full bg-white/10 border border-white/20 rounded px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/40"
      />
      <input
        type="text"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder="Display name (optional)"
        className="w-full bg-white/10 border border-white/20 rounded px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/40"
      />
      <div className="flex gap-2">
        <button
          onClick={() => connectMutation.mutate()}
          disabled={!externalId || connectMutation.isPending}
          className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded px-3 py-2 transition-colors"
        >
          {connectMutation.isPending ? 'Connecting...' : `Connect ${meta?.label}`}
        </button>
        <button onClick={onClose} className="px-3 py-2 text-sm text-white/50 hover:text-white">
          Cancel
        </button>
      </div>
    </div>
  );
}

function MessagingChannelsPanel() {
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const {
    data: bindingsData,
    isLoading,
    isError: bindingsError,
  } = useQuery({
    queryKey: ['messaging-bindings'],
    queryFn: () => api.get('/api/messaging/bindings').then((r) => r.data),
  });

  const { data: statusData } = useQuery({
    queryKey: ['messaging-status'],
    queryFn: () => api.get('/api/messaging/status').then((r) => r.data),
    staleTime: 60000,
  });

  const deleteMutation = useMutation({
    mutationFn: (bindingId: string) => api.delete(`/api/messaging/bindings/${bindingId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['messaging-bindings'] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) =>
      api.patch(`/api/messaging/bindings/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['messaging-bindings'] }),
  });

  const bindings: MessagingBinding[] = bindingsData?.bindings || [];
  const connectedPlatforms = new Set(bindings.map((b) => b.platform));

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-white mb-1">External Messaging</h3>
        <p className="text-xs text-white/50">
          Connect your messaging platforms to interact with Concord from anywhere. Messages route
          through your agent with the configured permission level.
        </p>
      </div>

      {/* Connected platforms */}
      {isLoading ? (
        <div className="text-xs text-white/40">Loading connections...</div>
      ) : bindingsError ? (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          Failed to load messaging connections. Check server status.
        </div>
      ) : bindings.length === 0 ? (
        <div className="p-4 bg-white/5 rounded-lg text-center text-sm text-white/40">
          No platforms connected yet. Add one below.
        </div>
      ) : (
        <div className="space-y-2">
          {bindings.map((binding) => (
            <BindingCard
              key={binding.id}
              binding={binding}
              onDelete={(id) => deleteMutation.mutate(id)}
              onUpdate={(id, data) => updateMutation.mutate({ id, data })}
            />
          ))}
        </div>
      )}

      {/* Add platform section */}
      {connectingPlatform ? (
        <div className="p-4 bg-white/5 rounded-lg border border-white/10">
          <div className="flex items-center gap-2 mb-3">
            {(() => {
              const Icon = PLATFORM_META[connectingPlatform]?.icon || MessageSquare;
              return <Icon className={`w-4 h-4 ${PLATFORM_META[connectingPlatform]?.color}`} />;
            })()}
            <span className="text-sm font-medium text-white">
              Connect {PLATFORM_META[connectingPlatform]?.label}
            </span>
          </div>
          <ConnectPlatformForm
            platform={connectingPlatform}
            onClose={() => setConnectingPlatform(null)}
          />
        </div>
      ) : (
        <div>
          <p className="text-xs text-white/40 mb-2">Add platform</p>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(PLATFORM_META).map(([key, meta]) => {
              const Icon = meta.icon;
              const isConnected = connectedPlatforms.has(key);
              const isAvailable = statusData?.platforms?.[key]?.configured !== false;
              return (
                <button
                  key={key}
                  onClick={() => !isConnected && setConnectingPlatform(key)}
                  disabled={isConnected}
                  className={`flex items-center gap-2 p-2 rounded-lg border text-left transition-colors
                    ${
                      isConnected
                        ? 'border-green-500/30 bg-green-500/10 cursor-default'
                        : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10 cursor-pointer'
                    }`}
                >
                  <Icon className={`w-4 h-4 flex-shrink-0 ${meta.color}`} />
                  <span className="text-xs text-white/70 truncate">{meta.label}</span>
                  {isConnected && <CheckCircle className="w-3 h-3 text-green-400 ml-auto" />}
                  {!isAvailable && !isConnected && (
                    <span className="ml-auto" title="Not configured on server">
                      <AlertCircle className="w-3 h-3 text-yellow-400/50" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedMessagingChannelsPanel = withErrorBoundary(MessagingChannelsPanel);
export { _WrappedMessagingChannelsPanel as MessagingChannelsPanel };
