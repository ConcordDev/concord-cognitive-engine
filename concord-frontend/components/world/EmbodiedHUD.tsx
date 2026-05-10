'use client';

/**
 * EmbodiedHUD — 7-channel ambient-signal readout pinned to the bottom-left.
 * Each channel is a tiny horizontal bar showing the value normalised to a
 * sane range. Deviations from baseline are shown as colour shifts (cold
 * blue, hot red, etc.).
 *
 * Wraps the Phase 3 macros: embodied.signals_for_player + embodied.channels.
 * Polls every 8 s; the env-sensor heartbeat writes baselines every 75 s
 * so 8-s polling is plenty.
 */

import { useEffect, useState } from 'react';

interface ChannelDescriptor { id: string; label: string; unit: string; }

interface ChannelReadings { [k: string]: number | undefined; }

const RANGES: Record<string, [number, number]> = {
  'thermal_os.ambient_temp': [-10, 40],
  'chemical_os.humidity': [0, 100],
  'chemical_os.air_quality': [0, 500],
  'sight_os.illumination': [0, 100_000],
  'sonic_os.ambient_db': [0, 120],
  'tactile_force_os.ambient_pressure': [80, 110],
  'tactile_force_os.structural_stress': [0, 100],
};

function valueColor(channel: string, value: number): string {
  if (channel.includes('thermal')) {
    if (value < 5) return 'bg-blue-500';
    if (value < 18) return 'bg-cyan-400';
    if (value < 28) return 'bg-emerald-400';
    if (value < 35) return 'bg-amber-400';
    return 'bg-red-500';
  }
  if (channel.includes('air_quality')) {
    if (value < 50) return 'bg-emerald-400';
    if (value < 150) return 'bg-amber-400';
    return 'bg-red-500';
  }
  if (channel.includes('illumination')) {
    if (value < 100) return 'bg-indigo-700';
    if (value < 1_000) return 'bg-indigo-400';
    return 'bg-amber-200';
  }
  if (channel.includes('ambient_db')) {
    if (value < 40) return 'bg-emerald-400';
    if (value < 80) return 'bg-amber-400';
    return 'bg-red-500';
  }
  return 'bg-zinc-300';
}

export default function EmbodiedHUD() {
  const [channels, setChannels] = useState<ChannelDescriptor[]>([]);
  const [readings, setReadings] = useState<ChannelReadings>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cr = await fetch('/api/lens/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'embodied', name: 'channels', input: {} }),
      }).catch(() => null);
      const data = cr ? await cr.json().catch(() => null) : null;
      if (!cancelled && data?.channels) setChannels(data.channels);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'embodied', name: 'signals_for_player', input: {} }),
      }).catch(() => null);
      const data = r ? await r.json().catch(() => null) : null;
      if (!alive || !data?.ok || !data.signals) return;
      const sigs: ChannelReadings = {};
      for (const c of channels) {
        const v = data.signals[c.id];
        if (typeof v === 'number') sigs[c.id] = v;
      }
      setReadings(sigs);
    };
    if (channels.length > 0) {
      void refresh();
      const interval = window.setInterval(refresh, 8_000);
      return () => { alive = false; window.clearInterval(interval); };
    }
    return () => { alive = false; };
  }, [channels]);

  if (channels.length === 0 || Object.keys(readings).length === 0) return null;

  return (
    <div className="fixed bottom-3 left-3 z-40 bg-zinc-950/85 backdrop-blur-md border border-zinc-700/50 rounded-xl p-2 shadow-xl pointer-events-auto">
      <div className="text-[10px] uppercase tracking-widest text-zinc-400 font-bold mb-1.5 px-1">Sense</div>
      <div className="space-y-1">
        {channels.map(c => {
          const v = readings[c.id];
          if (v === undefined) return null;
          const [min, max] = RANGES[c.id] || [0, 100];
          const pct = Math.max(0, Math.min(1, (v - min) / (max - min)));
          return (
            <div key={c.id} className="flex items-center gap-2 text-[10px] font-mono">
              <span className="w-16 text-zinc-300 shrink-0">{c.label}</span>
              <div className="w-20 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className={`h-full ${valueColor(c.id, v)} transition-all duration-500`}
                  style={{ width: `${pct * 100}%` }}
                />
              </div>
              <span className="w-12 text-right text-zinc-400 shrink-0">
                {Math.round(v)}{c.unit ? ` ${c.unit}` : ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
