'use client';

import { useEffect, useState } from 'react';
import { MapPin, Play, Square, Loader2, Activity } from 'lucide-react';
import dynamic from 'next/dynamic';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const TrackMap = dynamic(() => import('./TrackMap').then(m => m.TrackMap), { ssr: false });

interface Track {
  id: string; aircraftId: string; tail: string; from: string | null; to: string | null;
  startedAt: string; endedAt: string | null; durationMin?: number;
  points: Array<{ lat: number; lng: number; altitudeFt: number; groundSpeedKts: number; timestamp: string }>;
  maxAltitudeFt: number; maxGroundSpeedKts: number; totalDistanceNm: number;
}
interface Aircraft { id: string; tail: string }

export function TrackLogsPanel() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ aircraftId: '', from: '', to: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [t, a] = await Promise.all([
        lensRun({ domain: 'aviation', action: 'track-logs-list', input: {} }),
        lensRun({ domain: 'aviation', action: 'aircraft-list', input: {} }),
      ]);
      setTracks((t.data?.result?.tracks || []) as Track[]);
      setAircraft((a.data?.result?.aircraft || []) as Aircraft[]);
    } catch (e) { console.error('[Tracks] failed', e); }
    finally { setLoading(false); }
  }

  async function start() {
    if (!form.aircraftId) return;
    try {
      await lensRun({ domain: 'aviation', action: 'track-logs-start', input: form });
      setForm({ aircraftId: '', from: '', to: '' });
      await refresh();
    } catch (e) { console.error('[Tracks] start', e); }
  }

  async function end(id: string) {
    try {
      await lensRun({ domain: 'aviation', action: 'track-logs-end', input: { trackId: id } });
      await refresh();
    } catch (e) { console.error('[Tracks] end', e); }
  }

  async function appendPosition(id: string) {
    if (!navigator.geolocation) { alert('Geolocation not available'); return; }
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        await lensRun({ domain: 'aviation', action: 'track-logs-append', input: { trackId: id, lat: pos.coords.latitude, lng: pos.coords.longitude, altitudeFt: pos.coords.altitude ? pos.coords.altitude * 3.28084 : 0, groundSpeedKts: pos.coords.speed ? pos.coords.speed * 1.94384 : 0 } });
        await refresh();
      } catch (e) { console.error('[Tracks] append', e); }
    }, err => alert(`Position error: ${err.message}`));
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <MapPin className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Track logs · GPS recording</span>
        <span className="ml-auto text-[10px] text-gray-500">{tracks.filter(t => !t.endedAt).length} active</span>
      </header>

      <div className="border-b border-white/10">
        <TrackMap tracks={tracks} className="h-64 w-full" />
      </div>

      <div className="p-3 border-b border-white/10 grid grid-cols-4 gap-2">
        <select value={form.aircraftId} onChange={e => setForm({ ...form, aircraftId: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="">Aircraft…</option>
          {aircraft.map(a => <option key={a.id} value={a.id}>{a.tail}</option>)}
        </select>
        <input value={form.from} onChange={e => setForm({ ...form, from: e.target.value.toUpperCase() })} placeholder="From ICAO" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input value={form.to} onChange={e => setForm({ ...form, to: e.target.value.toUpperCase() })} placeholder="To ICAO" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <button onClick={start} disabled={!form.aircraftId} className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 disabled:opacity-40 inline-flex items-center justify-center gap-1"><Play className="w-3 h-3" />Start track</button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : tracks.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><MapPin className="w-6 h-6 mx-auto mb-2 opacity-30" />No track logs yet. Start one above; use phone GPS to log positions.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {tracks.map(t => (
              <li key={t.id} className={cn('px-3 py-2 hover:bg-white/[0.03]', !t.endedAt && 'bg-emerald-500/5')}>
                <div className="flex items-center gap-2 mb-1">
                  <Activity className={cn('w-3.5 h-3.5', t.endedAt ? 'text-gray-400' : 'text-emerald-400 animate-pulse')} />
                  <span className="text-sm font-mono text-cyan-300">{t.tail}</span>
                  {t.from && t.to && <span className="text-[10px] font-mono text-gray-400">{t.from}→{t.to}</span>}
                  <span className="ml-auto text-[10px] text-gray-500">
                    {t.points.length} pts · {t.totalDistanceNm.toFixed(1)}nm · {t.maxAltitudeFt}ft peak
                  </span>
                </div>
                {!t.endedAt && (
                  <div className="flex items-center gap-2">
                    <button onClick={() => appendPosition(t.id)} className="px-2 py-1 text-[10px] rounded bg-cyan-500/30 text-cyan-300 hover:bg-cyan-500/50 inline-flex items-center gap-1"><MapPin className="w-2.5 h-2.5" />Log GPS now</button>
                    <button onClick={() => end(t.id)} className="px-2 py-1 text-[10px] rounded bg-rose-500/30 text-rose-300 hover:bg-rose-500/50 inline-flex items-center gap-1"><Square className="w-2.5 h-2.5" />End</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default TrackLogsPanel;
