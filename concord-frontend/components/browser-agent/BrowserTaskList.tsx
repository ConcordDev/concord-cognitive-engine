'use client';

import type { BrowserTask } from '@/lib/api/browser-agent';

interface Props {
  tasks: BrowserTask[];
  activeTaskId: string | null;
  onSelect: (id: string) => void;
}

const STATUS_DOT: Record<string, string> = {
  pending: 'bg-zinc-500',
  planning: 'bg-blue-400 animate-pulse',
  awaiting_approval: 'bg-amber-400 animate-pulse',
  running: 'bg-green-400 animate-pulse',
  paused: 'bg-zinc-400',
  completed: 'bg-cyan-400',
  failed: 'bg-red-400',
  cancelled: 'bg-zinc-600',
  budget_exceeded: 'bg-red-500',
};

export function BrowserTaskList({ tasks, activeTaskId, onSelect }: Props) {
  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
      {tasks.length === 0 ? (
        <div className="text-xs text-white/40 text-center p-4">No tasks yet.</div>
      ) : (
        tasks.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className={`w-full text-left px-2 py-2 rounded ${
              activeTaskId === t.id ? 'bg-cyan-500/10' : 'hover:bg-white/5'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[t.status] || 'bg-white/30'}`} />
              <span className={`flex-1 text-sm truncate ${activeTaskId === t.id ? 'text-white' : 'text-white/80'}`}>{t.title}</span>
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-white/40">
              <span>{t.total_steps}/{t.max_steps} steps</span>
              <span>${(t.total_cost_cents / 100).toFixed(2)}</span>
            </div>
          </button>
        ))
      )}
    </div>
  );
}
