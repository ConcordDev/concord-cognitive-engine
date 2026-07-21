import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ConnectionStatus now reads its polling cadence from useClientConfig()
// (shell-diet: server-tunable poll interval, /api/config/client). Mocked to
// the hook's own baked defaults per the tests/link-shell.test.tsx precedent
// so the single `global.fetch` mock below stays scoped to the component's
// own /health check instead of also answering the config fetch.
vi.mock('@/hooks/useClientConfig', () => ({
  useClientConfig: () => ({ poll: { systemStatusMs: 30000, connectionStatusMs: 20000 } }),
}));

import { ConnectionStatus } from '@/components/common/ConnectionStatus';

describe('ConnectionStatus', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when online and not stale', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: {
        get: (key: string) => key === 'X-Concord-Stale' ? null : null,
      },
    });

    const { container } = render(<ConnectionStatus />);
    await waitFor(() => {
      expect(container.querySelector('.fixed')).toBeNull();
    });
  });

  it('shows offline banner when connection fails', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'));

    render(<ConnectionStatus />);
    await waitFor(() => {
      expect(screen.getByText(/Connection lost/i)).toBeInTheDocument();
    });
  });

  it('shows stale data banner when serving cached data', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      headers: {
        get: (key: string) => key === 'X-Concord-Stale' ? 'true' : null,
      },
    });

    render(<ConnectionStatus />);
    await waitFor(() => {
      expect(screen.getByText(/Showing cached data/i)).toBeInTheDocument();
    });
  });

  it('shows offline banner when response is not ok', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      headers: { get: () => null },
    });

    render(<ConnectionStatus />);
    await waitFor(() => {
      expect(screen.getByText(/Connection lost/i)).toBeInTheDocument();
    });
  });
});
