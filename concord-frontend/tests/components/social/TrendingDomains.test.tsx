import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: React.PropsWithChildren<Record<string, unknown>>) =>
        React.createElement('div', props, props.children),
    },
  ),
}));
vi.mock('@/lib/api/client', () => ({ api: { get: vi.fn() } }));

import { TrendingDomains } from '@/components/social/TrendingDomains';
import { api } from '@/lib/api/client';

const mockedApi = api as unknown as { get: ReturnType<typeof vi.fn> };

function withQuery(node: React.ReactElement, qc: QueryClient) {
  return React.createElement(QueryClientProvider, { client: qc }, node);
}

describe('TrendingDomains', () => {
  let qc: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  });
  afterEach(() => {
    cleanup();
    qc.clear();
  });

  it('renders nothing when there are no domains', async () => {
    mockedApi.get.mockResolvedValue({ data: { domains: [] } });
    const { container } = render(withQuery(<TrendingDomains />, qc));
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalled());
    expect(container.textContent).not.toMatch(/Trending by Domain/);
  });

  it('renders domains with top posts and engagement', async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        domains: [
          {
            domain: 'science',
            score: 9,
            topPosts: [
              {
                id: 'p1',
                title: 'Quantum leap',
                createdAt: '2026-05-01',
                engagement: { views: 100, likes: 20, comments: 5 },
              },
            ],
          },
        ],
      },
    });
    render(withQuery(<TrendingDomains />, qc));
    expect(await screen.findByText('Trending by Domain')).toBeInTheDocument();
    expect(screen.getByText('science')).toBeInTheDocument();
    expect(screen.getByText('Quantum leap')).toBeInTheDocument();
  });

  it('renders the "No posts yet" placeholder when a domain has no posts', async () => {
    mockedApi.get.mockResolvedValue({
      data: { domains: [{ domain: 'art', score: 3, topPosts: [] }] },
    });
    render(withQuery(<TrendingDomains />, qc));
    expect(await screen.findByText('No posts yet')).toBeInTheDocument();
  });

  it('renders "Untitled" when a post has no title', async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        domains: [
          { domain: 'tech', score: 1, topPosts: [{ id: 'p2', title: '', createdAt: '2026-05-02' }] },
        ],
      },
    });
    render(withQuery(<TrendingDomains />, qc));
    expect(await screen.findByText('Untitled')).toBeInTheDocument();
  });
});
