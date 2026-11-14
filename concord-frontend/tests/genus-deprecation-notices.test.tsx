/**
 * Deprecation notices for docs / feed / reflection (GB-1538 genus,
 * rider 2: FIX-docs-014 · FIX-feed-011 · FIX-reflection-005), as
 * consolidated by genus leg 5 (resolution (a)).
 *
 * The founder's docs-014 ruling (A) confirms the lens-status taxonomy
 * is real: deprecated lenses render the deprecation notice. Leg 3 of
 * the genus mounted DeprecatedLensNotice per-page on these three
 * lenses; leg 5 then consolidated the mount into LensShell — the one
 * place every lens passes through — and removed every per-page mount
 * (they double-rendered against the shell). These pins now hold the
 * SHELL to the mount, the pages to carrying no mount of their own,
 * and the rendered output to exactly one notice per deprecated lens.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { render, screen, cleanup } from '@testing-library/react';
import { DeprecatedLensNotice } from '@/components/lens/DeprecatedLensNotice';
import { LensShell } from '@/components/lens/LensShell';
import { getLensStatus } from '@/lib/lenses/lens-status';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
afterEach(() => { cleanup(); });

const CASES = [
  { lens: 'docs', target: 'whiteboard', page: 'app/lenses/docs/page.tsx' },
  { lens: 'feed', target: 'whiteboard', page: 'app/lenses/feed/page.tsx' },
  { lens: 'reflection', target: 'paper', page: 'app/lenses/reflection/page.tsx' },
] as const;

const PAGE_MOUNTED = [
  'app/lenses/daily/page.tsx',
  'app/lenses/hypothesis/page.tsx',
  'app/lenses/metalearning/page.tsx',
  'app/lenses/suffering/page.tsx',
  'app/lenses/transfer/page.tsx',
  'app/lenses/docs/page.tsx',
  'app/lenses/feed/page.tsx',
  'app/lenses/reflection/page.tsx',
] as const;

describe('genus deprecation notices — shell consolidation (leg 5)', () => {
  it('LensShell mounts the shared notice once, driven by its lensId', () => {
    expect(read('components/lens/LensShell.tsx')).toContain('<DeprecatedLensNotice lensId={lensId} />');
  });

  it('no lens page carries a per-page mount anymore (the double-render guard)', () => {
    for (const page of PAGE_MOUNTED) {
      expect(read(page)).not.toContain('DeprecatedLensNotice');
    }
  });

  for (const c of CASES) {
    it(`the registry marks ${c.lens} deprecated, merging into ${c.target} as a mode`, () => {
      const entry = getLensStatus(c.lens);
      expect(entry?.status).toBe('deprecated');
      expect(entry?.mergeTarget).toBe(c.target);
      expect(entry?.postMergeRole).toBe('mode');
    });

    it(`the notice renders for ${c.lens} with a link to the merge target`, () => {
      render(<DeprecatedLensNotice lensId={c.lens} />);
      expect(screen.getByText(/This lens is deprecated\./)).toBeInTheDocument();
      const link = screen.getByRole('link', { name: new RegExp(`the ${c.target} lens`) });
      expect(link).toHaveAttribute('href', `/lenses/${c.target}`);
    });

    it(`the shell renders exactly one notice for ${c.lens}`, () => {
      render(
        <LensShell lensId={c.lens} disableAgentFab>
          <div>lens body</div>
        </LensShell>,
      );
      expect(screen.getAllByRole('note')).toHaveLength(1);
      expect(screen.getByText(/This lens is deprecated\./)).toBeInTheDocument();
    });
  }

  it('the shell renders no notice for a lens that is not deprecated', () => {
    render(
      <LensShell lensId="paper" disableAgentFab>
        <div>lens body</div>
      </LensShell>,
    );
    expect(screen.queryAllByRole('note')).toHaveLength(0);
  });
});
