/**
 * Beacon Health Checks render the server's hypothesis throughput line.
 * An empty engine is "no data yet", not a 100% pass.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    bridge: {
      beacon: () => Promise.resolve({
        data: {
          ok: true,
          healthy: true,
          checkedAt: '2026-10-11T08:14:00.000Z',
          checks: [
            {
              name: 'hypothesis_throughput',
              pass: true,
              noData: true,
              detail: 'no data yet',
            },
            {
              name: 'lattice_alive',
              pass: true,
              detail: 'DTU count: 3',
            },
          ],
        },
      }),
      info: () => Promise.resolve({ data: { bridges: [] } }),
      strategyHints: () => Promise.resolve({ data: { ok: false } }),
    },
    scope: { metrics: () => Promise.resolve({ data: null }) },
    hypothesis: { status: () => Promise.resolve({ data: null }) },
    metalearning: { status: () => Promise.resolve({ data: null }) },
  },
}));

vi.mock('@/components/brain/BrainHealthPanel', () => ({
  default: () => null,
}));

import NerveCenter from '@/components/platform/NerveCenter';

describe('NerveCenter beacon hypothesis throughput', () => {
  it('renders an empty hypothesis engine as no data, not 100%', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <NerveCenter />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('hypothesis throughput')).toBeTruthy();
    });

    const row = screen.getByText('hypothesis throughput').closest('[data-state]');
    expect(row).toBeTruthy();
    expect(row).toHaveAttribute('data-state', 'no-data');
    expect(row?.textContent).toContain('no data yet');
    expect(row?.textContent).not.toContain('100%');
    expect(row?.textContent).not.toContain('0/0');
    expect(screen.queryByText(/100%/)).toBeNull();

    const lattice = screen.getByText('lattice alive').closest('[data-state]');
    expect(lattice).toHaveAttribute('data-state', 'pass');
  });
});
