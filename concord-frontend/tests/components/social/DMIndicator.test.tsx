import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
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
vi.mock('@/lib/realtime/socket', () => ({
  getSocket: vi.fn(() => null),
  subscribe: vi.fn(() => () => {}),
}));

import { DMIndicator } from '@/components/social/DMIndicator';
import { api } from '@/lib/api/client';

const mockedApi = api as unknown as { get: ReturnType<typeof vi.fn> };

function withQuery(node: React.ReactElement, qc: QueryClient) {
  return React.createElement(QueryClientProvider, { client: qc }, node);
}

describe('DMIndicator', () => {
  let qc: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  });
  afterEach(() => {
    cleanup();
    qc.clear();
  });

  it('renders a button with no badge when userId absent', () => {
    const { container } = render(withQuery(<DMIndicator />, qc));
    expect(container.querySelector('button')).not.toBeNull();
    expect(container.textContent).not.toMatch(/\d/);
  });

  it('navigates to /messages on click', () => {
    render(withQuery(<DMIndicator />, qc));
    fireEvent.click(screen.getByRole('button'));
    expect(push).toHaveBeenCalledWith('/messages');
  });

  it('shows the unread badge from unreadCount fields', async () => {
    mockedApi.get.mockResolvedValue({
      data: { conversations: [{ id: 'c1', unreadCount: 2 }, { id: 'c2', unreadCount: 1 }] },
    });
    render(withQuery(<DMIndicator userId="u1" />, qc));
    expect(await screen.findByText('3')).toBeInTheDocument();
  });

  it('counts hasUnread as 1 when unreadCount missing', async () => {
    mockedApi.get.mockResolvedValue({
      data: { conversations: [{ id: 'c1', hasUnread: true }, { id: 'c2' }] },
    });
    render(withQuery(<DMIndicator userId="u2" />, qc));
    expect(await screen.findByText('1')).toBeInTheDocument();
  });

  it('caps the badge at 99+', async () => {
    const convos = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, unreadCount: 30 }));
    mockedApi.get.mockResolvedValue({ data: { conversations: convos } });
    render(withQuery(<DMIndicator userId="u3" />, qc));
    expect(await screen.findByText('99+')).toBeInTheDocument();
  });

  it('shows no badge when the fetch fails (count falls back to 0)', async () => {
    mockedApi.get.mockRejectedValue(new Error('down'));
    const { container } = render(withQuery(<DMIndicator userId="u4" />, qc));
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalled());
    expect(container.textContent).not.toMatch(/[1-9]/);
  });
});
