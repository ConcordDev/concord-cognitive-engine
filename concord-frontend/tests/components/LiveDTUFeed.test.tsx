import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const paginated = vi.fn();
const subscribe = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: { dtus: { paginated: (...args: unknown[]) => paginated(...args) } },
}));

vi.mock('@/lib/realtime/socket', () => ({
  connectSocket: vi.fn(),
  subscribe: (...args: unknown[]) => subscribe(...args),
}));

import { LiveDTUFeed } from '@/components/live/LiveDTUFeed';

describe('LiveDTUFeed', () => {
  it('uses persisted createdAt and does not reset to just now', async () => {
    paginated.mockResolvedValue({
      data: {
        dtus: [{
          id: 'live-1',
          title: 'Persisted',
          summary: 's',
          tier: 'regular',
          tags: ['a', 'b', 'c', 'd'],
          type: 'dream',
          createdAt: '2020-01-02T03:04:05.000Z',
        }],
      },
    });
    subscribe.mockImplementation((_event: string, _cb: (data: Record<string, unknown>) => void) => () => {});
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <LiveDTUFeed limit={5} onDtuClick={() => {}} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Persisted')).toBeTruthy();
    const clock = screen.getByTitle(new Date('2020-01-02T03:04:05.000Z').toLocaleString());
    expect(clock.textContent).not.toBe('just now');
    expect(clock.textContent).not.toBe('');
  });

  it('appends a socket event using createdAt', async () => {
    paginated.mockResolvedValue({ data: { dtus: [] } });
    let handler: ((data: Record<string, unknown>) => void) | null = null;
    subscribe.mockImplementation((_event: string, cb: (data: Record<string, unknown>) => void) => {
      handler = cb;
      return () => {};
    });
    const onClick = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <LiveDTUFeed onDtuClick={onClick} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(handler).toBeTruthy());
    handler!({ id: 'sock-1', title: 'Socket note', createdAt: '2019-05-01T00:00:00.000Z', tier: 'mega', tags: ['z'] });
    expect(await screen.findByText('Socket note')).toBeTruthy();
    fireEvent.click(screen.getByText('Socket note'));
    expect(onClick).toHaveBeenCalledWith('sock-1');
  });
});
