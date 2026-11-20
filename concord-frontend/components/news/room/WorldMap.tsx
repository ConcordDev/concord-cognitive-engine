'use client';

/**
 * The front page: the world, heated by how much is being reported from each
 * place. Equal Earth projection over Natural Earth 1:110m (world-atlas),
 * countries filled on a log heat scale, coral pulses where stories arrived in
 * the last three hours, dashed rings where a place is known only from the
 * outlet's country, and great-circle arcs between countries named in the
 * same story. Everything drawn comes from the stories passed in.
 */

import { useMemo, useState } from 'react';
import { geoEqualEarth, geoPath, geoGraticule10, geoCentroid } from 'd3-geo';
import { feature as topojsonFeature } from 'topojson-client';
import type { Feature, Geometry } from 'geojson';
import countriesTopo from 'world-atlas/countries-110m.json';
import { heatOf, type Arc, type Region } from './roomApi';

const W = 960;
const H = 500;

type CountryFeature = Feature<Geometry, { name: string }>;

const FEATURES: CountryFeature[] = (() => {
  const topo = countriesTopo as unknown as Parameters<typeof topojsonFeature>[0] & { objects: { countries: Parameters<typeof topojsonFeature>[1] } };
  const fc = topojsonFeature(topo, topo.objects.countries) as unknown as { features: CountryFeature[] };
  return fc.features.filter((f) => f.properties?.name && f.properties.name !== 'Antarctica');
})();

const PROJECTION = geoEqualEarth().fitExtent([[8, 8], [W - 8, H - 8]], { type: 'Sphere' });
const PATH = geoPath(PROJECTION);
const GRATICULE = PATH(geoGraticule10()) || '';
const SPHERE = PATH({ type: 'Sphere' }) || '';
const SHAPES = FEATURES.map((f) => ({ name: f.properties.name, d: PATH(f) || '', lonLat: geoCentroid(f) as [number, number], xy: PATH.centroid(f) as [number, number] }));
const BY_NAME = new Map(SHAPES.map((s) => [s.name, s]));

/** Display names for the abbreviated Natural Earth labels. */
const DISPLAY: Record<string, string> = {
  'United States of America': 'United States', 'Dem. Rep. Congo': 'DR Congo', 'Central African Rep.': 'Central African Republic',
  'Bosnia and Herz.': 'Bosnia & Herzegovina', 'Dominican Rep.': 'Dominican Republic', 'Eq. Guinea': 'Equatorial Guinea',
  'S. Sudan': 'South Sudan', 'W. Sahara': 'Western Sahara', 'Solomon Is.': 'Solomon Islands', 'Falkland Is.': 'Falkland Islands',
  'N. Cyprus': 'Northern Cyprus', 'Fr. S. Antarctic Lands': 'French Southern Lands', 'Macedonia': 'North Macedonia',
};
export const placeName = (key: string) => DISPLAY[key] || key;
export const ALL_PLACES = SHAPES.map((s) => s.name);

export function WorldMap({ regions, arcs, selected, onSelect, className }: {
  regions: Region[];
  arcs: Arc[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  className?: string;
}) {
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null);
  const byKey = useMemo(() => new Map(regions.map((r) => [r.key, r])), [regions]);
  const max = useMemo(() => regions.reduce((m, r) => Math.max(m, r.count), 0), [regions]);
  const arcPaths = useMemo(() => arcs.slice(0, 30).flatMap((a) => {
    const A = BY_NAME.get(a.a); const B = BY_NAME.get(a.b);
    if (!A || !B) return [];
    const d = PATH({ type: 'LineString', coordinates: [A.lonLat, B.lonLat] });
    return d ? [{ id: `${a.a}|${a.b}`, d, w: 0.8 + Math.log2(a.count + 1) }] : [];
  }), [arcs]);
  const hovered = hover ? byKey.get(hover.key) : null;

  return (
    <div className={`relative ${className || ''}`} data-testid="sr-map">
      <svg viewBox={`0 0 ${W} ${H}`} className="sr-map h-full w-full" role="group" aria-label="World map of where stories are reported from" onMouseLeave={() => setHover(null)}>
        <path className="sr-sphere" d={SPHERE} />
        <path className="sr-graticule" d={GRATICULE} />
        {SHAPES.map((s) => {
          const r = byKey.get(s.name);
          const heat = r ? heatOf(r.mentioned || r.count, max) : 0;
          const active = !!r;
          return (
            <path
              key={s.name}
              className="sr-country"
              d={s.d}
              data-heat={heat}
              data-selected={selected === s.name ? 'true' : 'false'}
              data-testid={active ? 'sr-country-active' : undefined}
              data-place={s.name}
              role={active ? 'button' : undefined}
              tabIndex={active ? 0 : -1}
              aria-label={active ? `${placeName(s.name)}: ${r!.count} stor${r!.count === 1 ? 'y' : 'ies'}` : undefined}
              onMouseMove={(e) => {
                const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                setHover({ key: s.name, x: e.clientX - box.left, y: e.clientY - box.top });
              }}
              onClick={() => onSelect(selected === s.name ? null : s.name)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(selected === s.name ? null : s.name); } }}
            />
          );
        })}
        {arcPaths.map((a) => <path key={a.id} className="sr-arc" d={a.d} strokeWidth={a.w} />)}
        {regions.map((r) => {
          const s = BY_NAME.get(r.key);
          if (!s || !Number.isFinite(s.xy[0])) return null;
          const [x, y] = s.xy;
          return (
            <g key={r.key}>
              {r.outlet > 0 && r.mentioned === 0 && <circle className="sr-outlet-ring" cx={x} cy={y} r={4 + Math.min(6, r.outlet)} />}
              {r.last3h > 0 && r.mentioned > 0 && (
                <>
                  <circle className="sr-pulse" cx={x} cy={y} r={5} />
                  <circle className="sr-core" cx={x} cy={y} r={1.6 + Math.min(3, Math.log2(r.last3h + 1))} />
                </>
              )}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="sr-tooltip absolute z-10 px-2.5 py-1.5 text-[12px]" style={{ left: Math.min(hover.x + 14, 9999), top: hover.y + 14 }} role="status">
          <p className="sr-display text-[15px] font-semibold leading-tight">{placeName(hover.key)}</p>
          {hovered ? (
            <p className="sr-mono text-[11px] sr-text-2">
              {hovered.count} stor{hovered.count === 1 ? 'y' : 'ies'} · {hovered.sources} source{hovered.sources === 1 ? '' : 's'}
              {hovered.last3h ? <span className="sr-live-text"> · {hovered.last3h} in 3h</span> : null}
              {hovered.outlet ? <span className="sr-outlet-text"> · {hovered.outlet} by outlet</span> : null}
            </p>
          ) : <p className="text-[11px] sr-faint">No stories in this window.</p>}
        </div>
      )}
    </div>
  );
}
