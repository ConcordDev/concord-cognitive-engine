// FIX-diy-004 pin (source-level, the import-names/board-names pattern):
// the build-time stats must render a sub-hour total in minutes and a
// zero-rounded setup share as '<1m' — never 'Total time 0h' for a
// nonzero build.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(process.cwd(), 'components/diy/ProjectWorkshop.tsx'), 'utf8');

describe('FIX-diy-004 build-time display', () => {
  it('renders the total in minutes under an hour', () => {
    expect(src).toContain('buildTime.grandTotalMinutes < 60');
    expect(src).toContain('`${buildTime.grandTotalMinutes}m`');
  });
  it("renders a zero-rounded setup share of a nonzero build as '<1m'", () => {
    expect(src).toContain("buildTime.setupCleanupMinutes === 0 && buildTime.grandTotalMinutes > 0 ? '<1m'");
  });
});
