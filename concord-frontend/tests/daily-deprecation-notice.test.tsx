/**
 * Daily deprecation notice (FIX-daily-010).
 *
 * The queue and inventory mark Daily deprecated, and the founder's
 * docs-014 ruling (A) confirms the lens-status taxonomy is real:
 * deprecated lenses render the deprecation notice. The registry
 * already carried the truth (LENS_STATUS_MAP: daily = deprecated,
 * merge target whiteboard, post-merge role mode) and the shared
 * DeprecatedLensNotice already surfaces it for hypothesis and
 * suffering — Daily's page simply never mounted the notice, so the
 * lens loaded as a normal current lens. These pins hold the page to
 * the adoption and the component to the registry for 'daily'.
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

describe('daily deprecation notice (FIX-daily-010)', () => {
  it("the registry marks daily deprecated, merging into whiteboard as a mode", () => {
    const entry = getLensStatus('daily');
    expect(entry?.status).toBe('deprecated');
    expect(entry?.mergeTarget).toBe('whiteboard');
    expect(entry?.postMergeRole).toBe('mode');
  });

  it("the daily page mounts the shared notice", () => {
    expect(read('app/lenses/daily/page.tsx')).toContain('<DeprecatedLensNotice lensId="daily" />');
  });

  it('the notice renders for daily with a link to the merge target', () => {
    render(<DeprecatedLensNotice lensId="daily" />);
    expect(screen.getByText(/This lens is deprecated\./)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /the whiteboard lens/ });
    expect(link).toHaveAttribute('href', '/lenses/whiteboard');
    expect(screen.getByText(/as a mode/)).toBeInTheDocument();
  });

  it('the notice stays silent for a lens that is not deprecated', () => {
    const { container } = render(<DeprecatedLensNotice lensId="paper" />);
    expect(container.firstChild).toBeNull();
  });
});
