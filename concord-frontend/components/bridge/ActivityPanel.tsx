'use client';

import { Activity } from 'lucide-react';
import type { BridgeLogAccess, BridgeLogEntry } from './types';
import { EmptyCard, StatusCard, UnavailableCard, actionIcon, formatAction } from './bridge-helpers';

export function ActivityPanel({
  log, access, onDtuClick,
}: {
  log: BridgeLogEntry[];
  access: BridgeLogAccess;
  onDtuClick?: (id: string) => void;
}) {
  if (access === 'pending') {
    return (
      <StatusCard
        icon={<Activity />}
        message="Event log not loaded yet"
        hint="The dump stays unread until this account's role is known. If you can read it, entries show up when that request finishes — a missing read is not an empty feed."
      />
    );
  }
  if (access === 'operator-only') {
    return (
      <StatusCard
        icon={<Activity />}
        message="Bridge event log is operator-only"
        hint="Members cannot read this dump. Organism, debate, and emergent-role counts above still come from catalogs this account can read."
      />
    );
  }
  if (access === 'unavailable') {
    return (
      <UnavailableCard
        icon={<Activity />}
        message="Bridge event log unavailable"
        hint="The log could not be loaded. This is not an empty activity feed."
      />
    );
  }
  if (log.length === 0) return <EmptyCard icon={<Activity />} message="No bridge activity yet" hint="Submit a DTU for validation or query an organism to see activity here." />;

  return (
    <div className="space-y-2">
      {log.slice().reverse().map(entry => (
        <div key={entry.id} className="flex items-start gap-3 p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="mt-0.5">{actionIcon(entry.action)}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-zinc-200">{formatAction(entry.action)}</span>
              <span className="text-xs text-zinc-400">{new Date(entry.at).toLocaleString()}</span>
            </div>
            {entry.dtuId && <button onClick={() => onDtuClick?.(String(entry.dtuId))} className="text-xs text-neon-cyan hover:underline cursor-pointer">DTU: {String(entry.dtuId).slice(0, 12)}...</button>}
            {entry.swarmName && <span className="text-xs text-purple-400 ml-2">{String(entry.swarmName)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
