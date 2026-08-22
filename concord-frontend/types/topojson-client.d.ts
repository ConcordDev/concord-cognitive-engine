// Minimal type stub for the `topojson-client` package (real runtime
// dependency — see package.json/package-lock.json). The official
// `@types/topojson-client` package depends on `topojson-specification`,
// which was unpublished from npm in 2023 (`npm view topojson-specification`
// 404s), making that types package unusable. This stub declares only the
// slice of the API actually used in this codebase (`feature()`, called
// from components/global/ChoroplethMap.tsx to convert world-atlas's
// TopoJSON country data into GeoJSON) — extend here if a future caller
// needs more of topojson-client's surface (merge/mesh/neighbors/bbox).
declare module 'topojson-client' {
  export function feature(
    topology: unknown,
    object: unknown,
  ): {
    type: 'FeatureCollection';
    features: Array<{
      type: 'Feature';
      id: string;
      properties: Record<string, unknown>;
      geometry: { type: string; coordinates: unknown };
    }>;
  };
}
