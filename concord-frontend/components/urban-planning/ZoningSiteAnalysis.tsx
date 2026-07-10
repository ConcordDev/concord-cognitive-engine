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
 *
 * Each tool is a real designed form (not a JSON-paste textarea, not a
 * generic macro-button wall) that calls its own macro and renders the
 * actual numbers the backend computes.
 */

import { useState } from 'react';
import { Loader2, Building2, Footprints, Users, Car, Plus, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Tool = 'zoning' | 'walkability' | 'density' | 'traffic';

const TOOLS: { id: Tool; label: string; icon: typeof Building2 }[] = [
  { id: 'zoning', label: 'Zoning Analysis', icon: Building2 },
  { id: 'walkability', label: 'Walkability Score', icon: Footprints },
  { id: 'density', label: 'Density Calculator', icon: Users },
  { id: 'traffic', label: 'Traffic Impact', icon: Car },
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
      </div>
    </div>
  );
}
