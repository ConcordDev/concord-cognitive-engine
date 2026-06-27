/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// LensShell + ManifestActionBar pull in stores/context we don't care about
// here — stub them to passthrough so the test isolates the four UX states.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/ManifestActionBar', () => ({
  ManifestActionBar: () => null,
}));

import AnnouncementsLensPage from '@/app/lenses/announcements/page';

const NOW = Math.floor(Date.now() / 1000);

function okResponse(announcements: unknown[]) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ ok: true, announcements }),
  });
}

const SAMPLE = [
  { id: 'ann_1', kind: 'feature_drop', title: 'Batch 4 shipped', body_md: 'Announcements lens is live.', published_at: NOW - 30, expires_at: null },
];

describe('AnnouncementsLensPage — four UX states', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('loading: shows a spinner status before the fetch resolves', () => {
    // A fetch that never resolves keeps the page in the loading state.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<AnnouncementsLensPage />);
    expect(screen.getByRole('status')).toHaveTextContent(/loading announcements/i);
  });

  it('empty: shows an honest empty state when no announcements exist', async () => {
    vi.stubGlobal('fetch', vi.fn(() => okResponse([])));
    render(<AnnouncementsLensPage />);
    await waitFor(() => expect(screen.getByText(/no announcements yet/i)).toBeInTheDocument());
    // Not an error, not a spinner.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('error: shows an honest error + a working Retry that re-fetches', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }))
      .mockImplementationOnce(() => okResponse(SAMPLE));
    vi.stubGlobal('fetch', fetchMock);
    render(<AnnouncementsLensPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn't load/i);

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getByText('Batch 4 shipped')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('populated: renders real announcements from the backend', async () => {
    vi.stubGlobal('fetch', vi.fn(() => okResponse(SAMPLE)));
    render(<AnnouncementsLensPage />);
    await waitFor(() => expect(screen.getByText('Batch 4 shipped')).toBeInTheDocument());
    expect(screen.getByText('Announcements lens is live.')).toBeInTheDocument();
    // a11y: the kind filter is a tablist.
    expect(screen.getByRole('tablist', { name: /filter by kind/i })).toBeInTheDocument();
  });
});
