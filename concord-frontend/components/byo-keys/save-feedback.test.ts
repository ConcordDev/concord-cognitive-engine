// FIX-byo-keys-006 / 009: saves in the BYO keys surfaces spoke only as
// transient toasts or not at all. Source-pins: the keys page carries a
// persistent inline save error; the rate-limit and fallback panels check
// the save result, speak a refusal, and name a clear.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE = readFileSync(join(__dirname, '../../app/lenses/byo-keys/page.tsx'), 'utf8');
const RATE = readFileSync(join(__dirname, 'RateLimitPanel.tsx'), 'utf8');
const FALL = readFileSync(join(__dirname, 'FallbackChainPanel.tsx'), 'utf8');

describe('BYO keys save feedback (FIX-byo-keys-006/009)', () => {
  it('the keys page renders a persistent inline save error', () => {
    expect(PAGE).toContain('const [saveError, setSaveError] = useState<string | null>(null);');
    expect(PAGE).toContain('{saveError && (');
    expect(PAGE).toContain('setSaveError(keyProblem);');
  });

  it('the rate-limit save checks the result and names a clear', () => {
    expect(RATE).toContain("if (!r.data?.ok) { setError(");
    expect(RATE).toContain("'Rate limit cleared.'");
  });

  it('the fallback save checks the result and names a clear', () => {
    expect(FALL).toContain("if (!r.data?.ok) { setError(");
    expect(FALL).toContain("'Fallback chain cleared.'");
  });
});
