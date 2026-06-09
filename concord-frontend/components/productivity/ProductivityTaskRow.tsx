'use client';

/**
 * ProductivityTaskRow — shared task row with a complete checkbox,
 * priority flag and due-state styling. Used by the Today and Tasks
 * panels. All mutations go through lensRun().
 */

import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { Check, Flag, Trash2 } from 'lucide-react';

export interface ProdTask {
  id: string;
  content: string;
  priority: number;
  dueDate: string | null;
  labels: string[];
  dueState?: string;
  done?: boolean;
}

const PRIORITY_COLOR: Record<number, string> = {
  1: 'text-rose-400', 2: 'text-amber-400', 3: 'text-sky-400', 4: 'text-zinc-600',
};
const DUE_COLOR: Record<string, string> = {
  overdue: 'text-rose-400', today: 'text-amber-400', upcoming: 'text-zinc-400', none: 'text-zinc-600',
};

export function ProductivityTaskRow({ task, onChange, showDelete = true }: {
  task: ProdTask; onChange: () => void; showDelete?: boolean;
}) {
  const complete = async () => {
    await lensRun('productivity', 'task-complete', { id: task.id });
    onChange();
  };
  const del = async () => {
    await lensRun('productivity', 'task-delete', { id: task.id });
    onChange();
  };

  return (
    <li className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
      <button aria-label="Confirm" type="button" onClick={complete}
        className="w-4 h-4 rounded-full border border-zinc-600 hover:border-red-500 flex items-center justify-center shrink-0">
        <Check className="w-3 h-3 text-transparent hover:text-red-400" />
      </button>
      <Flag className={cn('w-3 h-3 shrink-0', PRIORITY_COLOR[task.priority] || 'text-zinc-600')} />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-zinc-200 truncate">{task.content}</p>
        {(task.dueDate || task.labels.length > 0) && (
          <p className="text-[10px] text-zinc-400">
            {task.dueDate && <span className={DUE_COLOR[task.dueState || 'none']}>{task.dueDate}</span>}
            {task.labels.length > 0 && <span className="ml-1">{task.labels.map((l) => `#${l}`).join(' ')}</span>}
          </p>
        )}
      </div>
      {showDelete && (
        <button aria-label="Delete" type="button" onClick={del} className="text-zinc-600 hover:text-rose-400 shrink-0">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </li>
  );
}
