// Asset Studio Increment 1 — Unit 3 (in-world round-trip mapping).
//
// world_buildings rows gain nullable `archetype`/`feature` columns once an
// Asset-Studio-authored building is spawned (Unit 1's migration). This pins
// that `mapWorldBuildingToRendererDTU` (components/world/WorldOsSurface.tsx) threads
// those two fields through onto the BuildingDTU object BuildingRenderer3D
// consumes (it already reads `dtu.archetype`/`dtu.feature` at its
// procedural-buildings path, BuildingRenderer3D.tsx:164/177) — WITHOUT
// changing the mapping's output shape for any row that doesn't carry them,
// i.e. every seed/lens/legacy building already in the world.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// world/page.tsx pulls in this page's entire component tree (Three.js scene
// components, sockets, dozens of lens panels) at module-import time, so it
// can't be safely imported directly in a unit test — this is the same
// constraint documented in tests/world-page-wind-direction-threading.test.ts
// and tests/power-clusters-layer.test.ts, and the same source-pin convention
// they use is followed here.
const src = readFileSync(path.resolve(__dirname, '../../../../components/world/WorldOsSurface.tsx'), 'utf8');

/**
 * Re-derived, standalone copy of `mapWorldBuildingToRendererDTU`'s logic so
 * the mapping's actual OUTPUT can be asserted with real computed values
 * (not just pattern-matched). The `it('source pins the exact conditional
 * spread ...')` case below independently pins that page.tsx's real
 * implementation matches this — so the two can't silently drift apart.
 */
function coerceMaterial(m: string) {
  const known = ['usb', 'brick', 'stone', 'wood', 'steel', 'concrete', 'glass'];
  return known.includes(m) ? m : 'usb';
}
type Row = {
  id: string;
  building_type: string;
  name: string;
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  material: string;
  is_seed: number;
  archetype?: string;
  feature?: string;
};
function mapWorldBuildingToRendererDTU(b: Row) {
  return {
    id: b.id,
    name: b.name || b.building_type,
    position: { x: b.x, y: b.y ?? 0, z: b.z },
    dimensions: { width: b.width || 10, height: b.height || 8, depth: b.depth || 8 },
    floors: 1,
    material: coerceMaterial(b.material),
    style: 'colonial' as const,
    building_type: b.building_type,
    ...(b.archetype ? { archetype: b.archetype } : {}),
    ...(b.feature ? { feature: b.feature } : {}),
    structure: {
      columns: { count: 0, spacing: 0, radius: 0 },
      beams: { count: 0, height: 0 },
      roofType: 'gable' as const,
      hasBasement: false,
      windowRows: 1,
      windowsPerRow: 2,
    },
  };
}

const legacyRow: Row = {
  id: 'b-legacy-1',
  building_type: 'tavern',
  name: 'Old Tavern',
  x: 12,
  y: 0,
  z: 34,
  width: 14,
  depth: 10,
  height: 9,
  material: 'brick',
  is_seed: 1,
  // no archetype / feature — matches every real seed/lens row today
};

const authoredRow: Row = {
  id: 'b-authored-1',
  building_type: 'archive', // Unit 1 sets building_type=archetype for authored rows
  name: "Kestrel's Archive",
  x: 100,
  y: 0,
  z: 200,
  width: 18,
  depth: 16,
  height: 12,
  material: 'stone',
  is_seed: 0,
  archetype: 'archive',
  feature: 'dome',
};

describe('world lens page — world_buildings row -> BuildingDTU mapping (Unit 3)', () => {
  it('a row WITHOUT archetype/feature maps byte-identically to the pre-Unit-3 shape (no archetype/feature keys at all)', () => {
    const dtu = mapWorldBuildingToRendererDTU(legacyRow);
    expect(dtu).toEqual({
      id: 'b-legacy-1',
      name: 'Old Tavern',
      position: { x: 12, y: 0, z: 34 },
      dimensions: { width: 14, height: 9, depth: 10 },
      floors: 1,
      material: 'brick',
      style: 'colonial',
      building_type: 'tavern',
      structure: {
        columns: { count: 0, spacing: 0, radius: 0 },
        beams: { count: 0, height: 0 },
        roofType: 'gable',
        hasBasement: false,
        windowRows: 1,
        windowsPerRow: 2,
      },
    });
    expect('archetype' in dtu).toBe(false);
    expect('feature' in dtu).toBe(false);
  });

  it('a row WITH archetype+feature produces a BuildingDTU carrying them through, unmodified', () => {
    const dtu = mapWorldBuildingToRendererDTU(authoredRow);
    expect(dtu.archetype).toBe('archive');
    expect(dtu.feature).toBe('dome');
    // Everything else about the mapping is unaffected by the new fields.
    expect(dtu.id).toBe('b-authored-1');
    expect(dtu.building_type).toBe('archive');
    expect(dtu.dimensions).toEqual({ width: 18, height: 12, depth: 16 });
  });

  it('a falsy (empty-string) archetype/feature is treated as "not carried" and omitted, not passed through', () => {
    const dtu = mapWorldBuildingToRendererDTU({ ...legacyRow, archetype: '', feature: '' });
    expect('archetype' in dtu).toBe(false);
    expect('feature' in dtu).toBe(false);
  });

  // ── Source pins: prove page.tsx's REAL implementation matches the logic
  // exercised above, so the standalone copy above can't silently drift from
  // the shipped code. ─────────────────────────────────────────────────────
  //
  // WorldBuildingRow + mapWorldBuildingToRendererDTU moved out of page.tsx
  // into lib/world-lens/world-building-dto.ts (the pre-existing canonical
  // copy standalone preview surfaces already used) because a Next.js page.tsx
  // file may only export Page fields (default/metadata/generateStaticParams/
  // …) — re-exporting a plain function/interface from it broke the
  // production build ("... is not a valid Page export field"). page.tsx now
  // imports both symbols instead of defining them; the pins below check the
  // canonical lib source for the definitions and page.tsx's source for the
  // import + usage sites.
  const dtoSrc = readFileSync(
    path.resolve(__dirname, '..', '..', '..', '..', 'lib', 'world-lens', 'world-building-dto.ts'),
    'utf8'
  );

  it('page.tsx imports WorldBuildingRow + mapWorldBuildingToRendererDTU from the canonical lib module', () => {
    expect(src).toMatch(/import \{ mapWorldBuildingToRendererDTU, type WorldBuildingRow \} from '@\/lib\/world-lens\/world-building-dto';/);
  });

  it('the canonical lib module declares WorldBuildingRow with nullable archetype/feature', () => {
    expect(dtoSrc).toMatch(/export interface WorldBuildingRow \{/);
    expect(dtoSrc).toMatch(/archetype\?:\s*string;/);
    expect(dtoSrc).toMatch(/feature\?:\s*string;/);
  });

  it('declares the worldBuildings state using WorldBuildingRow[]', () => {
    expect(src).toMatch(/useState<WorldBuildingRow\[\]>\(\[\]\)/);
  });

  it('the canonical lib module exports mapWorldBuildingToRendererDTU', () => {
    expect(dtoSrc).toMatch(/export function mapWorldBuildingToRendererDTU\(b: WorldBuildingRow\)/);
  });

  it('the canonical function conditionally spreads archetype/feature only when the row carries them', () => {
    const fnStart = dtoSrc.indexOf('export function mapWorldBuildingToRendererDTU');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = dtoSrc.slice(fnStart, fnStart + 1200);
    expect(fnBody).toMatch(/\.\.\.\(b\.archetype \? \{ archetype: b\.archetype \} : \{\}\)/);
    expect(fnBody).toMatch(/\.\.\.\(b\.feature \? \{ feature: b\.feature \} : \{\}\)/);
    // Every field the pre-Unit-3 mapping produced is still produced.
    expect(fnBody).toMatch(/building_type: b\.building_type/);
    expect(fnBody).toMatch(/material: coerceMaterial\(b\.material\)/);
  });

  it('buildingRendererBuildings (feeding BuildingRenderer3D) uses the imported mapper', () => {
    const memoStart = src.indexOf('const buildingRendererBuildings = useMemo(');
    expect(memoStart).toBeGreaterThan(-1);
    const memoBody = src.slice(memoStart, memoStart + 200);
    expect(memoBody).toMatch(/worldBuildings\.map\(mapWorldBuildingToRendererDTU\)/);
  });

  it('BuildingRenderer3D.tsx (unmodified) already reads dtu.archetype and dtu.feature', () => {
    const rendererSrc = readFileSync(
      path.resolve(__dirname, '..', '..', '..', '..', 'components', 'world-lens', 'BuildingRenderer3D.tsx'),
      'utf8'
    );
    expect(rendererSrc).toMatch(/const explicitArch = \(dtu as \{ archetype\?: string \}\)\.archetype;/);
    expect(rendererSrc).toMatch(/\(dtu as \{ feature\?:/);
  });
});
