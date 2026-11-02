/**
 * Wave 4 (PR #1707): the delight primitives (code.md §3b D1–D4,
 * E-CODE-1) — pure cores plus the egg's rendering in the git LOG.
 *
 * The stamp is built only from a real run's figures; a timeout stamps
 * its timeout. The egg triggers only on the user's own exact words.
 * The provenance summary reads only records the server returned.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  apiHelpers: { lens: { runDomain: vi.fn() } },
}));

import { runStampText, isShipItCommit, summarizeProvenance, QuietSuccessEdge } from '@/components/code/delight';
import { GitPanel } from '@/components/code/GitPanel';

describe('runStampText (D1)', () => {
  it('stamps a real run in the spec format', () => {
    expect(runStampText({ elapsedMs: 88, exitCode: 0 })).toBe('ran · 88 ms · exit 0');
    expect(runStampText({ elapsedMs: 1500, exitCode: 1 })).toBe('ran · 1.5 s · exit 1');
  });
  it('a timeout stamps its timeout, never an exit', () => {
    expect(runStampText({ elapsedMs: 30000, timedOut: true })).toBe('stopped · 30.0 s · timeout');
  });
});

describe('isShipItCommit (E-CODE-1)', () => {
  it('matches only the exact words, forgiving case and padding', () => {
    expect(isShipItCommit('ship it')).toBe(true);
    expect(isShipItCommit('  Ship It ')).toBe(true);
    expect(isShipItCommit('ship it now')).toBe(false);
    expect(isShipItCommit('fix the ship it bug')).toBe(false);
    expect(isShipItCommit('')).toBe(false);
  });
});

describe('summarizeProvenance (D4)', () => {
  const log = [
    { id: 'c2', number: 'C-00002', message: 'second', committedAt: '2026-10-29T00:00:00Z', paths: ['b.js'] },
    { id: 'c1', number: 'C-00001', message: 'first', committedAt: '2026-10-28T00:00:00Z', paths: ['src/a.js', 'b.js'] },
  ];
  const snaps = [
    { files: [{ name: 'src/a.js' }] },
    { files: [{ name: 'a.js' }, { name: 'x.js' }] },
    { files: [{ name: 'other.js' }] },
  ];
  it('finds the newest commit touching the file and counts its snapshots', () => {
    const sum = summarizeProvenance(log, snaps, 'src/a.js');
    expect(sum.lastCommit?.id).toBe('c1');
    expect(sum.snapshotCount).toBe(2);
    expect(sum.hasHistory).toBe(true);
  });
  it('a file with no records reads as no history', () => {
    const sum = summarizeProvenance(log, snaps, 'new.js');
    expect(sum).toEqual({ lastCommit: null, snapshotCount: 0, hasHistory: false });
  });
});

describe('QuietSuccessEdge (D2)', () => {
  it('renders nothing idle and the flash layer on a success key', () => {
    const { container, rerender } = render(<QuietSuccessEdge flashKey={0} />);
    expect(container.querySelector('.concord-quiet-flash')).toBeNull();
    rerender(<QuietSuccessEdge flashKey={1} />);
    expect(container.querySelector('.concord-quiet-flash')).toBeTruthy();
  });
});

describe('git LOG egg (E-CODE-1)', () => {
  it('a "ship it" commit carries the serif line; other commits do not', async () => {
    lensRunMock.mockReset();
    lensRunMock.mockImplementation((req: { action: string }) => {
      if (req.action === 'git-status') return Promise.resolve({ data: { ok: true, result: { branch: 'main', branches: ['main'], modified: [], staged: [], head: 'c2', clean: true } } });
      if (req.action === 'git-log') return Promise.resolve({ data: { ok: true, result: { log: [
        { id: 'c2xxxxxx', number: 'C-00002', message: 'ship it', branch: 'main', committedAt: '2026-10-29T00:00:00Z', paths: ['a.js'] },
        { id: 'c1xxxxxx', number: 'C-00001', message: 'regular work', branch: 'main', committedAt: '2026-10-28T00:00:00Z', paths: ['a.js'] },
      ] } } });
      return Promise.resolve({ data: { ok: true, result: { stashes: [] } } });
    });
    render(<GitPanel projectId="p1" />);
    expect(await screen.findByTestId('ship-it-line')).toBeTruthy();
    expect(screen.getByTestId('ship-it-line').textContent).toBe('Shipped, with receipts.');
    expect(screen.getAllByTestId('ship-it-line')).toHaveLength(1);
  });
});
