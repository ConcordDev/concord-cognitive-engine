'use client';

import { Users } from 'lucide-react';
import type { EmergentRole } from './types';

export function EmergentsPanel({ emergents }: { emergents: EmergentRole[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {emergents.map(em => (
        <div key={em.role} className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-blue-400" />
            <h3 className="font-semibold text-sm capitalize">{em.role}</h3>
          </div>
          <div className="flex flex-wrap gap-1">
            {em.capabilities.canQuery && <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">Query</span>}
            {em.capabilities.canValidate && <span className="text-xs px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded">Validate</span>}
            {em.capabilities.canDebate && <span className="text-xs px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded">Debate</span>}
            {em.capabilities.canVote && <span className="text-xs px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded">Vote</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
