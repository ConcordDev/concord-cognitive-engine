'use client';

/**
 * EnergyLivePanel — Sense-style real-time consumption stream. The user
 * submits instantaneous wattage samples (from a smart meter / clamp /
 * smart plug); the panel renders the rolling live curve with
 * current / peak / average watts.
 */

import { useCallback, useEffect, useState } from 'react';
import { Activity, Loader2, Plus, Zap } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz/ChartKit';

interface LiveSample { id: string; watts: number; at: string; deviceName: string }
interface Device { id: string; name: string }

export function EnergyLivePanel({ onChange }: { onChange: () => void }) {
  const [samples, setSamples] = useState<LiveSample[]>([]);
  const [current, setCurrent] = useState(0);
  const [peak, setPeak] = useState(0);
  const [avgWatts, setAvgWatts] = useState(0);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [watts, setWatts] = useState('');
  const [deviceId, setDeviceId] = useState('');

  const refresh = useCallback(async () => {
    const [s, d] = await Promise.all([
      lensRun('energy', 'live-stream', { minutes: 120 }),
      lensRun('energy', 'device-list', {}),
    ]);
    if (s.data?.ok) {
      const res = s.data.result as {
        samples: LiveSample[]; current: number; peak: number; avgWatts: number;
      };
      setSamples(res.samples || []);
      setCurrent(res.current || 0);
      setPeak(res.peak || 0);
      setAvgWatts(res.avgWatts || 0);
    }
    setDevices((d.data?.result?.devices as Device[]) || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const submit = async () => {
    if (!(Number(watts) >= 0) || watts === '') { setError('Enter a wattage reading.'); return; }
    const r = await lensRun('energy', 'live-sample', {
      watts: Number(watts), ...(deviceId ? { deviceId } : {}),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setWatts(''); setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const chartData = samples.map((s) => ({
    t: new Date(s.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    watts: s.watts,
  }));

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <div className="grid grid-cols-3 gap-2">
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-lime-400">{current.toLocaleString()}<span className="text-xs text-zinc-400"> W</span></p>
          <p className="text-[10px] text-zinc-400 uppercase tracking-wide">Now</p>
        </div>
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-amber-400">{peak.toLocaleString()}<span className="text-xs text-zinc-400"> W</span></p>
          <p className="text-[10px] text-zinc-400 uppercase tracking-wide">Peak</p>
        </div>
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-zinc-100">{avgWatts.toLocaleString()}<span className="text-xs text-zinc-400"> W</span></p>
          <p className="text-[10px] text-zinc-400 uppercase tracking-wide">Average</p>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_1.4fr_auto] gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input placeholder="Watts now" inputMode="numeric" value={watts} onChange={(e) => setWatts(e.target.value)}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          <option value="">Whole home</option>
          {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button type="button" onClick={submit}
          className="flex items-center justify-center gap-1 px-3 bg-lime-600 hover:bg-lime-500 text-white text-xs font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Sample
        </button>
      </div>

      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Activity className="w-3.5 h-3.5 text-lime-400" /> Live consumption (last 2h)
        </h3>
        {chartData.length > 1 ? (
          <ChartKit kind="area" data={chartData} xKey="t" height={170}
            series={[{ key: 'watts', label: 'Watts', color: '#a3e635' }]} showLegend={false} />
        ) : (
          <p className="flex items-center gap-1 text-[11px] text-zinc-400 italic py-8 justify-center">
            <Zap className="w-3.5 h-3.5" /> No live samples yet. Submit wattage readings to see the live stream.
          </p>
        )}
      </div>
    </div>
  );
}
