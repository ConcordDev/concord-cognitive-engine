import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { ShareButton } from '@/components/social/ShareButton';
import { api } from '@/lib/api/client';

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

function withQuery(node: React.ReactElement, qc: QueryClient) {
  return React.createElement(QueryClientProvider, { client: qc }, node);
}

describe('ShareButton', () => {
  let qc: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    mockedApi.get.mockResolvedValue({ data: { ok: true, shares: [] } });
    mockedApi.post.mockResolvedValue({ data: { ok: true } });
  });
  afterEach(() => { cleanup(); qc.clear(); });

  it('hides itself when share count is 0 and hideWhenEmpty=true', async () => {
    const { container } = render(withQuery(
      React.createElement(ShareButton, { postId: 'p1', hideWhenEmpty: true }),
      qc,
    ));
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalled());
    expect(container.querySelector('button')).toBeNull();
  });

  it('renders when share count is non-zero', async () => {
    mockedApi.get.mockResolvedValue({ data: { ok: true, shares: [{ userId: 'u1', commentary: 'gold' }] } });
    const { container } = render(withQuery(
      React.createElement(ShareButton, { postId: 'p2' }),
      qc,
    ));
    await waitFor(() => expect(container.querySelector('button')).not.toBeNull());
  });

  it('fires POST /api/social/share when commentary submitted', async () => {
    mockedApi.get.mockResolvedValue({ data: { ok: true, shares: [{ userId: 'u1' }] } });
    const { container } = render(withQuery(
      React.createElement(ShareButton, { postId: 'p3' }),
      qc,
    ));
    const trigger = await waitFor(() => container.querySelector('button')!);
    fireEvent.click(trigger);
    // After opening, the composer reveals a textarea + submit
    await waitFor(() => expect(container.querySelector('textarea')).not.toBeNull());
    const ta = container.querySelector('textarea')!;
    fireEvent.change(ta, { target: { value: 'this is great' } });
    const submit = container.querySelectorAll('button')[1] as HTMLButtonElement;
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith('/api/social/share', expect.objectContaining({ postId: 'p3' })),
    );
  });
});
