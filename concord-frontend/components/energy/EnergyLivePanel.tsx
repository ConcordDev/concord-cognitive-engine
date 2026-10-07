'use client';

/**
 * EnergyLivePanel — Sense-style real-time consumption stream. The user
 * submits instantaneous wattage samples (from a smart meter / clamp /
 * smart plug); the panel renders the rolling live curve with
 * current / peak / average watts.
 */

import { useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Loader2, Plus, Zap } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz/ChartKit';
import { cn } from '@/lib/utils';
import { useSmartPolling } from '@/hooks/useSmartPolling';

interface LiveSample { id: string; watts: number; at: string; deviceName: string }
// Sense/Emporia's whole identity is a power meter that visibly moves.
// Real backend poll, not a fake ticker — every 5s while this tab is open
// we re-call the same live-stream/device-list macros a manual refresh
// would, so the "Now" tile reflects genuinely fresh server state.
const POLL_MS = 5000;

export function EnergyLivePanel({
  meterId,
  meterName,
  onChange,
}: {
  meterId: string;
  meterName: string;
  onChange: () => void;
}) {
  const [samples, setSamples] = useState<LiveSample[]>([]);
  const [current, setCurrent] = useState(0);
  const [peak, setPeak] = useState(0);
  const [avgWatts, setAvgWatts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [watts, setWatts] = useState('');
  const [hasLoaded, setHasLoaded] = useState(false);

  const refresh = useCallback(async () => {
    setPolling(true);
    try {
      const s = await lensRun('energy', 'live-stream', { minutes: 120, deviceId: meterId });
      if (s.data?.ok) {
        const res = s.data.result as {
          samples: LiveSample[]; current: number; peak: number; avgWatts: number;
        };
        setSamples(res.samples || []);
        setCurrent(res.current || 0);
        setPeak(res.peak || 0);
        setAvgWatts(res.avgWatts || 0);
        setError(null);
      } else {
        setError(s.data?.error || 'Failed to load live readings.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load live readings.');
    } finally {
      setLoading(false);
      setPolling(false);
      setHasLoaded(true);
    }
  }, [meterId]);

  // jitter: 0 — a dedicated test asserts the poll lands on the exact
  // POLL_MS cadence; pausing on a hidden tab is still the useful part here.
  useSmartPolling(refresh, POLL_MS, { jitter: 0 });

  const submit = async () => {
    if (!(Number(watts) >= 0) || watts === '') { setError('Enter a wattage reading.'); return; }
    try {
      const r = await lensRun('energy', 'live-sample', {
        watts: Number(watts), deviceId: meterId,
      });
      if (r.data?.ok === false) { setError(r.data?.error || 'Failed to submit reading.'); return; }
      setWatts(''); setError(null);
      await refresh();
      await onChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to submit reading.');
    }
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
        <div className="relative bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 text-center overflow-hidden">
          <span
            className="absolute top-1.5 right-1.5 flex items-center gap-1 text-[9px] uppercase tracking-wider text-lime-400"
            title={`Polling live-stream every ${POLL_MS / 1000}s`}
          >
            <span className={cn('w-1.5 h-1.5 rounded-full bg-lime-400', polling && 'animate-ping')} />
          </span>
          <AnimatePresence mode="wait">
            <motion.p
              key={current}
              initial={hasLoaded ? { opacity: 0.3, scale: 0.94 } : false}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="text-2xl font-bold text-lime-400"
            >
              {current.toLocaleString()}<span className="text-xs text-zinc-400"> W</span>
            </motion.p>
          </AnimatePresence>
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

      <div className="grid gap-2 rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 sm:grid-cols-[1fr_1.4fr_auto]">
        <input aria-label="Watts now" placeholder="Watts now" inputMode="numeric" value={watts} onChange={(e) => setWatts(e.target.value)}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <div className="flex items-center rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-300">
          Recording on <span className="ml-1 font-medium text-zinc-100">{meterName}</span>
        </div>
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
