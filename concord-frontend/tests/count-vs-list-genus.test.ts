/**
 * count-vs-list-genus.test.ts — CB-0454 guard (B6).
 *
 * Pins:
 *  - FIX-healthcare-010: PatientsPanel tracks the unfiltered register total and
 *    shows "N of {total}" while searching; a no-match search says so instead of
 *    claiming the register is empty.
 *  - FIX-board-017: the Card Prioritization summary labels its buckets as WSJF
 *    score quartiles (what the server actually computes), not task priorities.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FE = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(FE, rel), 'utf8');

describe('CB-0454 count-vs-list genus', () => {
  it('FIX-healthcare-010: badge distinguishes filtered count from register total; no-match search says so', () => {
    const src = read('components/healthcare/PatientsPanel.tsx');
    expect(src).toContain('if (!query) setTotal(patients.length)');
    expect(src).toContain('`${list.length} of ${total}`');
    expect(src).toContain('No patients match');
    expect(src).toContain("'No patients yet.'");
  });

  it('FIX-board-017: prioritization buckets are labelled as WSJF quartiles, not priorities', () => {
    const src = read('components/board/TasksPanel.tsx');
    expect(src).toContain('Top quartile');
    expect(src).toContain('Bottom quartile');
    expect(src).toContain('split into quartiles — not task priority');
    expect(src).not.toContain('<p className="text-[10px] capitalize mb-1 opacity-80">{tier}</p>');
  });
});
