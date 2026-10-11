/**
 * CasesPanel — GET /api/disputes/queue must not fire for a non-admin.
 *
 * The route is adminOnly (economy/guards.js#requireAdmin): role
 * admin / owner / founder, or scopes "*" / "economy:admin". A signed-in
 * member used to request it on every /lenses/disputes load and the browser
 * logged the 403. This pins that a viewer the server would refuse never
 * issues the read and never sees a queue section, and that an allowed
 * viewer still loads and renders the queue.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

interface AuthUser {
  id: string;
  username: string;
  email: string;
  role: string;
  scopes?: string[];
}

const authState = vi.hoisted(() => ({
  user: null as AuthUser | null,
  isLoading: true,
}));

const apiGet = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: authState.user,
    isLoading: authState.isLoading,
    isAuthenticated: authState.user !== null,
    logout: async () => {},
    refresh: async () => {},
  }),
}));

vi.mock('@/lib/api/client', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ items: [], isLoading: false }),
}));

vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { CasesPanel } from '@/components/disputes/CasesPanel';

const MY_DISPUTE = {
  id: 'dsp-mine-1',
  dispute_type: 'quality',
  reporter_id: 'u1',
  reported_user_id: 'seller-1',
  reported_content_id: 'tx-1',
  description: 'Item was damaged',
  evidence: [],
  status: 'open',
  resolution: null,
  opened_at: '2026-10-01T12:00:00.000Z',
  resolved_at: null,
  userRole: 'buyer',
  canRespond: false,
};

const QUEUE_DISPUTE = {
  id: 'dsp-queue-77',
  dispute_type: 'non_delivery',
  reporter_id: 'buyer-9',
  reported_user_id: 'seller-9',
  reported_content_id: 'tx-9',
  description: 'Package never arrived',
  evidence: [],
  status: 'escalated',
  resolution: null,
  opened_at: '2026-10-02T12:00:00.000Z',
  resolved_at: null,
};

function user(role: string, scopes?: string[]): AuthUser {
  return { id: 'u1', username: 'tester', email: 'tester@test.local', role, scopes };
}

function callsTo(path: string): unknown[][] {
  return apiGet.mock.calls.filter((call) => String(call[0]) === path);
}

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <CasesPanel />
    </QueryClientProvider>,
  );
  return {
    ...view,
    rerenderPanel() {
      view.rerender(
        <QueryClientProvider client={client}>
          <CasesPanel />
        </QueryClientProvider>,
      );
    },
  };
}

beforeEach(() => {
  authState.user = null;
  authState.isLoading = true;
  apiGet.mockReset();
  apiGet.mockImplementation(async (url: string) => {
    if (url === '/api/disputes/queue') {
      return { data: { ok: true, queue: [QUEUE_DISPUTE], total: 1 } };
    }
    if (url === '/api/disputes/my') {
      return { data: { ok: true, disputes: [MY_DISPUTE], total: 1 } };
    }
    return { data: { ok: true } };
  });
});

afterEach(() => {
  cleanup();
});

describe('disputes CasesPanel — skip the admin queue without the server role', () => {
  it('does not request the queue while auth is still resolving', async () => {
    const view = mount();
    await waitFor(() => expect(callsTo('/api/disputes/my').length).toBeGreaterThan(0));
    expect(callsTo('/api/disputes/queue')).toEqual([]);
    expect(view.queryByRole('button', { name: /Admin Queue/i })).toBeNull();
    expect(view.queryByText(/admin queue/i)).toBeNull();
    expect(view.queryByRole('alert')).toBeNull();
  });

  it('a non-admin sees their cases and never requests or renders the queue', async () => {
    authState.isLoading = false;
    authState.user = user('member');
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/api/disputes/queue') {
        return Promise.reject(new Error('queue must not be requested'));
      }
      if (url === '/api/disputes/my') {
        return { data: { ok: true, disputes: [], total: 0 } };
      }
      return { data: { ok: true } };
    });
    const view = mount();
    expect(await view.findByText(/No disputes found/i)).toBeInTheDocument();
    expect(view.getByRole('button', { name: /My Disputes/i })).toBeInTheDocument();
    expect(view.getByRole('button', { name: /Report Problem/i })).toBeInTheDocument();
    expect(view.queryByRole('button', { name: /Admin Queue/i })).toBeNull();
    expect(view.queryByText(/No disputes in the admin queue/i)).toBeNull();
    expect(view.queryByText(/could not be loaded/i)).toBeNull();
    expect(view.queryByRole('alert')).toBeNull();
    expect(view.queryByText('dsp-queue-77')).toBeNull();
    await waitFor(() => expect(callsTo('/api/disputes/my').length).toBeGreaterThan(0));
    expect(callsTo('/api/disputes/queue')).toEqual([]);
  });

  it.each(['user', 'moderator', 'operator', 'sovereign'])(
    'does not request the queue for server-denied role %s',
    async (role) => {
      authState.isLoading = false;
      authState.user = user(role, ['admin', 'operator']);
      const view = mount();
      await waitFor(() => expect(callsTo('/api/disputes/my').length).toBeGreaterThan(0));
      expect(callsTo('/api/disputes/queue'), role).toEqual([]);
      expect(view.queryByRole('button', { name: /Admin Queue/i })).toBeNull();
    },
  );

  it('requests the queue for an admin and renders the returned case', async () => {
    authState.isLoading = false;
    authState.user = user('admin');
    const view = mount();
    await waitFor(() => expect(callsTo('/api/disputes/queue').length).toBeGreaterThan(0));
    expect(callsTo('/api/disputes/queue')[0][0]).toBe('/api/disputes/queue');
    expect(await view.findByText('dsp-mine-1')).toBeInTheDocument();
    expect(view.queryByText('dsp-queue-77')).toBeNull();

    fireEvent.click(view.getByRole('button', { name: /Admin Queue/i }));
    expect(await view.findByText('dsp-queue-77')).toBeInTheDocument();
    expect(view.getByText('Non-Delivery')).toBeInTheDocument();
    expect(view.queryByText('dsp-mine-1')).toBeNull();
    expect(view.queryByText(/could not be loaded/i)).toBeNull();
  });

  it.each(['owner', 'founder'])('requests and renders the queue for role %s', async (role) => {
    authState.isLoading = false;
    authState.user = user(role);
    const view = mount();
    await waitFor(() => expect(callsTo('/api/disputes/queue').length).toBeGreaterThan(0));
    fireEvent.click(view.getByRole('button', { name: /Admin Queue/i }));
    expect(await view.findByText('dsp-queue-77')).toBeInTheDocument();
  });

  it.each(['*', 'economy:admin'])('requests the queue when scopes include %s', async (scope) => {
    authState.isLoading = false;
    authState.user = user('member', [scope]);
    const view = mount();
    await waitFor(() => expect(callsTo('/api/disputes/queue').length).toBeGreaterThan(0));
    fireEvent.click(view.getByRole('button', { name: /Admin Queue/i }));
    expect(await view.findByText('dsp-queue-77')).toBeInTheDocument();
  });

  it('starts the queue read only after auth resolves to an admin', async () => {
    const view = mount();
    await waitFor(() => expect(callsTo('/api/disputes/my').length).toBeGreaterThan(0));
    expect(callsTo('/api/disputes/queue')).toEqual([]);
    expect(view.queryByRole('button', { name: /Admin Queue/i })).toBeNull();

    authState.isLoading = false;
    authState.user = user('admin');
    view.rerenderPanel();
    await waitFor(() => expect(callsTo('/api/disputes/queue').length).toBeGreaterThan(0));
    fireEvent.click(view.getByRole('button', { name: /Admin Queue/i }));
    expect(await view.findByText('dsp-queue-77')).toBeInTheDocument();
  });
});
