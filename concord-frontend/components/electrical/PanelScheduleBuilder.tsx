'use client';

/* eslint-disable react-hooks/exhaustive-deps */

/**
 * PanelScheduleBuilder — circuit-by-circuit panel schedule with breaker
 * sizing and per-leg phase-balance analysis. Persists per user via the
 * electrical.panel* macros.
 */

import { useState, useEffect, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { LayoutGrid, Plus, Trash2, Loader2, Gauge } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Circuit {
  id: string; position: number; name: string; description: string;
  watts: number; voltage: number; amps: number; breaker: number;
  poles: number; wireGauge: string; phase: string;
}
interface Panel {
  id: string; name: string; mainBreaker: number; voltage: number;
  spaces: number; circuits: Circuit[];
}
interface ScheduleResult {
  panelId: string; name: string; mainBreaker: number; voltage: number;
  spacesUsed: number; spacesTotal: number; circuits: Circuit[];
  totalConnectedWatts: number; totalDemandAmps: number;
  legA_amps: number; legB_amps: number; phaseImbalancePercent: number;
  utilizationPercent: number; nec80PercentRule: string;
}

export function PanelScheduleBuilder() {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<ScheduleResult | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newPanel, setNewPanel] = useState({ name: '', mainBreaker: '200', voltage: '240', spaces: '40' });
  const [ckt, setCkt] = useState({ name: '', description: '', watts: '', voltage: '120', breaker: '', phase: 'A' });

  const refresh = useCallback(async () => {
    const r = await lensRun<{ panels: Panel[] }>('electrical', 'panelList', {});
    const list = r.data.result?.panels || [];
    setPanels(list);
    if (list.length && !activeId) setActiveId(list[0].id);
  }, [activeId]);

  useEffect(() => { refresh(); }, []);

  const loadSchedule = useCallback(async (panelId: string) => {
    const r = await lensRun<ScheduleResult>('electrical', 'panelSchedule', { panelId });
    setSchedule(r.data.result);
  }, []);

  useEffect(() => { if (activeId) loadSchedule(activeId); }, [activeId, loadSchedule]);

  const createPanel = useMutation({
    mutationFn: async () => {
      const r = await lensRun<Panel>('electrical', 'panelCreate', {
        name: newPanel.name || 'New Panel',
        mainBreaker: parseInt(newPanel.mainBreaker) || 200,
        voltage: parseInt(newPanel.voltage) || 240,
        spaces: parseInt(newPanel.spaces) || 40,
      });
      await refresh();
      if (r.data.result) setActiveId(r.data.result.id);
      setShowNew(false);
      setNewPanel({ name: '', mainBreaker: '200', voltage: '240', spaces: '40' });
    },
  });

  const addCircuit = useMutation({
    mutationFn: async () => {
      if (!activeId) return;
      await lensRun('electrical', 'panelAddCircuit', {
        panelId: activeId,
        name: ckt.name || undefined,
        description: ckt.description || undefined,
        watts: parseFloat(ckt.watts) || 0,
        voltage: parseInt(ckt.voltage) || 120,
        breaker: ckt.breaker ? parseInt(ckt.breaker) : undefined,
        phase: ckt.phase,
      });
      setCkt({ name: '', description: '', watts: '', voltage: '120', breaker: '', phase: 'A' });
      await refresh();
      await loadSchedule(activeId);
    },
  });

  const removeCircuit = useMutation({
    mutationFn: async (circuitId: string) => {
      if (!activeId) return;
      await lensRun('electrical', 'panelRemoveCircuit', { panelId: activeId, circuitId });
      await refresh();
      await loadSchedule(activeId);
    },
  });

  const deletePanel = useMutation({
    mutationFn: async (panelId: string) => {
      await lensRun('electrical', 'panelDelete', { panelId });
      setSchedule(null);
      setActiveId(null);
      await refresh();
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-indigo-500/20 bg-gradient-to-br from-zinc-950 via-indigo-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-indigo-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <LayoutGrid className="h-4 w-4 text-indigo-400" />
          <span className="text-sm font-semibold text-white">Panel schedule builder</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">electrical.panel*</span>
        </div>
        <button type="button" onClick={() => setShowNew((s) => !s)} className="inline-flex items-center gap-1 rounded bg-indigo-500 px-2 py-1 text-xs font-semibold text-white hover:bg-indigo-400"><Plus className="h-3 w-3" />New panel</button>
      </header>

      <div className="p-4 space-y-3">
        {showNew && (
          <div className="grid grid-cols-4 gap-2 rounded-lg border border-indigo-500/15 bg-zinc-950/40 p-3">
            <label className="col-span-4"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Panel name</span>
              <input value={newPanel.name} onChange={(e) => setNewPanel({ ...newPanel, name: e.target.value })} placeholder="e.g. Main Distribution" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" /></label>
            <label><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Main breaker</span>
              <select value={newPanel.mainBreaker} onChange={(e) => setNewPanel({ ...newPanel, mainBreaker: e.target.value })} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono">
                {['100', '125', '150', '200', '400'].map((b) => <option key={b} value={b}>{b}A</option>)}
              </select></label>
            <label><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Voltage</span>
              <select value={newPanel.voltage} onChange={(e) => setNewPanel({ ...newPanel, voltage: e.target.value })} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono">
                <option value="120">120V</option><option value="240">240V</option><option value="208">208V</option>
              </select></label>
            <label><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Spaces</span>
              <input type="number" value={newPanel.spaces} onChange={(e) => setNewPanel({ ...newPanel, spaces: e.target.value })} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" /></label>
            <button type="button" onClick={() => createPanel.mutate()} disabled={createPanel.isPending} className="self-end rounded bg-indigo-500 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-400 disabled:opacity-50">
              {createPanel.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Create'}
            </button>
          </div>
        )}

        {panels.length === 0 && !showNew && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-400">No panels yet. Create one to start building a schedule.</div>
        )}

        {panels.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {panels.map((p) => (
              <button key={p.id} type="button" onClick={() => setActiveId(p.id)} className={`rounded px-2.5 py-1 text-xs ${activeId === p.id ? 'bg-indigo-500/20 text-indigo-200 border border-indigo-500/40' : 'border border-zinc-800 text-zinc-400 hover:text-white'}`}>
                {p.name} <span className="font-mono text-[10px] text-zinc-400">{p.mainBreaker}A</span>
              </button>
            ))}
          </div>
        )}

        {schedule && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded border border-indigo-500/15 bg-zinc-950/40 px-2 py-1.5 text-[11px]"><div className="text-[9px] text-zinc-400">Connected load</div><div className="font-mono text-indigo-200">{schedule.totalConnectedWatts}W</div></div>
              <div className="rounded border border-indigo-500/15 bg-zinc-950/40 px-2 py-1.5 text-[11px]"><div className="text-[9px] text-zinc-400">Demand</div><div className="font-mono text-indigo-200">{schedule.totalDemandAmps}A</div></div>
              <div className="rounded border border-indigo-500/15 bg-zinc-950/40 px-2 py-1.5 text-[11px]"><div className="text-[9px] text-zinc-400">Spaces</div><div className="font-mono text-zinc-200">{schedule.spacesUsed}/{schedule.spacesTotal}</div></div>
              <div className={`rounded border px-2 py-1.5 text-[11px] ${schedule.nec80PercentRule === 'PASS' ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-rose-500/40 bg-rose-500/10'}`}>
                <div className={`text-[9px] ${schedule.nec80PercentRule === 'PASS' ? 'text-emerald-300' : 'text-rose-300'}`}>NEC 80%</div>
                <div className={`font-mono ${schedule.nec80PercentRule === 'PASS' ? 'text-emerald-100' : 'text-rose-100'}`}>{schedule.nec80PercentRule}</div>
              </div>
            </div>

            {/* phase balance */}
            <div className="rounded-lg border border-indigo-500/15 bg-zinc-950/40 p-2">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-400"><Gauge className="h-3 w-3" />Phase balance — imbalance {schedule.phaseImbalancePercent}%</div>
              <div className="mt-1.5 space-y-1">
                {[{ leg: 'A', amps: schedule.legA_amps }, { leg: 'B', amps: schedule.legB_amps }].map(({ leg, amps }) => {
                  const max = Math.max(schedule.legA_amps, schedule.legB_amps, 1);
                  return (
                    <div key={leg} className="flex items-center gap-2 text-[10px]">
                      <span className="w-8 font-mono text-zinc-400">Leg {leg}</span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                        <div className={leg === 'A' ? 'h-full bg-indigo-500' : 'h-full bg-cyan-500'} style={{ width: `${(amps / max) * 100}%` }} />
                      </div>
                      <span className="w-12 text-right font-mono text-zinc-300">{amps}A</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* circuit table */}
            <div className="space-y-1">
              <div className="grid grid-cols-[28px_1fr_64px_56px_56px_64px_56px_28px] gap-1 text-[9px] uppercase tracking-wider text-zinc-400">
                <span>#</span><span>Circuit</span><span>Watts</span><span>Amps</span><span>Bkr</span><span>Wire</span><span>Leg</span><span></span>
              </div>
              {schedule.circuits.map((c) => (
                <div key={c.id} className="grid grid-cols-[28px_1fr_64px_56px_56px_64px_56px_28px] gap-1 rounded border border-indigo-500/10 bg-zinc-950/40 px-1 py-1 text-[10px]">
                  <span className="font-mono text-zinc-400">{c.position}</span>
                  <span className="truncate text-zinc-100">{c.name}{c.description ? ` — ${c.description}` : ''}</span>
                  <span className="font-mono text-zinc-400">{c.watts}W</span>
                  <span className="font-mono text-indigo-200">{c.amps}A</span>
                  <span className="font-mono text-amber-300">{c.breaker}A</span>
                  <span className="font-mono text-zinc-400">{c.wireGauge}</span>
                  <span className="font-mono text-cyan-300">{c.phase}{c.poles === 2 ? ' (2P)' : ''}</span>
                  <button aria-label="Delete" type="button" onClick={() => removeCircuit.mutate(c.id)} className="text-zinc-600 hover:text-rose-300"><Trash2 className="mx-auto h-3 w-3" /></button>
                </div>
              ))}
              {schedule.circuits.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-3 text-center text-[10px] text-zinc-400">No circuits — add one below.</div>}
            </div>

            {/* add circuit */}
            <div className="grid grid-cols-[1fr_72px_64px_56px_44px_64px] gap-1.5 rounded-lg border border-indigo-500/15 bg-zinc-950/40 p-2">
              <input value={ckt.name} onChange={(e) => setCkt({ ...ckt, name: e.target.value })} placeholder="Circuit name" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white" />
              <input type="number" value={ckt.watts} onChange={(e) => setCkt({ ...ckt, watts: e.target.value })} placeholder="Watts" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white font-mono" />
              <select value={ckt.voltage} onChange={(e) => setCkt({ ...ckt, voltage: e.target.value })} className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white font-mono">
                <option value="120">120V</option><option value="240">240V</option>
              </select>
              <input type="number" value={ckt.breaker} onChange={(e) => setCkt({ ...ckt, breaker: e.target.value })} placeholder="Bkr" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white font-mono" />
              <select value={ckt.phase} onChange={(e) => setCkt({ ...ckt, phase: e.target.value })} className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white font-mono">
                <option value="A">A</option><option value="B">B</option>
              </select>
              <button type="button" onClick={() => addCircuit.mutate()} disabled={addCircuit.isPending || !ckt.watts} className="rounded bg-indigo-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-indigo-400 disabled:opacity-50">
                {addCircuit.isPending ? <Loader2 className="mx-auto h-3 w-3 animate-spin" /> : 'Add'}
              </button>
            </div>

            <button type="button" onClick={() => deletePanel.mutate(schedule.panelId)} className="text-[10px] text-zinc-400 hover:text-rose-400">Delete this panel</button>
          </>
        )}
      </div>
    </div>
  );
}
