/**
 * /lenses/vault — one cabinet.
 *
 * Open the vault calls vault.submit and shows the title only after
 * vault.my_submissions contains that id and the same title.
 * A submitted row stays Submitted. Browse stays the admitted set.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
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

interface Submission {
  id: string;
  title: string;
  status: string;
}

function browse(records: Submission[] = []) {
  return { data: { ok: true, result: { records, count: records.length }, error: null } };
}

function mine(submissions: Submission[]) {
  return { data: { ok: true, result: { submissions, count: submissions.length }, error: null } };
}

function cabinet(submissions: Submission[] = [], records: Submission[] = []) {
  lensRun.mockImplementation(async (_domain: string, action: string) => {
    if (action === 'browse') return browse(records);
    if (action === 'my_submissions') return mine(submissions);
    throw new Error(action);
  });
}

beforeEach(() => {
  lensRun.mockReset();
  authUser.current = null;
});

describe('vault cabinet', () => {
  it('EMPTY: nothing unlocked and nothing selected', async () => {
    cabinet();
    const view = render(<VaultPage />);
    expect(await view.findByText('Nothing unlocked.')).toBeInTheDocument();
    expect(view.getByText('Nothing selected.')).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'The vault' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Open the vault' })).toBeEnabled();
    expect(view.queryByText('Admitted')).toBeNull();
    expect(view.queryByText(/curator/i)).toBeNull();
  });

  it('ERROR: a failed read shows role=alert and Retry reloads', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'no_db' } });
    const view = render(<VaultPage />);
    expect(await view.findByRole('alert')).toHaveTextContent(/no_db/);
    cabinet();
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(await view.findByText('Nothing unlocked.')).toBeInTheDocument();
  });

  it('OPEN: a blank title does not call submit', async () => {
    cabinet();
    const view = render(<VaultPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Open the vault' }));
    fireEvent.click(view.getByRole('button', { name: 'Open the vault' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/A title is required/);
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('submit');
  });

  it('OPEN: shows the title only after my_submissions contains the id and title', async () => {
    const submissions: Submission[] = [];
    lensRun.mockImplementation(async (_domain: string, action: string, input?: { title?: string }) => {
      if (action === 'browse') return browse([]);
      if (action === 'my_submissions') return mine(submissions);
      if (action === 'submit') {
        submissions.unshift({ id: 'vsub_1', title: input?.title || '', status: 'submitted' });
        return { data: { ok: true, result: { ok: true, id: 'vsub_1', status: 'submitted' }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<VaultPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Open the vault' }));
    fireEvent.change(view.getByTestId('vault-title'), { target: { value: '  Night tape  ' } });
    fireEvent.click(view.getByRole('button', { name: 'Open the vault' }));
    expect(await view.findByRole('button', { name: /Night tape/ })).toBeInTheDocument();
    expect(view.getByText('Submitted')).toBeInTheDocument();
    expect(view.getByText('Nothing selected.')).toBeInTheDocument();
    expect(view.queryByText('Nothing unlocked.')).toBeNull();
    expect(view.queryByText('Admitted')).toBeNull();
    const save = lensRun.mock.calls.find((call) => call[1] === 'submit');
    expect(save?.[0]).toBe('vault');
    expect(save?.[2]).toEqual({ title: 'Night tape' });
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('admit');
  });

  it('OPEN: a list miss does not show the title', async () => {
    lensRun.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'browse') return browse([]);
      if (action === 'my_submissions') return mine([]);
      if (action === 'submit') {
        return { data: { ok: true, result: { ok: true, id: 'vsub_missing', status: 'submitted' }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<VaultPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Open the vault' }));
    fireEvent.change(view.getByTestId('vault-title'), { target: { value: 'Lost tape' } });
    fireEvent.click(view.getByRole('button', { name: 'Open the vault' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/did not read it back/);
    expect(view.queryByRole('button', { name: /Lost tape/ })).toBeNull();
  });

  it('GREETING: title-cases the signed-in name', async () => {
    authUser.current = { username: 'ramaj' };
    cabinet();
    const view = render(<VaultPage />);
    expect(await view.findByRole('heading', { name: 'The vault, Ramaj' })).toBeInTheDocument();
    expect(await view.findByText('Nothing unlocked.')).toBeInTheDocument();
  });

  it('LOAD: shows an existing submission as submitted and an admitted record as admitted', async () => {
    cabinet(
      [{ id: 'vsub_own', title: 'Own tape', status: 'submitted' }],
      [{ id: 'vsub_pub', title: 'Public tape', status: 'admitted' }],
    );
    const view = render(<VaultPage />);
    expect(await view.findByRole('button', { name: /Own tape/ })).toBeInTheDocument();
    expect(view.getByRole('button', { name: /Public tape/ })).toBeInTheDocument();
    expect(view.getByText('Submitted')).toBeInTheDocument();
    expect(view.getByText('Admitted')).toBeInTheDocument();
    expect(view.getByText('Nothing selected.')).toBeInTheDocument();
    expect(view.queryByText('Nothing unlocked.')).toBeNull();
  });

  it('SELECT: choosing a row fills the right pane and does not admit', async () => {
    cabinet([{ id: 'vsub_own', title: 'Own tape', status: 'submitted' }]);
    const view = render(<VaultPage />);
    fireEvent.click(await view.findByRole('button', { name: /Own tape/ }));
    expect(await view.findByRole('heading', { name: 'Own tape' })).toBeInTheDocument();
    expect(view.queryByText('Nothing selected.')).toBeNull();
    expect(view.getAllByText('Submitted')).toHaveLength(2);
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('admit');
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('record');
  });

  it('OPEN: a refused submit does not show the title', async () => {
    cabinet();
    const view = render(<VaultPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Open the vault' }));
    lensRun.mockImplementation(async (_domain: string, action: string) => {
      if (action === 'browse') return browse([]);
      if (action === 'my_submissions') return mine([]);
      if (action === 'submit') return { data: { ok: false, result: null, error: 'submit_failed' } };
      throw new Error(action);
    });
    fireEvent.change(view.getByTestId('vault-title'), { target: { value: 'Bad tape' } });
    fireEvent.click(view.getByRole('button', { name: 'Open the vault' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/submit_failed/);
    expect(view.queryByRole('button', { name: /Bad tape/ })).toBeNull();
    expect(view.getByText('Nothing unlocked.')).toBeInTheDocument();
  });

  it('OPEN: a second work stays beside the first', async () => {
    const submissions: Submission[] = [{ id: 'vsub_1', title: 'First tape', status: 'submitted' }];
    lensRun.mockImplementation(async (_domain: string, action: string, input?: { title?: string }) => {
      if (action === 'browse') return browse([]);
      if (action === 'my_submissions') return mine(submissions);
      if (action === 'submit') {
        submissions.unshift({ id: 'vsub_2', title: input?.title || '', status: 'submitted' });
        return { data: { ok: true, result: { ok: true, id: 'vsub_2', status: 'submitted' }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<VaultPage />);
    expect(await view.findByRole('button', { name: /First tape/ })).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: 'Open the vault' }));
    fireEvent.change(view.getByTestId('vault-title'), { target: { value: 'Second tape' } });
    fireEvent.click(view.getByRole('button', { name: 'Open the vault' }));
    expect(await view.findByRole('button', { name: /Second tape/ })).toBeInTheDocument();
    expect(view.getByRole('button', { name: /First tape/ })).toBeInTheDocument();
  });
});
