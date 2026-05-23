import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: React.PropsWithChildren<Record<string, unknown>>) =>
        React.createElement('button', props, props.children),
    },
  ),
}));
vi.mock('@/lib/api/client', () => ({ api: { get: vi.fn() } }));

import { TrendingTopics } from '@/components/social/TrendingTopics';
import { api } from '@/lib/api/client';

const mockedApi = api as unknown as { get: ReturnType<typeof vi.fn> };

function withQuery(node: React.ReactElement, qc: QueryClient) {
  return React.createElement(QueryClientProvider, { client: qc }, node);
}

describe('TrendingTopics', () => {
  let qc: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  });
  afterEach(() => {
    cleanup();
    qc.clear();
  });

  it('renders the empty state when no topics', async () => {
    mockedApi.get.mockResolvedValue({ data: { topics: [] } });
    render(withQuery(<TrendingTopics />, qc));
    expect(await screen.findByText('No trending topics yet')).toBeInTheDocument();
  });

  it('renders a list of topics with change indicators', async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        topics: [
          { tag: 'ai', count: 100, change: 'up' },
          { tag: 'rust', count: 50, change: 'down' },
          { tag: 'wasm', count: 25, change: 'stable' },
        ],
      },
    });
    render(withQuery(<TrendingTopics />, qc));
    expect(await screen.findByText('ai')).toBeInTheDocument();
    expect(screen.getByText('rust')).toBeInTheDocument();
    expect(screen.getByText('wasm')).toBeInTheDocument();
    expect(screen.getByText('Trending Topics')).toBeInTheDocument();
  });

  it('clicking a topic calls onTopicClick with the tag', async () => {
    const onTopic = vi.fn();
    mockedApi.get.mockResolvedValue({ data: { topics: [{ tag: 'graphql', count: 10 }] } });
    render(withQuery(<TrendingTopics onTopicClick={onTopic} />, qc));
    fireEvent.click(await screen.findByText('graphql'));
    expect(onTopic).toHaveBeenCalledWith('graphql');
  });

  it('handles missing topics field by showing empty state', async () => {
    mockedApi.get.mockResolvedValue({ data: {} });
    render(withQuery(<TrendingTopics />, qc));
    expect(await screen.findByText('No trending topics yet')).toBeInTheDocument();
  });

  it('eventually renders the AnimatedCounter post count', async () => {
    mockedApi.get.mockResolvedValue({ data: { topics: [{ tag: 'x', count: 5 }] } });
    render(withQuery(<TrendingTopics />, qc));
    await screen.findByText('x');
    await waitFor(() => expect(screen.getByText(/posts/)).toBeInTheDocument());
  });
});
