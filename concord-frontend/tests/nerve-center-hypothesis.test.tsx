/**
 * Platform Nerve Center hypothesis panel.
 *
 * GET /api/hypothesis/status used to 500. The panel treated a thrown query as
 * "Not yet initialized" and, when a body arrived with ok:false or without
 * stats, rendered proposed/supported/refuted/inconclusive as 0. Those zeros
 * are only honest when the lifecycle engine actually returned them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const hypothesisStatus = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    bridge: {
      beacon: () => Promise.resolve({ data: { ok: false } }),
      info: () => Promise.resolve({ data: { bridges: [] } }),
      strategyHints: () => Promise.resolve({ data: { ok: false } }),
    },
    scope: { metrics: () => Promise.resolve({ data: null }) },
    hypothesis: { status: () => hypothesisStatus() },
    metalearning: { status: () => Promise.resolve({ data: null }) },
  },
}));

vi.mock('@/components/brain/BrainHealthPanel', () => ({
  default: () => null,
}));

import NerveCenter from '@/components/platform/NerveCenter';

function renderCenter() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NerveCenter />
    </QueryClientProvider>,
  );
}

function hypothesisCard() {
  const heading = screenHeading();
  const card = heading.parentElement;
  if (!card) throw new Error('hypothesis card missing');
  return within(card);
}

function screenHeading() {
  const { getByRole } = renderResult;
  return getByRole('heading', { name: 'Hypothesis Engine' });
}

let renderResult: ReturnType<typeof renderCenter>;

const LIVE_ZEROS = {
  data: {
    ok: true,
    total: 0,
    stats: { proposed: 0, supported: 0, refuted: 0, inconclusive: 0 },
  },
};

const LIVE_COUNTS = {
  data: {
    ok: true,
    total: 10,
    stats: { proposed: 3, supported: 1, refuted: 2, inconclusive: 4 },
  },
};

beforeEach(() => {
  hypothesisStatus.mockReset();
});

describe('NerveCenter hypothesis metrics', () => {
  it('shows an alert when status 500s, and does not paint zero counts', async () => {
    hypothesisStatus.mockRejectedValue({
      response: {
        status: 500,
        data: { ok: false, error: 'An unexpected error occurred', code: 'INTERNAL_ERROR' },
      },
      message: 'Request failed with status code 500',
    });
    renderResult = renderCenter();
    const card = hypothesisCard();
    await waitFor(() => {
      expect(card.getByRole('alert')).toHaveTextContent('Hypothesis metrics unavailable');
    });
    expect(card.queryByText('Proposed')).toBeNull();
    expect(card.queryByText('An unexpected error occurred')).toBeNull();
    expect(card.queryByText('Not yet initialized')).toBeNull();
  });

  it('names a specific engine error instead of hiding it', async () => {
    hypothesisStatus.mockRejectedValue({
      response: {
        status: 503,
        data: { ok: false, error: 'hypothesis_engine_unavailable', code: 'ENGINE_UNAVAILABLE' },
      },
    });
    renderResult = renderCenter();
    const card = hypothesisCard();
    await waitFor(() => {
      expect(card.getByRole('alert')).toHaveTextContent('hypothesis_engine_unavailable');
    });
    expect(card.queryByText('Proposed')).toBeNull();
  });

  it('treats an ok:false body as unavailable, not as zero counts', async () => {
    hypothesisStatus.mockResolvedValue({
      data: { ok: false, error: 'metrics_failed' },
    });
    renderResult = renderCenter();
    const card = hypothesisCard();
    await waitFor(() => {
      expect(card.getByRole('alert')).toHaveTextContent('metrics_failed');
    });
    expect(card.queryByText('Proposed')).toBeNull();
  });

  it('renders a real empty engine as zeros', async () => {
    hypothesisStatus.mockResolvedValue(LIVE_ZEROS);
    renderResult = renderCenter();
    const card = hypothesisCard();
    await waitFor(() => {
      expect(card.getByText('Proposed')).toBeTruthy();
    });
    expect(card.queryByRole('alert')).toBeNull();
    const rows = ['Proposed', 'Supported', 'Refuted', 'Inconclusive'];
    for (const label of rows) {
      const row = card.getByText(label).parentElement;
      expect(row?.textContent).toContain('0');
    }
  });

  it('renders the lifecycle counts the engine returned', async () => {
    hypothesisStatus.mockResolvedValue(LIVE_COUNTS);
    renderResult = renderCenter();
    const card = hypothesisCard();
    await waitFor(() => {
      expect(card.getByText('3')).toBeTruthy();
    });
    expect(card.getByText('Proposed').parentElement?.textContent).toContain('3');
    expect(card.getByText('Supported').parentElement?.textContent).toContain('1');
    expect(card.getByText('Refuted').parentElement?.textContent).toContain('2');
    expect(card.getByText('Inconclusive').parentElement?.textContent).toContain('4');
  });
});
