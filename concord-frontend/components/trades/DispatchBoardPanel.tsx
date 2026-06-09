'use client';

import { useCallback, useEffect, useState } from 'react';
import { Calendar, Loader2, RefreshCw } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Tech { id: string; name: string; status: string }
interface Job { id: string; customerName: string; description: string; scheduledFor: string | null; priority: 'low' | 'normal' | 'high' | 'emergency'; status: string }
interface Row { tech: Tech; jobs: Job[] }

const HOURS = Array.from({ length: 12 }, (_, i) => i + 7);

const PRIORITY: Record<string, string> = {
  emergency: 'bg-rose-500 text-white',
  high: 'bg-amber-500 text-black',
  normal: 'bg-cyan-500 text-black',
  low: 'bg-gray-500 text-gray-100',
};

export function DispatchBoardPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [unassigned, setUnassigned] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'trades', action: 'dispatch-board', input: { date } });
      setRows((res.data?.result?.rows || []) as Row[]);
      setUnassigned((res.data?.result?.unassigned || []) as Job[]);
    } catch (e) { console.error('[Dispatch] failed', e); }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { refresh(); }, [refresh]);

  function hourOf(j: Job): number {
    if (!j.scheduledFor) return 9;
    const d = new Date(j.scheduledFor);
    if (Number.isNaN(d.getTime())) return 9;
    return d.getHours();
  }

  async function assignJob(jobId: string, techId: string | null) {
    if (techId == null) return;
    try {
      await lensRun({ domain: 'trades', action: 'job-assign', input: { id: jobId, tech: techId } });
      await refresh();
    } catch (e) { console.error('[Dispatch] assign', e); }
  }

  function onDragStart(e: React.DragEvent, jobId: string, fromTechId: string | null) {
    e.dataTransfer.setData('jobId', jobId);
    if (fromTechId) e.dataTransfer.setData('fromTechId', fromTechId);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function onDropOnTech(e: React.DragEvent, techId: string) {
    e.preventDefault();
    const jobId = e.dataTransfer.getData('jobId');
    if (jobId) assignJob(jobId, techId);
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Calendar className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Dispatch board</span>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="ml-auto text-xs bg-lattice-deep border border-lattice-border rounded px-2 py-0.5 text-white" />
        <button aria-label="Refresh" onClick={refresh} className="p-1 text-gray-400 hover:text-white"><RefreshCw className="w-3.5 h-3.5" /></button>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : rows.length === 0 ? (
        <div className="px-3 py-10 text-center text-xs text-gray-400"><Calendar className="w-6 h-6 mx-auto mb-2 opacity-30" />Add technicians to populate the board.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[640px]">
            <thead className="bg-white/[0.02] border-b border-white/5">
              <tr>
                <th className="text-left px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-400 sticky left-0 bg-[#0d1117]">Tech</th>
                {HOURS.map(h => <th key={h} className="text-[10px] text-gray-400 font-mono">{h}{h < 12 ? 'a' : 'p'}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map(r => (
                <tr key={r.tech.id} className="hover:bg-white/[0.02]" onDragOver={onDragOver} onDrop={(e) => onDropOnTech(e, r.tech.id)}>
                  <td className="px-3 py-2 sticky left-0 bg-[#0d1117]">
                    <div className="text-sm text-white">{r.tech.name}</div>
                    <div className="text-[9px] uppercase text-gray-400">{r.tech.status.replace('_', ' ')}</div>
                  </td>
                  {HOURS.map(h => {
                    const job = r.jobs.find(j => hourOf(j) === h);
                    return (
                      <td key={h} className="px-0.5 py-1">
                        {job ? (
                          <div
                            draggable
                            onDragStart={(e) => onDragStart(e, job.id, r.tech.id)}
                            className={cn('rounded px-1 py-0.5 text-[10px] font-medium truncate cursor-move select-none', PRIORITY[job.priority || 'normal'])}
                            title={`${job.customerName} · ${job.description} (drag to reassign)`}
                          >
                            {job.customerName}
                          </div>
                        ) : (
                          <div className="h-4" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {unassigned.length > 0 && (
        <div className="px-3 py-2 border-t border-white/5 bg-white/[0.02]">
          <div className="text-[10px] uppercase tracking-wider text-amber-400 mb-1">Unassigned · {unassigned.length} <span className="text-gray-400 normal-case">(drag to a tech row to assign)</span></div>
          <div className="flex flex-wrap gap-1">
            {unassigned.map(j => (
              <span
                key={j.id}
                draggable
                onDragStart={(e) => onDragStart(e, j.id, null)}
                className={cn('text-[10px] px-1.5 py-0.5 rounded cursor-move select-none', PRIORITY[j.priority || 'normal'])}
                title={`${j.description} — drag onto a tech row`}
              >
                {j.customerName}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default DispatchBoardPanel;
