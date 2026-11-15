// Audit fix sweep (PR #2356) — FIX-lattice-002: the A/B candidate model
// tag validates charset + length before Start enables. '!!bad' (or a
// 300-char paste) used to enable Start with no feedback; now the field
// caps at 64, an invalid tag shows the format inline, and Start stays
// disabled until the tag is a valid model-tag slug.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { RefreshSchedule } from '@/components/lattice/RefreshSchedule';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('/api/brains/schedule')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ ok: true, canEdit: true, schedule: [] }) });
    }
    if (url.includes('/api/brains/ab-tests')) {
      return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve({ ok: true, tests: [] }) });
    }
    return Promise.reject(new Error('unexpected ' + url));
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(RefreshSchedule)),
  );
}

describe('lattice A/B candidate tag — validated before Start', () => {
  it('caps at 64, flags !!bad inline, and enables Start only for a valid tag', async () => {
    const view = mount();
    const input = await view.findByPlaceholderText('e.g. concord-conscious:v7') as HTMLInputElement;
    const start = view.getByRole('button', { name: /Start A\/B test/ }) as HTMLButtonElement;
    expect(input.maxLength).toBe(64);
    expect(start.disabled).toBe(true);

    fireEvent.change(input, { target: { value: '!!bad' } });
    const alert = await view.findByRole('alert');
    expect(alert.textContent).toContain('Tags are 1–64 characters');
    expect(start.disabled).toBe(true);

    fireEvent.change(input, { target: { value: 'concord-conscious:v7' } });
    expect(view.queryByRole('alert')).toBeNull();
    expect((view.getByRole('button', { name: /Start A\/B test/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});
