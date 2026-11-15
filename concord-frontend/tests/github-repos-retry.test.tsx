/**
 * FIX-schema-005 + FIX-temporal-003 — the GitHub-pull error banner in the
 * Schema Tooling tab and the Temporal Repos tab was terminal: no retry, so a
 * transient or rate-limited failure stranded the tab. Pin: the banner
 * carries a Retry control that refetches.
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

import { SchemaRepos } from '@/components/schema/SchemaRepos';
import { TemporalRepos } from '@/components/temporal/TemporalRepos';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('GitHub repos error banner retry', () => {
  beforeEach(() => runMock.mockClear());
  it('schema-005: SchemaRepos offers Retry and refetches on click', async () => {
    wrap(<SchemaRepos />);
    const btn = await screen.findByRole('button', { name: 'Retry' });
    const before = runMock.mock.calls.length;
    fireEvent.click(btn);
    await vi.waitFor(() => expect(runMock.mock.calls.length).toBeGreaterThan(before));
  });
  it('temporal-003: TemporalRepos offers Retry and refetches on click', async () => {
    wrap(<TemporalRepos />);
    const btn = await screen.findByRole('button', { name: 'Retry' });
    const before = runMock.mock.calls.length;
    fireEvent.click(btn);
    await vi.waitFor(() => expect(runMock.mock.calls.length).toBeGreaterThan(before));
  });
});
