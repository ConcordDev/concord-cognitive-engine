'use client';

import { useBrainHealth } from '@/hooks/useBrainHealth';

interface BrainData {
  online?: boolean;
  enabled?: boolean;
  model?: string;
  role?: string;
  avgResponseMs?: number;
  stats?: {
    requests?: number;
    errors?: number;
    dtusGenerated?: number;
    lastCallAt?: string | null;
  };
}

function BrainCard({ name, brain }: { name: string; brain: BrainData }) {
  if (!brain) return null;
  const online = brain.online || brain.enabled;
  const statusColor = online ? 'bg-green-500' : 'bg-red-500';
  const avgMs = brain.avgResponseMs || 0;
  const healthColor = !online ? 'text-red-400' : avgMs > 5000 ? 'text-yellow-400' : 'text-green-400';

  return (
    <div className="border border-neutral-700 rounded-lg p-4 bg-neutral-900">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold capitalize text-sm">{name}</h3>
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${statusColor}`} />
      </div>
      <div className="text-xs text-neutral-400 space-y-1">
        <div>Model: <span className="text-neutral-200">{brain.model || 'N/A'}</span></div>
        <div>Role: <span className="text-neutral-200">{brain.role || 'N/A'}</span></div>
        <div className={healthColor}>
          Avg Response: {avgMs > 0 ? `${avgMs}ms` : 'N/A'}
        </div>
        <div>Requests: <span className="text-neutral-200">{brain.stats?.requests || 0}</span></div>
        <div>Errors: <span className={(brain.stats?.errors ?? 0) > 0 ? 'text-red-400' : 'text-neutral-200'}>
          {brain.stats?.errors || 0}
        </span></div>
        <div>DTUs Generated: <span className="text-neutral-200">{brain.stats?.dtusGenerated || 0}</span></div>
        {brain.stats?.lastCallAt && (
          <div>Last Call: <span className="text-neutral-200">
            {new Date(brain.stats.lastCallAt).toLocaleTimeString()}
          </span></div>
        )}
      </div>
    </div>
  );
}

const BRAIN_ORDER = ['conscious', 'subconscious', 'utility', 'repair', 'multimodal'];

function brainLabel(name: string): string {
  if (!name) return 'Brain';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function fleetNames(names: string[]): string[] {
  const rank = (name: string) => {
    const i = BRAIN_ORDER.indexOf(name);
    return i === -1 ? BRAIN_ORDER.length : i;
  };
  return [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export default function BrainHealthPanel() {
  const { brainStatus, isLoading, refresh } = useBrainHealth();

  if (!brainStatus.hasSnapshot) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Brain Health</h2>
          {!isLoading && (
            <button
              type="button"
              onClick={refresh}
              className="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 transition-colors"
            >
              Refresh
            </button>
          )}
        </div>
        <p role="status" className="text-xs text-neutral-400">
          {isLoading ? 'Loading brain health…' : 'Brain health unavailable'}
        </p>
      </div>
    );
  }

  const total = brainStatus.totalCount ?? 0;
  const onlineText = total > 0 ? `${brainStatus.onlineCount}/${total}` : 'no data yet';
  const names = fleetNames(Object.keys(brainStatus.fleet));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Brain Health</h2>
          <p className="text-xs text-neutral-400">
            Mode: <span className="text-neutral-200">{brainStatus.mode}</span>
            {' | '}Online: <span className="text-neutral-200">{onlineText}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 transition-colors"
        >
          Refresh
        </button>
      </div>
      {names.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {names.map((name) => (
            <BrainCard key={name} name={brainLabel(name)} brain={brainStatus.fleet[name]} />
          ))}
        </div>
      )}
    </div>
  );
}
