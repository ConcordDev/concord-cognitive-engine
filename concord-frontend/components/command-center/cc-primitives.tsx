'use client';

import { useState } from 'react';
import type { ComponentType, ReactNode } from 'react';

export interface SystemHealth {
  ok: boolean;
  system?: { version: string; uptime: { seconds: number; formatted: string }; memory: { heapUsed: string; heapTotal: string; rss: string } };
  dtus?: { total: number; regular: number; mega: number; hyper: number; shadow: number };
  llm?: { ollamaReady: boolean; ollamaEnabled: boolean };
  [key: string]: unknown;
}

export function StatusDot({ status }: { status: 'green' | 'yellow' | 'red' | 'gray' }) {
  const colors = { green: 'bg-green-400', yellow: 'bg-yellow-400', red: 'bg-red-400', gray: 'bg-gray-500' };
  return (
    <span className="relative inline-flex">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${colors[status]}`} />
      {status === 'green' && <span className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-30" />}
      {status === 'red' && <span className="absolute inset-0 rounded-full bg-red-400 animate-ping opacity-30" />}
    </span>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string | number; sub?: ReactNode }) {
  return (
    <div className="bg-[#0d1219] rounded-xl p-3 border border-cyan-900/15 shadow-sm hover:border-cyan-800/25 transition-colors">
      <p className="text-lg font-mono font-bold text-cyan-50">{value}</p>
      <p className="text-xs text-cyan-500/50">{label}</p>
      {sub && <p className="text-[10px] text-cyan-700/40 mt-0.5">{sub}</p>}
    </div>
  );
}

export function BreakerBadge({ name, state }: { name: string; state: string }) {
  const color = state === 'closed' ? 'green' : state === 'half-open' ? 'yellow' : 'red';
  return (
    <div className="flex items-center gap-2 text-xs">
      <StatusDot status={color} />
      <span className="text-gray-300 capitalize">{name}</span>
      <span className="text-gray-400 ml-auto">{state}</span>
    </div>
  );
}

export function ConfirmButton({ label, icon: Icon, color, onConfirm, description }: {
  label: string; icon: ComponentType<{ className?: string; size?: number | string }>; color: 'red' | 'green' | 'yellow';
  onConfirm: () => void; description: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const colorClass = color === 'red' ? 'bg-red-600 hover:bg-red-500' : color === 'green' ? 'bg-green-600 hover:bg-green-500' : 'bg-yellow-600 hover:bg-yellow-500';

  if (confirming) {
    return (
      <div className="bg-lattice-elevated border border-lattice-border rounded-lg p-3 space-y-2">
        <p className="text-xs text-gray-300">{description}</p>
        <div className="flex gap-2">
          <button onClick={() => { onConfirm(); setConfirming(false); }} className={`px-3 py-1.5 text-xs rounded ${colorClass} text-white`}>Confirm</button>
          <button onClick={() => setConfirming(false)} className="px-3 py-1.5 text-xs rounded bg-gray-700 text-gray-300">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <button onClick={() => setConfirming(true)} className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-white ${colorClass} transition-colors`}>
      <Icon className="w-4 h-4" /> {label}
    </button>
  );
}

export const DISTRICT_META: Record<string, { label: string; color: string; icon: string }> = {
  commons: { label: 'The Commons', color: 'text-blue-400', icon: 'cross-domain dialogue' },
  observatory: { label: 'The Observatory', color: 'text-cyan-400', icon: 'external data' },
  forge: { label: 'The Forge', color: 'text-orange-400', icon: 'plugin creation' },
  archive: { label: 'The Archive', color: 'text-amber-400', icon: 'first principles' },
  garden: { label: 'The Garden', color: 'text-green-400', icon: 'shadow patterns' },
  gate: { label: 'The Gate', color: 'text-red-400', icon: 'governance' },
  nursery: { label: 'The Nursery', color: 'text-purple-400', icon: 'emergence' },
};
