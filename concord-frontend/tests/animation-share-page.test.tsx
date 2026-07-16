/**
 * /share/animation/[token] — the public animation-share viewer.
 *
 * Wave 4 gap closure (`docs/lens-specs/animation-capability-map.md`
 * checklist item 17): the page previously required `useAuth()`'s `user`
 * before it would even attempt to load the share, showing a "Sign in to
 * view this animation" prompt to anyone logged out. It now calls the
 * dedicated public REST route (`GET /api/animation/share/:token`) with a
 * plain, unauthenticated `fetch` and has NO dependency on `useAuth()` at
 * all — this test renders the page with no auth context/provider present
 * to prove that.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: 'shr_abc123' }),
}));

// Deliberately NOT mocking `@/hooks/useAuth` — the page must never import or
// call it. If it did, this render would throw (no AuthProvider in the tree)
// or vi would need a mock; neither exists here, and the test still expects
// a clean render, proving the page is genuinely auth-independent.

import AnimationSharePage from '@/app/share/animation/[token]/page';

function jsonOk(body: Record<string, unknown>) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}
function jsonFail(status: number, body: Record<string, unknown>) {
  return Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) });
}

const SHARE = { token: 'shr_abc123', title: 'Bouncing Ball', views: 4, allowDownload: true };
const ANIM = {
  id: 'anm_1', title: 'Bouncing Ball', width: 320, height: 240, fps: 24,
  background: '#ffffff', thumbnail: null, frameCount: 2,
  frames: [
    { id: 'f1', exposure: 1, strokes: [] },
    { id: 'f2', exposure: 1, strokes: [] },
  ],
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('/share/animation/[token] — public share viewer', () => {
  it('renders with NO auth context and calls the public REST route, not lensRun', async () => {
    const fetchMock = vi.fn((url: string) => {
      expect(String(url)).toBe('/api/animation/share/shr_abc123');
      return jsonOk({ ok: true, result: { share: SHARE, animation: ANIM } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getByText } = render(<AnimationSharePage />);
    await waitFor(() => expect(getByText('Bouncing Ball')).toBeInTheDocument());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/animation/share/shr_abc123');
    expect(getByText(/4 views/)).toBeInTheDocument();
    expect(getByText(/320×240/)).toBeInTheDocument();
  });

  it('never shows a "Sign in" prompt — the old auth-gated branch is gone', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOk({ ok: true, result: { share: SHARE, animation: ANIM } })));
    const { queryByText, getByText } = render(<AnimationSharePage />);
    await waitFor(() => expect(getByText('Bouncing Ball')).toBeInTheDocument());
    expect(queryByText(/Sign in to view this animation/i)).not.toBeInTheDocument();
  });

  it('an invalid/unknown token shows an honest error, not a silent blank page', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonFail(404, { ok: false, error: 'share link not found' })));
    const { getByText } = render(<AnimationSharePage />);
    await waitFor(() => expect(getByText(/share link not found/i)).toBeInTheDocument());
  });

  it('allowDownload:false renders without frames but still shows the thumbnail-only notice', async () => {
    const noDownloadShare = { ...SHARE, allowDownload: false };
    const noDownloadAnim = { ...ANIM, frames: undefined, thumbnail: null };
    vi.stubGlobal('fetch', vi.fn(() => jsonOk({ ok: true, result: { share: noDownloadShare, animation: noDownloadAnim } })));
    const { getByText } = render(<AnimationSharePage />);
    await waitFor(() => expect(getByText('Bouncing Ball')).toBeInTheDocument());
    expect(getByText(/owner disabled frame downloads/i)).toBeInTheDocument();
  });
});
