/**
 * Transfer deprecation notice (FIX-transfer-004).
 *
 * The queue and inventory mark Transfer deprecated, and the founder's
 * docs-014 ruling (A) confirms the lens-status taxonomy is real:
 * deprecated lenses render the deprecation notice. The registry
 * already carried the truth (LENS_STATUS_MAP: transfer = deprecated,
 * merge target paper, post-merge role engine) and the shared
 * DeprecatedLensNotice already surfaces it for hypothesis, suffering
 * and daily — Transfer's page simply never mounted the notice, so
 * the lens loaded as a normal current lens. These pins hold the page
 * to the adoption and the component to the registry for 'transfer'.
 * Same adoption as FIX-daily-010.
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

describe('transfer deprecation notice (FIX-transfer-004)', () => {
  it("the registry marks transfer deprecated, merging into paper as an engine", () => {
    const entry = getLensStatus('transfer');
    expect(entry?.status).toBe('deprecated');
    expect(entry?.mergeTarget).toBe('paper');
    expect(entry?.postMergeRole).toBe('engine');
  });

  it("the transfer page mounts the shared notice", () => {
    expect(read('app/lenses/transfer/page.tsx')).toContain('<DeprecatedLensNotice lensId="transfer" />');
  });

  it('the notice renders for transfer with a link to the merge target', () => {
    render(<DeprecatedLensNotice lensId="transfer" />);
    expect(screen.getByText(/This lens is deprecated\./)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /the paper lens/ });
    expect(link).toHaveAttribute('href', '/lenses/paper');
    expect(screen.getByText(/as a engine/)).toBeInTheDocument();
  });

  it('the notice stays silent for a lens that is not deprecated', () => {
    const { container } = render(<DeprecatedLensNotice lensId="graph" />);
    expect(container.firstChild).toBeNull();
  });
});
