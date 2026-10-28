/// <reference types="@testing-library/jest-dom/vitest" />
// MonitoringPanel: Run Migrations / Sync to PostgreSQL are admin-only on
// the server (/api/db/migrate, /api/db/sync -> 403 for non-admins). The UI
// must not render them for non-admins at all — a member's click used to
// surface a misleading "session expired" toast for what was really a 403.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    get: (...a: unknown[]) => apiGet(...a),
    post: (...a: unknown[]) => apiPost(...a),
  },
}));

let role = 'member';
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'tester', email: 'tester@test.local', role },
    isLoading: false,
    isAuthenticated: true,
    logout: async () => {},
    refresh: async () => {},
  }),
}));

import { MonitoringPanel } from './MonitoringPanel';

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MonitoringPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiGet.mockImplementation((url: string) => {
    if (url === '/api/db/status') return Promise.resolve({ data: { postgres: { connected: true } } });
    return Promise.resolve({ data: {} });
  });
  apiPost.mockResolvedValue({ data: {} });
});

describe('MonitoringPanel database actions', () => {
  it('role member: buttons absent, admin-only line shown, no POST made', async () => {
    role = 'member';
    renderPanel();
    expect(await screen.findByText('Migrations and sync are admin-only.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /run migrations/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /sync to postgresql/i })).toBeNull();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('role admin: both buttons are present', async () => {
    role = 'admin';
    renderPanel();
    expect(await screen.findByRole('button', { name: /run migrations/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sync to postgresql/i })).toBeInTheDocument();
    expect(screen.queryByText('Migrations and sync are admin-only.')).toBeNull();
  });
});
