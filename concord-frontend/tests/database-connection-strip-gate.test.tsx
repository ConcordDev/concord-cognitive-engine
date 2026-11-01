import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const getMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { get: (...a: unknown[]) => getMock(...a) } }));
let role = 'member';
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', role } }) }));

import { ConnectionStrip } from '@/components/database/ConnectionStrip';

const wrap = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ConnectionStrip />
  </QueryClientProvider>,
);

describe('Database ConnectionStrip: admin-only status calls', () => {
  beforeEach(() => { getMock.mockReset(); cleanup(); });

  it('a member opening the lens fires no admin-only calls and sees a quiet admin-only note', async () => {
    role = 'member';
    wrap();
    expect(screen.getByTestId('db-status-admin-only')).toBeInTheDocument();
    expect(screen.queryByText('Disconnected')).not.toBeInTheDocument(); // no claims about state nobody read
    await new Promise((r) => setTimeout(r, 30));
    expect(getMock).not.toHaveBeenCalled();
  });

  it('an admin still gets the status cards from /api/db/status and /api/redis/stats', async () => {
    role = 'admin';
    getMock.mockImplementation((url: string) => Promise.resolve({
      data: url === '/api/db/status' ? { mode: 'postgresql', postgres: { connected: true, enabled: true } } : { enabled: true, keys: 3 },
    }));
    wrap();
    // PostgreSQL and Redis each read "Connected"
    await waitFor(() => expect(screen.getAllByText('Connected').length).toBe(2));
    expect(getMock).toHaveBeenCalledWith('/api/db/status');
    expect(getMock).toHaveBeenCalledWith('/api/redis/stats');
  });
});
