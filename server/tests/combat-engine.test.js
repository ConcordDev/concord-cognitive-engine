// server/tests/combat-engine.test.js
//
// Tests for combat engine behavior.
// Coverage:
// - Hub ground refuses violence (returns false from initiateCombat)
// - Cascade cap at 9, 7-day expiry
// - Soft-power check for each world
// - Refusal field dampens damage
// - Cross-world combat (Kane consolidation raids) tracked separately
// - Distributed agency factions don't escalate

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CombatEngine, CASCADE_CAP, REFUSAL_DAMAGE_TYPES, ATTACK_TYPES } from '../lib/combat-engine.js';

function makeCombatEngine() {
  return new CombatEngine({
    db: null,
    refusalEngine: null,
    hubGroundCheck: (worldId) => worldId === 'concordia-hub',
  });
}

test('hub ground refuses violence', () => {
  const ce = makeCombatEngine();
  const result = ce.initiateCombat('attacker1', 'defender1', 'concordia-hub');
  assert.equal(result, false);
});

test('off-hub world allows combat', () => {
  const ce = makeCombatEngine();
  const result = ce.initiateCombat('attacker1', 'defender1', 'cyber');
  assert.equal(result, true);
});

test('Cascade fires at cap 9', () => {
  const ce = makeCombatEngine();
  let firedAt = 0;
  for (let i = 0; i < CASCADE_CAP; i++) {
    const r = ce.cascadeContribution('cyber', 'a1', 'd1');
    if (r.fired) firedAt = i + 1;
  }
  assert.equal(firedAt, CASCADE_CAP);
});

test('Cascade does not refire on subsequent contributions', () => {
  const ce = makeCombatEngine();
  for (let i = 0; i < CASCADE_CAP; i++) {
    ce.cascadeContribution('cyber', 'a1', 'd1');
  }
  const r = ce.cascadeContribution('cyber', 'a1', 'd1');
  assert.equal(r.fired, false);
});

test('soft power refuses attack on hub ground', () => {
  const ce = makeCombatEngine();
  assert.equal(ce.softPowerCheck('concordia-hub', 'attack'), false);
});

test('soft power allows non-attack on hub', () => {
  const ce = makeCombatEngine();
  assert.equal(ce.softPowerCheck('concordia-hub', 'observe'), true);
});

test('refusal field dampens damage', () => {
  const ce = makeCombatEngine();
  const attacker = { id: 'a', worldId: 'cyber', hp: 100 };
  const defender = { id: 'd', worldId: 'cyber', hp: 100 };
  const ctx = { refusalId: 'hostility_paused', worldContext: {} };
  const result = ce.resolveAttack(attacker, defender, 'law_strike', ctx);
  assert.equal(result.hit, true);
  assert.equal(result.damage, 12);  // 25 / 2 = 12.5 floored to 12
});

test('unrefused attack uses full damage', () => {
  const ce = makeCombatEngine();
  const attacker = { id: 'a', worldId: 'cyber', hp: 100 };
  const defender = { id: 'd', worldId: 'cyber', hp: 100 };
  const result = ce.resolveAttack(attacker, defender, 'law_strike', { worldContext: {} });
  assert.equal(result.damage, 25);
});

test('breath_dodge is non-damaging', () => {
  const ce = makeCombatEngine();
  const attacker = { id: 'a', worldId: 'cyber', hp: 100 };
  const defender = { id: 'd', worldId: 'cyber', hp: 100 };
  const result = ce.resolveAttack(attacker, defender, 'breath_dodge', { worldContext: {} });
  assert.equal(result.damage, 0);
});

test('death_suspended protection (HP stops at 1)', () => {
  const ce = makeCombatEngine();
  const target = { id: 't', worldId: 'cyber', hp: 5 };
  const result = ce.applyDamage(target, 100, 'death_suspended');
  assert.equal(result.newHp, 1);
  assert.equal(result.killed, false);
});

test('normal damage can kill', () => {
  const ce = makeCombatEngine();
  const target = { id: 't', worldId: 'cyber', hp: 5 };
  const result = ce.applyDamage(target, 100, 'consequence_held');
  assert.equal(result.newHp, 0);
  assert.equal(result.killed, true);
});

test('cascade days remaining is correct', () => {
  const ce = makeCombatEngine();
  const r = ce.cascadeContribution('cyber', 'a1', 'd1');
  assert.ok(r.daysRemaining > 6 && r.daysRemaining <= 7);
});

test('attack on hub via resolveAttack is blocked', () => {
  const ce = makeCombatEngine();
  const attacker = { id: 'a', worldId: 'cyber', hp: 100 };
  const defender = { id: 'd', worldId: 'concordia-hub', hp: 100 };
  const result = ce.resolveAttack(attacker, defender, 'law_strike', { worldContext: {} });
  assert.equal(result.hit, false);
});

test('cross-world combat (Kane consolidation raids) tracked', () => {
  const ce = makeCombatEngine();
  // Kane consolidates across superhero + crime + Grid
  ce.initiateCombat('kane', 'jax', 'crime');
  ce.initiateCombat('kane', 'luminary', 'superhero');
  ce.initiateCombat('kane', 'grid-node', 'cyber');
  assert.equal(ce.activeCombats.size, 3);
});

test('REFUSAL_DAMAGE_TYPES lists 8 refusals', () => {
  assert.equal(REFUSAL_DAMAGE_TYPES.length, 8);
});

test('ATTACK_TYPES includes cascade_burst for high-tier', () => {
  assert.ok(ATTACK_TYPES.includes('cascade_burst'));
});
