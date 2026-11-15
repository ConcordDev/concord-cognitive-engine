/**
 * FIX-import-005 leg — SOURCE pin (same form as tests/import-names.test.ts,
 * which pins the base fix): ImportDeskPanel refuses over-limit field
 * names before the call, with the 120-char limit named in the result
 * area, for both field-name list inputs (Map Fields targets and dedup
 * keys). The behavioural half (the server refuses too, at exactly 120
 * accepted) is pinned in server/tests/front15-import-005-leg.test.js.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const src = fs.readFileSync(
  path.join(process.cwd(), 'components/import/ImportDeskPanel.tsx'),
  'utf8',
);

describe('import field-name limit wiring (FIX-import-005 leg)', () => {
  it('the Map Fields guard refuses a target name over 120 characters', () => {
    expect(src).toContain("action === 'mapFields'");
    expect(src).toMatch(/f\.length > 120/);
    expect(src).toContain('Field names are limited to 120 characters — shorten the longest target field and retry.');
  });

  it('the dedup-keys guard applies the same limit', () => {
    expect(src).toContain("action === 'detectDuplicates'");
    expect(src).toContain('Field names are limited to 120 characters — shorten the longest dedup key and retry.');
  });
});
