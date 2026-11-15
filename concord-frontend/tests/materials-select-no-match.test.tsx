/**
 * Materials Select-by-spec no-match rendering (FIX-materials-008,
 * panel half). The server now names the recommendation's basis;
 * these source pins hold the panel to rendering each basis honestly:
 * a full match gets the trophy line, a partial passer is labelled a
 * closest match (not a full match) in amber, and a zero-pass result
 * renders "No match" with no recommendation at all.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const src = fs.readFileSync(path.join(process.cwd(), 'components/materials/MaterialsToolkit.tsx'), 'utf8');

describe('materials select no-match rendering (FIX-materials-008)', () => {
  it('renders a "No match" state when the recommendation basis is none', () => {
    expect(src).toContain("recommendationBasis === 'none'");
    expect(src).toContain('No match — no candidate meets any of the stated requirements');
  });

  it('labels a partial passer as a closest match, not a full match', () => {
    expect(src).toContain("recommendationBasis === 'closest-partial'");
    expect(src).toContain('Closest match (not a full match)');
  });

  it('the result type admits no recommendation (null) and the basis fields', () => {
    expect(src).toContain('recommended: string | null');
    expect(src).toContain('recommendationBasis?');
  });
});
