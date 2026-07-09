'use client';

/**
 * NoaaStationExplorer — browse the real NOAA CO-OPS station directory
 * (ocean.noaa-stations) and pull live observed water-level readings for
 * a chosen station (ocean.noaa-water-level). Both macros had zero UI —
 * the lens already surfaced NOAA *predicted* tides (NoaaTidesPanel,
 * TideActionStack) against a small hardcoded 5-station picker, but
 * never the full live station directory or observed (as opposed to
 * predicted) water levels.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Radio, Search, Loader2, Activity } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Station { id: string; name: string; state?: string; latitude?: number; longitude?: number; timezone?: string }
interface WaterReading { time: string; waterLevel: number; sigma?: number; flags?: string }
interface WaterLevelResult { stationId: string; beginDate: string; endDate: string; units: string; datum: string; latest: WaterReading | null; readings: WaterReading[]; count: number }

const US_STATES = ['', 'AK', 'AL', 'CA', 'CT', 'DE', 'FL', 'GA', 'HI', 'LA', 'MA', 'MD', 'ME', 'MS', 'NC', 'NH', 'NJ', 'NY', 'OR', 'RI', 'SC', 'TX', 'VA', 'WA'];

export function NoaaStationExplorer() {
  const [state, setState] = useState('');
  const [type, setType] = useState<'tidepredictions' | 'waterlevels'>('waterlevels');
  const [stations, setStations] = useState<Station[]>([]);
  const [selected, setSelected] = useState<Station | null>(null);
  const [waterLevel, setWaterLevel] = useState<WaterLevelResult | null>(null);

  const searchStations = useMutation({
    mutationFn: async () => {
      const r = await lensRun<{ stations: Station[]; count: number }>('ocean', 'noaa-stations', { state: state || undefined, type });
      return r.data;
    },
    onSuccess: (data) => setStations(data?.ok && data.result ? data.result.stations : []),
  });

  const loadWaterLevel = useMutation({
    mutationFn: async (station: Station) => {
      setSelected(station);
      const r = await lensRun<WaterLevelResult>('ocean', 'noaa-water-level', { stationId: station.id, units: 'metric' });
      return r.data;
    },
    onSuccess: (data) => setWaterLevel(data?.ok && data.result ? data.result : null),
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Radio className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">NOAA station directory</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">ocean.noaa-stations + noaa-water-level</span>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <select className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" value={state} onChange={(e) => setState(e.target.value)}>
          {US_STATES.map((s) => <option key={s || 'all'} value={s}>{s || 'All states'}</option>)}
        </select>
        <select className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="waterlevels">Water level stations</option>
          <option value="tidepredictions">Tide prediction stations</option>
        </select>
        <button
          type="button"
          onClick={() => searchStations.mutate()}
          disabled={searchStations.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {searchStations.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search stations
        </button>
        {stations.length > 0 && <span className="text-[10px] text-zinc-400">{stations.length} stations</span>}
      </div>

      {stations.length > 0 && (
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
          {stations.slice(0, 200).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => loadWaterLevel.mutate(s)}
              className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11px] ${selected?.id === s.id ? 'bg-cyan-500/15 text-cyan-200' : 'text-zinc-300 hover:bg-zinc-900'}`}
            >
              <span className="truncate">{s.name} <span className="text-zinc-500">· {s.state}</span></span>
              <span className="shrink-0 font-mono text-[10px] text-zinc-500">{s.id}</span>
            </button>
          ))}
        </div>
      )}

      {loadWaterLevel.isPending && (
        <div className="flex items-center gap-2 text-[11px] text-zinc-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading observed water level for {selected?.name}…</div>
      )}

      {waterLevel && selected && !loadWaterLevel.isPending && (
        <div className="space-y-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Activity className="h-3 w-3" />Observed water level — {selected.name}</div>
            {waterLevel.latest && (
              <SaveAsDtuButton
                compact
                apiSource="noaa-tides-and-currents"
                title={`${selected.name} observed water level — ${waterLevel.latest.waterLevel}m (${waterLevel.datum})`}
                content={`Station: ${selected.name} (${selected.id})\nDatum: ${waterLevel.datum}, units ${waterLevel.units}\nWindow: ${waterLevel.beginDate}–${waterLevel.endDate}\nLatest: ${waterLevel.latest.waterLevel}m at ${waterLevel.latest.time}\nReadings: ${waterLevel.count}`}
                extraTags={['ocean', 'noaa', 'water-level', selected.state?.toLowerCase() || 'us']}
                rawData={waterLevel}
              />
            )}
          </div>
          {!waterLevel.latest && <div className="text-[11px] text-zinc-400">No recent readings for this station.</div>}
          {waterLevel.latest && (
            <>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-2xl text-emerald-200">{waterLevel.latest.waterLevel}m</span>
                <span className="text-[10px] text-zinc-400">{waterLevel.datum} datum · {new Date(waterLevel.latest.time.replace(' ', 'T') + 'Z').toLocaleString()}</span>
              </div>
              <div className="flex h-10 items-end gap-px overflow-hidden rounded border border-zinc-800 bg-zinc-950/60 p-1">
                {waterLevel.readings.slice(-48).map((r, i) => {
                  const vals = waterLevel.readings.slice(-48).map((x) => x.waterLevel);
                  const min = Math.min(...vals), max = Math.max(...vals);
                  const pct = max > min ? ((r.waterLevel - min) / (max - min)) * 100 : 50;
                  return <div key={i} className="flex-1 rounded-t bg-emerald-500/50" style={{ height: `${Math.max(4, pct)}%` }} title={`${r.waterLevel}m @ ${r.time}`} />;
                })}
              </div>
              <p className="text-[9px] text-zinc-500">Last {Math.min(48, waterLevel.readings.length)} of {waterLevel.count} readings (6-min intervals).</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
