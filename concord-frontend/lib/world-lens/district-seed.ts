/**
 * World Lens — the 2D district editor's starting canvas.
 *
 * This used to be DEMO_DISTRICT "Pioneer Valley": six pre-placed
 * "validated" buildings by invented creators (@architect_alex,
 * @builder_bob…), invented infrastructure with citation counts, and
 * hardcoded capacities (Pop 2,400 · Power 5,000 kW · Water 90,000 gal/day)
 * that the status bar showed as if they were real. The editor's district is
 * local state that is never saved, so it now starts as an honest empty
 * sketch: a flat 20×20 ground grid, no zones, no infrastructure, no
 * buildings, zero capacities. Anything that appears in it was placed by
 * the user in this session.
 */

import type { District, TerrainCell } from './types';

export const LOCAL_SKETCH_NAME = 'Local sketch (not saved)';

function flatTerrainGrid(width: number, height: number): TerrainCell[][] {
  // Neutral, uniform ground: a canvas to draw on, not survey data.
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({
      soilType: 'loam' as const,
      bedrockDepth: 5,
      waterTableDepth: 3,
      seismicZone: 1,
      elevation: 10,
    })),
  );
}

export const EMPTY_DISTRICT: District = {
  id: 'local-sketch',
  name: LOCAL_SKETCH_NAME,
  terrain: {
    grid: flatTerrainGrid(20, 20),
    dimensions: { width: 20, height: 20 },
  },
  zoning: { zones: [] },
  infrastructure: {
    waterMains: [],
    powerGrid: [],
    drainage: [],
    roads: [],
    dataNetwork: [],
  },
  weather: {
    baseTemperature: 15,
    seasonalRange: { min: 15, max: 15 },
    avgWindSpeed: 0,
    avgWindDirection: 0,
    annualRainfall: 0,
    snowLoad: 0,
    seismicRisk: 0,
  },
  buildings: [],
  environmentalScore: 0,
  populationCapacity: 0,
  powerCapacity: 0,
  waterCapacity: 0,
};
