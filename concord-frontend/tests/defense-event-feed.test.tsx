import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// S3 — the Live feed reads the events the lens itself produces.
// EventFeed drives defense.activity-feed (server-derived from the lens's
// own stores); these tests pin the surface contract: events render with
// their kind + text, an untouched workspace says so honestly, and a
// failed read surfaces as an error — never as a silent empty panel.

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));

import { EventFeed } from '@/components/defense/EventFeed';

beforeEach(() => { lensRun.mockReset(); });

describe('defense event feed (S3)', () => {
  it('renders the workspace’s own events from activity-feed', async () => {
    lensRun.mockResolvedValue({
      data: {
        ok: true,
        result: {
          total: 2,
          events: [
            { at: '2026-11-03T10:00:00.000Z', kind: 'asset', text: 'Asset added — TEST-TRUCK-1' },
            { at: '2026-11-03T09:00:00.000Z', kind: 'mission', text: 'Mission task added — TEST-TASK-1' },
          ],
        },
      },
    });
    render(<EventFeed />);
    await waitFor(() => expect(screen.getByText('Asset added — TEST-TRUCK-1')).toBeInTheDocument());
    expect(screen.getByText('Mission task added — TEST-TASK-1')).toBeInTheDocument();
    expect(screen.getByText('2 events')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith('defense', 'activity-feed', { limit: 50 });
  });

  it('an untouched workspace gets an honest empty state, not a blank panel', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { events: [], total: 0 } } });
    render(<EventFeed />);
    await waitFor(() => expect(screen.getByText(/No events yet/)).toBeInTheDocument());
  });

  it('a failed read shows the error instead of an empty feed', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, error: 'STATE unavailable' } });
    render(<EventFeed />);
    await waitFor(() => expect(screen.getByText('STATE unavailable')).toBeInTheDocument());
    expect(screen.queryByText(/No events yet/)).not.toBeInTheDocument();
  });
});
