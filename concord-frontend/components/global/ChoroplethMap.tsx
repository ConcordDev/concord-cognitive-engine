'use client';

/**
 * ChoroplethMap — a REAL choropleth: actual country-boundary polygons
 * filled by real World Bank indicator intensity, not centroid dots
 * standing in for one (that was the prior state — see DataExplorer.tsx's
 * `choroMarkers` + the shared point-map `MapView`). Country geometry comes
 * from `world-atlas` (Natural Earth via the well-known public-domain
 * TopoJSON package, ISC-licensed) converted with `topojson-client`;
 * numeric ISO-3166 ids are mapped to the alpha-3 codes the World Bank API
 * (and this app's own `global.choropleth` macro) actually returns, via the
 * small dedicated `iso-3166-1` package — never a fabricated code table.
 *
 * Uses the same equirectangular projection formula as the app's other
 * dependency-free SVG map (`components/viz/MapView.tsx`), for visual/
 * behavioral consistency, and the same intensity color ramp.
 */

import { useMemo, useState } from 'react';
// See types/topojson-client.d.ts for why this needs a local stub instead
// of the official (currently broken) @types package.
import { feature as topojsonFeature } from 'topojson-client';
import iso from 'iso-3166-1';
// world-atlas ships plain JSON (documented TopoJSON: a Topology with an
// `objects.countries` GeometryCollection) — resolveJsonModule handles the
// import, no `require()` needed.
import countriesTopo from 'world-atlas/countries-110m.json';

export interface ChoroplethCountryDatum {
  code: string; // alpha-3, matches World Bank's countryiso3code
  name: string;
  value: number;
  intensity: number; // 0..1, already normalized by the backend
}

interface ChoroplethMapProps {
  countries: ChoroplethCountryDatum[];
  min: number;
  max: number;
  indicatorLabel: string;
  fmt: (v: number) => string;
  height?: number;
}

const W = 720;
const H = 360;

function project([lon, lat]: number[]): [number, number] {
  return [((lon + 180) / 360) * W, ((90 - lat) / 180) * H];
}

function ringPath(ring: number[][]): string {
  return `M ${ring.map((p) => project(p).join(',')).join(' L ')} Z`;
}

// Same ramp as components/viz/MapView.tsx's intensity->color mapping, for
// visual consistency across the app's two dependency-free SVG maps.
function ramp(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  const r = Math.round(30 + c * 225);
  const g = Math.round(80 + (1 - c) * 120);
  const b = Math.round(220 - c * 160);
  return `rgb(${r},${g},${b})`;
}

const NO_DATA_FILL = '#27272a';

// Built once at module load — real country geometry (177 features at 110m
// resolution) is stable and doesn't depend on props, so there is no reason
// to recompute per render or per component instance.
const COUNTRY_FEATURES: Array<{ alpha3: string | null; name: string; rings: number[][][] }> = (() => {
  const topo = countriesTopo as unknown as { objects: { countries: unknown } };
  const geo = topojsonFeature(topo, topo.objects.countries);
  return geo.features.map((f) => {
    const match = iso.whereNumeric(String(f.id).padStart(3, '0'));
    const geomType = f.geometry.type;
    const coords = f.geometry.coordinates as number[][][] | number[][][][];
    // Flatten Polygon (rings: number[][][]) and MultiPolygon
    // (polygons: number[][][][], each an array of rings) into one flat
    // list of rings — a choropleth fills every ring the same way per
    // country, so the Polygon/MultiPolygon distinction doesn't matter
    // once we're just drawing filled paths.
    const rings: number[][][] = geomType === 'MultiPolygon'
      ? (coords as number[][][][]).flat()
      : (coords as number[][][]);
    return { alpha3: match?.alpha3 || null, name: String(f.properties.name || 'Unknown'), rings };
  });
})();

export function ChoroplethMap({ countries, min, max, indicatorLabel, fmt, height = 340 }: ChoroplethMapProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const byCode = useMemo(() => new Map(countries.map((c) => [c.code, c])), [countries]);
  const span = max - min || 1;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height }} role="img" aria-label={`Choropleth map: ${indicatorLabel}`}>
        <rect width={W} height={H} fill="#0a0a0f" />
        {COUNTRY_FEATURES.map((feature, fi) => {
          const datum = feature.alpha3 ? byCode.get(feature.alpha3) : undefined;
          const fill = datum ? ramp((datum.value - min) / span) : NO_DATA_FILL;
          const active = hovered === feature.alpha3;
          return (
            <g key={fi}>
              {feature.rings.map((ring, ri) => (
                <path
                  key={ri}
                  d={ringPath(ring)}
                  fill={fill}
                  fillOpacity={datum ? (active ? 1 : 0.85) : 0.4}
                  stroke={active ? '#fff' : '#000'}
                  strokeOpacity={active ? 0.6 : 0.25}
                  strokeWidth={active ? 1 : 0.4}
                  onMouseEnter={() => feature.alpha3 && setHovered(feature.alpha3)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ cursor: datum ? 'pointer' : 'default' }}
                >
                  <title>
                    {datum ? `${datum.name} — ${fmt(datum.value)}` : `${feature.name} — no data`}
                  </title>
                </path>
              ))}
            </g>
          );
        })}
      </svg>
      {hovered && byCode.get(hovered) && (
        <p className="mt-1 px-1 text-[11px] text-zinc-300">
          <span className="font-medium text-white">{byCode.get(hovered)!.name}</span>
          {' · '}{fmt(byCode.get(hovered)!.value)}
        </p>
      )}
    </div>
  );
}

export default ChoroplethMap;
