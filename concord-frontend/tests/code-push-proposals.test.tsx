/** PushProposalsPanel — draft → review → push/reject through the code domain's governance macros. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));
const addToast = vi.fn();
vi.mock('@/store/ui', () => ({ useUIStore: { getState: () => ({ addToast }) } }));

import { PushProposalsPanel } from '@/components/code/PushProposalsPanel';

const PENDING = {
  id: 'pp1', repo: 'dutch/app', baseRef: 'main', branchName: 'ai/validate-signup', status: 'pending', fileCount: 1,
  edits: [{ filename: 'src/signup.ts', reason: 'validate email' }], createdAt: '2026-10-03T00:00:00Z', rejectReason: null, pushResult: null,
};

beforeEach(() => {
  lensRunMock.mockReset(); addToast.mockReset();
  lensRunMock.mockImplementation((domain: string, action: string) => {
    if (domain === 'github') return Promise.resolve({ data: { ok: true, result: { repos: [{ fullName: 'dutch/app' }] } } });
    if (action === 'push-proposal-list') return Promise.resolve({ data: { ok: true, result: { proposals: [PENDING] } } });
    if (action === 'push-proposal-approve') return Promise.resolve({ data: { ok: true, result: { proposal: { ...PENDING, status: 'pushed' } } } });
    return Promise.resolve({ data: { ok: true, result: { proposal: PENDING } } });
  });
});

describe('PushProposalsPanel', () => {
  it('drafts a verified patch for the chosen repo and new branch', async () => {
    render(<PushProposalsPanel />);
    await screen.findByText('src/signup.ts');
    fireEvent.change(screen.getByLabelText('New branch'), { target: { value: 'ai/rate-limit' } });
    fireEvent.change(screen.getByLabelText('Describe the change'), { target: { value: 'add rate limiting' } });
    fireEvent.click(screen.getByRole('button', { name: /draft verified patch/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('code', 'push-proposal-create', { repo: 'dutch/app', ref: 'main', branchName: 'ai/rate-limit', taskQuery: 'add rate limiting' }));
  });

  it('never pushes until Push is pressed, then pushes that proposal', async () => {
    render(<PushProposalsPanel />);
    await screen.findByText('src/signup.ts');
    expect(lensRunMock).not.toHaveBeenCalledWith('code', 'push-proposal-approve', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: /push to branch/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('code', 'push-proposal-approve', { id: 'pp1' }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })));
  });

  it('rejects without pushing', async () => {
    render(<PushProposalsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /reject/i }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('code', 'push-proposal-reject', { id: 'pp1' }));
    expect(lensRunMock).not.toHaveBeenCalledWith('code', 'push-proposal-approve', expect.anything());
  });
});
