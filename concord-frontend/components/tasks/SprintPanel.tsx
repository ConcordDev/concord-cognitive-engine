'use client';

import { useState, useEffect, useCallback } from 'react';
import { callTasksMacro } from '@/lib/api/tasks';
import { Zap, X, Loader2 } from 'lucide-react';

interface Burndown {
  ok: boolean;
  sprint?: { id: string; name: string; status: string; startAt: number; endAt: number };
  totalPoints?: number;
  completedPoints?: number;
  remainingPoints?: number;
  idealRemainingNow?: number;
  daysElapsed?: number;
  totalDays?: number;
  pacing?: string;
}

interface Props { sprintId: string; onClose: () => void; }

const PACE_COLOR: Record<string, string> = {
  ahead: 'text-green-400',
  'on-track': 'text-cyan-300',
  behind: 'text-red-400',
};

export function SprintPanel({ sprintId, onClose }: Props) {
  const [bd, setBd] = useState<Burndown | null>(null);

  const load = useCallback(async () => {
    const r = await callTasksMacro<Burndown>('sprint_burndown', { sprintId });
    setBd(r);
  }, [sprintId]);

  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);

  if (!bd?.ok) return (
    <div className="border-t border-white/10 px-3 py-2 bg-black/40 text-xs text-white/40 flex items-center gap-2">
      <Loader2 className="w-3 h-3 animate-spin" /> Loading sprint…
    </div>
  );

  const pct = bd.totalPoints ? Math.round((bd.completedPoints! / bd.totalPoints) * 100) : 0;
  const idealPct = bd.totalPoints && bd.idealRemainingNow != null
    ? Math.max(0, Math.round(((bd.totalPoints - bd.idealRemainingNow) / bd.totalPoints) * 100))
    : 0;

  return (
    <div className="border-t border-white/10 px-3 py-2 bg-black/40 flex items-center gap-4 text-xs">
      <Zap className="w-3.5 h-3.5 text-cyan-400" />
      <span className="text-white font-medium">{bd.sprint?.name}</span>
      <span className="text-white/40">{bd.daysElapsed}/{bd.totalDays}d</span>
      <span className="flex-1 flex items-center gap-2">
        <div className="flex-1 max-w-md h-2 bg-white/5 rounded relative overflow-hidden">
          <div className="absolute inset-y-0 left-0 bg-cyan-400/60" style={{ width: `${pct}%` }} />
          <div className="absolute inset-y-0 w-0.5 bg-white/40" style={{ left: `${idealPct}%` }} />
        </div>
        <span className="text-white/70 font-mono">{bd.completedPoints}/{bd.totalPoints}p</span>
      </span>
      {bd.pacing && (
        <span className={`uppercase font-medium ${PACE_COLOR[bd.pacing] || 'text-white/60'}`}>
          {bd.pacing}
        </span>
      )}
      <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
