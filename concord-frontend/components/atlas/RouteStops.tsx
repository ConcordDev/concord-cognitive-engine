'use client';

/**
 * RouteStops — Google Maps 2026 "Ask Maps"-style stop suggester: enter
 * a start and end, pick an amenity, and get sensible stops near the
 * route midpoint. Wires the atlas.route-stops macro.
 */

import { useState } from 'react';
import { Route, Fuel, Loader2, MapPin } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Stop { name: string; lat: number; lng: number; amenity: string; detourFromMidKm: number; brand: string | null }
interface Result { amenity: string; routeDistanceKm: number; routeDurationText: string; stops: Stop[]; count: number }

const AMENITIES = ['fuel', 'cafe', 'restaurant', 'fast_food', 'toilets', 'charging_station', 'pharmacy', 'parking'];

export function RouteStops() {
  const [form, setForm] = useState({ startLat: '', startLng: '', endLat: '', endLng: '', amenity: 'fuel' });
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function find() {
    const nums = [form.startLat, form.startLng, form.endLat, form.endLng].map(Number);
    if (nums.some(n => !Number.isFinite(n))) { setErr('Enter numeric start and end coordinates.'); return; }
    setBusy(true); setErr(''); setResult(null);
    const r = await lensRun('atlas', 'route-stops', {
      start: { lat: nums[0], lng: nums[1] },
      end: { lat: nums[2], lng: nums[3] },
      amenity: form.amenity,
    });
    if (r.data?.ok) setResult(r.data.result as Result);
    else setErr(r.data?.error || 'Could not find stops.');
    setBusy(false);
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Route className="w-4 h-4 text-emerald-400" />
        <h3 className="text-sm font-bold text-zinc-100">Add a Stop</h3>
        <span className="text-[11px] text-zinc-500">Ask Maps shape</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-2">
        {([['startLat', 'Start lat'], ['startLng', 'Start lng'], ['endLat', 'End lat'], ['endLng', 'End lng']] as const).map(([k, label]) => (
          <input key={k} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} placeholder={label}
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
        ))}
      </div>
      <div className="flex gap-1.5 mb-2">
        <select value={form.amenity} onChange={e => setForm({ ...form, amenity: e.target.value })}
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
          {AMENITIES.map(a => <option key={a} value={a}>{a.replace('_', ' ')}</option>)}
        </select>
        <button onClick={find} disabled={busy}
          className="flex-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 inline-flex items-center justify-center gap-1">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Fuel className="w-3.5 h-3.5" />}
          Find stops along route
        </button>
      </div>
      {err && <p className="text-xs text-rose-400">{err}</p>}
      {result && (
        <div className="mt-2">
          <p className="text-[11px] text-zinc-500 mb-1">
            Route {result.routeDistanceKm} km · {result.routeDurationText} — {result.count} {result.amenity.replace('_', ' ')} stop{result.count === 1 ? '' : 's'} near the midpoint
          </p>
          <ul className="space-y-1 max-h-56 overflow-y-auto">
            {result.stops.map((s, i) => (
              <li key={i} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <MapPin className="w-3 h-3 text-emerald-400 shrink-0" />
                <span className="text-xs text-zinc-200 truncate flex-1">{s.name}{s.brand ? ` · ${s.brand}` : ''}</span>
                <span className="text-[10px] text-zinc-500">{s.detourFromMidKm} km off-mid</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
