/**
 * Trending Topics must not render a non-string tag as "[object Object]".
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args) },
}));

import { TrendingTopics } from '@/components/social/TrendingTopics';

function renderTopics() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TrendingTopics />
    </QueryClientProvider>,
  );
}

describe('TrendingTopics tag normalization', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/api/social/topics/trending') {
        return {
          data: {
            ok: true,
            topics: [
              { tag: 'concord', count: 120 },
              { tag: '[object Object]', count: 90 },
              { tag: '[object object]', count: 84 },
              { tag: '  [OBJECT OBJECT]  ', count: 3 },
              { tag: { name: 'kept-topic' }, count: 4 },
              { tag: { label: '[object object]' }, count: 1 },
              { tag: { unexpected: true }, count: 2 },
            ],
          },
        };
      }
      return { data: {} };
    });
  });

  it('renders real labels and drops [object Object] in any letter case', async () => {
    renderTopics();
    await waitFor(() => {
      expect(screen.getByText('concord')).toBeTruthy();
    });
    expect(screen.getByText('kept-topic')).toBeTruthy();
    expect(screen.queryByText('[object Object]')).toBeNull();
    expect(screen.queryByText(/object object/i)).toBeNull();
  });
});
