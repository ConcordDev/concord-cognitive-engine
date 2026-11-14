/**
 * FIX-lock-006 — the Lock Security tab's GitHub pull showed the terminal
 * 'github unavailable' banner with no way back. Pin: the banner carries a
 * Retry control that refetches (same shape as FIX-schema-005/temporal-003).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const runMock = vi.fn(async () => ({ data: { ok: false, error: 'github_unavailable' } }));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => runMock(...args),
  api: { post: vi.fn(async () => { throw new Error('unused'); }) },
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));

import { SecurityRepos } from '@/components/lock/SecurityRepos';

describe('FIX-lock-006 SecurityRepos retry', () => {
  beforeEach(() => runMock.mockClear());
  it('error banner offers Retry and refetches on click', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><SecurityRepos /></QueryClientProvider>);
    const btn = await screen.findByRole('button', { name: 'Retry' });
    const before = runMock.mock.calls.length;
    fireEvent.click(btn);
    await vi.waitFor(() => expect(runMock.mock.calls.length).toBeGreaterThan(before));
  });
});
