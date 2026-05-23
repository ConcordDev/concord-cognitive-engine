import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: React.PropsWithChildren<Record<string, unknown>>) =>
        React.createElement('span', props, props.children),
    },
  ),
  AnimatePresence: ({ children }: React.PropsWithChildren) =>
    React.createElement(React.Fragment, null, children),
}));
vi.mock('@/lib/api/client', () => ({ api: { get: vi.fn() } }));

import { StreakIndicator } from '@/components/social/StreakIndicator';
import { api } from '@/lib/api/client';

const mockedApi = api as unknown as { get: ReturnType<typeof vi.fn> };

function withQuery(node: React.ReactElement, qc: QueryClient) {
  return React.createElement(QueryClientProvider, { client: qc }, node);
}

describe('StreakIndicator', () => {
  let qc: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  });
  afterEach(() => {
    cleanup();
    qc.clear();
  });

  it('renders nothing when currentStreak is 0', async () => {
    mockedApi.get.mockResolvedValue({ data: { currentStreak: 0, longestStreak: 0, lastPostDate: '' } });
    const { container } = render(withQuery(<StreakIndicator userId="u1" />, qc));
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalled());
    expect(container.textContent).not.toMatch(/day streak/);
  });

  it('renders a non-milestone streak (3 days, no badge)', async () => {
    mockedApi.get.mockResolvedValue({ data: { currentStreak: 3, longestStreak: 5, lastPostDate: '' } });
    render(withQuery(<StreakIndicator userId="u2" />, qc));
    expect(await screen.findByText(/3 day streak/)).toBeInTheDocument();
    expect(screen.queryByText('Getting Started')).toBeNull();
  });

  it('renders the "Getting Started" badge at 7-day milestone', async () => {
    mockedApi.get.mockResolvedValue({ data: { currentStreak: 7, longestStreak: 7, lastPostDate: '' } });
    render(withQuery(<StreakIndicator userId="u3" />, qc));
    expect(await screen.findByText('Getting Started')).toBeInTheDocument();
  });

  it('renders the "Dedicated" badge at 30-day milestone', async () => {
    mockedApi.get.mockResolvedValue({ data: { currentStreak: 30, longestStreak: 30, lastPostDate: '' } });
    render(withQuery(<StreakIndicator userId="u4" />, qc));
    expect(await screen.findByText('Dedicated')).toBeInTheDocument();
  });

  it('renders the "Legendary" badge at 365-day milestone', async () => {
    mockedApi.get.mockResolvedValue({ data: { currentStreak: 365, longestStreak: 365, lastPostDate: '' } });
    render(withQuery(<StreakIndicator userId="u5" />, qc));
    expect(await screen.findByText('Legendary')).toBeInTheDocument();
  });

  it('does not fetch when userId is empty (query disabled)', async () => {
    render(withQuery(<StreakIndicator userId="" />, qc));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockedApi.get).not.toHaveBeenCalled();
  });
});
