/**
 * Transfer deprecation notice (FIX-transfer-004).
 *
 * The queue and inventory mark Transfer deprecated, and the founder's
 * docs-014 ruling (A) confirms the lens-status taxonomy is real:
 * deprecated lenses render the deprecation notice. The registry
 * already carried the truth (LENS_STATUS_MAP: transfer = deprecated,
 * merge target paper, post-merge role engine). Same adoption as
 * FIX-daily-010.
 *
 * GB-1538 genus leg 5, resolution (a2): the ONE deprecation surface
 * is the LensShell banner (the founder's shell-family
 * implementation). Transfer's per-page DeprecatedLensNotice mount
 * is removed — it double-rendered against the shell — and these
 * pins re-point to the banner: the registry entry, the shell locus,
 * a no-page-mount guard, and exactly one rendered notice for
 * transfer.
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

describe('transfer deprecation notice (FIX-transfer-004)', () => {
  it("the registry marks transfer deprecated, merging into paper as an engine", () => {
    const entry = getLensStatus('transfer');
    expect(entry?.status).toBe('deprecated');
    expect(entry?.mergeTarget).toBe('paper');
    expect(entry?.postMergeRole).toBe('engine');
  });

  it("the notice reaches transfer through the shell banner; the page mounts no copy", () => {
    const shell = read('components/lens/LensShell.tsx');
    expect(shell).toContain('getLensStatus(lensId)');
    expect(shell).toContain('role="note"');
    expect(read('app/lenses/transfer/page.tsx')).not.toContain('DeprecatedLensNotice');
  });

  it('the shell renders exactly one notice for transfer with a link to the merge target', () => {
    render(
      <LensShell lensId="transfer" disableAgentFab>
        <div>lens body</div>
      </LensShell>,
    );
    expect(screen.getAllByRole('note')).toHaveLength(1);
    expect(screen.getByText(/This lens is/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'paper' });
    expect(link).toHaveAttribute('href', '/lenses/paper');
    expect(screen.getByText(/as a engine/)).toBeInTheDocument();
  });

  it('the shell renders no notice for a lens that is not deprecated', () => {
    render(
      <LensShell lensId="graph" disableAgentFab>
        <div>lens body</div>
      </LensShell>,
    );
    expect(screen.queryAllByRole('note')).toHaveLength(0);
  });
});
