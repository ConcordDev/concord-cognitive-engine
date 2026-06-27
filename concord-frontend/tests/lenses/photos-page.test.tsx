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

import PhotosLensPage from '@/app/lenses/photos/page';

const NOW = Math.floor(Date.now() / 1000);

function okResponse(photos: unknown[]) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ ok: true, photos }),
  });
}

const SAMPLE = [
  { id: 'ph_1', world_id: 'tunya', caption: 'Summit at dawn', taken_at: NOW - 120, dtu_id: null, visibility: 'private' },
  { id: 'ph_2', world_id: 'tunya', caption: 'Shared vista', taken_at: NOW - 300, dtu_id: 'dtu_photo_abc', visibility: 'public' },
];

describe('PhotosLensPage — four UX states', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('loading: shows a status role before the fetch resolves', () => {
    // A fetch that never resolves keeps the page in the loading state.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<PhotosLensPage />);
    expect(screen.getByRole('status')).toHaveTextContent(/loading photos/i);
  });

  it('empty: shows an honest empty state when the gallery is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(() => okResponse([])));
    render(<PhotosLensPage />);
    await waitFor(() => expect(screen.getByText(/no photos yet/i)).toBeInTheDocument());
    // Not an error, not a spinner.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('error: shows an honest error + a working Retry that re-fetches', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }))
      .mockImplementationOnce(() => okResponse(SAMPLE));
    vi.stubGlobal('fetch', fetchMock);
    render(<PhotosLensPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not load photos/i);

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getByText('Summit at dawn')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('populated: renders real photos; shared photo shows the DTU badge', async () => {
    vi.stubGlobal('fetch', vi.fn(() => okResponse(SAMPLE)));
    render(<PhotosLensPage />);
    await waitFor(() => expect(screen.getByText('Summit at dawn')).toBeInTheDocument());
    expect(screen.getByText('Shared vista')).toBeInTheDocument();
    // The unshared photo offers a Share button; the shared one shows the badge.
    expect(screen.getByRole('button', { name: /share/i })).toBeInTheDocument();
    expect(screen.getByText(/dtu minted/i)).toBeInTheDocument();
    // a11y: tabs are toggle buttons with aria-pressed.
    expect(screen.getByRole('button', { name: /my photos/i })).toHaveAttribute('aria-pressed', 'true');
  });
});
