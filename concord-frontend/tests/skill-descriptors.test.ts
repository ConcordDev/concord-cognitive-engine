// T3.1 — per-skill descriptor completeness + identity.
//
// Pins: every SKILL_CATALOG key resolves a descriptor; combat skills are
// distinct (sword ≠ spear ≠ fire); the ALL_SKILL_KEYS mirror matches the server
// SKILL_CATALOG exactly (drift guard); mastery milestones are ordered.

import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  ALL_SKILL_KEYS, descriptorFor, isCombatSkill, unlockedMilestones,
} from '@/lib/concordia/skill-descriptors';

describe('T3.1 — descriptor completeness', () => {
  test('every SKILL_CATALOG key resolves a descriptor', () => {
    for (const key of ALL_SKILL_KEYS) {
      const d = descriptorFor(key);
      expect(d.baseAction).toBeTruthy();
      expect(d.element).toBeTruthy();
      expect(d.styleHint).toBeTruthy();
    }
  });

  test('ALL_SKILL_KEYS mirrors the server SKILL_CATALOG exactly', () => {
    const serverSrc = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'server/lib/skill-tree-engine.js'), 'utf8',
    );
    // Extract every quoted token inside the SKILL_CATALOG object literal.
    const block = serverSrc.slice(serverSrc.indexOf('SKILL_CATALOG = Object.freeze({'));
    const end = block.indexOf('});');
    const catalogKeys = Array.from(block.slice(0, end).matchAll(/"([a-z_]+)"/g)).map((m) => m[1]);
    // Group names appear as bare keys (combat:, athletic:) not quoted, so the
    // quoted tokens are exactly the skill ids. Both sets must match.
    const front = new Set(ALL_SKILL_KEYS);
    const server = new Set(catalogKeys);
    for (const k of server) expect(front.has(k), `frontend missing ${k}`).toBe(true);
    for (const k of front) expect(server.has(k), `server missing ${k}`).toBe(true);
  });
});

describe('T3.1 — combat skill identity', () => {
  test('sword, spear, and fire read distinct', () => {
    const sword = descriptorFor('swords');
    const spear = descriptorFor('spears');
    const fire = descriptorFor('elemental_fire');
    expect(sword.animationAccents.leverArmM).not.toBe(spear.animationAccents.leverArmM);
    expect(fire.element).toBe('fire');
    expect(sword.element).toBe('physical');
    expect(isCombatSkill('swords')).toBe(true);
    expect(isCombatSkill('cooking')).toBe(false);
  });

  test('reach weapons have longer lever arms', () => {
    expect(descriptorFor('spears').animationAccents.leverArmM!)
      .toBeGreaterThan(descriptorFor('fists').animationAccents.leverArmM ?? 0.46);
  });

  test('mastery milestones unlock in order with level', () => {
    expect(unlockedMilestones('swords', 5)).toEqual([]);
    const at40 = unlockedMilestones('swords', 40);
    expect(at40).toContain('feint');
    expect(at40).toContain('riposte');
    expect(unlockedMilestones('swords', 100)).toContain('chain_extend');
  });
});
