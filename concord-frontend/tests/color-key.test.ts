// WAVE ART Layer-3 — the canonical clean-toon colour key (completeness).
import { describe, it, expect } from 'vitest';
import {
  ELEMENT_COLORS, EVENT_CHANNEL_COLORS, colorForElement, colorForChannel, FALLBACK_COLOR,
} from '@/lib/world-lens/color-key';

const isHex = (s: string) => /^#[0-9a-fA-F]{6}$/.test(s);

describe('canonical colour key', () => {
  it('all 7 elements + 13 channels have valid distinct hex colours', () => {
    const els = Object.values(ELEMENT_COLORS);
    const chs = Object.values(EVENT_CHANNEL_COLORS);
    expect(els.length).toBe(7);
    expect(chs.length).toBe(13);
    expect(els.every(isHex)).toBe(true);
    expect(chs.every(isHex)).toBe(true);
    expect(new Set(els).size).toBe(7);   // distinct
    expect(new Set(chs).size).toBe(13);  // distinct
  });

  it('accessors resolve known keys and fall back for unknown', () => {
    expect(colorForElement('fire')).toBe(ELEMENT_COLORS.fire);
    expect(colorForChannel('crisis')).toBe(EVENT_CHANNEL_COLORS.crisis);
    expect(colorForElement('nope')).toBe(FALLBACK_COLOR);
    expect(colorForChannel(null)).toBe(FALLBACK_COLOR);
  });
});
