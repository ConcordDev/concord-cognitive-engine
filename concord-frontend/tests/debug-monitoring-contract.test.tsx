import { describe, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
get.mockResolvedValue({
  data: {
    ok: true,
    breachedCount: 0,
    generatedAt: '2026-10-07T12:00:00.000Z',
    slos: [
      {
        sloId: 'chat_response_latency',
        status: 'no_data',
        slo: {
          description: 'Chat response latency',
          targetMs: 3000,
          percentile: 95,
          errorBudgetPercent: 1,
          window: 'rolling_30d',
        },
      },
      {
        sloId: 'inference_availability',
        status: 'ok',
        samples: 12,
        successRate: '99.50%',
        targetMet: true,
        errorBudgetConsumed: 0,
        slo: {
          description: 'Inference request availability',
          targetRate: 0.99,
          errorBudgetPercent: 1,
          window: 'rolling_30d',
        },
      },
    ],
  },
});

vi.mock('@/lib/api/client', () => ({ api: { get } }));
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = (props: Record<string, unknown>) => <span data-testid={`icon-${name}`} {...props} />;
    return Icon;
  };
  return new Proxy(actual, {
    get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]),
  });
});

import { SLODashboard } from '@/components/debug/SLODashboard';

describe('Debug monitoring contract', () => {
  it('renders the live nested SLO server shape without a success-shaped fallback', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SLODashboard />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('chat response latency')).toBeInTheDocument();
    expect(screen.getByText('p95 < 3000ms')).toBeInTheDocument();
    expect(screen.getByText('inference availability')).toBeInTheDocument();
    expect(screen.getByText('99.50%')).toBeInTheDocument();
    expect(screen.getByText('12 samples')).toBeInTheDocument();
  });
});
