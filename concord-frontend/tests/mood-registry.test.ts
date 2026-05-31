// WAVE EXPR — the mood registry/bridge (the concordia:npc-mood consumer).
import { describe, it, expect, beforeEach } from 'vitest';
import { installMoodListener, getMood, emotionFor, biasFor, _testing } from '@/lib/concordia/mood-registry';

beforeEach(() => _testing.reset());

describe('mood registry', () => {
  it('a dispatched concordia:npc-mood populates the registry → emotion + bias', () => {
    installMoodListener();
    expect(_testing.installed()).toBe(true);
    window.dispatchEvent(new CustomEvent('concordia:npc-mood', { detail: { npcId: 'n1', mood: 'hostile', avoidEyeContact: false } }));
    expect(getMood('n1')?.mood).toBe('hostile');
    expect(emotionFor('n1')).toBe('angry');           // mood → facial (no longer frozen-neutral)
    expect(biasFor('n1')!.posture.torsoPitch).toBeGreaterThan(0.1); // hostile lean
  });

  it('ignores payloads without an npcId', () => {
    installMoodListener();
    window.dispatchEvent(new CustomEvent('concordia:npc-mood', { detail: { mood: 'grieving' } }));
    expect(getMood('')).toBeNull();
  });

  it('an unknown NPC returns null (caller falls back to the old path → off==today)', () => {
    expect(emotionFor('nobody')).toBeNull();
    expect(biasFor('nobody')).toBeNull();
  });

  it('grieving mood reads sad + slumped', () => {
    _testing.set('g', { mood: 'grieving' });
    expect(emotionFor('g')).toBe('sad');
    expect(biasFor('g')!.posture.headPitch).toBeGreaterThan(0.1); // head down
  });
});
