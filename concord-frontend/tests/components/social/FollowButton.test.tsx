import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { FollowButton } from '@/components/social/FollowButton';
import { api } from '@/lib/api/client';

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

function withQuery(node: React.ReactElement, qc: QueryClient) {
  return React.createElement(QueryClientProvider, { client: qc }, node);
}

describe('FollowButton', () => {
  let qc: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    mockedApi.get.mockResolvedValue({ data: { ok: true, following: [] } });
    mockedApi.post.mockResolvedValue({ data: { ok: true } });
  });
  afterEach(() => { cleanup(); qc.clear(); });

  it('hides when targetUserId === currentUserId (self)', () => {
    const { container } = render(withQuery(
      React.createElement(FollowButton, { targetUserId: 'u1', currentUserId: 'u1' }),
      qc,
    ));
    expect(container.querySelector('button')).toBeNull();
  });

  it('hides when currentUserId is missing (anonymous viewer)', () => {
    const { container } = render(withQuery(
      React.createElement(FollowButton, { targetUserId: 'u1' }),
      qc,
    ));
    expect(container.querySelector('button')).toBeNull();
  });

  it('renders Follow when not in the following list', async () => {
    const { container } = render(withQuery(
      React.createElement(FollowButton, { targetUserId: 'u-target', currentUserId: 'u-viewer' }),
      qc,
    ));
    await waitFor(() => expect(container.querySelector('button[aria-pressed="false"]')).not.toBeNull(), { timeout: 3000 });
    expect(container.textContent).toMatch(/Follow/);
  });

  it('renders Following when target is in the following list', async () => {
    mockedApi.get.mockResolvedValue({ data: { ok: true, following: [{ userId: 'u-target' }] } });
    const { container } = render(withQuery(
      React.createElement(FollowButton, { targetUserId: 'u-target', currentUserId: 'u-viewer' }),
      qc,
    ));
    await waitFor(() => expect(container.querySelector('button[aria-pressed="true"]')).not.toBeNull(), { timeout: 3000 });
    expect(container.textContent).toMatch(/Following/);
  });
});
