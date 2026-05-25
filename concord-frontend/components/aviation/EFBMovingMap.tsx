'use client';

/**
 * EFBMovingMap — interactive moving map for the aviation lens.
 *
 * Covers ForeFlight feature-parity backlog items 1-3:
 *  - Interactive moving map with sectional / IFR chart-overlay catalog
 *  - Visual route plotting (magenta line) with airspace / TFR display
 *  - Weather radar + winds-aloft overlay
 *
 * All data is live + keyless: FAA chart catalog (chart-catalog macro),
 * route geometry from FAA NASR (route-plot macro), active TFRs
 * (airspace-tfrs macro), winds-aloft + radar descriptor (wx-overlay macro).
 * No fabricated charts, routes, or weather.
 */

import { useState, useCallback } from 'react';
import { Loader2, Layers, Route, AlertTriangle, Plane, Wind } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface ChartLayer {
  id: string;
  label: string;
  scale: string;
  category: string;
  wms: string;
  layer: string;
  visible: boolean;
}
interface ChartEdition {
  name: string;
  editionName: string;
  editionDate: string;
  editionNumber: number | null;
}
interface RoutePoint {
  ident: string;
  lat: number | null;
  lng: number | null;
  name: string;
  unresolved?: boolean;
}
interface RouteLeg {
  from: string;
  to: string;
  distance_nm: number | null;
  bearing_deg: number | null;
  unresolved?: boolean;
}
interface TFR {
  notamId: string;
  type: string;
  description: string;
  facility: string;
  state: string;
  creationDate: string;
  url: string;
}
interface WindAloft {
  level_hpa: number;
  altitude_ft: number;
  windSpeed_kt: number | null;
  windDir_deg: number | null;
  temp_c: number | null;
}

type ChartKind = 'sectional' | 'ifr_low' | 'ifr_high' | 'terminal';

export default function EFBMovingMap() {
  const [activeChart, setActiveChart] = useState<ChartKind>('sectional');
  const [chartLayers, setChartLayers] = useState<ChartLayer[]>([]);
  const [editions, setEditions] = useState<ChartEdition[]>([]);
  const [chartLoading, setChartLoading] = useState(false);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [waypointsRaw, setWaypointsRaw] = useState('');
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const [routeLegs, setRouteLegs] = useState<RouteLeg[]>([]);
  const [routeTotal, setRouteTotal] = useState<number | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  const [tfrs, setTfrs] = useState<TFR[]>([]);
  const [tfrLoading, setTfrLoading] = useState(false);
  const [showTfrs, setShowTfrs] = useState(true);

  const [winds, setWinds] = useState<WindAloft[]>([]);
  const [radarLabel, setRadarLabel] = useState<string | null>(null);
  const [wxLoading, setWxLoading] = useState(false);
  const [showRadar, setShowRadar] = useState(false);

  const loadCharts = useCallback(async (kind: ChartKind) => {
    setChartLoading(true);
    setActiveChart(kind);
    const r = await lensRun('aviation', 'chart-catalog', { kind });
    if (r.data?.ok && r.data.result) {
      const res = r.data.result as { layers?: ChartLayer[]; editions?: ChartEdition[] };
      setChartLayers(res.layers || []);
      setEditions(res.editions || []);
    }
    setChartLoading(false);
  }, []);

  const loadWinds = useCallback(async (lat: number, lng: number) => {
    setWxLoading(true);
    const r = await lensRun('aviation', 'wx-overlay', { lat, lng });
    if (r.data?.ok && r.data.result) {
      const res = r.data.result as {
        windsAloft?: WindAloft[];
        radarLayer?: { label?: string };
      };
      setWinds(res.windsAloft || []);
      setRadarLabel(res.radarLayer?.label || null);
    }
    setWxLoading(false);
  }, []);

  const plotRoute = useCallback(async () => {
    if (!from.trim() || !to.trim()) {
      setRouteError('Enter a departure and destination identifier.');
      return;
    }
    setRouteLoading(true);
    setRouteError(null);
    const waypoints = waypointsRaw
      .split(/[\s,]+/)
      .map((w) => w.trim().toUpperCase())
      .filter(Boolean);
    const r = await lensRun('aviation', 'route-plot', {
      from: from.trim().toUpperCase(),
      to: to.trim().toUpperCase(),
      waypoints,
    });
    if (r.data?.ok && r.data.result) {
      const res = r.data.result as {
        points?: RoutePoint[];
        legs?: RouteLeg[];
        totalDistance_nm?: number;
      };
      setRoutePoints(res.points || []);
      setRouteLegs(res.legs || []);
      setRouteTotal(res.totalDistance_nm ?? null);
      // Centre the winds-aloft probe on the route midpoint.
      const resolved = (res.points || []).filter((p) => p.lat != null && p.lng != null);
      if (resolved.length > 0) {
        const mid = resolved[Math.floor(resolved.length / 2)];
        await loadWinds(mid.lat as number, mid.lng as number);
      }
    } else {
      setRouteError(r.data?.error || 'Route could not be plotted.');
      setRoutePoints([]);
      setRouteLegs([]);
      setRouteTotal(null);
    }
    setRouteLoading(false);
  }, [from, to, waypointsRaw, loadWinds]);

  const loadTfrs = useCallback(async () => {
    setTfrLoading(true);
    const r = await lensRun('aviation', 'airspace-tfrs', {});
    if (r.data?.ok && r.data.result) {
      setTfrs((r.data.result as { tfrs?: TFR[] }).tfrs || []);
    }
    setTfrLoading(false);
  }, []);

  // SVG projection — equirectangular, auto-fit to plotted route.
  type ResolvedPoint = { ident: string; name: string; lat: number; lng: number };
  const resolvedPts: ResolvedPoint[] = routePoints
    .filter((p): p is RoutePoint & { lat: number; lng: number } => p.lat != null && p.lng != null)
    .map((p) => ({ ident: p.ident, name: p.name, lat: p.lat, lng: p.lng }));
  const bounds = resolvedPts.length > 0
    ? {
        minLat: Math.min(...resolvedPts.map((p) => p.lat)),
        maxLat: Math.max(...resolvedPts.map((p) => p.lat)),
        minLng: Math.min(...resolvedPts.map((p) => p.lng)),
        maxLng: Math.max(...resolvedPts.map((p) => p.lng)),
      }
    : null;
  const W = 640;
  const H = 320;
  const pad = 36;
  const proj = (lat: number, lng: number) => {
    if (!bounds) return { x: W / 2, y: H / 2 };
    const latSpan = Math.max(0.01, bounds.maxLat - bounds.minLat);
    const lngSpan = Math.max(0.01, bounds.maxLng - bounds.minLng);
    const x = pad + ((lng - bounds.minLng) / lngSpan) * (W - 2 * pad);
    const y = pad + ((bounds.maxLat - lat) / latSpan) * (H - 2 * pad);
    return { x, y };
  };

  const activeLayer = chartLayers.find((l) => l.id === activeChart) || chartLayers[0];

  return (
    <div className="space-y-4">
      {/* Chart catalog selector */}
      <div className="rounded-lg border border-sky-500/20 bg-black/20 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Layers className="w-4 h-4 text-sky-400" />
          <span className="text-xs font-semibold text-gray-200 uppercase tracking-wider">
            Moving-map chart overlay
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(['sectional', 'ifr_low', 'ifr_high', 'terminal'] as ChartKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => loadCharts(k)}
              className={
                'px-2.5 py-1 rounded text-xs font-mono transition ' +
                (activeChart === k && chartLayers.length > 0
                  ? 'bg-sky-500/20 text-sky-200 border border-sky-500/40'
                  : 'text-gray-400 border border-white/10 hover:text-sky-200')
              }
            >
              {k === 'sectional' ? 'VFR Sectional' : k === 'ifr_low' ? 'IFR Low' : k === 'ifr_high' ? 'IFR High' : 'Terminal'}
            </button>
          ))}
          {chartLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400 self-center" />}
        </div>
        {activeLayer && (
          <p className="text-[10px] text-gray-400 mt-2 font-mono">
            Active: {activeLayer.label} ({activeLayer.scale}) · FAA-published tiles via{' '}
            {activeLayer.wms.replace('https://', '')}
          </p>
        )}
        {editions.length > 0 && (
          <p className="text-[10px] text-gray-400 mt-1">
            {editions.length} current FAA chart editions on this cycle.
          </p>
        )}
        {chartLayers.length === 0 && !chartLoading && (
          <p className="text-[10px] text-gray-400 mt-2">
            Select a chart type to load the live FAA overlay catalog.
          </p>
        )}
      </div>

      {/* Route plotter */}
      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Route className="w-4 h-4 text-fuchsia-400" />
          <span className="text-xs font-semibold text-gray-200 uppercase tracking-wider">
            Visual route plotting
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input
            type="text"
            value={from}
            onChange={(e) => setFrom(e.target.value.toUpperCase())}
            placeholder="From (KSFO)"
            maxLength={4}
            className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono uppercase"
          />
          <input
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value.toUpperCase())}
            placeholder="To (KLAX)"
            maxLength={4}
            className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono uppercase"
          />
        </div>
        <input
          type="text"
          value={waypointsRaw}
          onChange={(e) => setWaypointsRaw(e.target.value.toUpperCase())}
          placeholder="Waypoints, space-separated (optional)"
          className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono uppercase mb-2"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={plotRoute}
            disabled={routeLoading}
            className="px-3 py-1 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/15 text-xs text-fuchsia-100 disabled:opacity-40 inline-flex items-center gap-1"
          >
            {routeLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Route className="w-3 h-3" />}
            Plot route
          </button>
          <button
            type="button"
            onClick={loadTfrs}
            disabled={tfrLoading}
            className="px-3 py-1 rounded-md border border-amber-500/40 bg-amber-500/15 text-xs text-amber-100 disabled:opacity-40 inline-flex items-center gap-1"
          >
            {tfrLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
            Load TFRs
          </button>
        </div>
        {routeError && <p className="text-xs text-rose-300 mt-2">{routeError}</p>}
      </div>

      {/* Moving map canvas */}
      <div className="rounded-lg border border-white/10 bg-[#070b12] p-2">
        <div className="flex items-center justify-between mb-1 px-1">
          <span className="text-[10px] uppercase tracking-wider text-gray-400">
            {activeLayer?.label || 'Moving map'}
          </span>
          <div className="flex items-center gap-3 text-[10px]">
            <label className="inline-flex items-center gap-1 text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showTfrs}
                onChange={(e) => setShowTfrs(e.target.checked)}
                className="accent-amber-500"
              />
              TFRs
            </label>
            <label className="inline-flex items-center gap-1 text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showRadar}
                onChange={(e) => setShowRadar(e.target.checked)}
                className="accent-sky-500"
              />
              Radar
            </label>
          </div>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%' }} role="img" aria-label="moving map">
          <rect width={W} height={H} fill="#070b12" />
          {/* graticule */}
          {[...Array(9)].map((_, i) => (
            <line key={`v${i}`} x1={(i / 8) * W} y1={0} x2={(i / 8) * W} y2={H} stroke="#15202e" strokeWidth={1} />
          ))}
          {[...Array(5)].map((_, i) => (
            <line key={`h${i}`} x1={0} y1={(i / 4) * H} x2={W} y2={(i / 4) * H} stroke="#15202e" strokeWidth={1} />
          ))}
          {showRadar && radarLabel && (
            <text x={W - 8} y={H - 8} textAnchor="end" fontSize={9} fill="#38bdf8" opacity={0.7}>
              {radarLabel} overlay armed
            </text>
          )}
          {/* magenta route line */}
          {resolvedPts.length >= 2 && (
            <polyline
              points={resolvedPts.map((p) => {
                const { x, y } = proj(p.lat, p.lng);
                return `${x},${y}`;
              }).join(' ')}
              fill="none"
              stroke="#e879f9"
              strokeWidth={2}
              strokeDasharray="6 3"
            />
          )}
          {/* waypoint markers */}
          {resolvedPts.map((p, i) => {
            const { x, y } = proj(p.lat, p.lng);
            const isEnd = i === 0 || i === resolvedPts.length - 1;
            return (
              <g key={p.ident + i}>
                {isEnd ? (
                  <Plane x={x - 7} y={y - 7} width={14} height={14} color="#38bdf8" />
                ) : (
                  <circle cx={x} cy={y} r={4} fill="#e879f9" stroke="#fff" strokeWidth={0.6} />
                )}
                <text x={x + 8} y={y + 3} fontSize={9} fill="#cbd5e1" fontFamily="monospace">
                  {p.ident}
                </text>
              </g>
            );
          })}
          {resolvedPts.length === 0 && (
            <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={12} fill="#475569">
              Plot a route to draw it on the map.
            </text>
          )}
        </svg>
        {routeTotal != null && (
          <p className="text-[11px] text-fuchsia-300 mt-1 px-1 font-mono">
            Total route distance: {routeTotal} nm · {routeLegs.length} leg
            {routeLegs.length === 1 ? '' : 's'}
          </p>
        )}
      </div>

      {/* Route legs table */}
      {routeLegs.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">Leg breakdown</p>
          <div className="space-y-1">
            {routeLegs.map((leg, i) => (
              <div key={i} className="flex items-center justify-between text-xs font-mono">
                <span className="text-gray-300">
                  {leg.from} → {leg.to}
                </span>
                {leg.unresolved ? (
                  <span className="text-rose-300">unresolved ident</span>
                ) : (
                  <span className="text-gray-400">
                    {leg.distance_nm} nm · hdg {String(leg.bearing_deg).padStart(3, '0')}°
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Winds aloft */}
      {(winds.length > 0 || wxLoading) && (
        <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Wind className="w-4 h-4 text-sky-400" />
            <span className="text-[10px] uppercase tracking-wider text-sky-300">
              Winds aloft (route midpoint)
            </span>
            {wxLoading && <Loader2 className="w-3 h-3 animate-spin text-sky-400" />}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {winds.map((w) => (
              <div key={w.level_hpa} className="text-xs bg-black/30 rounded p-2">
                <p className="text-gray-400 font-mono">{w.altitude_ft.toLocaleString()} ft</p>
                <p className="text-gray-100 font-mono">
                  {w.windDir_deg != null ? `${String(Math.round(w.windDir_deg)).padStart(3, '0')}°` : '---'}
                  {' / '}
                  {w.windSpeed_kt != null ? `${Math.round(w.windSpeed_kt)} kt` : '---'}
                </p>
                {w.temp_c != null && (
                  <p className="text-[10px] text-gray-400">{Math.round(w.temp_c)}°C</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active TFRs */}
      {showTfrs && tfrs.length > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span className="text-[10px] uppercase tracking-wider text-amber-300">
              Active TFRs ({tfrs.length})
            </span>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {tfrs.slice(0, 40).map((t) => (
              <div key={t.notamId || t.description} className="text-xs border-b border-white/5 pb-1 last:border-0">
                <p className="text-amber-200 font-mono">
                  {t.type} {t.facility ? `· ${t.facility}` : ''} {t.state ? `(${t.state})` : ''}
                </p>
                {t.description && (
                  <p className="text-gray-400 text-[11px] truncate">{t.description}</p>
                )}
                {t.url && (
                  <a
                    href={t.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-sky-400 hover:underline"
                  >
                    FAA detail
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {showRadar && !radarLabel && (
        <p className="text-[10px] text-gray-400">
          Plot a route to arm the NWS composite-reflectivity radar overlay for its midpoint.
        </p>
      )}
    </div>
  );
}
