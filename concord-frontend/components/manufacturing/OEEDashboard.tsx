'use client';

import { useEffect, useState } from 'react';
import { Activity, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface MachineOEE {
  id: string;
  name: string;
  availability: number; // 0-100
  performance: number;
  quality: number;
  oee: number;
  status: 'running' | 'idle' | 'down' | 'maintenance';
  lastDowntimeReason?: string;
}

export function OEEDashboard() {
  const [machines, setMachines] = useState<MachineOEE[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const res = await api.post('/api/lens/run', { domain: 'manufacturing', action: 'oee-status', input: {} });
        setMachines((res.data?.result?.machines || []) as MachineOEE[]);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, []);

  const avg = (k: keyof MachineOEE) => machines.length > 0 ? machines.reduce((s, m) => s + (m[k] as number), 0) / machines.length : 0;

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Activity className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">OEE dashboard</span>
        <span className="ml-auto text-[10px] text-gray-400">{machines.length} machines · world-class &gt;85%</span>
      </header>
      {loading ? (
        <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : (
        <>
          <div className="p-4 grid grid-cols-4 gap-3">
            <Stat label="Avg OEE" value={`${Math.round(avg('oee'))}%`} color={avg('oee') >= 85 ? 'green' : avg('oee') >= 65 ? 'cyan' : avg('oee') >= 50 ? 'yellow' : 'red'} big />
            <Stat label="Availability" value={`${Math.round(avg('availability'))}%`} />
            <Stat label="Performance" value={`${Math.round(avg('performance'))}%`} />
            <Stat label="Quality" value={`${Math.round(avg('quality'))}%`} />
          </div>
          <table className="w-full text-xs">
            <thead className="border-y border-white/5">
              <tr>
                <th className="px-3 py-1.5 text-left text-[10px] uppercase text-gray-400">Machine</th>
                <th className="px-3 py-1.5 text-left text-[10px] uppercase text-gray-400">Status</th>
                <th className="px-3 py-1.5 text-right text-[10px] uppercase text-gray-400">Avail %</th>
                <th className="px-3 py-1.5 text-right text-[10px] uppercase text-gray-400">Perf %</th>
                <th className="px-3 py-1.5 text-right text-[10px] uppercase text-gray-400">Qual %</th>
                <th className="px-3 py-1.5 text-right text-[10px] uppercase text-gray-400">OEE</th>
              </tr>
            </thead>
            <tbody>
              {machines.map(m => (
                <tr key={m.id} className="border-b border-white/5 hover:bg-white/[0.03]">
                  <td className="px-3 py-1.5 text-white">{m.name}</td>
                  <td className="px-3 py-1.5">
                    <span className={cn('text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold',
                      m.status === 'running' ? 'bg-green-500/20 text-green-300' :
                      m.status === 'idle' ? 'bg-gray-500/20 text-gray-300' :
                      m.status === 'down' ? 'bg-red-500/20 text-red-300' :
                      'bg-yellow-500/20 text-yellow-300'
                    )}>{m.status}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{m.availability}%</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{m.performance}%</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{m.quality}%</td>
                  <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums font-bold',
                    m.oee >= 85 ? 'text-green-300' : m.oee >= 65 ? 'text-cyan-300' : m.oee >= 50 ? 'text-yellow-300' : 'text-red-300'
                  )}>{m.oee}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, color = 'cyan', big }: { label: string; value: string; color?: 'green' | 'cyan' | 'yellow' | 'red'; big?: boolean }) {
  const palette = { green: 'text-green-300', cyan: 'text-cyan-300', yellow: 'text-yellow-300', red: 'text-red-300' };
  return (
    <div className="p-3 bg-white/[0.02] rounded text-center">
      <div className={cn('font-bold tabular-nums', big ? 'text-4xl' : 'text-2xl', palette[color])}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
    </div>
  );
}
export default OEEDashboard;
