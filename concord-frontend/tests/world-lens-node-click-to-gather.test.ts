import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// ConcordiaScene.tsx and components/world/WorldOsSurface.tsx are large Three.js/DOM-
// heavy files (this repo's established pattern for such files is a
// source-pinning regression test, see tests/world-page-*.test.ts). This
// pins the click-to-gather wiring added 2026-07-21: a resource-node mesh
// (real GLB or procedural fallback) is now a real, clickable game object,
// not just a decorative shape with a disconnected 2D HUD list.
const sceneSrc = readFileSync(join(process.cwd(), 'components/world-lens/ConcordiaScene.tsx'), 'utf8');
const pageSrc = readFileSync(join(process.cwd(), 'components/world/WorldOsSurface.tsx'), 'utf8');

describe('ConcordiaScene — resource-node click raycast', () => {
  it('raycasts the infrastructure layer and filters for isResourceNode-tagged hits', () => {
    expect(sceneSrc).toContain("layersRef.current['infrastructure']");
    expect(sceneSrc).toContain('isResourceNode?: boolean');
  });

  it('dispatches concordia:node-click with nodeId, nodeType, depleted, and the world-space hit point', () => {
    const idx = sceneSrc.indexOf("new CustomEvent('concordia:node-click'");
    expect(idx).toBeGreaterThan(-1);
    const slice = sceneSrc.slice(idx, idx + 400);
    expect(slice).toContain('nodeId:');
    expect(slice).toContain('nodeType:');
    expect(slice).toContain('depleted:');
    expect(slice).toContain('point:');
  });

  it('the resource-node check runs before the buildings/terrain checks, after the avatar check', () => {
    const avatarIdx = sceneSrc.indexOf('concordia:npc-context-menu');
    const nodeIdx = sceneSrc.indexOf('concordia:node-click');
    const buildingIdx = sceneSrc.indexOf('// Check buildings layer next');
    expect(avatarIdx).toBeGreaterThan(-1);
    expect(nodeIdx).toBeGreaterThan(avatarIdx);
    expect(buildingIdx).toBeGreaterThan(nodeIdx);
  });
});

describe('world/page.tsx — click-to-gather consumer', () => {
  it('page.tsx\'s source declares gatherFromNode via useCallback (memoization-identity source-shape pin — proves the declaration shape, not runtime stability of the closure identity)', () => {
    expect(pageSrc).toContain('const gatherFromNode = useCallback(async (nodeId: string) => {');
  });

  it('listens for concordia:node-click and calls the existing gatherFromNode (one real gather call path)', () => {
    const idx = pageSrc.indexOf("window.addEventListener('concordia:node-click'");
    expect(idx).toBeGreaterThan(-1);
    const before = pageSrc.slice(Math.max(0, idx - 1500), idx);
    expect(before).toContain('void gatherFromNode(detail.nodeId)');
  });

  it('reuses the same tool-swing + dust-particle feedback as the freeform right-click gather path', () => {
    const idx = pageSrc.indexOf("window.addEventListener('concordia:node-click'");
    const before = pageSrc.slice(Math.max(0, idx - 1500), idx);
    expect(before).toContain("animation: 'attack-light'");
    expect(before).toContain("type: 'dust'");
  });

  it('a depleted node click shows an honest message instead of silently no-op-ing', () => {
    const idx = pageSrc.indexOf("window.addEventListener('concordia:node-click'");
    const before = pageSrc.slice(Math.max(0, idx - 1500), idx);
    expect(before).toContain('depleted');
    expect(before).toMatch(/pushCombatLog\(.*depleted/i);
  });
});
