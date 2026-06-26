// Dead-wire audit fixes (2026-06-26). Each of these was a connection where one
// end existed but the other was missing/no-op, so the feature never reached the
// player. We assert the reconnect at the source level (same style as
// game-modes-hotbar-wired.test.tsx) so a future refactor can't silently sever
// them again.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const read = (...p: string[]) => readFileSync(path.resolve(root, ...p), 'utf8');

describe('spell-cast — was dispatched by two sources, only consumer was a no-op stub', () => {
  const world = read('app', 'lenses', 'world', 'page.tsx');

  it('the world lens now LISTENS for concordia:spell-cast (the missing consumer)', () => {
    expect(world).toMatch(/addEventListener\(\s*['"]concordia:spell-cast['"]/);
  });

  it('the consumer lands the spell on the engaged target via combat:attack with element + skillId', () => {
    // Pull the spell-cast handler region and assert it forwards the cast.
    const idx = world.indexOf("addEventListener('concordia:spell-cast'");
    const region = world.slice(Math.max(0, idx - 1600), idx);
    expect(region).toMatch(/combat:attack/);
    expect(region).toMatch(/skillId:\s*detail\.spellId/);
    expect(region).toMatch(/element,/);
  });

  it('both dispatch sites carry the element so the burst is not always "physical"', () => {
    expect(read('components', 'world', 'concordia-hud', 'SkillWheelMount.tsx'))
      .toMatch(/element,/);
    expect(read('components', 'world-lens', 'CombatFlowHotbar.tsx'))
      .toMatch(/element:\s*slot\.spell\.element/);
  });
});

describe('quest markers — ConcordiaScene mounted QuestMarker3D but was never fed objectives', () => {
  const world = read('app', 'lenses', 'world', 'page.tsx');

  it('the world lens builds questObjectives and passes them to ConcordiaScene', () => {
    expect(world).toMatch(/setQuestObjectives/);
    expect(world).toMatch(/questObjectives=\{questObjectives\}/);
  });

  it('only placeable objective kinds become markers (talk_to / deliver → real NPC position)', () => {
    expect(world).toMatch(/talk_to:\s*['"]talk['"]/);
    expect(world).toMatch(/deliver:\s*['"]delivery['"]/);
    // resolves the objective target against the live NPC list — no invented coords
    expect(world).toMatch(/npcById\.get\(o\?\.target\)/);
  });

  it('QuestMarker3D pings for the scene on mount (it mounts after scene-ready fires)', () => {
    expect(read('components', 'world-lens', 'QuestMarker3D.tsx'))
      .toMatch(/concordia:scene-request-ready/);
  });
});

describe('faction war banner — listener waited on a CustomEvent bridged from a phantom socket name', () => {
  const world = read('app', 'lenses', 'world', 'page.tsx');

  it('the SR bridge subscribes to the REAL server event faction:war-declared', () => {
    expect(world).toMatch(/['"]faction:war-declared['"]/);
  });

  it('no longer subscribes to the phantom faction-war:declared (never emitted server-side)', () => {
    expect(world).not.toMatch(/['"]faction-war:declared['"]/);
  });
});
