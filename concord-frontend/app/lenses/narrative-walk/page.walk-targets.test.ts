import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Pin test (FIX-creative-writing-010): 'The step before' and 'Start over'
// rendered as bare 13px text links (~18px tall) beside a Next CTA whose
// bare fixed bottom-8 put its lower edge under the phone bottom bar. The
// links now carry a 44px touch height (look unchanged) and the CTA uses
// the platform's fixed-button clearance below md. Source-level pins.
const src = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

describe('Narrative walk touch targets (FIX-creative-writing-010)', () => {
  it('Back and Start over carry a 44px touch height', () => {
    const hits = src.match(/inline-flex min-h-11 items-center px-2 -mx-2 text-\[13px\]/g) || [];
    expect(hits.length).toBe(2);
  });

  it('the Next CTA clears the phone bottom bar below md', () => {
    expect(src).toContain('fixed bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] right-4 z-30');
    expect(src).toContain('md:bottom-8 md:right-8');
    expect(src).not.toContain('className="fixed bottom-8 right-8 z-30');
  });
});
