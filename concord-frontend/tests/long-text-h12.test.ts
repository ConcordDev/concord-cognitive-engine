/**
 * H12 — long user text wraps instead of overflowing, and fashion names carry
 * the same 120-char bound the server already enforces (server/domains/fashion.js
 * fsClean(name, 120)). No bound is invented for lenses whose server has none.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf8');

describe('H12 long text', () => {
  it('cognitive-replay moment line wraps anywhere', () => {
    expect(src('app/lenses/cognitive-replay/page.tsx')).toMatch(/data-testid="cr-line"[^>]*break-words \[overflow-wrap:anywhere\]/);
  });
  it('bounty description wraps anywhere', () => {
    expect(src('components/bounties/BountyCard.tsx')).toMatch(/whitespace-pre-wrap[^>]*min-w-0 break-words \[overflow-wrap:anywhere\]">\{bounty\.description\}/);
  });
  it.each([
    ['components/fashion/FashionClosetPanel.tsx', 'placeholder="Item name" maxLength={120}'],
    ['components/fashion/FashionOutfitsPanel.tsx', 'placeholder="Outfit name" maxLength={120}'],
    ['components/fashion/FashionCapsulePanel.tsx', 'placeholder="Capsule name" maxLength={120}'],
  ])('%s caps the name at the server bound of 120', (f, needle) => {
    expect(src(f)).toContain(needle);
  });
  it('the server bound the cap mirrors still exists', () => {
    const server = readFileSync(resolve(__dirname, '../../server/domains/fashion.js'), 'utf8');
    expect(server).toMatch(/fsClean\(params\.name, 120\)/);
  });
});
