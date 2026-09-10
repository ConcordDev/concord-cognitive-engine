// Pins the fix for the partially-dead `combat:kill` event (verification audit
// item #13): the real socket event was already consumed by the world page's
// own combat state (`worldSocket.on('combat:kill', handleCombatKill)`), but
// ScreenReaderAnnouncer's COMBAT_CUES list expects a bridged window event
// named `concordia:combat-kill` that only exists if 'combat:kill' is in the
// world page's `SR_BRIDGE_EVENTS` array. It was missing, so the announcer
// (proven live and correct by tests/components/ScreenReaderAnnouncer.test.tsx,
// which fires `concordia:combat-kill` directly) never actually spoke a kill
// in production. `components/world/WorldOsSurface.tsx` is a very large, heavily-wired
// page component that isn't practical to fully render in a unit test — this
// pins the bridge wiring at the source level instead, the same style used by
// tests/roguelite-hud-wired.test.tsx and friends.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORLD_PAGE = path.resolve(__dirname, '..', 'app', 'lenses', 'world', 'page.tsx');
const ANNOUNCER = path.resolve(__dirname, '..', 'components', 'accessibility', 'ScreenReaderAnnouncer.tsx');

describe("combat:kill screen-reader bridge (audit item #13)", () => {
  const worldSrc = readFileSync(WORLD_PAGE, 'utf8');
  const announcerSrc = readFileSync(ANNOUNCER, 'utf8');

  it("world page's SR_BRIDGE_EVENTS array includes 'combat:kill'", () => {
    const match = worldSrc.match(/const SR_BRIDGE_EVENTS = \[([\s\S]*?)\];/);
    expect(match).toBeTruthy();
    const body = match![1];
    expect(body).toMatch(/'combat:kill'/);
  });

  it('the raw combat:kill socket subscription for gameplay state is still intact (untouched by this fix)', () => {
    expect(worldSrc).toMatch(/worldSocket\.on\('combat:kill', handleCombatKill\)/);
    expect(worldSrc).toMatch(/worldSocket\.off\('combat:kill', handleCombatKill\)/);
  });

  it("ScreenReaderAnnouncer's COMBAT_CUES already listens for the bridged concordia:combat-kill window event", () => {
    expect(announcerSrc).toMatch(/'combat:kill'/);
  });
});
