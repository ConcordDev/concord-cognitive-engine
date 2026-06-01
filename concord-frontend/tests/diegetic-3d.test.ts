// Chunk 2 — diegetic 3D: world events surface as in-world beacons; the station
// minigame panels are already diegetic via StationInteractionRouter. These pin
// the WIRING (the 3D render itself needs a real-GPU check).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

describe('world-event 3D beacons', () => {
  const src = read('components/world/WorldEventBeacons.tsx');
  it('polls active world events and attaches beacons to the shared scene', () => {
    expect(src).toMatch(/\/api\/worlds\/\$\{worldId\}\/events\?status=active/);
    expect(src).toMatch(/__concordiaScene/);
    expect(src).toMatch(/scene\.add\(/);
  });
  it('reconciles beacons (adds new events, removes ended ones)', () => {
    expect(src).toMatch(/beaconsRef/);
    expect(src).toMatch(/disposeGroup/);
  });
  it('anchors each event at a STABLE per-id position (no jump between polls)', () => {
    expect(src).toMatch(/positionForEvent/);
  });
  it('is mounted in the world lens 3D view', () => {
    const page = read('app/lenses/world/page.tsx');
    expect(page).toMatch(/import\('@\/components\/world\/WorldEventBeacons'\)/);
    expect(page).toMatch(/<WorldEventBeacons worldId=/);
  });
});

describe('station minigames are already diegetic (StationInteractionRouter)', () => {
  const src = read('components/world/StationInteractionRouter.tsx');
  it('routes building-interact → the matching overlay via the canonical table', () => {
    expect(src).toMatch(/concordia:building-interact|building_type/);
    expect(src).toMatch(/ROUTER_TABLE/);
  });
  it('covers the 11 minigame station building types', () => {
    for (const t of ['farm_plot', 'restaurant', 'trivia_kiosk', 'karaoke_booth', 'mahjong_table',
      'hacking_terminal', 'programming_console', 'factory_workbench', 'attraction_booth',
      'creature_pen', 'glyph_altar']) {
      expect(src).toMatch(new RegExp(t));
    }
  });
});
