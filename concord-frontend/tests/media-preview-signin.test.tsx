import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, renderHook } from '@testing-library/react';
import { useStreamPreview } from '@/hooks/useStreamPreview';
import { MediaPreviewNotice } from '@/components/media/MediaPreviewNotice';
import { PreviewAwareMedia } from '@/components/media/PreviewAwareMedia';
import { UniversalPlayer } from '@/components/media/UniversalPlayer';

vi.mock('next/link', () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }));

const STREAM = '/api/media/m1/stream';

/** What the server sends for each audience (server/routes/media.js, brief 1420). */
const SIGNED_OUT_PREVIEW = { 'x-concord-preview': 'true', 'x-concord-preview-seconds': '30', 'x-concord-full-requires': 'sign-in' };
const MEMBER_FULL = {};
const LICENSE_PREVIEW = { 'x-concord-preview': 'true', 'x-concord-full-requires': 'license' };

function mockFetch(headers: Record<string, string>) {
  const fn = vi.fn(async () => ({ status: 206, headers: new Headers(headers) }) as unknown as Response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => { window.history.replaceState(null, '', '/lenses/music?item=m1'); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

describe('useStreamPreview', () => {
  it('reads the server signal with a one-byte Range request (never pulls the file)', async () => {
    const f = mockFetch(SIGNED_OUT_PREVIEW);
    const { result } = renderHook(() => useStreamPreview(STREAM));
    await waitFor(() => expect(result.current.isPreview).toBe(true));
    expect(result.current.seconds).toBe(30);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(STREAM);
    expect((init.headers as Record<string, string>).Range).toBe('bytes=0-0');
  });

  it('a member (no preview headers) is not a preview', async () => {
    const f = mockFetch(MEMBER_FULL);
    const { result } = renderHook(() => useStreamPreview(STREAM));
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(result.current.isPreview).toBe(false);
  });

  it('a licence-gated preview for a signed-in member is not the sign-in prompt', async () => {
    const f = mockFetch(LICENSE_PREVIEW);
    const { result } = renderHook(() => useStreamPreview(STREAM));
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(result.current.isPreview).toBe(false);
  });

  it('a failed probe means no preview UI, never a guess', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { result } = renderHook(() => useStreamPreview(STREAM));
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.isPreview).toBe(false);
  });

  it('enabled=false does not probe', async () => {
    const f = mockFetch(SIGNED_OUT_PREVIEW);
    renderHook(() => useStreamPreview(STREAM, false));
    await new Promise((r) => setTimeout(r, 10));
    expect(f).not.toHaveBeenCalled();
  });
});

describe('MediaPreviewNotice', () => {
  const preview = { isPreview: true, seconds: 30 };

  it('renders nothing for members', () => {
    const { container } = render(<MediaPreviewNotice preview={{ isPreview: false, seconds: 0 }} ended />);
    expect(container.firstChild).toBeNull();
  });

  it('while playing: a Preview badge and the 30 s hint, no sign-in button yet', () => {
    render(<MediaPreviewNotice preview={preview} currentTime={12} />);
    expect(screen.getByTestId('media-preview-badge').textContent).toBe('Preview');
    expect(screen.queryByTestId('media-preview-signin')).toBeNull();
    expect(screen.getByTestId('media-preview-notice').textContent).toMatch(/First 30 s/);
  });

  it('when the preview ends: "Sign in for the full track" linking back to this same item', () => {
    render(<MediaPreviewNotice preview={preview} ended />);
    const link = screen.getByTestId('media-preview-signin');
    expect(link.textContent).toMatch(/Sign in for the full track/);
    expect(link.getAttribute('href')).toBe(`/login?from=${encodeURIComponent('/lenses/music?item=m1')}`);
  });

  it('also appears when the clock reaches the server cut, before an ended event', () => {
    render(<MediaPreviewNotice preview={preview} currentTime={29.9} />);
    expect(screen.getByTestId('media-preview-signin')).toBeTruthy();
  });

  it('says "video" for video', () => {
    render(<MediaPreviewNotice preview={preview} ended kind="video" />);
    expect(screen.getByTestId('media-preview-signin').textContent).toMatch(/full video/);
  });
});

describe('PreviewAwareMedia', () => {
  it('does not probe until first play, then shows the badge and the sign-in prompt at the end', async () => {
    const f = mockFetch(SIGNED_OUT_PREVIEW);
    const { container } = render(<PreviewAwareMedia src={STREAM} kind="audio" />);
    expect(f).not.toHaveBeenCalled();
    const el = container.querySelector('audio') as HTMLAudioElement;
    fireEvent.play(el);
    await waitFor(() => expect(screen.getByTestId('media-preview-badge')).toBeTruthy());
    expect(screen.queryByTestId('media-preview-signin')).toBeNull();
    fireEvent.ended(el);
    expect(screen.getByTestId('media-preview-signin')).toBeTruthy();
    fireEvent.play(el); // replay clears the prompt
    expect(screen.queryByTestId('media-preview-signin')).toBeNull();
  });

  it('a member playing sees the bare element: no badge, no prompt', async () => {
    const f = mockFetch(MEMBER_FULL);
    const { container } = render(<PreviewAwareMedia src={STREAM} kind="audio" />);
    fireEvent.play(container.querySelector('audio') as HTMLAudioElement);
    await waitFor(() => expect(f).toHaveBeenCalled());
    fireEvent.ended(container.querySelector('audio') as HTMLAudioElement);
    expect(screen.queryByTestId('media-preview-notice')).toBeNull();
  });
});

describe('UniversalPlayer', () => {
  const dto = { id: 'm1', title: 'Song', mediaType: 'audio' as const, duration: 200 };

  it('signed out: shows the Preview badge; the prompt appears when the track ends', async () => {
    mockFetch(SIGNED_OUT_PREVIEW);
    const { container } = render(<UniversalPlayer mediaDTU={dto} />);
    await waitFor(() => expect(screen.getByTestId('media-preview-badge')).toBeTruthy());
    fireEvent.ended(container.querySelector('audio') as HTMLAudioElement);
    expect(screen.getByTestId('media-preview-signin').getAttribute('href')).toContain('/login?from=');
  });

  it('member: no change (no notice at all)', async () => {
    const f = mockFetch(MEMBER_FULL);
    render(<UniversalPlayer mediaDTU={dto} />);
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(screen.queryByTestId('media-preview-notice')).toBeNull();
  });
});
