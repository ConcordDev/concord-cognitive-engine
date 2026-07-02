/**
 * /lenses/photos — four-UX-state contract.
 *
 * Pins that the photos lens renders genuine loading (role=status + spinner) /
 * error (role=alert + a working Retry) / empty / populated states against the
 * real /api/photos/* REST surface (mocked via global.fetch standing in for
 * server/domains/photos.js → server/lib/photo-gallery.js), plus the polish
 * bonuses: a reduced-motion-aware entrance animation on populated content and
 * success/error toasts on share/delete. a11y: tab/refresh/share/delete buttons
 * carry accessible names.
 *
 * No fabricated data: every state is driven by the exact { ok, photos } shape
 * the /api/photos/* routes return.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';

// Toast store — capture addToast calls to assert the toast bonus.
const addToastMock = vi.fn();
vi.mock('@/store/ui', () => ({
  useUIStore: (selector: (s: { addToast: typeof addToastMock }) => unknown) =>
    selector({ addToast: addToastMock }),
}));

// LensShell + ManifestActionBar are presentational chrome — stub to keep the
// render focused on the four UX states.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/ManifestActionBar', () => ({
  ManifestActionBar: () => null,
}));

import PhotosLensPage from '@/app/lenses/photos/page';

const PHOTO = {
  id: 'p_1',
  user_id: 'u_1',
  world_id: 'tunya',
  caption: 'Sunset over the spire',
  taken_at: Math.floor(Date.now() / 1000) - 120,
  dtu_id: null,
  visibility: 'private',
};

function jsonResponse(body: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

beforeEach(() => {
  addToastMock.mockReset();
  vi.restoreAllMocks();
});

describe('photos lens — four UX states', () => {
  it('LOADING: shows a role=status spinner while photos are in flight', async () => {
    // fetch never resolves → stuck loading.
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}) as Promise<Response>);
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<PhotosLensPage />); });
    const loading = view!.getByTestId('photos-loading');
    expect(loading).toBeInTheDocument();
    expect(loading).toHaveAttribute('role', 'status');
    expect(loading).toHaveAttribute('aria-busy', 'true');
    // the spinner svg is reduced-motion-aware
    expect(loading.querySelector('.animate-spin.motion-reduce\\:animate-none')).toBeTruthy();
  });

  it('EMPTY: shows an honest empty state once the fetch resolves with no photos', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => jsonResponse({ ok: true, photos: [] }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<PhotosLensPage />); });
    await waitFor(() => expect(view!.getByTestId('photos-empty')).toBeInTheDocument());
    expect(view!.getByTestId('photos-empty').textContent).toMatch(/no photos yet/i);
    // a11y: chrome buttons carry accessible names.
    expect(view!.getByLabelText('Refresh')).toBeInTheDocument();
  });

  it('READY: renders a real photo with a reduced-motion-aware entrance animation', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => jsonResponse({ ok: true, photos: [PHOTO] }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<PhotosLensPage />); });
    await waitFor(() => expect(view!.getByTestId('photos-list')).toBeInTheDocument());
    const list = view!.getByTestId('photos-list');
    expect(list.textContent).toMatch(/Sunset over the spire/);
    expect(list.className).toMatch(/animate-in/);
    expect(list.className).toMatch(/motion-reduce:animate-none/);
  });

  it('TOAST (success): sharing a photo fires a success toast', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/share')) return jsonResponse({ ok: true });
      return jsonResponse({ ok: true, photos: [PHOTO] });
    });
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<PhotosLensPage />); });
    await waitFor(() => expect(view!.getByTestId('photos-list')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(view!.getByLabelText('Share photo Sunset over the spire'));
    });
    await waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })),
    );
  });

  it('TOAST (error): a failed delete fires an error toast', async () => {
    vi.spyOn(global, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/delete')) return jsonResponse({ ok: false }, false, 500);
      return jsonResponse({ ok: true, photos: [PHOTO] });
    });
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<PhotosLensPage />); });
    await waitFor(() => expect(view!.getByTestId('photos-list')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(view!.getByLabelText('Delete photo Sunset over the spire'));
    });
    await waitFor(() =>
      expect(addToastMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })),
    );
  });

  it('ERROR: shows role=alert + a Retry that re-issues the fetch', async () => {
    let calls = 0;
    vi.spyOn(global, 'fetch').mockImplementation(() => {
      calls += 1;
      return jsonResponse({ ok: false, reason: 'boom' }, false, 500);
    });
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<PhotosLensPage />); });
    await waitFor(() => expect(view!.getByTestId('photos-error')).toBeInTheDocument());
    expect(view!.getByTestId('photos-error')).toHaveAttribute('role', 'alert');

    const before = calls;
    await act(async () => { fireEvent.click(view!.getByText('Retry')); });
    await waitFor(() => expect(calls).toBeGreaterThan(before));
  });
});
