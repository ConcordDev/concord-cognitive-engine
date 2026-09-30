'use client';

import { Network, RefreshCw, Zap } from 'lucide-react';
import type { Organism } from './types';
import { EmptyCard } from './bridge-helpers';

export function OrganismsPanel({ organisms, onRefresh }: { organisms: Organism[]; onRefresh: () => void }) {
  if (organisms.length === 0) return <EmptyCard icon={<Network />} message="No organisms detected" hint="DTU swarms with 10+ members can be awakened as Knowledge Organisms." />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={onRefresh} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {organisms.map(org => (
          <div key={org.id} className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
            <div className="flex items-center gap-2 mb-2">
              {org.isOrganism ? <Zap className="w-4 h-4 text-yellow-400" /> : <Network className="w-4 h-4 text-zinc-400" />}
              <h3 className="font-semibold text-sm">{org.persona?.name || org.name}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full ${org.isOrganism ? 'bg-green-500/20 text-green-400' : 'bg-zinc-700 text-zinc-400'}`}>
                {org.isOrganism ? 'Awakened' : 'Dormant'}
              </span>
            </div>
            <div className="text-xs text-zinc-400 space-y-1">
              <div>{org.size} DTUs in swarm</div>
              {org.topTags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {org.topTags.map(tag => (
                    <span key={tag} className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400">{tag}</span>
                  ))}
                </div>
              )}
              {org.persona?.objective && <div className="text-zinc-400 mt-1 italic">{org.persona.objective}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
