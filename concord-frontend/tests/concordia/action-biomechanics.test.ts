import { describe, it, expect } from 'vitest';
import {
  resolveActionDescriptor,
  buildActionPoses,
  buildActionClip,
  ACTION_DESCRIPTORS,
  ACTION_VERBS,
  ACTION_ARCHETYPES,
  MOTION_EXTRA_ARCHETYPES,
  _internal,
} from '@/lib/concordia/action-biomechanics';
import { juiceTriggerFor } from '@/lib/concordia/play-action';

// The master verb inventory the framework must cover (the "render for
// EVERYTHING" requirement). Every one must resolve to a non-null descriptor —
// specific OR category fallback — so no action is ever silent.
const MASTER_VERBS = [
  // labor / extraction
  'chop', 'log', 'mine', 'till', 'dig', 'gather', 'forage', 'harvest', 'plant', 'water', 'fish',
  // craft / station
  'build', 'construct', 'craft', 'forge', 'cook', 'mill', 'repair', 'serve',
  // station verbs that have no explicit row (must fall back, not error)
  'sing', 'discard', 'answer', 'type_command', 'write_code', 'place_entity', 'breed', 'ride_attraction',
  // magic / world
  'cast', 'compose_spell', 'commune', 'place_sign', 'take_photo', 'claim_land', 'expand_claim',
  // social / npc
  'talk', 'greet', 'wave', 'court', 'mentor', 'trade', 'applaud', 'hire', 'inspect',
  // immersive-sim
  'hack', 'lockpick', 'pickpocket',
  // mount / consume / locomotion
  'mount', 'dismount', 'eat', 'drink', 'emote', 'climb', 'swim',
];

describe('action-biomechanics — coverage (no silent verb)', () => {
  it('every master-inventory verb resolves to a non-null descriptor', () => {
    for (const v of MASTER_VERBS) {
      const d = resolveActionDescriptor(v);
      expect(d, `verb "${v}" resolved null`).toBeTruthy();
      expect(ACTION_ARCHETYPES).toContain(d.archetype);
      expect(d.phases).toHaveLength(3);
      expect(d.phases.every((p) => p >= 0)).toBe(true);
    }
  });

  it('an unknown verb still resolves (generic, never throws)', () => {
    const d = resolveActionDescriptor('zorp_the_quux');
    expect(d).toBeTruthy();
    expect(ACTION_ARCHETYPES).toContain(d.archetype);
  });

  it('an empty verb resolves to the generic descriptor', () => {
    expect(resolveActionDescriptor('').archetype).toBe(_internal.GENERIC.archetype);
  });

  it('handles hyphen/space verb forms (normalised to underscore)', () => {
    expect(resolveActionDescriptor('place-sign')).toEqual(ACTION_DESCRIPTORS.place_sign);
    expect(resolveActionDescriptor('take photo')).toEqual(ACTION_DESCRIPTORS.take_photo);
  });
});

describe('action-biomechanics — pose generation', () => {
  it('every archetype builds a rest→…→settle pose sequence', () => {
    for (const arch of ACTION_ARCHETYPES) {
      const poses = buildActionPoses(arch, 3);
      expect(poses.length, `${arch} produced no poses`).toBeGreaterThanOrEqual(2);
      expect(poses[0].t).toBe(0);            // starts at rest
      expect(poses[poses.length - 1].t).toBe(1); // ends settled
      // monotonic non-decreasing time
      for (let i = 1; i < poses.length; i++) expect(poses[i].t).toBeGreaterThanOrEqual(poses[i - 1].t);
    }
  });

  it('tier scales amplitude (tier 5 > tier 1 on a leading-bone rotation)', () => {
    const lo = buildActionPoses('swing_down', 1);
    const hi = buildActionPoses('swing_down', 5);
    const loRot = Math.abs((lo[1].bones.rightArm?.rot?.[0]) ?? 0);
    const hiRot = Math.abs((hi[1].bones.rightArm?.rot?.[0]) ?? 0);
    expect(hiRot).toBeGreaterThan(loRot);
  });

  it('builds a valid THREE clip for every declared verb', () => {
    for (const v of ACTION_VERBS) {
      const clip = buildActionClip(v, 3);
      expect(clip.duration).toBeGreaterThan(0);
      expect(clip.tracks.length).toBeGreaterThan(0);
    }
  });
});

describe('action-biomechanics — motion-extended archetypes (firearm/flight/movement)', () => {
  it('covers the 6 move-render archetypes the move-resolver can derive', () => {
    expect([...MOTION_EXTRA_ARCHETYPES].sort()).toEqual(
      ['blink', 'firearm', 'flight', 'speed_trail', 'surface_ride', 'web_swing'],
    );
  });

  it('each builds a distinct rest→…→t=1 pose sequence (not the generic fallback)', () => {
    const generic = JSON.stringify(buildActionPoses('manipulate_in_place', 3));
    for (const arch of MOTION_EXTRA_ARCHETYPES) {
      const poses = buildActionPoses(arch, 3);
      expect(poses.length, `${arch} produced no poses`).toBeGreaterThanOrEqual(2);
      expect(poses[0].t).toBe(0);
      expect(poses[poses.length - 1].t).toBe(1);
      for (let i = 1; i < poses.length; i++) expect(poses[i].t).toBeGreaterThanOrEqual(poses[i - 1].t);
      expect(JSON.stringify(poses), `${arch} fell back to generic`).not.toBe(generic);
    }
  });

  it('tier scales amplitude on a motion-extended archetype', () => {
    const lo = buildActionPoses('flight', 1);
    const hi = buildActionPoses('flight', 5);
    const loRot = Math.abs(lo[1].bones.spine?.rot?.[0] ?? 0);
    const hiRot = Math.abs(hi[1].bones.spine?.rot?.[0] ?? 0);
    expect(hiRot).toBeGreaterThan(loRot);
  });
});

describe('play-action — juice mapping', () => {
  it('maps every descriptor juiceId to a valid GameJuice trigger', () => {
    const VALID = new Set(['menu-open', 'menu-close', 'success', 'failure', 'milestone', 'damage', 'level-up', 'discovery']);
    for (const v of ACTION_VERBS) {
      const d = ACTION_DESCRIPTORS[v];
      expect(VALID.has(juiceTriggerFor(d.juiceId))).toBe(true);
    }
    expect(juiceTriggerFor('impact_wood')).toBe('damage');
    expect(juiceTriggerFor(undefined)).toBe('success');
  });
});
