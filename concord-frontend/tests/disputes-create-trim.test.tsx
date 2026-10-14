/**
 * F3 — CreateDisputeForm Submit stays disabled for whitespace-only fields.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const apiPost = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'buyer', email: 'b@x.com', role: 'member' },
    isLoading: false,
    isAuthenticated: true,
    logout: async () => {},
    refresh: async () => {},
  }),
}));

vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ data: { ok: true, disputes: [], total: 0 } }),
    post: (...args: unknown[]) => apiPost(...args),
    put: vi.fn(),
  },
}));

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: [], isLoading: false }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { CasesPanel } from '@/components/disputes/CasesPanel';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('disputes F3 create trim gate', () => {
  beforeEach(() => {
    apiPost.mockReset();
    apiPost.mockResolvedValue({ data: { ok: true, disputeId: 'disp_1' } });
  });
  afterEach(() => cleanup());

  it('whitespace-only transaction/statement keeps Submit disabled and posts nothing', async () => {
    wrap(<CasesPanel />);
    const fileBtn = await screen.findByRole('button', { name: /report problem/i });
    fireEvent.click(fileBtn);

    const tx = await screen.findByPlaceholderText(/tx_/i);
    const statement = screen.getByPlaceholderText(/what went wrong/i);
    fireEvent.change(tx, { target: { value: '   ' } });
    fireEvent.change(statement, { target: { value: '   ' } });

    const submit = screen.getByRole('button', { name: /submit dispute/i });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(apiPost).not.toHaveBeenCalled();
  });
});
