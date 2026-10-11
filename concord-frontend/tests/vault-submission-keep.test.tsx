/**
 * TheVault submissions — an owned submission can be kept as a private DTU
 * and drafted in Thread. An admitted work that is not the user's stays put.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const { lensRun, authUser } = vi.hoisted(() => ({
  lensRun: vi.fn(),
  authUser: { current: null as { username: string } | null },
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authUser.current, isLoading: false, isAuthenticated: !!authUser.current }),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import VaultPage from '@/app/lenses/vault/page';
import { vaultSubmissionKeepRecord, recordDtuCall, recordThreadDraftCall } from '@/components/lens/recordKeep';

const own = {
  id: 'vsub_1',
  title: 'Night tape',
  status: 'submitted',
  workKind: 'writing',
  description: 'A quiet piece.',
  body: 'the actual text of the piece',
  submittedAt: 1760140800,
};

beforeEach(() => {
  lensRun.mockReset();
  authUser.current = null;
});

function cabinet() {
  lensRun.mockImplementation(async (domain: string, action: string, input?: { content?: string; citedDtuId?: string }) => {
    if (domain === 'vault' && action === 'browse') {
      return { data: { ok: true, result: { records: [{ id: 'vsub_pub', title: 'Public tape', status: 'admitted' }] }, error: null } };
    }
    if (domain === 'vault' && action === 'my_submissions') {
      return { data: { ok: true, result: { submissions: [own] }, error: null } };
    }
    if (domain === 'dtu' && action === 'create') {
      return { data: { ok: true, result: { dtu: { id: 'dtu_vault_1' } }, error: null } };
    }
    if (domain === 'dtu' && action === 'get') {
      return { data: { ok: true, result: { dtu: { id: 'dtu_vault_1' } }, error: null } };
    }
    if (domain === 'thread' && action === 'thread-draft') {
      return {
        data: {
          ok: true,
          result: {
            draft: {
              id: 'th_vault_1',
              status: 'draft',
              citedDtuId: input?.citedDtuId,
              content: input?.content,
            },
          },
          error: null,
        },
      };
    }
    throw new Error(`${domain}.${action}`);
  });
}

describe('vault submission keep', () => {
  it('keeps an owned submission as a private DTU and drafts that DTU in Thread', async () => {
    cabinet();
    const view = render(<VaultPage />);
    fireEvent.click(await view.findByRole('button', { name: /Night tape/ }));

    const record = vaultSubmissionKeepRecord(own);
    expect(record?.body).toContain('Night tape');
    expect(record?.body).toContain('A quiet piece.');
    expect(record?.body).toContain('the actual text of the piece');
    expect(record?.body).not.toMatch(/lorem|placeholder|Untitled/i);

    fireEvent.click(view.getByRole('button', { name: 'Keep as DTU' }));
    expect(await view.findByText(/Saved as private DTU dtu_vault_1\./)).toBeTruthy();

    const created = lensRun.mock.calls.find((c) => c[0] === 'dtu' && c[1] === 'create');
    expect(created?.[2]).toEqual(recordDtuCall(record)?.input);
    expect((created?.[2] as { visibility?: string }).visibility).toBe('private');
    expect(String((created?.[2] as { content?: string }).content)).toContain('the actual text of the piece');

    fireEvent.click(view.getByRole('button', { name: /Draft in Thread/i }));
    expect(await view.findByText(/Drafted in Thread as th_vault_1, citing dtu_vault_1\. Not posted\./)).toBeTruthy();
    const drafted = lensRun.mock.calls.find((c) => c[0] === 'thread' && c[1] === 'thread-draft');
    expect(drafted?.[2]).toEqual(recordThreadDraftCall(record, 'dtu_vault_1')?.input);
    expect(String((drafted?.[2] as { content?: string }).content)).toContain('DTU dtu_vault_1');
  });

  it('does not offer Keep on an admitted work that is not the user\'s submission', async () => {
    cabinet();
    const view = render(<VaultPage />);
    fireEvent.click(await view.findByRole('button', { name: /Public tape/ }));
    expect(await view.findByRole('heading', { name: 'Public tape' })).toBeTruthy();
    await waitFor(() => expect(view.queryByRole('button', { name: 'Keep as DTU' })).toBeNull());
  });
});
