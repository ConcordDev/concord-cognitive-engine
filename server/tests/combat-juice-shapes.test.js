/**
 * Sprint B Phase 8 — Combat juice bridge contract.
 *
 * Pins the wire-up of the new juice add-ons in CombatBridges.tsx:
 *   - combat:polish (combo_start/extend/finish/rocked) → emitHitNumber
 *     + emitScreenShake + emitHitStop
 *   - combat:telegraph → concordia:weapon-glow CustomEvent
 *   - combat:stagger → concordia:camera-punch CustomEvent
 *   - world:building-state (collapsed) → concordia:building-collapse
 *
 * The bridges are subscribers; testing them requires mocking the
 * `subscribe` import + capturing the dispatched CustomEvents. Easier
 * test target is the *event-shape* contract: assert the new shapes
 * for combat:stagger + world:building-state validate correctly with
 * payloads matching what routes/worlds.js + skill-environment.js
 * actually emit.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { EVENT_SHAPES, validateEvent } from '../lib/event-shapes.js';

describe('Sprint B Phase 8 — combat:stagger event shape', () => {
  it('is registered in EVENT_SHAPES', () => {
    assert.ok(EVENT_SHAPES['combat:stagger'], 'combat:stagger must have a registered shape');
  });

  it('validates a payload matching routes/worlds.js#/combat/attack emit', () => {
    // From server/routes/worlds.js:2071 (the post-env-boost stagger emit).
    const payload = {
      attackerId: 'user_a',
      targetId: 'npc_dorvik',
      worldId: 'concordia-hub',
      buildingId: 'bldg_42',
      durationMs: 1200,
      structuralStress: 0.6,
      elementContrib: 0.4,
    };
    const r = validateEvent('combat:stagger', payload);
    assert.equal(r.ok, true, `expected ok=true, got ${JSON.stringify(r)}`);
  });

  it('rejects a payload missing attackerId / targetId / durationMs', () => {
    const r = validateEvent('combat:stagger', { worldId: 'concordia-hub' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing, ['attackerId', 'targetId', 'durationMs']);
  });
});

describe('Sprint B Phase 8 — world:building-state event shape', () => {
  it('is registered in EVENT_SHAPES', () => {
    assert.ok(EVENT_SHAPES['world:building-state'], 'world:building-state must have a registered shape');
  });

  it('validates a collapsed-transition payload', () => {
    // From server/lib/embodied/skill-environment.js#applyStructuralStress.
    const payload = {
      worldId: 'concordia-hub',
      buildingId: 'bldg_42',
      state: 'collapsed',
      healthPct: 0,
      position: { x: 12.5, y: 0, z: -7.2 },
      structuralStress: 1.0,
    };
    const r = validateEvent('world:building-state', payload);
    assert.equal(r.ok, true);
  });

  it('validates a damaged-transition payload (intermediate state)', () => {
    const r = validateEvent('world:building-state', {
      worldId: 'concordia-hub',
      buildingId: 'bldg_42',
      state: 'damaged',
      healthPct: 0.35,
    });
    assert.equal(r.ok, true);
  });

  it('rejects a payload missing buildingId or state', () => {
    const r = validateEvent('world:building-state', { worldId: 'concordia-hub' });
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing, ['buildingId', 'state']);
  });
});

describe('Sprint B Phase 8 — telegraph payload (existing shape, regression)', () => {
  it('validates the payload CombatTelegraphGlowBridge consumes', () => {
    // The bridge listens for combat:telegraph and dispatches
    // concordia:weapon-glow with intensity derived from severity.
    const r = validateEvent('combat:telegraph', {
      attackerId: 'user_a',
      anticipationMs: 240,
      severity: 7,
      style: 'sifu',
      tier: 3,
    });
    assert.equal(r.ok, true);
  });
});
