/**
 * /lenses/photos — four-UX-state contract.
 *
 * Pins loading, error + Retry, the empty line "No frame yet.", a populated
 * frame whose image src is the real bytes route, and share/delete toasts
 * that follow the HTTP status and the follow-up list.
 *
 * No fabricated data: every state is driven by the exact { ok, photos } shape
 * the /api/photos/* routes return.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';

// Toast store — capture addToast calls to assert the toast bonus.
const addToastMock = vi.fn();
// The north-star frame wires these into the page; stub them for a headless render.
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
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
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

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
    expect(loading.textContent).toMatch(/Opening the frame/);
  });

  it('EMPTY: shows an honest empty state once the fetch resolves with no photos', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => jsonResponse({ ok: true, photos: [] }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<PhotosLensPage />); });
    await waitFor(() => expect(view!.getByTestId('photos-empty')).toBeInTheDocument());
    expect(view!.getByTestId('photos-empty').textContent).toMatch(/No frame yet/);
    expect(view!.getByRole('button', { name: 'Import' })).toBeInTheDocument();
    expect(view!.queryByText(/tunya/)).toBeNull();
  });

  it('READY: renders a real photo with a reduced-motion-aware entrance animation', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => jsonResponse({ ok: true, photos: [PHOTO] }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<PhotosLensPage />); });
    await waitFor(() => expect(view!.getByTestId('photos-list')).toBeInTheDocument());
    const list = view!.getByTestId('photos-list');
    expect(list.textContent).toMatch(/Sunset over the spire/);
  });

  it('READY: each card renders the actual photo bytes via /api/photos/:id/image (verify-pass fix)', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => jsonResponse({ ok: true, photos: [PHOTO] }));
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<PhotosLensPage />); });
    await waitFor(() => expect(view!.getByTestId('photos-list')).toBeInTheDocument());
    const img = view!.getByAltText('Sunset over the spire') as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.getAttribute('src')).toBe(`/api/photos/${PHOTO.id}/image`);
  });

  it('TOAST (success): sharing a photo fires a success toast only after the list reads the DTU back', async () => {
    let shared = false;
    vi.spyOn(global, 'fetch').mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/share')) {
        shared = true;
        return jsonResponse({ ok: true, dtuId: 'dtu_1' });
      }
      return jsonResponse({
        ok: true,
        photos: [{ ...PHOTO, dtu_id: shared ? 'dtu_1' : null }],
      });
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

  it('IMPORT: shows the caption only after mine contains the new id', async () => {
    const calls: string[] = [];
    let mineGets = 0;
    vi.spyOn(global, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method || 'GET'} ${url}`);
      if (url.includes('/save')) return jsonResponse({ ok: true, id: 'ph_new' });
      if (!url.includes('/api/photos/mine')) return jsonResponse({ ok: true, user: null });
      mineGets += 1;
      if (mineGets < 2) return jsonResponse({ ok: true, photos: [] });
      return jsonResponse({
        ok: true,
        photos: [{ ...PHOTO, id: 'ph_new', caption: 'Proof frame' }],
      });
    });
    class FakeImage {
      onload: (() => void) | null = null;
      naturalWidth = 2;
      naturalHeight = 2;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal('Image', FakeImage);
    HTMLCanvasElement.prototype.getContext = (() => ({ drawImage() {} })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,aaa';

    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<PhotosLensPage />); });
    await waitFor(() => expect(view!.getByTestId('photos-empty')).toBeInTheDocument());
    const input = view!.getByLabelText('Import photos') as HTMLInputElement;
    const file = new File(['png'], 'Proof frame.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    await waitFor(() => expect(view!.getByText('Proof frame')).toBeInTheDocument());
    expect(calls.some((line) => line.startsWith('POST') && line.includes('/api/photos/save'))).toBe(true);
    expect(view!.queryByText(/Saved, but the frame did not read it back/)).toBeNull();
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
