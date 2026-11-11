import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const auth = vi.hoisted(() => ({ user: null as { role?: string } | null, isLoading: false }));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: auth.user, isLoading: auth.isLoading, isAuthenticated: !!auth.user, logout: async () => {}, refresh: async () => {} }),
}));
vi.mock('@/components/lattice/latticeShared', () => ({
  fetchJSON: vi.fn(async () => ({ ok: true })),
}));

import { RefreshPanel } from '../RefreshPanel';

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RefreshPanel />
    </QueryClientProvider>,
  );
}

describe('RefreshPanel role gate', () => {
  it('leaves manual refresh off for a signed-in member', () => {
    auth.user = { role: 'member' };
    auth.isLoading = false;
    renderPanel();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
    for (const button of buttons) expect(button).toBeDisabled();
    expect(screen.getByText(/stays off until you are signed in as an owner/i)).toBeTruthy();
  });

  it('enables refresh for an admin', () => {
    auth.user = { role: 'admin' };
    auth.isLoading = false;
    renderPanel();
    for (const button of screen.getAllByRole('button')) expect(button).not.toBeDisabled();
    expect(screen.queryByText(/stays off until you are signed in as an owner/i)).toBeNull();
  });

  it('stays off while the session is still loading', () => {
    auth.user = { role: 'owner' };
    auth.isLoading = true;
    renderPanel();
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    expect(screen.queryByText(/stays off until you are signed in as an owner/i)).toBeNull();
  });
});
