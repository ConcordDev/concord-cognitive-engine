// Section F — accessibility pure-logic tests (F1 subtitle, F2 remap, F3 announce).
import { describe, it, expect } from 'vitest';
import { subtitleDurationMs, enqueueCue, type SubtitleCue } from '@/lib/accessibility/subtitle';
import { formatWorldEventAnnouncement, formatCombatCue } from '@/lib/accessibility/announce';
import { DEFAULT_PROFILE, remapAction } from '@/lib/concordia/keybindings';
import { DEFAULT_GAMEPAD_COMBAT_MAP, remapGamepadButton, resolveGamepadButton } from '@/lib/concordia/gamepad-combat-map';

describe('F1 — subtitle timing + queue', () => {
  it('scales duration with word count, clamped', () => {
    const short = subtitleDurationMs('Hi');
    const long = subtitleDurationMs(Array(100).fill('word').join(' '));
    expect(short).toBe(1500);          // floor
    expect(long).toBe(9000);           // ceiling
    expect(subtitleDurationMs('a b c d e f g h i j')).toBeGreaterThan(short);
  });

  it('enqueue collapses an immediate duplicate + caps length', () => {
    const cue = (text: string): SubtitleCue => ({ id: text, text, durationMs: 1500 });
    let q: SubtitleCue[] = [];
    q = enqueueCue(q, cue('a'));
    q = enqueueCue(q, cue('a')); // dup of last → collapsed
    expect(q.length).toBe(1);
    q = enqueueCue(q, cue('b'));
    q = enqueueCue(q, cue('c'));
    q = enqueueCue(q, cue('d'));
    q = enqueueCue(q, cue('e')); // exceeds cap 4
    expect(q.length).toBe(4);
    expect(q[q.length - 1].text).toBe('e');
  });
});

describe('F2 — keyboard remap (conflict swap)', () => {
  it('rebinds an action + swaps the colliding action to the old key', () => {
    // light is e/tap, parry is f/tap. Rebind light → f (tap): parry should take e.
    const next = remapAction(DEFAULT_PROFILE, 'light', 'f');
    expect(next.bindings.light.key).toBe('f');
    expect(next.bindings.parry.key).toBe('e'); // swapped
    expect(next.id).toBe('custom');
  });

  it('no-op for an unknown/empty key', () => {
    expect(remapAction(DEFAULT_PROFILE, 'light', '')).toBe(DEFAULT_PROFILE);
  });
});

describe('F2 — gamepad remap', () => {
  it('resolves default bindings', () => {
    expect(resolveGamepadButton(DEFAULT_GAMEPAD_COMBAT_MAP, 'X')?.action).toBe('light');
    expect(resolveGamepadButton(DEFAULT_GAMEPAD_COMBAT_MAP, 'Home')).toBe(null);
  });
  it('rebinds a button + swaps the colliding button', () => {
    // X→light, B→dodge. Rebind B → light: X should inherit B's old binding (dodge).
    const next = remapGamepadButton(DEFAULT_GAMEPAD_COMBAT_MAP, 'B', 'light', 'tap');
    expect(next.B?.action).toBe('light');
    expect(next.X?.action).toBe('dodge'); // swapped
  });
});

describe('F3 — announcement formatting', () => {
  it('world events map to spoken lines with the right priority', () => {
    expect(formatWorldEventAnnouncement('world:plague-declared')?.priority).toBe('assertive');
    expect(formatWorldEventAnnouncement('world:event:scheduled', { name: 'Harvest Fair' })?.text).toContain('Harvest Fair');
    expect(formatWorldEventAnnouncement('unknown:event')).toBe(null);
    // calm horror tension is silent
    expect(formatWorldEventAnnouncement('horror:tension', { band: 'calm' })).toBe(null);
    expect(formatWorldEventAnnouncement('horror:tension', { band: 'terror' })?.priority).toBe('assertive');
  });

  it('combat cues — telegraphs are assertive + name the counter', () => {
    const t = formatCombatCue('combat:telegraph', { perilKind: 'sweep', counter: 'jump' });
    expect(t?.priority).toBe('assertive');
    expect(t?.text).toContain('sweep');
    expect(t?.text).toContain('jump');
    expect(formatCombatCue('combat:impact', { severity: 'knockdown' })?.priority).toBe('assertive');
    expect(formatCombatCue('combat:impact', { severity: 'flinch' })).toBe(null);
  });
});
