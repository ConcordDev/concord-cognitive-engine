/**
 * FIX-byo-keys-001 — the OpenRouter catalog renders third-party model
 * descriptions. A browser-agent scan flagged the surface for text a
 * human cannot see but an agent can read. The live feed carries no such
 * payload today (471 models scanned at fix time: zero invisible
 * characters), but the panel had the asymmetry that would carry one:
 * descriptions rendered with line-clamp-2 (tail present in the DOM,
 * invisible on screen) and no stripping of invisible characters.
 * The cure: strip zero-width / bidi / joiner / control characters at
 * render and show the description in full, so everything in the DOM is
 * exactly what a human can read.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { visibleCatalogText } from '@/components/byo-keys/OpenRouterCatalog';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-byo-keys-001 — no invisible text in the catalog', () => {
  it('strips zero-width, bidi, joiner and control characters', () => {
    const poisoned = 'Fast model.' + String.fromCharCode(0x200B, 0x200C, 0x202E, 0x2060, 0xFEFF, 0x00AD, 0x0007) + ' for coding.';
    const clean = visibleCatalogText(poisoned);
    expect(clean).toBe('Fast model. for coding.');
    expect(clean).not.toMatch(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD\u0000-\u001F\u007F-\u009F]/);
  });

  it('keeps ordinary text, tabs and newlines intact', () => {
    const s = 'Line one.\n\tIndented — with punctuation (v2) [ok]';
    expect(visibleCatalogText(s)).toBe(s);
  });

  it('renders descriptions through the stripper, unclamped, in card and detail', () => {
    const s = read('components/byo-keys/OpenRouterCatalog.tsx');
    expect(s).toContain('visibleCatalogText(m.description)');
    expect(s).toContain('visibleCatalogText(selected.description)');
    expect(s).not.toContain('line-clamp-2');
  });
});
