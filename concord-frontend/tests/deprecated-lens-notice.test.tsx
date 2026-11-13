/**
 * FIX-hypothesis-008 / FIX-suffering-013 — both lenses are marked
 * deprecated in LENS_STATUS_MAP (merge target paper) yet loaded as
 * normal current lenses with no notice. The shared
 * DeprecatedLensNotice surfaces the registry's own status at the top
 * of each page; it is data-driven, so any future deprecation appears
 * automatically.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('deprecated lens notice', () => {
  const notice = read('components/lens/DeprecatedLensNotice.tsx');

  it('reads the canonical lens status map', () => {
    expect(notice).toContain("getLensStatus");
    expect(notice).toContain("entry.status !== 'deprecated'");
    expect(notice).toContain('This lens is deprecated.');
  });

  it('both deprecated lens pages mount it', () => {
    expect(read('app/lenses/hypothesis/page.tsx')).toContain('<DeprecatedLensNotice lensId="hypothesis" />');
    expect(read('app/lenses/suffering/page.tsx')).toContain('<DeprecatedLensNotice lensId="suffering" />');
  });
});
