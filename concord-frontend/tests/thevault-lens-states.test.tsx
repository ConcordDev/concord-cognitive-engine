/**
 * /lenses/vault — submission side of the hall of fame (docs/THEVAULT_SPEC.md).
 * Pins: the full submit form reaches vault.submit with every field, the page reads my_submissions back,
 * withdraw works and refuses honestly, the signed-in submitter sees a decline reason and nobody else does,
 * the vault launches empty, and signed-out visitors cannot submit.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const { lensRun, authUser } = vi.hoisted(() => ({
  lensRun: vi.fn(),
  authUser: { current: null as { id: string; username: string } | null },
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authUser.current, isLoading: false, isAuthenticated: !!authUser.current }),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import VaultPage from '@/app/lenses/vault/page';

interface Sub { id: string; title: string; status: string; workKind?: string; description?: string; body?: string; declineReason?: string; curatorStatement?: string }

const ok = (result: unknown) => ({ data: { ok: true, result, error: null } });

function backend(opts: { records?: Sub[]; submissions?: Sub[]; onSubmit?: (input: Record<string, unknown>) => unknown; onWithdraw?: (input: Record<string, unknown>) => unknown } = {}) {
  const submissions = opts.submissions ?? [];
  lensRun.mockImplementation(async (_d: string, action: string, input: Record<string, unknown> = {}) => {
    if (action === 'browse') return ok({ ok: true, records: opts.records ?? [] });
    if (action === 'my_submissions') return ok({ ok: true, submissions });
    if (action === 'submit') {
      if (opts.onSubmit) return opts.onSubmit(input);
      submissions.unshift({ id: 'vsub_1', title: String(input.title), status: 'submitted', workKind: String(input.workKind), description: String(input.description), body: String(input.body) });
      return ok({ ok: true, id: 'vsub_1', status: 'submitted' });
    }
    if (action === 'withdraw') {
      if (opts.onWithdraw) return opts.onWithdraw(input);
      const row = submissions.find((s) => s.id === input.submissionId);
      if (row) row.status = 'withdrawn';
      return ok({ ok: true, id: input.submissionId, status: 'withdrawn' });
    }
    throw new Error(action);
  });
}

const calls = (action: string) => lensRun.mock.calls.filter((c) => c[1] === action);

beforeEach(() => {
  lensRun.mockReset();
  authUser.current = { id: 'u1', username: 'ramaj' };
});

describe('vault page: launch state and signed-out', () => {
  it('launches empty: honest empty copy, no records, no counts', async () => {
    backend();
    const view = render(<VaultPage />);
    expect(await view.findByTestId('vault-empty')).toHaveTextContent('Nothing has been admitted yet.');
    expect(view.queryByTestId('vault-admitted')).toBeNull();
    expect(view.queryByTestId('vault-my-submissions')).toBeNull();
  });

  it('a signed-out visitor sees no form, and my_submissions is never called', async () => {
    authUser.current = null;
    backend();
    const view = render(<VaultPage />);
    expect(await view.findByTestId('vault-signin')).toBeInTheDocument();
    expect(view.queryByTestId('vault-submit-panel')).toBeNull();
    expect(calls('my_submissions')).toHaveLength(0);
  });

  it('a failed read shows an alert and Retry reloads', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'no_db' } });
    const view = render(<VaultPage />);
    expect(await view.findByRole('alert')).toHaveTextContent(/no_db/);
    backend();
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(await view.findByTestId('vault-empty')).toBeInTheDocument();
  });
});

describe('vault page: submit', () => {
  async function fillAndSubmit(view: ReturnType<typeof render>) {
    fireEvent.click(await view.findByRole('button', { name: 'Submit a work' }));
    fireEvent.change(view.getByPlaceholderText("The work's title"), { target: { value: '  Night tape  ' } });
    fireEvent.change(view.getByLabelText('Kind'), { target: { value: 'music' } });
    fireEvent.change(view.getByPlaceholderText('What is it, and why does it belong here?'), { target: { value: 'A four-track demo.' } });
    fireEvent.change(view.getByPlaceholderText(/Paste the text, a link/), { target: { value: 'liner notes' } });
    fireEvent.change(view.getByPlaceholderText(/DTU ids this work builds on/), { target: { value: 'dtu_a, dtu_b dtu_a' } });
    fireEvent.click(view.getByRole('button', { name: 'Submit for consideration' }));
  }

  it('sends every field to vault.submit, then reads my_submissions back and lists the work as Submitted', async () => {
    backend();
    const view = render(<VaultPage />);
    await fillAndSubmit(view);
    expect(await view.findByTestId('vault-my-submissions')).toBeInTheDocument();
    expect(calls('submit')[0][0]).toBe('vault');
    expect(calls('submit')[0][2]).toEqual({
      title: 'Night tape', workKind: 'music', description: 'A four-track demo.', body: 'liner notes', lineage: ['dtu_a', 'dtu_b'],
    });
    fireEvent.click(await view.findByRole('button', { name: /Night tape/ }));
    expect(view.getByTestId('vault-my-status')).toHaveTextContent('Submitted');
    expect(calls('admit')).toHaveLength(0);
  });

  it('omits lineage when blank', async () => {
    backend();
    const view = render(<VaultPage />);
    fireEvent.click(await view.findByRole('button', { name: 'Submit a work' }));
    fireEvent.change(view.getByPlaceholderText("The work's title"), { target: { value: 'Plain' } });
    fireEvent.click(view.getByRole('button', { name: 'Submit for consideration' }));
    await waitFor(() => expect(calls('submit')).toHaveLength(1));
    expect('lineage' in (calls('submit')[0][2] as object)).toBe(false);
  });

  it('a refused submit shows the refusal and lists nothing', async () => {
    backend({ onSubmit: () => ({ data: { ok: false, result: null, error: 'invalid_work_kind' } }) });
    const view = render(<VaultPage />);
    await fillAndSubmit(view);
    expect(await view.findByRole('alert')).toHaveTextContent(/not one the vault accepts/);
    expect(view.queryByTestId('vault-my-submissions')).toBeNull();
  });

  it('a submit the vault does not read back is reported, not shown', async () => {
    backend({ onSubmit: () => ok({ ok: true, id: 'vsub_ghost', status: 'submitted' }) });
    const view = render(<VaultPage />);
    await fillAndSubmit(view);
    expect(await view.findByText(/did not read it back/)).toBeInTheDocument();
    expect(view.queryByRole('button', { name: /Night tape/ })).toBeNull();
  });
});

describe('vault page: my submissions, withdraw, privacy', () => {
  it('withdraw calls vault.withdraw with the id and reason, and the row reads back Withdrawn', async () => {
    backend({ submissions: [{ id: 'vsub_w', title: 'Held tape', status: 'submitted' }] });
    const view = render(<VaultPage />);
    fireEvent.click(await view.findByRole('button', { name: /Held tape/ }));
    fireEvent.click(view.getByRole('button', { name: 'Withdraw' }));
    fireEvent.change(view.getByLabelText('Reason (optional)'), { target: { value: ' changed my mind ' } });
    fireEvent.click(view.getByRole('button', { name: 'Withdraw this work' }));
    await waitFor(() => expect(view.getByTestId('vault-my-status')).toHaveTextContent('Withdrawn'));
    expect(calls('withdraw')[0][2]).toEqual({ submissionId: 'vsub_w', reason: 'changed my mind' });
    expect(view.queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });

  it('a refused withdraw (admitted records are permanent) shows the server answer', async () => {
    backend({
      submissions: [{ id: 'vsub_r', title: 'Review tape', status: 'under_review' }],
      onWithdraw: () => ({ data: { ok: false, result: null, error: 'wrong_state' } }),
    });
    const view = render(<VaultPage />);
    fireEvent.click(await view.findByRole('button', { name: /Review tape/ }));
    fireEvent.click(view.getByRole('button', { name: 'Withdraw' }));
    fireEvent.click(view.getByRole('button', { name: 'Withdraw this work' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/no longer waiting/);
  });

  it('an admitted work offers no withdraw', async () => {
    backend({ submissions: [{ id: 'vsub_a', title: 'Kept tape', status: 'admitted', curatorStatement: 'Because.' }] });
    const view = render(<VaultPage />);
    fireEvent.click(await view.findByRole('button', { name: /Kept tape/ }));
    expect(view.queryByRole('button', { name: 'Withdraw' })).toBeNull();
    expect(view.getByText('Because.')).toBeInTheDocument();
  });

  it('the submitter reads their own decline reason, labelled private; the public list never shows one', async () => {
    backend({
      records: [{ id: 'vsub_pub', title: 'Public tape', status: 'admitted' }],
      submissions: [{ id: 'vsub_d', title: 'Declined tape', status: 'declined', declineReason: 'Not documented enough.' }],
    });
    const view = render(<VaultPage />);
    fireEvent.click(await view.findByRole('button', { name: /Declined tape/ }));
    expect(view.getByTestId('vault-decline-reason')).toHaveTextContent('private to you');
    expect(view.getByTestId('vault-decline-reason')).toHaveTextContent('Not documented enough.');
    // the admitted list is the browse result only
    expect(view.getByTestId('vault-admitted')).toHaveTextContent('Public tape');
    expect(view.getByTestId('vault-admitted')).not.toHaveTextContent(/Declined tape|Not documented/);
  });
});
