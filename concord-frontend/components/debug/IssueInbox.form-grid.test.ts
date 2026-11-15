// FIX-debug-010: the IssueInbox record form's two grid-cols-2 rows used
// bare inputs — an input's intrinsic width holds its grid column open, so
// at 390px the right-hand column (the Release field) clipped. Source-pin:
// every control in those grids can shrink to its column (min-w-0 w-full).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'IssueInbox.tsx'), 'utf8');

describe('IssueInbox form grids at phone width (FIX-debug-010)', () => {
  it('all four grid controls shrink to their column', () => {
    const occurrences = SRC.match(/min-w-0 w-full px-2 py-1\.5 bg-lattice-surface/g) ?? [];
    expect(occurrences.length).toBe(4);
  });

  it('the Release field is one of them', () => {
    const releaseBlock = SRC.slice(SRC.indexOf('list="debug-release-names"'), SRC.indexOf('list="debug-release-names"') + 200);
    expect(releaseBlock).toContain('min-w-0 w-full');
  });
});
