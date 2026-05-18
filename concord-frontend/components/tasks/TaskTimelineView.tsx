'use client';

import { useState, useEffect, useCallback } from 'react';
import { callTasksMacro } from '@/lib/api/tasks';
import { Loader2, GitBranch } from 'lucide-react';

interface Lane {
  id: string; task_key: string; title: string;
  status_id: string; priority: string;
  startHours: number; endHours: number; durationHours: number;
}

interface Roadmap { ok: boolean; lanes?: Lane[]; totalHours?: number; totalDays?: number; criticalPath?: string[]; }

interface Props { projectId: string; onSelect: (id: string) => void; }

const PRI_COLOR: Record<string, string> = {
  urgent: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#94a3b8',
  none: '#52525b',
};

export function TaskTimelineView({ projectId, onSelect }: Props) {
  const [rm, setRm] = useState<Roadmap | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await callTasksMacro<Roadmap>('roadmap', { projectId });
      setRm(r);
    } finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-white/40">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }
  if (!rm?.ok || !rm.lanes || rm.lanes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-white/40 text-sm gap-2">
        <GitBranch className="w-8 h-8 opacity-40" />
        No tasks to lay out yet.
      </div>
    );
  }

  const max = rm.totalHours || 1;
  const criticalSet = new Set(rm.criticalPath || []);

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="mb-3 flex items-center gap-3 text-xs text-white/60">
        <span>Total: <span className="text-white font-mono">{rm.totalDays}d</span> ({rm.totalHours}h)</span>
        <span>Critical path: <span className="text-orange-300 font-mono">{(rm.criticalPath || []).join(' → ')}</span></span>
      </div>
      <div className="space-y-1">
        {rm.lanes.map((lane) => {
          const leftPct = (lane.startHours / max) * 100;
          const widthPct = (lane.durationHours / max) * 100;
          const isCritical = criticalSet.has(lane.task_key);
          return (
            <div
              key={lane.id}
              onClick={() => onSelect(lane.id)}
              className="group flex items-center gap-2 px-2 py-1 hover:bg-white/5 rounded cursor-pointer"
            >
              <span className="font-mono text-xs text-white/40 w-16 flex-shrink-0">{lane.task_key}</span>
              <span className="text-sm text-white/80 w-48 truncate flex-shrink-0">{lane.title}</span>
              <div className="flex-1 relative h-5 bg-black/30 rounded">
                <div
                  className={`absolute inset-y-0 rounded ${isCritical ? 'border-2 border-orange-400/60' : ''}`}
                  style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 0.5)}%`, backgroundColor: PRI_COLOR[lane.priority] || '#52525b' }}
                  title={`${lane.durationHours}h`}
                />
              </div>
              <span className="text-xs text-white/40 w-12 text-right">{lane.durationHours}h</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
