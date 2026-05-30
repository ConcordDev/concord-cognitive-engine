import { describe, it, expect } from 'vitest';
import { activityToActionVerb, ACTIVITY_VERB_MAP, ANIMATED_ACTIVITIES } from '@/lib/concordia/npc-activity-anim';
import { resolveActionDescriptor } from '@/lib/concordia/action-biomechanics';

// The server NPC routine emits these activity_kinds (npc-routines.js).
const SERVER_ACTIVITY_KINDS = [
  'build', 'commune', 'cook', 'craft', 'farm', 'fish', 'gather', 'log', 'mill',
  'mine', 'patrol', 'rest', 'sleep', 'socialize', 'trade', 'train', 'wander',
];

describe('WS4.5 — activity → action verb mapping', () => {
  it('maps every server activity_kind to a verb or null (never undefined)', () => {
    for (const a of SERVER_ACTIVITY_KINDS) {
      const v = activityToActionVerb(a);
      expect(v === null || typeof v === 'string').toBe(true);
    }
  });

  it('"doing" activities map to a real WS1 verb that resolves to a descriptor', () => {
    for (const a of ANIMATED_ACTIVITIES) {
      const verb = activityToActionVerb(a);
      expect(verb).toBeTruthy();
      // and the verb is animatable by the WS1 engine (never-null resolver)
      expect(resolveActionDescriptor(verb as string)).toBeTruthy();
    }
  });

  it('passive blocks (sleep/rest/wander/patrol/train) animate nothing — gait/idle only', () => {
    for (const a of ['sleep', 'rest', 'wander', 'patrol', 'train']) {
      expect(activityToActionVerb(a)).toBeNull();
    }
  });

  it('the forge/temple/field cases read right', () => {
    expect(activityToActionVerb('craft')).toBe('craft');
    expect(activityToActionVerb('commune')).toBe('commune');
    expect(activityToActionVerb('farm')).toBe('harvest');
    expect(activityToActionVerb('mine')).toBe('mine');
    expect(activityToActionVerb('socialize')).toBe('talk');
  });

  it('unknown / empty → null (no crash)', () => {
    expect(activityToActionVerb('zorp')).toBeNull();
    expect(activityToActionVerb(undefined)).toBeNull();
    expect(activityToActionVerb('')).toBeNull();
  });

  it('every mapped verb is a valid WS1 verb id (descriptor resolves)', () => {
    for (const v of Object.values(ACTIVITY_VERB_MAP)) {
      if (v) expect(resolveActionDescriptor(v).archetype).toBeTruthy();
    }
  });
});
