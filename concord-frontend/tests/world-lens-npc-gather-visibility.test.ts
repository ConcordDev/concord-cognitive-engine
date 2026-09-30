import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// world/page.tsx is a large Three.js/DOM-heavy file (this repo's
// established pattern is a source-pinning regression test, see
// tests/world-page-*.test.ts). Pins the world:npc-gather wiring added
// 2026-07-21: an NPC's gather_resource action (server/lib/npc-simulator.js)
// was previously a completely silent DB write — no signal reached the
// world lens at all. handleNpcGather bridges the new server broadcast
// into the SAME tool-swing + dust-particle feedback the player's own
// click-to-gather already gets, so NPCs gathering resources is now a
// real, watchable action instead of an invisible macro call.
const src = readFileSync(join(process.cwd(), 'components/world/WorldOsSurface.tsx'), 'utf8');

describe('world/page.tsx — NPC gather visibility (world:npc-gather)', () => {
  it('subscribes to world:npc-gather on the world socket, with matching cleanup', () => {
    expect(src).toContain("worldSocket.on('world:npc-gather', handleNpcGather);");
    expect(src).toContain("worldSocket.off('world:npc-gather', handleNpcGather);");
  });

  it('dispatches concordia:combat-anim targeted at the NPC entity (not the player)', () => {
    const idx = src.indexOf('const handleNpcGather = ');
    expect(idx).toBeGreaterThan(-1);
    const body = src.slice(idx, idx + 900);
    expect(body).toContain('entityId: data.npcId');
    expect(body).toContain("animation: 'attack-light'");
  });

  it('dispatches a dust particle burst at the real node position (x/y/z from the emit payload)', () => {
    const idx = src.indexOf('const handleNpcGather = ');
    const body = src.slice(idx, idx + 900);
    expect(body).toContain("type: 'dust'");
    expect(body).toContain('x: data.x');
    expect(body).toContain('z: data.z');
  });

  it('guards on a missing npcId — never dispatches for a malformed payload', () => {
    const idx = src.indexOf('const handleNpcGather = ');
    const body = src.slice(idx, idx + 300);
    expect(body).toContain('if (!data?.npcId) return;');
  });
});
