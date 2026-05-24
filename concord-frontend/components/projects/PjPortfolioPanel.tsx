'use client';

/**
 * PjPortfolioPanel — a cross-project rollup of health and progress.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Briefcase } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface PProject {
  id: string; name: string; key: string; status: string; health: string;
  archived: boolean; targetDate: string | null;
  totalTasks: number; doneTasks: number; progressPct: number; points: number;
}

const HEALTH_COLOR: Record<string, string> = {
  on_track: 'text-emerald-400', at_risk: 'text-amber-400', off_track: 'text-rose-400',
};
const STATUS_COLOR: Record<string, string> = {
  planned: 'text-zinc-400', started: 'text-sky-400', paused: 'text-amber-400',
  completed: 'text-emerald-400', canceled: 'text-rose-400',
};

export function PjPortfolioPanel() {
  const [projects, setProjects] = useState<PProject[]>([]);
  const [byHealth, setByHealth] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('projects', 'portfolio', {});
    setProjects(r.data?.result?.projects || []);
    setByHealth(r.data?.result?.byHealth || {});
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const active = projects.filter((p) => !p.archived);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-emerald-300">{byHealth.on_track || 0}</p>
          <p className="text-[10px] text-zinc-400 uppercase">On track</p>
        </div>
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-amber-300">{byHealth.at_risk || 0}</p>
          <p className="text-[10px] text-zinc-400 uppercase">At risk</p>
        </div>
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-rose-300">{byHealth.off_track || 0}</p>
          <p className="text-[10px] text-zinc-400 uppercase">Off track</p>
        </div>
      </div>

      <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
        <Briefcase className="w-3.5 h-3.5 text-indigo-400" /> All projects ({active.length} active)
      </h3>
      {projects.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic py-6 text-center">No projects yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {projects.map((p) => (
            <li key={p.id} className={cn('bg-zinc-900/70 border border-zinc-800 rounded-xl p-3', p.archived && 'opacity-50')}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] font-mono text-indigo-400">{p.key}</span>
                <span className="text-sm font-semibold text-zinc-100 flex-1">{p.name}</span>
                <span className={cn('text-[10px] uppercase', STATUS_COLOR[p.status])}>{p.status}</span>
                <span className={cn('text-[10px] uppercase', HEALTH_COLOR[p.health])}>{p.health.replace(/_/g, ' ')}</span>
                {p.targetDate && <span className="text-[10px] text-zinc-400">{p.targetDate}</span>}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${p.progressPct}%` }} />
                </div>
                <span className="text-[10px] text-zinc-400">{p.doneTasks}/{p.totalTasks} · {p.points}pt</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
