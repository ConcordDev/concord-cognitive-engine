import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// F3 — modal NAME fields ate typed input: the suite Modal's backdrop and
// panel carried Enter/Space keydown handlers that preventDefault()ed and
// programmatically clicked the div, so a keydown bubbling out of a
// focused name field closed the modal unsaved (typing a two-word name
// died at the space; pasting the same text never fired the handler and
// worked). These tests type the way the walk did — key-by-key — and pin
// that the modal now stays open and the typed name saves.

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

function renderSuite() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ContractorSuite />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockImplementation((_domain: string, action: string) => {
    if (action === 'pricebook-list') return ok({ items: [] });
    if (action === 'pricebook-save') return ok({ id: 'pb_new' });
    return ok({});
  });
});

describe('masonry modal typed input (F3)', () => {
  it('typing a name with spaces and Enter keydowns never closes the price-item modal', async () => {
    renderSuite();
    fireEvent.click(screen.getByRole('button', { name: /Price Book/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Add item/ }));
    expect(await screen.findByText('New price item')).toBeInTheDocument();

    // The modal's inputs render in field order: SKU, Name, Unit, Category, Unit cost.
    const inputs = document.querySelectorAll('input');
    const nameInput = inputs[1];
    // The walk's failing gesture: ordinary key-by-key typing, whose
    // Space and Enter keydowns bubble out of the focused field.
    fireEvent.keyDown(nameInput, { key: 'P' });
    fireEvent.keyDown(nameInput, { key: 'R' });
    fireEvent.keyDown(nameInput, { key: ' ' });
    fireEvent.keyDown(nameInput, { key: '4' });
    fireEvent.keyDown(nameInput, { key: 'Enter' });
    expect(screen.getByText('New price item')).toBeInTheDocument();

    fireEvent.change(nameInput, { target: { value: 'PR4 Test Brick' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('masonry', 'pricebook-save', expect.objectContaining({ name: 'PR4 Test Brick' })),
    );
  });
});
