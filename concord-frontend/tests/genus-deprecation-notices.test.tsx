/**
 * Deprecation notices for docs / feed / reflection (GB-1538 genus,
 * rider 2: FIX-docs-014 · FIX-feed-011 · FIX-reflection-005), as
 * consolidated by genus leg 5 (resolution (a2)).
 *
 * The founder's docs-014 ruling (A) confirms the lens-status taxonomy
 * is real: deprecated lenses render the deprecation notice. The ONE
 * deprecation surface is the LensShell banner (the founder's
 * shell-family implementation, FIX-commonsense-002 /
 * FIX-grounding-007 / FIX-inference-010): the per-page
 * DeprecatedLensNotice mounts are removed — they double-rendered
 * against the shell — and these pins hold the shell banner to the
 * registry, every page to carrying no mount of its own, and the
 * rendered output to exactly one notice per deprecated lens.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { render, screen, cleanup } from '@testing-library/react';
import { LensShell } from '@/components/lens/LensShell';
import { getLensStatus } from '@/lib/lenses/lens-status';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
afterEach(() => { cleanup(); });

const CASES = [
  { lens: 'docs', target: 'whiteboard', role: 'mode', page: 'app/lenses/docs/page.tsx' },
  { lens: 'feed', target: 'whiteboard', role: 'mode', page: 'app/lenses/feed/page.tsx' },
  { lens: 'reflection', target: 'paper', role: 'mode', page: 'app/lenses/reflection/page.tsx' },
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

describe('genus deprecation notices — shell banner consolidation (leg 5, a2)', () => {
  it('LensShell carries the banner, driven by the status map', () => {
    const shell = read('components/lens/LensShell.tsx');
    expect(shell).toContain('getLensStatus(lensId)');
    expect(shell).toContain("statusEntry?.status === 'deprecated'");
    expect(shell).toContain('role="note"');
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

    it(`the shell renders exactly one notice for ${c.lens} with the merge-target link`, () => {
      render(
        <LensShell lensId={c.lens} disableAgentFab>
          <div>lens body</div>
        </LensShell>,
      );
      expect(screen.getAllByRole('note')).toHaveLength(1);
      expect(screen.getByText(/This lens is/)).toBeInTheDocument();
      const link = screen.getByRole('link', { name: c.target });
      expect(link).toHaveAttribute('href', `/lenses/${c.target}`);
      expect(screen.getByText(new RegExp(`as a ${c.role}`))).toBeInTheDocument();
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
