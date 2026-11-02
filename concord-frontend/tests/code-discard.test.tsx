/**
 * S10 (PR #1707): Discard changes must revert — and be recoverable (F10).
 *
 * The old discard gated on native confirm(), which never resolves in
 * the reviewed surface: clicks landed, nothing happened, and the
 * change stayed staged for a future commit. These tests pin the
 * rebuilt row: arm/confirm in the UI (confirm() never called), the
 * git-discard macro fires with the path, the snapshot notice renders,
 * and the caller is told which path to reconcile in the editor.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { GitPanel } from '@/components/code/GitPanel';

type Call = { domain: string; action: string; input: Record<string, unknown> };
const calls = () => lensRunMock.mock.calls.map((c) => c[0] as Call);

const confirmSpy = vi.fn(() => true);

beforeEach(() => {
  lensRunMock.mockReset();
  vi.stubGlobal('confirm', confirmSpy);
  confirmSpy.mockClear();
  lensRunMock.mockImplementation((req: Call) => {
    switch (req.action) {
      case 'git-status':
        return Promise.resolve({ data: { ok: true, result: { branch: 'main', branches: ['main'], modified: ['helper.py'], staged: [], head: 'abc', clean: false } } });
      case 'git-log':
        return Promise.resolve({ data: { ok: true, result: { log: [] } } });
      case 'git-stash-list':
        return Promise.resolve({ data: { ok: true, result: { stashes: [] } } });
      case 'git-discard':
        return Promise.resolve({ data: { ok: true, result: { path: 'helper.py', restored: true, snapshotId: 'stash_1' } } });
      default:
        return Promise.resolve({ data: { ok: true, result: {} } });
    }
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('GitPanel discard (S10)', () => {
  it('arm → confirm executes the revert, reports the snapshot, and reconciles — confirm() never fires', async () => {
    const onDiscarded = vi.fn();
    render(<GitPanel projectId="p1" onDiscarded={onDiscarded} />);
    const discardBtn = await screen.findByTitle('Discard changes');
    fireEvent.click(discardBtn);
    // Armed only — the macro has NOT run yet.
    expect(calls().some((c) => c.action === 'git-discard')).toBe(false);
    fireEvent.click(await screen.findByTitle('Confirm discard'));
    await waitFor(() => expect(calls().some((c) => c.action === 'git-discard' && c.input.path === 'helper.py')).toBe(true));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onDiscarded).toHaveBeenCalledWith('helper.py');
    expect(await screen.findByText(/Discarded changes to helper\.py — a snapshot is kept in the stash list/)).toBeTruthy();
  });

  it('a refused discard surfaces the server reason via the panel notice path', async () => {
    lensRunMock.mockImplementation((req: Call) => {
      if (req.action === 'git-discard') return Promise.resolve({ data: { ok: false, error: 'STATE unavailable' } });
      if (req.action === 'git-status') return Promise.resolve({ data: { ok: true, result: { branch: 'main', branches: ['main'], modified: ['helper.py'], staged: [], head: 'abc', clean: false } } });
      return Promise.resolve({ data: { ok: true, result: { log: [], stashes: [] } } });
    });
    render(<GitPanel projectId="p1" />);
    fireEvent.click(await screen.findByTitle('Discard changes'));
    fireEvent.click(await screen.findByTitle('Confirm discard'));
    expect(await screen.findByText('STATE unavailable')).toBeTruthy();
  });
});
