/**
 * Daily deprecation notice (FIX-daily-010).
 *
 * The queue and inventory mark Daily deprecated, and the founder's
 * docs-014 ruling (A) confirms the lens-status taxonomy is real:
 * deprecated lenses render the deprecation notice. The registry
 * already carried the truth (LENS_STATUS_MAP: daily = deprecated,
 * merge target whiteboard, post-merge role mode).
 *
 * GB-1538 genus leg 5, resolution (a2): the ONE deprecation surface
 * is the LensShell banner (the founder's shell-family
 * implementation). Daily's per-page DeprecatedLensNotice mount is
 * removed — it double-rendered against the shell — and these pins
 * re-point to the banner: the registry entry, the shell locus, a
 * no-page-mount guard, and exactly one rendered notice for daily.
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

describe('daily deprecation notice (FIX-daily-010)', () => {
  it("the registry marks daily deprecated, merging into whiteboard as a mode", () => {
    const entry = getLensStatus('daily');
    expect(entry?.status).toBe('deprecated');
    expect(entry?.mergeTarget).toBe('whiteboard');
    expect(entry?.postMergeRole).toBe('mode');
  });

  it("the notice reaches daily through the shell banner; the page mounts no copy", () => {
    const shell = read('components/lens/LensShell.tsx');
    expect(shell).toContain('getLensStatus(lensId)');
    expect(shell).toContain('role="note"');
    expect(read('app/lenses/daily/page.tsx')).not.toContain('DeprecatedLensNotice');
  });

  it('the shell renders exactly one notice for daily with a link to the merge target', () => {
    render(
      <LensShell lensId="daily" disableAgentFab>
        <div>lens body</div>
      </LensShell>,
    );
    expect(screen.getAllByRole('note')).toHaveLength(1);
    expect(screen.getByText(/This lens is/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'whiteboard' });
    expect(link).toHaveAttribute('href', '/lenses/whiteboard');
    expect(screen.getByText(/as a mode/)).toBeInTheDocument();
  });

  it('the shell renders no notice for a lens that is not deprecated', () => {
    render(
      <LensShell lensId="paper" disableAgentFab>
        <div>lens body</div>
      </LensShell>,
    );
    expect(screen.queryAllByRole('note')).toHaveLength(0);
  });
});
