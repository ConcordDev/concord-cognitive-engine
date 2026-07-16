'use client';

/**
 * ZoningSiteAnalysis — real deterministic zoning/site-analysis calculators
 * that were completely unsurfaced before this rebuild (verified: zero
 * frontend references to any of the four macros). See
 * docs/lens-specs/urban-planning-capability-map.md.
 *
 *   - zoningAnalysis   → zone type + lot size → FAR, max buildable sqft,
 *                         height/setback/parking requirements, density class
 *   - walkabilityScore → amenity checklist → walkability score/rating
 *   - densityCalc      → population/area/units → pop & housing density,
 *                         urban/suburban/rural classification, transit fit
 *   - trafficImpact    → new housing/commercial sqft → new daily/peak
 *                         trips, % increase, impact level, mitigation list
 *   - shadowStudy      → lat/lng + a massing envelope → real hourly
 *                         NOAA-algorithm sun position (altitude/azimuth)
 *                         crossed with basic shadow trig into a shadow
 *                         length/direction path across one UTC day. This
 *                         is honestly a 2D shadow-path study, NOT a
 *                         rendered 3D massing study — see the backend
 *                         macro's `label`/`method` fields, which this tool
 *                         renders verbatim rather than re-describing.
 *
 * Each tool is a real designed form (not a JSON-paste textarea, not a
 * generic macro-button wall) that calls its own macro and renders the
 * actual numbers the backend computes.
 */

import { useState } from 'react';
import { Loader2, Building2, Footprints, Users, Car, Sun, Plus, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Tool = 'zoning' | 'walkability' | 'density' | 'traffic' | 'sun-study';

const TOOLS: { id: Tool; label: string; icon: typeof Building2 }[] = [
  { id: 'zoning', label: 'Zoning Analysis', icon: Building2 },
  { id: 'walkability', label: 'Walkability Score', icon: Footprints },
  { id: 'density', label: 'Density Calculator', icon: Users },
  { id: 'traffic', label: 'Traffic Impact', icon: Car },
  { id: 'sun-study', label: 'Sun / Shadow Study', icon: Sun },
];

const ZONES = ['residential', 'commercial', 'mixed', 'industrial'];
const AMENITY_CATEGORIES = ['grocery', 'restaurant', 'school', 'park', 'transit', 'retail', 'healthcare'];

interface ZoningResult {
  zoneType: string;
  lotSize: number;
  floorAreaRatio: number;
  maxBuildableSqFt: number;
  maxHeight: string;
  setback: string;
  parkingRequired: string;
  density: string;
}

interface WalkabilityResult {
  walkabilityScore: number;
  rating: string;
  amenityScores: Record<string, number>;
  totalAmenities: number;
}

interface DensityResult {
  population: number;
  area: string;
  populationDensity: string;
  housingDensity: string;
  classification: string;
  transitViability: string;
}

interface TrafficResult {
  newDailyTrips: number;
  peakHourTrips: number;
  currentADT: number;
  percentIncrease: number;
  impactLevel: string;
  mitigation: string[];
}

interface ShadowSample {
  hourUtc: number;
  sunUp: boolean;
  altitudeDeg: number;
  azimuthDeg: number;
  shadowLengthFt: number | null;
  shadowDirectionDeg: number | null;
}

interface ShadowStudyResult {
  label: string;
  location: { lat: number; lng: number; source: string };
  date: string;
  envelope: { widthFt: number; depthFt: number; heightFt: number };
  method: string;
  resolution: string;
  samples: ShadowSample[];
  daylightHours: number;
  approxSolarNoon: { hourUtc: number; altitudeDeg: number; note: string } | null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
      {label}
      {children}
    </label>
  );
}

const inputCls = 'rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder-zinc-600';
const runBtnCls = 'inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500 disabled:opacity-50';
const errCls = 'rounded border border-red-500/20 bg-red-500/5 px-2 py-1.5 text-xs text-red-300';
const resultCardCls = 'rounded-lg border border-emerald-500/20 bg-zinc-950/60 p-3';

function ZoningAnalysisTool() {
  const [zoneType, setZoneType] = useState('residential');
  const [lotSizeSqFt, setLotSizeSqFt] = useState('5000');
  const [result, setResult] = useState<ZoningResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true); setError(null);
    const r = await lensRun<ZoningResult>('urban-planning', 'zoningAnalysis', {
      zoneType, lotSizeSqFt: Number(lotSizeSqFt),
    });
    setLoading(false);
    if (r.data.ok === false || !r.data.result) { setError(r.data.error || 'analysis failed'); return; }
    setResult(r.data.result);
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        Zone type + lot size → floor area ratio, max buildable square footage, height &amp;
        setback limits, parking requirement, and density class.
      </p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Field label="Zone type">
          <select value={zoneType} onChange={(e) => setZoneType(e.target.value)} className={inputCls}>
            {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </Field>
        <Field label="Lot size (sqft)">
          <input inputMode="numeric" value={lotSizeSqFt} onChange={(e) => setLotSizeSqFt(e.target.value)} className={inputCls} />
        </Field>
      </div>
      {error && <div className={errCls}>{error}</div>}
      <button type="button" onClick={run} disabled={loading} className={runBtnCls}>
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Building2 className="w-3.5 h-3.5" />} Analyze Zoning
      </button>

      {result && (
        <div className={cn(resultCardCls, 'grid grid-cols-2 gap-x-4 gap-y-1.5 md:grid-cols-4')}>
          {[
            ['FAR', result.floorAreaRatio],
            ['Max buildable', `${result.maxBuildableSqFt.toLocaleString()} sqft`],
            ['Max height', result.maxHeight],
            ['Setback', result.setback],
            ['Parking req.', result.parkingRequired],
            ['Density class', result.density],
          ].map(([label, val]) => (
            <div key={label as string}>
              <div className="text-[9px] uppercase tracking-wider text-zinc-400">{label}</div>
              <div className="font-mono text-sm text-emerald-300">{val}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WalkabilityScoreTool() {
  const [amenities, setAmenities] = useState<{ category: string; withinWalkingDistance: boolean }[]>([
    { category: 'grocery', withinWalkingDistance: true },
  ]);
  const [result, setResult] = useState<WalkabilityResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addRow = () => setAmenities((a) => [...a, { category: 'retail', withinWalkingDistance: true }]);
  const removeRow = (i: number) => setAmenities((a) => a.filter((_, idx) => idx !== i));
  const updateRow = (i: number, patch: Partial<{ category: string; withinWalkingDistance: boolean }>) =>
    setAmenities((a) => a.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const run = async () => {
    setLoading(true); setError(null);
    const r = await lensRun<WalkabilityResult>('urban-planning', 'walkabilityScore', { amenities });
    setLoading(false);
    if (r.data.ok === false || !r.data.result) { setError(r.data.error || 'scoring failed'); return; }
    setResult(r.data.result);
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        List nearby amenities and mark which are within walking distance — the score weighs
        seven categories (grocery, restaurant, school, park, transit, retail, healthcare).
      </p>
      <div className="space-y-2">
        {amenities.map((a, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
            <select value={a.category} onChange={(e) => updateRow(i, { category: e.target.value })} className={inputCls}>
              {AMENITY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <input
                type="checkbox"
                checked={a.withinWalkingDistance}
                onChange={(e) => updateRow(i, { withinWalkingDistance: e.target.checked })}
                className="accent-emerald-500"
              />
              Walkable
            </label>
            <button type="button" aria-label="Remove amenity" onClick={() => removeRow(i)} className="text-zinc-600 hover:text-rose-400">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button type="button" onClick={addRow} className="flex items-center gap-1 text-[11px] text-emerald-300 hover:text-emerald-200">
          <Plus className="w-3.5 h-3.5" /> Add amenity
        </button>
      </div>
      {error && <div className={errCls}>{error}</div>}
      <button type="button" onClick={run} disabled={loading} className={runBtnCls}>
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Footprints className="w-3.5 h-3.5" />} Score Walkability
      </button>

      {result && (
        <div className={cn(resultCardCls, 'space-y-2')}>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-zinc-300">Score: <b className="text-emerald-300">{result.walkabilityScore}/100</b></span>
            <span className="text-zinc-300">Rating: <b className="text-emerald-300">{result.rating.replace(/-/g, ' ')}</b></span>
            <span className="text-zinc-400">{result.totalAmenities} amenities</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
            {Object.entries(result.amenityScores).map(([cat, score]) => (
              <div key={cat} className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1">
                <div className="text-[9px] uppercase tracking-wider text-zinc-400">{cat}</div>
                <div className="font-mono text-xs text-emerald-300">{score.toFixed(1)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DensityCalculatorTool() {
  const [population, setPopulation] = useState('12000');
  const [areaSqMiles, setAreaSqMiles] = useState('2.5');
  const [housingUnits, setHousingUnits] = useState('5000');
  const [result, setResult] = useState<DensityResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true); setError(null);
    const r = await lensRun<DensityResult>('urban-planning', 'densityCalc', {
      population: Number(population), areaSqMiles: Number(areaSqMiles), housingUnits: Number(housingUnits),
    });
    setLoading(false);
    if (r.data.ok === false || !r.data.result) { setError(r.data.error || 'calculation failed'); return; }
    setResult(r.data.result);
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        Population, area, and housing units for a district → population &amp; housing density,
        urban/suburban/rural classification, and transit-mode viability.
      </p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Field label="Population">
          <input inputMode="numeric" value={population} onChange={(e) => setPopulation(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Area (sq mi)">
          <input inputMode="decimal" value={areaSqMiles} onChange={(e) => setAreaSqMiles(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Housing units">
          <input inputMode="numeric" value={housingUnits} onChange={(e) => setHousingUnits(e.target.value)} className={inputCls} />
        </Field>
      </div>
      {error && <div className={errCls}>{error}</div>}
      <button type="button" onClick={run} disabled={loading} className={runBtnCls}>
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Users className="w-3.5 h-3.5" />} Calculate Density
      </button>

      {result && (
        <div className={cn(resultCardCls, 'grid grid-cols-2 gap-x-4 gap-y-1.5 md:grid-cols-3')}>
          {[
            ['Population density', result.populationDensity],
            ['Housing density', result.housingDensity],
            ['Area', result.area],
            ['Classification', result.classification.replace(/-/g, ' ')],
            ['Transit viability', result.transitViability.replace(/-/g, ' ')],
          ].map(([label, val]) => (
            <div key={label as string}>
              <div className="text-[9px] uppercase tracking-wider text-zinc-400">{label}</div>
              <div className="font-mono text-sm text-emerald-300">{val}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TrafficImpactTool() {
  const [newHousingUnits, setNewHousingUnits] = useState('120');
  const [newCommercialSqFt, setNewCommercialSqFt] = useState('15000');
  const [currentADT, setCurrentADT] = useState('10000');
  const [result, setResult] = useState<TrafficResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true); setError(null);
    const r = await lensRun<TrafficResult>('urban-planning', 'trafficImpact', {
      newHousingUnits: Number(newHousingUnits),
      newCommercialSqFt: Number(newCommercialSqFt),
      currentADT: Number(currentADT),
    });
    setLoading(false);
    if (r.data.ok === false || !r.data.result) { setError(r.data.error || 'analysis failed'); return; }
    setResult(r.data.result);
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        New housing units + new commercial square footage against the current average daily
        traffic (ADT) → projected new daily/peak-hour trips, percent increase, and mitigation.
      </p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Field label="New housing units">
          <input inputMode="numeric" value={newHousingUnits} onChange={(e) => setNewHousingUnits(e.target.value)} className={inputCls} />
        </Field>
        <Field label="New commercial sqft">
          <input inputMode="numeric" value={newCommercialSqFt} onChange={(e) => setNewCommercialSqFt(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Current ADT">
          <input inputMode="numeric" value={currentADT} onChange={(e) => setCurrentADT(e.target.value)} className={inputCls} />
        </Field>
      </div>
      {error && <div className={errCls}>{error}</div>}
      <button type="button" onClick={run} disabled={loading} className={runBtnCls}>
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Car className="w-3.5 h-3.5" />} Project Traffic Impact
      </button>

      {result && (
        <div className={cn(resultCardCls, 'space-y-2')}>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 md:grid-cols-4">
            {[
              ['New daily trips', result.newDailyTrips.toLocaleString()],
              ['Peak hour trips', result.peakHourTrips.toLocaleString()],
              ['Current ADT', result.currentADT.toLocaleString()],
              ['% increase', `${result.percentIncrease}%`],
            ].map(([label, val]) => (
              <div key={label as string}>
                <div className="text-[9px] uppercase tracking-wider text-zinc-400">{label}</div>
                <div className="font-mono text-sm text-emerald-300">{val}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-400">Impact level:</span>
            <span className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase',
              result.impactLevel === 'significant' ? 'text-red-300 bg-red-400/10' :
              result.impactLevel === 'moderate' ? 'text-amber-300 bg-amber-400/10' : 'text-emerald-300 bg-emerald-400/10',
            )}>{result.impactLevel}</span>
          </div>
          {!!result.mitigation?.length && (
            <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-zinc-300">
              {result.mitigation.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Top-down 2D shadow-fan schematic — one ray per daylight hourly sample,
 * angle = real shadowDirectionDeg, length scaled to the day's longest
 * shadow. This is explicitly a flat compass diagram, not a 3D render: it
 * exists to make the real per-hour direction/length data visually
 * scannable, not to simulate massing geometry.
 */
function ShadowFanDiagram({ samples, maxShadowFt }: { samples: ShadowSample[]; maxShadowFt: number }) {
  const rays = samples.filter((s) => s.sunUp && s.shadowDirectionDeg != null && s.shadowLengthFt != null);
  if (rays.length === 0) return null;
  const size = 180;
  const center = size / 2;
  const maxRadius = center - 18;
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
      <div className="mb-1 text-[9px] uppercase tracking-wider text-zinc-500">
        Shadow directions — top-down 2D schematic (not a 3D render, not to scale)
      </div>
      <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-36 w-36" role="img"
        aria-label="Shadow direction fan diagram">
        <circle cx={center} cy={center} r={maxRadius} fill="none" stroke="currentColor" strokeWidth={1} className="text-zinc-800" />
        <text x={center} y={12} textAnchor="middle" className="fill-zinc-600" style={{ fontSize: 8 }}>N</text>
        {rays.map((s) => {
          const r = maxRadius * Math.min(1, (s.shadowLengthFt as number) / Math.max(1, maxShadowFt));
          // Compass bearing (0deg = north, clockwise) -> SVG coordinates (0deg = up/-y).
          const rad = ((s.shadowDirectionDeg as number) * Math.PI) / 180;
          const x = center + r * Math.sin(rad);
          const y = center - r * Math.cos(rad);
          return (
            <line key={s.hourUtc} x1={center} y1={center} x2={x} y2={y}
              stroke="currentColor" strokeWidth={1.5} className="text-amber-500/70" />
          );
        })}
        <rect x={center - 5} y={center - 5} width={10} height={10} className="fill-zinc-500" />
      </svg>
    </div>
  );
}

function SunStudyTool() {
  const [lat, setLat] = useState('40.7128');
  const [lng, setLng] = useState('-74.0060');
  const [zoneType, setZoneType] = useState('commercial');
  const [lotSizeSqFt, setLotSizeSqFt] = useState('20000');
  const [date, setDate] = useState('2026-06-21');
  const [result, setResult] = useState<ShadowStudyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true); setError(null);
    const r = await lensRun<ShadowStudyResult>('urban-planning', 'shadowStudy', {
      lat: Number(lat), lng: Number(lng), zoneType, lotSizeSqFt: Number(lotSizeSqFt), date,
    });
    setLoading(false);
    if (r.data.ok === false || !r.data.result) { setError(r.data.error || 'sun study failed'); return; }
    setResult(r.data.result);
  };

  const daylight = result?.samples.filter((s) => s.sunUp) ?? [];
  const maxShadowFt = daylight.reduce((m, s) => Math.max(m, s.shadowLengthFt ?? 0), 1);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        Real NOAA solar-position algorithm crossed with basic shadow trig, sampled hourly across
        one UTC day — an honest 2D shadow-path study (length + direction per daylight hour), not a
        rendered 3D massing study.
      </p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Field label="Latitude">
          <input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Longitude">
          <input inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Zone type">
          <select value={zoneType} onChange={(e) => setZoneType(e.target.value)} className={inputCls}>
            {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </Field>
        <Field label="Lot size (sqft)">
          <input inputMode="numeric" value={lotSizeSqFt} onChange={(e) => setLotSizeSqFt(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Date (UTC)">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </Field>
      </div>
      {error && <div className={errCls}>{error}</div>}
      <button type="button" onClick={run} disabled={loading} className={runBtnCls}>
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sun className="w-3.5 h-3.5" />} Run Sun Study
      </button>

      {result && (
        <div className={cn(resultCardCls, 'space-y-3')}>
          <div className="text-[10px] font-medium text-amber-300">{result.label}</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] md:grid-cols-4">
            <div>
              <div className="text-[9px] uppercase tracking-wider text-zinc-400">Envelope height</div>
              <div className="font-mono text-sm text-emerald-300">{result.envelope.heightFt} ft</div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider text-zinc-400">Daylight hours</div>
              <div className="font-mono text-sm text-emerald-300">{result.daylightHours}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider text-zinc-400">Peak sun (UTC)</div>
              <div className="font-mono text-sm text-emerald-300">
                {result.approxSolarNoon ? `${String(result.approxSolarNoon.hourUtc).padStart(2, '0')}:00 @ ${result.approxSolarNoon.altitudeDeg}°` : 'n/a'}
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider text-zinc-400">Resolution</div>
              <div className="font-mono text-sm text-emerald-300">{result.resolution}</div>
            </div>
          </div>

          <ShadowFanDiagram samples={result.samples} maxShadowFt={maxShadowFt} />

          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-zinc-400">
                  <th className="py-1 pr-3 text-left font-normal">UTC hour</th>
                  <th className="py-1 pr-3 text-left font-normal">Altitude</th>
                  <th className="py-1 pr-3 text-left font-normal">Azimuth</th>
                  <th className="py-1 pr-3 text-left font-normal">Shadow length</th>
                  <th className="py-1 text-left font-normal">Shadow direction</th>
                </tr>
              </thead>
              <tbody>
                {daylight.map((s) => (
                  <tr key={s.hourUtc} className="border-t border-zinc-800/60">
                    <td className="py-1 pr-3 font-mono text-zinc-300">{String(s.hourUtc).padStart(2, '0')}:00</td>
                    <td className="py-1 pr-3 font-mono text-emerald-300">{s.altitudeDeg}°</td>
                    <td className="py-1 pr-3 font-mono text-emerald-300">{s.azimuthDeg}°</td>
                    <td className="py-1 pr-3 font-mono text-emerald-300">{s.shadowLengthFt?.toLocaleString()} ft</td>
                    <td className="py-1 font-mono text-emerald-300">{s.shadowDirectionDeg}°</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] leading-relaxed text-zinc-500">{result.method}</p>
        </div>
      )}
    </div>
  );
}

export function ZoningSiteAnalysis() {
  const [tool, setTool] = useState<Tool>('zoning');

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-emerald-600/15 to-transparent">
        <Building2 className="w-5 h-5 text-emerald-400" />
        <h2 className="text-sm font-bold text-zinc-100">Zoning &amp; Site Analysis</h2>
        <span className="text-[11px] text-zinc-400">Real deterministic planning math — not an LLM guess</span>
      </header>
      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
        {TOOLS.map((t) => {
          const Icon = t.icon;
          const active = tool === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTool(t.id)}
              className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-emerald-500',
                active ? 'bg-zinc-900 text-emerald-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>
      <div className="p-4">
        {tool === 'zoning' && <ZoningAnalysisTool />}
        {tool === 'walkability' && <WalkabilityScoreTool />}
        {tool === 'density' && <DensityCalculatorTool />}
        {tool === 'traffic' && <TrafficImpactTool />}
        {tool === 'sun-study' && <SunStudyTool />}
      </div>
    </div>
  );
}
