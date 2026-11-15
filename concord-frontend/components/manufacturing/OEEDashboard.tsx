'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Activity, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ConfirmDeleteButton, useDeleteSafety } from './DeleteSafety';
import { requestDelete } from './delete-safety-store';
import { notifyManufacturingMutated } from './mfg-events';

export interface MachineOEE {
  id: string;
  name: string;
  line?: string;
  availability: number; // 0-100
  /** Null until derivable — performance needs two readings spanning run time. */
  performance: number | null;
  /** Null until a real quality signal exists. IoT readings do not carry one. */
  quality: number | null;
  /** Null while quality is unknown. Availability × performance is not reported as OEE. */
  oee: number | null;
  status: 'running' | 'idle' | 'down' | 'maintenance';
  lastDowntimeReason?: string | null;
}

function lensError(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { error?: string } }; message?: string };
  return err?.response?.data?.error || err?.message || fallback;
}

function mean(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  if (nums.length === 0) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function pct(n: number | null): string {
  return n == null ? '—' : `${Math.round(n)}%`;
}

const fieldCls = 'mt-0.5 w-full min-w-[7rem] px-2 py-1 text-xs bg-[#0a0e17] border border-white/10 rounded text-white placeholder:text-gray-600';

export function OEEDashboard() {
  const [machines, setMachines] = useState<MachineOEE[]>([]);
  const [notes, setNotes] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [machineId, setMachineId] = useState('');
  const [name, setName] = useState('');
  const [line, setLine] = useState('');
  const [idealCycleTime, setIdealCycleTime] = useState('');

  const load = useCallback(async () => {
    const res = await api.post('/api/lens/run', { domain: 'manufacturing', action: 'oee-status', input: {} });
    const result = res.data?.result || {};
    return {
      machines: (result.machines || []) as MachineOEE[],
      notes: typeof result.notes === 'string' ? result.notes : null,
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    load().then((result) => {
      if (cancelled) return;
      setMachines(result.machines);
      setNotes(result.notes);
      setLoading(false);
    }).catch((e) => {
      if (cancelled) return;
      setError(lensError(e, 'Could not load OEE.'));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [load]);

  async function registerMachine(ev: FormEvent) {
    ev.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input: Record<string, unknown> = {
        machineId: machineId.trim(),
        name: name.trim(),
        line: line.trim(),
      };
      if (idealCycleTime.trim() !== '') input.idealCycleTime = idealCycleTime.trim();
      const res = await api.post('/api/lens/run', { domain: 'manufacturing', action: 'machine-register', input });
      if (res.data?.ok === false) {
        setError(res.data.error || 'Could not register machine.');
        return;
      }
      setMachineId('');
      setName('');
      const result = await load();
      setMachines(result.machines);
      setNotes(result.notes);
      notifyManufacturingMutated();
    } catch (e) {
      setError(lensError(e, 'Could not register machine.'));
    } finally {
      setSaving(false);
    }
  }

  const { pendingKeys } = useDeleteSafety();
  const visibleMachines = machines.filter((m) => !pendingKeys.includes(`machine:${m.id}`));

  function deleteMachine(m: MachineOEE) {
    requestDelete({
      key: `machine:${m.id}`,
      label: m.name,
      commit: async () => {
        const res = await api.post('/api/lens/run', { domain: 'manufacturing', action: 'machine-delete', input: { machineId: m.id } });
        if (res.data?.ok === false) throw new Error(res.data.error || 'Could not delete machine.');
        const result = await load();
        setMachines(result.machines);
        setNotes(result.notes);
        notifyManufacturingMutated();
      },
    });
  }

  const avgOee = mean(visibleMachines.map((m) => m.oee));
  const avgAvail = mean(visibleMachines.map((m) => m.availability));
  const avgPerf = mean(visibleMachines.map((m) => m.performance));
  const avgQual = mean(visibleMachines.map((m) => m.quality));

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Activity className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">OEE dashboard</span>
        <span className="ml-auto text-[10px] text-gray-400">{visibleMachines.length} machines · world-class &gt;85%</span>
      </header>
      <form onSubmit={registerMachine} className="px-3 py-2 border-b border-white/5 flex flex-wrap items-end gap-2">
        <label className="text-[10px] uppercase tracking-wider text-gray-500">
          Machine id
          <input id="manufacturing-machineid" name="machineid" value={machineId} onChange={(e) => setMachineId(e.target.value)} required className={fieldCls} />
        </label>
        <label className="text-[10px] uppercase tracking-wider text-gray-500">
          Name
          <input id="manufacturing-name" name="name" value={name} onChange={(e) => setName(e.target.value)} required className={fieldCls} />
        </label>
        <label className="text-[10px] uppercase tracking-wider text-gray-500">
          Line
          <input id="manufacturing-line" name="line" value={line} onChange={(e) => setLine(e.target.value)} className={fieldCls} />
        </label>
        <label className="text-[10px] uppercase tracking-wider text-gray-500">
          Ideal cycle (min)
          <input id="manufacturing-idealcycletime" name="idealcycletime" value={idealCycleTime} onChange={(e) => setIdealCycleTime(e.target.value)} inputMode="decimal" className={fieldCls} />
        </label>
        <button type="submit" disabled={saving} className="px-2 py-1 text-[10px] uppercase tracking-wider font-semibold rounded bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50">
          {saving ? 'Registering…' : 'Register machine'}
        </button>
        {machineId.trim() && machines.some((m) => m.id === machineId.trim()) && (
          <span className="self-center text-[10px] text-cyan-300">Saving updates machine {machineId.trim()} (blank ideal cycle keeps the current value).</span>
        )}
      </form>
      {error && <p role="alert" className="px-3 py-1.5 text-[11px] text-red-300">{error}</p>}
      {loading ? (
        <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : (
        <>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Avg OEE" value={pct(avgOee)} color={avgOee == null ? 'gray' : avgOee >= 85 ? 'green' : avgOee >= 65 ? 'cyan' : avgOee >= 50 ? 'yellow' : 'red'} big />
            <Stat label="Availability" value={pct(avgAvail)} />
            <Stat label="Performance" value={pct(avgPerf)} />
            <Stat label="Quality" value={pct(avgQual)} />
          </div>
          {visibleMachines.length === 0 ? (
            <p className="px-4 pb-4 text-xs text-gray-400">
              No machines registered.
              {notes && <span className="block mt-1 text-[10px] text-gray-500">{notes}</span>}
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="border-y border-white/5">
                <tr>
                  <th className="px-3 py-1.5 text-left text-[10px] uppercase text-gray-400">Machine</th>
                  <th className="px-3 py-1.5 text-left text-[10px] uppercase text-gray-400">Status</th>
                  <th className="px-3 py-1.5 text-right text-[10px] uppercase text-gray-400">Avail %</th>
                  <th className="px-3 py-1.5 text-right text-[10px] uppercase text-gray-400">Perf %</th>
                  <th className="px-3 py-1.5 text-right text-[10px] uppercase text-gray-400">Qual %</th>
                  <th className="px-3 py-1.5 text-right text-[10px] uppercase text-gray-400">OEE</th>
                  <th className="px-3 py-1.5"><span className="sr-only">Delete</span></th>
                </tr>
              </thead>
              <tbody>
                {visibleMachines.map(m => (
                  <tr key={m.id} className="border-b border-white/5 hover:bg-white/[0.03]">
                    <td className="px-3 py-1.5 text-white">
                      {m.name}
                      {m.line ? <span className="block text-[10px] text-gray-500">{m.line}</span> : null}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className={cn('text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold',
                        m.status === 'running' ? 'bg-green-500/20 text-green-300' :
                        m.status === 'idle' ? 'bg-gray-500/20 text-gray-300' :
                        m.status === 'down' ? 'bg-red-500/20 text-red-300' :
                        'bg-yellow-500/20 text-yellow-300'
                      )}>{m.status}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{m.availability}%</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{pct(m.performance)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{pct(m.quality)}</td>
                    <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums font-bold',
                      m.oee == null ? 'text-gray-500' : m.oee >= 85 ? 'text-green-300' : m.oee >= 65 ? 'text-cyan-300' : m.oee >= 50 ? 'text-yellow-300' : 'text-red-300'
                    )}>{pct(m.oee)}</td>
                    <td className="px-3 py-1.5 text-right">
                      <span className="inline-flex items-center gap-2">
                        <button type="button" aria-label={`Edit machine ${m.name}`}
                          onClick={() => { setMachineId(m.id); setName(m.name); setLine(m.line || ''); setIdealCycleTime(''); }}
                          className="text-gray-400 underline hover:text-cyan-200">
                          Edit
                        </button>
                        <ConfirmDeleteButton
                          itemLabel={m.name}
                          deleteTitle={`Delete machine ${m.name}`}
                          consequence="Its logged readings go with it."
                          onConfirm={() => deleteMachine(m)}
                          className="text-gray-500 hover:text-rose-300"
                        />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, color = 'cyan', big }: { label: string; value: string; color?: 'green' | 'cyan' | 'yellow' | 'red' | 'gray'; big?: boolean }) {
  const palette = { green: 'text-green-300', cyan: 'text-cyan-300', yellow: 'text-yellow-300', red: 'text-red-300', gray: 'text-gray-400' };
  return (
    <div className="p-3 bg-white/[0.02] rounded text-center">
      <div className={cn('font-bold tabular-nums', big ? 'text-4xl' : 'text-2xl', palette[color])}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
    </div>
  );
}
export default OEEDashboard;
