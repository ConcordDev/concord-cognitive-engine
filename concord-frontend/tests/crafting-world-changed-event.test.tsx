/**
 * The bench is the signed-in user's recipe list, not a per-world header.
 * Changing worlds must not refetch it, and the page must not call the
 * character endpoint the old stats header used.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import React from 'react';

const apiGet = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args), post: vi.fn() },
  lensRun: vi.fn(),
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import CraftingPage from '@/app/lenses/crafting/page';
import { ACTIVE_WORLD_CHANGED_EVENT } from '@/hooks/useActiveWorldId';

function recipeCalls() {
  return apiGet.mock.calls.filter((call) => call[0] === '/api/crafting/recipes').length;
}

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockImplementation((url: string) => {
    if (url === '/api/auth/me') {
      return Promise.resolve({ data: { ok: true, user: { id: 'u', username: 'ramaj', email: 'r@example.com', role: 'user' } } });
    }
    if (url === '/api/crafting/recipes') return Promise.resolve({ data: { ok: true, recipes: [] } });
    return Promise.resolve({ data: {} });
  });
});

describe('crafting bench ignores world-change events', () => {
  it('loads recipes once and does not reload when the active world changes', async () => {
    const { getByText } = render(<CraftingPage />);
    await waitFor(() => expect(getByText('The bench is clear.')).toBeInTheDocument());
    expect(recipeCalls()).toBe(1);
    expect(apiGet.mock.calls.some((call) => String(call[0]).includes('/api/crafting/character/'))).toBe(false);

    act(() => {
      window.dispatchEvent(new CustomEvent(ACTIVE_WORLD_CHANGED_EVENT, { detail: { worldId: 'tunya' } }));
      window.dispatchEvent(new CustomEvent('concordia:world-changed', { detail: { worldId: 'tunya' } }));
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(recipeCalls()).toBe(1);
  });
});
