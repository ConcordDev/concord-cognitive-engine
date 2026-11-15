// FIX-civic-bonds-005 (pledge leg) — pin for standing behaviour.
// The walk found a -1 pledge leaving the Pledge button enabled. The
// cure predates the sweep (main 02492eeba): the page mirrors the
// server's fail-closed numeric guard in badAmount(), disables Pledge
// while the amount is bad, and double-guards the click with a worded
// toast; the server (server/lib/civic-bonds.js pledgeToBond) rejects
// non-finite / non-positive amounts with bad_amount. These pins hold
// that shape so the guard cannot silently regress.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const page = readFileSync(path.resolve(__dirname, '..', 'app/lenses/civic-bonds/page.tsx'), 'utf8');
const lib = readFileSync(path.resolve(__dirname, '..', '..', 'server/lib/civic-bonds.js'), 'utf8');

describe('FIX-civic-bonds-005 — negative pledge is blocked at both layers', () => {
  it('client guard rejects non-finite, non-positive, over-cap, and off-denomination amounts', () => {
    expect(page).toContain('function badAmount(n: number, denomination: number): boolean');
    expect(page).toContain('return !Number.isFinite(n) || n <= 0 || n > 1e9 || n % denomination !== 0;');
  });
  it('Pledge button is disabled while the amount is bad', () => {
    expect(page).toContain('disabled={badAmount(amount, b.denomination)}');
  });
  it('click handler re-checks and words the refusal before any pledge call', () => {
    expect(page).toContain('Pledge must be a positive multiple of');
    const guardAt = page.indexOf('if (badAmount(amount, b.denomination))');
    const callAt = page.indexOf("void act('pledge'");
    expect(guardAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(guardAt);
  });
  it('server pledge refuses non-finite / non-positive amounts fail-closed', () => {
    expect(lib).toContain('if (!Number.isFinite(amt) || amt <= 0) return { ok: false, reason: "bad_amount" };');
  });
});
