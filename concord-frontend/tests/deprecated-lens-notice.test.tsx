/**
 * FIX-hypothesis-008 / FIX-suffering-013 — both lenses are marked
 * deprecated in LENS_STATUS_MAP (merge target paper) yet loaded as
 * normal current lenses with no notice. The deprecation notice is
 * data-driven, so any future deprecation appears automatically.
 *
 * GB-1538 genus leg 5, resolution (a2): the ONE deprecation surface
 * is the LensShell banner (the founder's shell-family implementation,
 * FIX-commonsense-002 / FIX-grounding-007 / FIX-inference-010). The
 * per-page DeprecatedLensNotice mounts these fixes originally pinned
 * are removed — they double-rendered against the shell — and these
 * pins re-point to the banner: the shell locus, a no-page-mount
 * guard, and exactly one rendered notice per deprecated lens. The
 * banner carries the notice's material content entire (deprecation
 * notice, merge target, post-merge role).
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { render, screen, cleanup } from '@testing-library/react';
import { LensShell } from '@/components/lens/LensShell';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
afterEach(() => { cleanup(); });

describe('deprecated lens notice (shell banner)', () => {
  it('the shell banner reads the canonical lens status map', () => {
    const shell = read('components/lens/LensShell.tsx');
    expect(shell).toContain('getLensStatus(lensId)');
    expect(shell).toContain("statusEntry?.status === 'deprecated'");
    expect(shell).toContain('role="note"');
    expect(shell).toContain('This lens is');
  });

  it('the pages carry no per-page mount of their own', () => {
    expect(read('app/lenses/hypothesis/page.tsx')).not.toContain('DeprecatedLensNotice');
    expect(read('app/lenses/suffering/page.tsx')).not.toContain('DeprecatedLensNotice');
  });

  it.each(['hypothesis', 'suffering'])('the shell renders exactly one notice for %s, linking the merge target', (lens) => {
    render(
      <LensShell lensId={lens} disableAgentFab>
        <div>lens body</div>
      </LensShell>,
    );
    expect(screen.getAllByRole('note')).toHaveLength(1);
    expect(screen.getByText(/This lens is/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'paper' });
    expect(link).toHaveAttribute('href', '/lenses/paper');
    expect(screen.getByText(/as a mode/)).toBeInTheDocument();
  });
});
