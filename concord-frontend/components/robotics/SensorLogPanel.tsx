'use client';

import { useState, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { Database, Radio, Trash2, RefreshCw, Loader2 } from 'lucide-react';
import type { RobotRow } from './FleetManager';

interface Sample { t: string; tick: number; channel: string; value: number }
interface PlaybackResult {
  robotId: string; channel: string | null; channels: string[];
  samples: Sample[];
  stats: { count: number; min: number | null; max: number | null; mean: number | null };
}

/**
 * SensorLogPanel — sensor data logging + playback. Wires
 * robotics.sensorLog / sensorPlayback / sensorClear. Log a synthetic
 * channel sample, then play back logged channels as a chart.
 */
export function SensorLogPanel({ robot }: { robot: RobotRow | null }) {
  const [playback, setPlayback] = useState<PlaybackResult | null>(null);
  const [channel, setChannel] = useState('imu_roll');
  const [value, setValue] = useState('0');
  const [filterCh, setFilterCh] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async (rid: string, ch?: string) => {
    const r = await lensRun('robotics', 'sensorPlayback', { robotId: rid, channel: ch || undefined, limit: 200 });
    if (r.data?.ok && r.data.result) setPlayback(r.data.result as PlaybackResult);
    else setErr(r.data?.error || 'Playback failed');
  }, []);

  useEffect(() => {
    setPlayback(null); setErr(null); setFilterCh('');
    if (robot) refresh(robot.id);
  }, [robot, refresh]);

  const logSample = async () => {
    if (!robot) return;
    setBusy('log'); setErr(null);
    const r = await lensRun('robotics', 'sensorLog', {
      robotId: robot.id, channel: channel.trim() || 'default',
      value: parseFloat(value) || 0,
    });
    if (r.data?.ok) await refresh(robot.id, filterCh);
    else setErr(r.data?.error || 'Log failed');
    setBusy(null);
  };

  // Log a burst of synthetic samples so playback has a meaningful trace.
  const logBurst = async () => {
    if (!robot) return;
    setBusy('burst'); setErr(null);
    for (let i = 0; i < 20; i++) {
      const v = Math.sin(i * 0.5) * 45 + (Math.random() - 0.5) * 8;
      const r = await lensRun('robotics', 'sensorLog', {
        robotId: robot.id, channel: channel.trim() || 'default',
        value: Math.round(v * 100) / 100, tick: i,
      });
      if (!r.data?.ok) { setErr(r.data?.error || 'Burst log failed'); break; }
    }
    await refresh(robot.id, filterCh);
    setBusy(null);
  };

  const clear = async () => {
    if (!robot) return;
    setBusy('clear'); setErr(null);
    const r = await lensRun('robotics', 'sensorClear', { robotId: robot.id });
    if (r.data?.ok) { setPlayback(null); await refresh(robot.id); }
    else setErr(r.data?.error || 'Clear failed');
    setBusy(null);
  };

  if (!robot) {
    return <p className="text-gray-500 text-sm text-center py-6">Select a robot to log and play back sensor data.</p>;
  }

  const chartData = (playback?.samples || []).map(s => ({ tick: s.tick, value: s.value }));

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-sm flex items-center gap-2">
        <Database className="w-4 h-4 text-neon-cyan" /> Sensor Log · {robot.name}
      </h3>

      <div className="panel p-3 grid grid-cols-1 md:grid-cols-4 gap-2">
        <input value={channel} onChange={e => setChannel(e.target.value)} placeholder="Channel name"
          className="bg-black/30 border border-white/10 rounded px-2 py-1.5 text-sm" />
        <input value={value} onChange={e => setValue(e.target.value)} placeholder="Value" type="number"
          className="bg-black/30 border border-white/10 rounded px-2 py-1.5 text-sm font-mono" />
        <button onClick={logSample} disabled={!!busy}
          className="px-3 py-1.5 bg-neon-cyan/20 text-neon-cyan rounded text-sm hover:bg-neon-cyan/30 disabled:opacity-50 flex items-center justify-center gap-1">
          {busy === 'log' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radio className="w-4 h-4" />} Log sample
        </button>
        <button onClick={logBurst} disabled={!!busy}
          className="px-3 py-1.5 bg-purple-400/20 text-purple-400 rounded text-sm hover:bg-purple-400/30 disabled:opacity-50 flex items-center justify-center gap-1">
          {busy === 'burst' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radio className="w-4 h-4" />} Log 20-sample burst
        </button>
      </div>

      {err && <p className="text-xs text-red-400">{err}</p>}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-gray-400 uppercase tracking-wide">Channel</label>
          <select value={filterCh} onChange={e => { setFilterCh(e.target.value); refresh(robot.id, e.target.value); }}
            className="bg-black/30 border border-white/10 rounded px-2 py-1 text-xs">
            <option value="">All channels</option>
            {(playback?.channels || []).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => refresh(robot.id, filterCh)}
            className="px-2.5 py-1 rounded bg-white/5 text-gray-300 text-xs hover:bg-white/10 flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
          <button onClick={clear} disabled={!!busy}
            className="px-2.5 py-1 rounded bg-red-400/20 text-red-400 text-xs hover:bg-red-400/30 disabled:opacity-50 flex items-center gap-1">
            <Trash2 className="w-3 h-3" /> Clear log
          </button>
        </div>
      </div>

      {playback && playback.stats.count > 0 ? (
        <>
          <div className="panel p-3 grid grid-cols-4 gap-3 text-center text-xs">
            <div><p className="text-lg font-bold font-mono">{playback.stats.count}</p><p className="text-gray-500">Samples</p></div>
            <div><p className="text-lg font-bold font-mono text-green-400">{playback.stats.min}</p><p className="text-gray-500">Min</p></div>
            <div><p className="text-lg font-bold font-mono text-red-400">{playback.stats.max}</p><p className="text-gray-500">Max</p></div>
            <div><p className="text-lg font-bold font-mono text-neon-cyan">{playback.stats.mean}</p><p className="text-gray-500">Mean</p></div>
          </div>
          <div className="panel p-3">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Playback trace</p>
            <ChartKit kind="area" data={chartData} xKey="tick"
              series={[{ key: 'value', label: 'Value', color: '#22d3ee' }]} height={200} />
          </div>
        </>
      ) : (
        <p className="text-gray-500 text-sm text-center py-4">No samples logged yet. Log a sample or a burst.</p>
      )}
    </div>
  );
}
