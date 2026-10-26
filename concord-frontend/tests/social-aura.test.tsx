/**
 * Aura + accent contrast — the pure modules behind the Social profile
 * identity (job oc-social-5, Social identity / JOB 8).
 *
 *   - The Aura is deterministic per handle: same handle → byte-identical
 *     SVG, different handles → different output. No user string can end
 *     up unescaped in the markup — the handle only feeds a hash, and the
 *     optional accent is a strict hex.
 *   - The contrast function is the shared gate for the user-picked
 *     accent, validated against known pairs (white passes, a mid grey
 *     fails, identical colours are 1:1).
 */
import { describe, it, expect } from 'vitest';
import {
  auraSvg,
  auraBlobs,
  fnv1a,
  mulberry32,
  normalizeHex,
  AURA_BLOB_COUNT,
} from '@/lib/social/aura';
import {
  contrastRatio,
  checkAccent,
  accentContrast,
  SOCIAL_SURFACE_HEX,
  ACCENT_MIN_CONTRAST,
} from '@/lib/social/contrast';

describe('Aura (deterministic banner)', () => {
  it('is deterministic: the same handle produces the identical SVG', () => {
    const a = auraSvg('grok@example');
    const b = auraSvg('grok@example');
    expect(a).toBe(b);
  });

  it('is deterministic across case: the handle is lower-cased before hashing', () => {
    expect(auraSvg('Grok@Example')).toBe(auraSvg('grok@example'));
  });

  it('different handles produce different auras', () => {
    const handles = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'];
    const outputs = new Set(handles.map((h) => auraSvg(h)));
    expect(outputs.size).toBe(handles.length);
  });

  it('contains exactly five blurred blobs and a feGaussianBlur in the 34-40 band', () => {
    const svg = auraSvg('blob-count-check');
    expect((svg.match(/<circle /g) || []).length).toBe(AURA_BLOB_COUNT);
    expect(svg).toContain('<feGaussianBlur stdDeviation="38"');
  });

  it('never injects the handle (or any user string) into the markup', () => {
    const hostile = '<script>alert("pwned")</script>"\'onmouseover=';
    const svg = auraSvg(hostile);
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('alert');
    expect(svg).not.toContain('onmouseover');
    // Every attribute value in the markup is a number or a fixed/accent hex.
    expect(svg).toMatch(/cx="\d+" cy="\d+" r="\d+" fill="#[0-9a-f]{6}" opacity="[\d.]+"/);
  });

  it('embeds a valid accent as one of its blob colours; an invalid accent is ignored', () => {
    const withAccent = auraBlobs('accented', '#14b8a6');
    expect(withAccent[0].color).toBe('#14b8a6');
    // Same handle, same accent → identical picks (still deterministic).
    expect(auraBlobs('accented', '#14b8a6')).toEqual(withAccent);
    expect(auraSvg('accented', '#14b8a6')).toContain('fill="#14b8a6"');
    // A non-hex accent never reaches the markup — only palette colours.
    const invalid = auraBlobs('accented', 'javascript:alert(1)');
    expect(invalid.every((b) => /^#[0-9a-f]{6}$/.test(b.color))).toBe(true);
    const notHex = auraBlobs('accented', '#12g45z');
    expect(notHex.every((b) => /^#[0-9a-f]{6}$/.test(b.color))).toBe(true);
  });

  it('fnv1a and mulberry32 are stable across runs (seed determinism)', () => {
    expect(fnv1a('concord')).toBe(fnv1a('concord'));
    expect(fnv1a('concord')).not.toBe(fnv1a('discord'));
    const r1 = mulberry32(1234);
    const r2 = mulberry32(1234);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
  });

  it('normalizeHex accepts only strict #rrggbb shapes and lowercases them', () => {
    expect(normalizeHex('#14B8A6')).toBe('#14b8a6');
    expect(normalizeHex('14b8a6')).toBe('#14b8a6');
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex('#1234567')).toBeNull();
    expect(normalizeHex('nope')).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });
});

describe('accent contrast (WCAG 2.x math)', () => {
  it('black on white is 21:1 (the reference pair)', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  it('identical colours are 1:1', () => {
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5);
  });

  it('white passes against the dark Social surface behind the avatar ring', () => {
    expect(accentContrast('#ffffff')).toBeCloseTo(18.63, 1);
    const check = checkAccent('#ffffff');
    expect(check.valid).toBe(true);
    expect(check.error).toBeNull();
  });

  it('a known failing pair: mid grey #767676 is under the 4.5:1 bar', () => {
    const ratio = accentContrast('#767676');
    expect(ratio).not.toBeNull();
    expect(ratio as number).toBeLessThan(ACCENT_MIN_CONTRAST);
    const check = checkAccent('#767676');
    expect(check.valid).toBe(false);
    expect(check.error).toMatch(/at least 4\.5:1/);
  });

  it('the surface constant is the dark lattice surface actually used behind the ring', () => {
    expect(SOCIAL_SURFACE_HEX).toBe('#12121a');
  });

  it('non-hex input is refused with the honest error', () => {
    const check = checkAccent('chartreuse');
    expect(check.valid).toBe(false);
    expect(check.error).toMatch(/hex colour/);
    expect(checkAccent('#12g45z').valid).toBe(false);
  });
});