import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
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
vi.mock('@/lib/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('@/lib/realtime/socket', () => ({
  getSocket: vi.fn(() => null),
  subscribe: vi.fn(() => () => {}),
}));

import { NotificationBell } from '@/components/social/NotificationBell';
import { api } from '@/lib/api/client';

const mockedApi = api as unknown as { get: ReturnType<typeof vi.fn> };

function withQuery(node: React.ReactElement, qc: QueryClient) {
  return React.createElement(QueryClientProvider, { client: qc }, node);
}

describe('NotificationBell', () => {
  let qc: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    mockedApi.get.mockResolvedValue({ data: { count: 0, notifications: [] } });
  });
  afterEach(() => {
    cleanup();
    qc.clear();
  });

  it('renders the bell button', () => {
    render(withQuery(<NotificationBell />, qc));
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('shows the unread badge when count > 0', async () => {
    mockedApi.get.mockResolvedValue({ data: { count: 4 } });
    render(withQuery(<NotificationBell userId="u1" />, qc));
    expect(await screen.findByText('4')).toBeInTheDocument();
  });

  it('caps the badge at 99+', async () => {
    mockedApi.get.mockResolvedValue({ data: { count: 250 } });
    render(withQuery(<NotificationBell userId="u2" />, qc));
    expect(await screen.findByText('99+')).toBeInTheDocument();
  });

  it('toggles aria-expanded when clicked', () => {
    render(withQuery(<NotificationBell userId="u3" />, qc));
    const btn = screen.getByRole('button', { name: /notifications/i });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('falls back to the notifications list when count endpoint fails', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url.includes('count')) return Promise.reject(new Error('no count'));
      return Promise.resolve({ data: { notifications: [{ id: 'n1' }, { id: 'n2' }] } });
    });
    render(withQuery(<NotificationBell userId="u4" />, qc));
    expect(await screen.findByText('2')).toBeInTheDocument();
  });

  it('does not fetch when userId absent (query disabled)', async () => {
    render(withQuery(<NotificationBell />, qc));
    await new Promise((r) => setTimeout(r, 50));
    expect(mockedApi.get).not.toHaveBeenCalled();
  });
});
