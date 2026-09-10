'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, MessageSquare } from 'lucide-react';
import type { Debate } from './types';
import { EmptyCard, VerdictBadge } from './bridge-helpers';

export function DebatesPanel({ debates, onDtuClick }: { debates: Debate[]; onDtuClick?: (id: string) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (debates.length === 0) return <EmptyCard icon={<MessageSquare />} message="No debates yet" hint="Debates occur when emergent agents challenge organism DTU outputs." />;

  return (
    <div className="space-y-3">
      {debates.slice().reverse().map(debate => (
        <div key={debate.id} className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
          <button onClick={() => setExpanded(expanded === debate.id ? null : debate.id)}
            className="w-full flex items-center gap-3 p-4 text-left hover:bg-zinc-800/50 transition-colors">
            {expanded === debate.id ? <ChevronDown className="w-4 h-4 text-zinc-400" /> : <ChevronRight className="w-4 h-4 text-zinc-400" />}
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium capitalize">{debate.challengerRole}</span>
                <span className="text-zinc-600">challenged</span>
                <button onClick={(e) => { e.stopPropagation(); onDtuClick?.(debate.dtuId); }} className="text-xs text-neon-cyan hover:underline cursor-pointer">{debate.dtuId.slice(0, 12)}...</button>
              </div>
              <div className="text-xs text-zinc-400 mt-0.5">{debate.challenge.slice(0, 100)}</div>
            </div>
            <VerdictBadge verdict={debate.verdict} />
          </button>
          {expanded === debate.id && (
            <div className="px-4 pb-4 space-y-2 border-t border-zinc-800 pt-3">
              {debate.transcript.map((turn, i) => (
                <div key={i} className="flex gap-2 text-sm">
                  <span className="font-medium text-zinc-400 capitalize min-w-[80px]">{turn.speaker}:</span>
                  <span className="text-zinc-300">{turn.content}</span>
                </div>
              ))}
              {debate.resolution && (
                <div className="mt-2 p-2 bg-zinc-800 rounded text-xs text-zinc-400">
                  Resolution: {debate.resolution}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
