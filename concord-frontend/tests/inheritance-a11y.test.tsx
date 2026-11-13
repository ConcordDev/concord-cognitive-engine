/**
 * FIX-inheritance-010 — two legs on the dark theme: (1) muted labels
 * at zinc-500/600, raised to zinc-400 across the inheritance panels;
 * (2) the beneficiary Name field had no visible length limit — a
 * 210-char name submitted and bounced off the server's INPUT_LIMITS
 * name cap (200) as 'Input too long'. The field now carries
 * maxLength={200} with a live n/200 counter, so the limit is known
 * before submit.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-inheritance-010 — inheritance contrast + visible limit', () => {
  it('no zinc-500/600 text remains in the inheritance tree', () => {
    for (const f of ['components/inheritance/IntestacyPanel.tsx', 'components/inheritance/MarketPanel.tsx', 'components/inheritance/BeneficiariesPanel.tsx']) {
      const s = read(f);
      expect(s.includes('text-zinc-500'), `${f} zinc-500`).toBe(false);
      expect(s.includes('text-zinc-600'), `${f} zinc-600`).toBe(false);
    }
  });

  it('the Name field is capped at the server limit with a live counter', () => {
    const s = read('components/inheritance/BeneficiariesPanel.tsx');
    expect(s).toContain('maxLength={200}');
    expect(s).toContain('{bName.length}/200');
  });
});
