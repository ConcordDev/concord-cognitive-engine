'use client';

import { Activity } from 'lucide-react';
import type { BridgeLogEntry } from './types';
import { EmptyCard, actionIcon, formatAction } from './bridge-helpers';

export function ActivityPanel({ log, onDtuClick }: { log: BridgeLogEntry[]; onDtuClick?: (id: string) => void }) {
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
