'use client';

import { ShieldCheck, Globe, Users, Activity } from 'lucide-react';

export interface FederationStatus {
  ok: boolean;
  enabled?: boolean;
  federation?: {
    instanceId?: string;
    name?: string;
    trustedCount?: number;
    pendingPosts?: number;
    capabilities?: string[];
    [k: string]: unknown;
  };
}

function StatusCard({
  label, value, tone, icon,
}: { label: string; value: string; tone?: 'good' | 'warn'; icon: React.ReactNode }) {
  const toneColor =
    tone === 'good' ? 'text-emerald-300' :
    tone === 'warn' ? 'text-amber-300'  :
    'text-white';
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-white/50">
        {icon}{label}
      </div>
      <div className={`text-base font-bold leading-tight mt-0.5 ${toneColor}`}>{value}</div>
    </div>
  );
}

export function StatusStrip({ status, peerCount }: { status: FederationStatus | null; peerCount: number }) {
  const fed = status?.federation ?? {};
  const enabled = !!status?.enabled;
  const instanceId = String(fed.instanceId ?? '—');
  const trusted = typeof fed.trustedCount === 'number' ? fed.trustedCount : peerCount;
  const pending = typeof fed.pendingPosts === 'number' ? fed.pendingPosts : 0;
  const caps = Array.isArray(fed.capabilities) ? fed.capabilities : [];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <StatusCard
        label="Status"
        value={enabled ? 'Enabled' : 'Disabled'}
        tone={enabled ? 'good' : 'warn'}
        icon={<ShieldCheck className="w-3.5 h-3.5" />}
      />
      <StatusCard
        label="Instance ID"
        value={instanceId.length > 16 ? `${instanceId.slice(0, 12)}…` : instanceId}
        icon={<Globe className="w-3.5 h-3.5" />}
      />
      <StatusCard
        label="Peers"
        value={String(trusted)}
        icon={<Users className="w-3.5 h-3.5" />}
      />
      <StatusCard
        label="Pending"
        value={String(pending)}
        tone={pending > 0 ? 'warn' : undefined}
        icon={<Activity className="w-3.5 h-3.5" />}
      />
      {caps.length > 0 && (
        <div className="col-span-2 sm:col-span-4 text-[11px] text-gray-400 mt-1">
          capabilities: <span className="text-gray-400 font-mono">{caps.join(', ')}</span>
        </div>
      )}
    </div>
  );
}
