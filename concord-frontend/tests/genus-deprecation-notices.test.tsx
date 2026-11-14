/**
 * Deprecation notices for docs / feed / reflection (GB-1538 genus,
 * rider 2: FIX-docs-014 · FIX-feed-011 · FIX-reflection-005).
 *
 * The founder's docs-014 ruling (A) confirms the lens-status taxonomy
 * is real: deprecated lenses render the deprecation notice. The
 * registry marked all three lenses deprecated with merge targets, and
 * five lenses (daily, hypothesis, metalearning, suffering, transfer)
 * already mounted the shared DeprecatedLensNotice — these three pages
 * never did, so each loaded as a normal current lens. These pins hold
 * the pages to the adoption and the component to the registry,
 * mirroring tests/daily-deprecation-notice.test.tsx.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { render, screen, cleanup } from '@testing-library/react';
import { DeprecatedLensNotice } from '@/components/lens/DeprecatedLensNotice';
import { getLensStatus } from '@/lib/lenses/lens-status';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
afterEach(() => { cleanup(); });

const CASES = [
  { lens: 'docs', target: 'whiteboard', page: 'app/lenses/docs/page.tsx' },
  { lens: 'feed', target: 'whiteboard', page: 'app/lenses/feed/page.tsx' },
  { lens: 'reflection', target: 'paper', page: 'app/lenses/reflection/page.tsx' },
] as const;

describe('genus deprecation notices (docs/feed/reflection)', () => {
  for (const c of CASES) {
    it(`the registry marks ${c.lens} deprecated, merging into ${c.target} as a mode`, () => {
      const entry = getLensStatus(c.lens);
      expect(entry?.status).toBe('deprecated');
      expect(entry?.mergeTarget).toBe(c.target);
      expect(entry?.postMergeRole).toBe('mode');
    });

    it(`the ${c.lens} page mounts the shared notice`, () => {
      expect(read(c.page)).toContain(`<DeprecatedLensNotice lensId="${c.lens}" />`);
    });

    it(`the notice renders for ${c.lens} with a link to the merge target`, () => {
      render(<DeprecatedLensNotice lensId={c.lens} />);
      expect(screen.getByText(/This lens is deprecated\./)).toBeInTheDocument();
      const link = screen.getByRole('link', { name: new RegExp(`the ${c.target} lens`) });
      expect(link).toHaveAttribute('href', `/lenses/${c.target}`);
    });
  }
});
