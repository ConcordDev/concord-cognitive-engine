// Track 1 — PvP↔NPC knockback parity + the player-responsive slow-mo model.

import { describe, it, expect, beforeEach } from 'vitest';
import { knockbackForTrigger, severityForTrigger, KNOCKBACK_BY_SEVERITY } from '@/lib/concordia/knockback-feel';
import { getPlayerTimeScale, setTimeScale, resume } from '@/lib/concordia/use-time-scale';

describe('knockback parity (PvP path mirrors the NPC severity table)', () => {
  it('maps triggers to the same severity→knockback the server uses', () => {
    // kill → knockdown (7.5), crit/heavy → rocked (4.5), light → flinch (0), none → 0
    expect(knockbackForTrigger('combat-kill')).toBe(KNOCKBACK_BY_SEVERITY.knockdown);
    expect(knockbackForTrigger('combat-kill')).toBe(7.5);
    expect(knockbackForTrigger('combat-crit')).toBe(4.5);
    expect(knockbackForTrigger('combat-hit', true)).toBe(4.5);   // heavy
    expect(knockbackForTrigger('combat-hit', false)).toBe(0);    // light = flinch, no knockback
    expect(knockbackForTrigger('something-else')).toBe(0);
  });
  it('severity mapping is explicit', () => {
    expect(severityForTrigger('combat-kill')).toBe('knockdown');
    expect(severityForTrigger('combat-crit')).toBe('rocked');
    expect(severityForTrigger('combat-hit', true)).toBe('rocked');
    expect(severityForTrigger('combat-hit', false)).toBe('flinch');
  });
});

describe('player-responsive slow-mo model', () => {
  beforeEach(() => { resume(); }); // reset to 1.0
  it('normal time → player runs at normal time', () => {
    expect(getPlayerTimeScale()).toBe(1);
  });
  it('hit-stop (world 0) freezes the player too', () => {
    setTimeScale(0);
    expect(getPlayerTimeScale()).toBe(0);
    resume();
  });
  it('slow-mo lifts the player into the responsive 0.5–0.8 band', () => {
    setTimeScale(0.25);                 // world cinematic crawl
    const p = getPlayerTimeScale();
    expect(p).toBeGreaterThanOrEqual(0.5);
    expect(p).toBeLessThanOrEqual(0.8);
    expect(p).toBeGreaterThan(0.25);    // player crisper than the world
    resume();
  });
  it('deeper world slow-mo still keeps the player ≥ 0.5', () => {
    setTimeScale(0.1);
    expect(getPlayerTimeScale()).toBeGreaterThanOrEqual(0.5);
    resume();
  });
});
