// Audit fix sweep (PR #2356) — FIX-history-003: Analysis Tools accepted
// an empty source and scored it 63/100 (the evaluator's defaults —
// primary type, no bias — with nothing actually named). Analyze now
// stays disabled with the reason shown until the source has a title.
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const runDomain = vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } }));
vi.mock('@/lib/api/client', () => ({
  apiHelpers: { lens: { runDomain: (...args: unknown[]) => runDomain(...(args as [])) } },
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));

import { TimelineSourceTools } from '@/components/history/TimelineSourceTools';

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(TimelineSourceTools)),
  );
}

describe('history Analysis Tools — an empty source is not scored', () => {
  it('disables Analyze with the reason until the source is named', () => {
    const view = mount();
    const analyze = view.getByRole('button', { name: /Analyze/ }) as HTMLButtonElement;
    expect(analyze.disabled).toBe(true);
    expect(view.getByText(/Name the source first/)).toBeTruthy();

    const titleLabel = view.getByText('Title').closest('label') as HTMLElement;
    const titleInput = titleLabel.querySelector('input') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Magna Carta (1215 engrossment)' } });

    expect(view.queryByText(/Name the source first/)).toBeNull();
    expect((view.getByRole('button', { name: /Analyze/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});
