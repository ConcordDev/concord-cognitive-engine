/**
 * Organ Comp Rollup missing-comp note (FIX-organ-004, panel half).
 * The server now excludes blank comp from averages and reports the
 * missing count; these source pins hold the panel to surfacing it:
 * the amber missing-comp note, and '—' (not $0) for an average with
 * nobody behind it, overall and per department.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const src = fs.readFileSync(path.join(process.cwd(), 'components/organ/OrgDesigner.tsx'), 'utf8');

describe('organ comp missing note (FIX-organ-004)', () => {
  it('surfaces the missing-comp count with the exclusion stated', () => {
    expect(src).toContain('data.missingComp > 0');
    expect(src).toContain('no comp recorded — excluded from the averages above');
  });

  it("renders an empty average as '—', never $0", () => {
    expect(src).toContain("data.avgComp == null ? '—' : usd(data.avgComp)");
    expect(src).toContain("d.avgComp == null ? '—' : usd(d.avgComp)");
    expect(src).toContain('missing)');
  });
});
