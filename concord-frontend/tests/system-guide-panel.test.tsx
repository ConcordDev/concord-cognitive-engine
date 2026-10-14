import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockApiGet = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
}));

import { SystemGuidePanel, formatTime } from '@/components/guidance/SystemGuidePanel';

function renderGuide() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SystemGuidePanel />
    </QueryClientProvider>,
  );
}

describe('formatTime (SystemGuidePanel)', () => {
  it('returns an honest fallback when createdAt is missing', () => {
    expect(formatTime(undefined)).toBe('—');
    expect(formatTime(null)).toBe('—');
    expect(formatTime('')).toBe('—');
  });

  it('does not throw when the catch path would have called .slice on undefined', () => {
    expect(() => formatTime(undefined as unknown as string)).not.toThrow();
  });
});

describe('SystemGuidePanel — missing createdAt (F1)', () => {
  beforeEach(() => {
    mockApiGet.mockReset();
    mockApiGet.mockImplementation(async (url: string) => {
      if (url === '/api/system/health') {
        return { data: { ok: true, dbWritable: true, storageWritable: true, recentErrors: 0, counts: {} } };
      }
      if (url === '/api/guidance/suggestions') {
        return { data: { suggestions: [] } };
      }
      if (url === '/api/guidance/first-win') {
        return { data: { steps: [], allDone: true, completedCount: 0 } };
      }
      if (url === '/api/events/paginated') {
        return {
          data: {
            items: [
              {
                id: 'evt_missing_ts',
                type: 'announcement',
                summary: 'Event without timestamp',
                // intentionally omit createdAt
                undoToken: null,
                scope: 'global',
                entityType: null,
              },
            ],
          },
        };
      }
      return { data: {} };
    });
  });

  it('expands without hitting the section error boundary when an event lacks createdAt', async () => {
    renderGuide();
    fireEvent.click(screen.getByTitle('Expand Guide'));

    await waitFor(() => {
      expect(screen.getByText('Event without timestamp')).toBeInTheDocument();
    });

    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    expect(screen.queryByText(/reading 'slice'/i)).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
