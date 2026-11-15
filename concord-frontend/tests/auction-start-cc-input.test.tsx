/**
 * FIX-auction-004 — the Start CC field opened pre-filled with '1', so
 * typed digits appended to the default ('0' read back as '00'/'10',
 * '-5' as '05'). The field now opens empty with the minimum stated;
 * submit validation already rejects empty / non-positive values in
 * words.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-auction-004 — start CC input', () => {
  const s = read('components/auction/BoardPanel.tsx');

  it('opens empty and states the minimum', () => {
    expect(s).toContain("startCc: ''");
    expect(s).not.toContain("startCc: '1'");
    expect(s).toContain('Start CC (more than 0)');
    expect(s).toContain("'Starting price has to be more than 0 CC.'");
  });
});
