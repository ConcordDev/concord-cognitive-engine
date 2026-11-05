import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// F7 — the page header's stat cards lagged the suite's own writes until
// reload: the cards read three react-query keys and nothing ever
// invalidated them after a suite mutation. After a successful schedule
// write, the suite must invalidate the stat keys so the header settles
// in-session.

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/components/viz', () => ({
  TimelineView: () => null,
  ChartKit: () => null,
}));
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => React.createElement('img', props),
}));

import { ContractorSuite } from '@/components/masonry/ContractorSuite';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockImplementation((_domain: string, action: string) => {
    if (action === 'schedule-list') return ok({ jobs: [], crewLoad: {} });
    if (action === 'schedule-add') return ok({ id: 'sch_new' });
    return ok({});
  });
});

describe('masonry header stats settle in-session (F7)', () => {
  it('a successful schedule-add invalidates the header stat query keys', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    render(
      <QueryClientProvider client={queryClient}>
        <ContractorSuite />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Schedule$/ }));
    await screen.findByText('Schedule a job');
    // The form's labels are unassociated siblings, so select by field
    // order inside the form card: Job title, Start date, Duration, Crew,
    // Forecast low, Precip.
    const formCard = screen.getByText('Schedule a job').closest('div')!.parentElement!;
    const inputs = formCard.querySelectorAll('input');
    fireEvent.change(inputs[0], { target: { value: 'PR4 Job' } });
    fireEvent.change(inputs[1], { target: { value: '2026-11-10' } });
    fireEvent.click(screen.getByRole('button', { name: /Add to calendar/ }));

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['masonry-stats-schedule'] }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['masonry-stats-invoices'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['masonry-stats-proposals'] });
  });
});
