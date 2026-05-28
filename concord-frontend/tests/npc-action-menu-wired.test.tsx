// Phase DA1 — NPC contextual action menu wiring tests.
//
// Static-assert that:
//   1. The menu listens for the right event.
//   2. The raycaster dispatches the new event name (not the old one).
//   3. All 7 action items are present.
//   4. The menu enriches via /api/mentors and /api/courtship.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MENU = path.resolve(__dirname, '..', 'components', 'world', 'NPCActionMenu.tsx');
const SCENE = path.resolve(__dirname, '..', 'components', 'world-lens', 'ConcordiaScene.tsx');
const WORLD = path.resolve(__dirname, '..', 'app', 'lenses', 'world', 'page.tsx');

describe('Phase DA1 — NPC contextual action menu', () => {
  it('NPCActionMenu listens for concordia:npc-context-menu', () => {
    const src = readFileSync(MENU, 'utf8');
    expect(src).toMatch(/addEventListener\(\s*['"]concordia:npc-context-menu['"]/);
  });

  it('Talk action forwards to concordia:open-dialogue (back-compat)', () => {
    const src = readFileSync(MENU, 'utf8');
    expect(src).toMatch(/dispatchEvent\(.*concordia:open-dialogue/s);
  });

  it('renders 7 action items (Talk, Mentor, Brawl, Court, Inspect, Trade, Hire)', () => {
    const src = readFileSync(MENU, 'utf8');
    for (const label of ['Talk', 'mentorship', 'Brawl invite', 'Court', 'Inspect traits', 'Trade', 'Hire']) {
      expect(src).toMatch(new RegExp(label, 'i'));
    }
  });

  it('action items call the right endpoints', () => {
    const src = readFileSync(MENU, 'utf8');
    expect(src).toMatch(/\/api\/mentorship\/request/);
    expect(src).toMatch(/\/api\/combat\/brawl\/invite/);
    expect(src).toMatch(/\/api\/courtship\/interact/);
  });

  it('enrich() polls /api/mentors and /api/courtship for conditional surface', () => {
    const src = readFileSync(MENU, 'utf8');
    expect(src).toMatch(/\/api\/mentors\//);
    expect(src).toMatch(/\/api\/courtship\/npc\//);
  });

  it('ConcordiaScene raycaster dispatches concordia:npc-context-menu (not the old open-dialogue path)', () => {
    const src = readFileSync(SCENE, 'utf8');
    expect(src).toMatch(/concordia:npc-context-menu/);
  });

  it('ConcordiaScene includes screenX + screenY in the dispatch payload', () => {
    const src = readFileSync(SCENE, 'utf8');
    // Find the context-menu dispatch block and confirm coords are there.
    const block = src.match(/concordia:npc-context-menu[\s\S]{0,400}/);
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/screenX/);
    expect(block![0]).toMatch(/screenY/);
  });

  it('NPCActionMenu mounted in the world lens via dynamic import', () => {
    const src = readFileSync(WORLD, 'utf8');
    expect(src).toMatch(/import\('@\/components\/world\/NPCActionMenu'\)/);
    expect(src).toMatch(/<NPCActionMenu \/>/);
  });
});
