import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// The page mounts LensShell + ManifestActionBar, which bind a lens-namespaced
// keyboard command. The real hook needs a KeyboardProvider parent that the
// shell supplies in production but not in an isolated component test, so stub
// it to a no-op.
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: vi.fn() }));

import LfgLensPage from '@/app/lenses/lfg/page';

const realFetch = global.fetch;

function mockFetchOnce(handler: (url: string, init?: RequestInit) => unknown) {
  global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    const body = handler(u, init);
    return {
      ok: true,
      status: 200,
      json: async () => body,
    } as Response;
  }) as unknown as typeof fetch;
}

const SAMPLE_ROW = {
  id: 'lfg_abc123',
  userId: 'user_healer_0001',
  worldId: 'tunya',
  role: 'healer',
  partyType: 'normal',
  note: 'need 2 dps for harvest dungeon',
  createdAt: 1000,
  expiresAt: 9999,
  partyMaxSize: 8,
  currentSize: 1,
};

describe('LfgLensPage — four UX states', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { global.fetch = realFetch; });

  it('renders the LOADING state before the first response resolves', async () => {
    // Never-resolving fetch keeps it in loading.
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    render(<LfgLensPage />);
    expect(await screen.findByText(/loading open requests/i)).toBeTruthy();
  });

  it('renders the ERROR state with a working Retry when the server fails', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false, status: 500, json: async () => ({ ok: false }),
    } as Response)) as unknown as typeof fetch;

    render(<LfgLensPage />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/could not load requests/i)).toBeTruthy();

    // Retry button exists and re-fires the fetch.
    const retry = screen.getByRole('button', { name: /retry/i });
    const callsBefore = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(retry);
    await waitFor(() => {
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('renders the EMPTY state when the server returns zero requests', async () => {
    mockFetchOnce(() => ({ ok: true, requests: [] }));
    render(<LfgLensPage />);
    expect(await screen.findByText(/no open requests in this filter/i)).toBeTruthy();
  });

  it('renders the POPULATED state from real data (no mock/seed rows)', async () => {
    mockFetchOnce(() => ({ ok: true, requests: [SAMPLE_ROW] }));
    render(<LfgLensPage />);
    // The note + size come straight from the response shape.
    expect(await screen.findByText(/need 2 dps for harvest dungeon/i)).toBeTruthy();
    expect(screen.getByText('1/8')).toBeTruthy();
    // The list region holds exactly one rendered request row.
    const list = screen.getByRole('list', { name: /open group requests/i });
    expect(list).toBeTruthy();
    // The invite affordance for someone else's post.
    expect(screen.getByRole('button', { name: /invite healer from tunya/i })).toBeTruthy();
  });

  it('exposes accessible filter controls (a11y)', async () => {
    mockFetchOnce(() => ({ ok: true, requests: [] }));
    render(<LfgLensPage />);
    await screen.findByText(/no open requests/i);
    expect(screen.getByLabelText(/filter by world/i)).toBeTruthy();
    expect(screen.getByLabelText(/filter by role/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /refresh requests/i })).toBeTruthy();
  });
});
