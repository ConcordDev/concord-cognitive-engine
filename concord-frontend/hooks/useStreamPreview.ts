'use client';

import { useEffect, useState } from 'react';

export interface StreamPreview {
  /** True when the server clamped this stream to a signed-out preview. */
  isPreview: boolean;
  /** How many seconds of the item the preview covers. */
  seconds: number;
}

const NONE: StreamPreview = { isPreview: false, seconds: 0 };

/**
 * Reads the server's signed-out preview signal for a media stream.
 *
 * `GET /api/media/:id/stream` answers a signed-out visitor with only the first
 * ~30 s of a PUBLIC item and says so in headers: `X-Concord-Preview: true`,
 * `X-Concord-Preview-Seconds`, `X-Concord-Full-Requires: sign-in`. An <audio> /
 * <video> element cannot read response headers, so this asks once with a
 * one-byte Range request (the server answers 206 with the same headers, so the
 * probe never pulls the file). Members, private items, errors and anything
 * without the sign-in marker read as "not a preview": no UI change for them.
 * The server is the only authority; the client never guesses a preview.
 * `enabled=false` defers the probe (lists of items probe on first play, not on mount).
 */
export function useStreamPreview(streamUrl: string | null | undefined, enabled = true): StreamPreview {
  const [state, setState] = useState<{ url: string; preview: StreamPreview } | null>(null);

  useEffect(() => {
    if (!streamUrl || !enabled) return;
    let live = true;
    const ac = new AbortController();
    fetch(streamUrl, { headers: { Range: 'bytes=0-0' }, credentials: 'include', signal: ac.signal })
      .then((r) => {
        if (!live) return;
        const flagged = r.headers.get('x-concord-preview') === 'true' && r.headers.get('x-concord-full-requires') === 'sign-in';
        const secs = Number(r.headers.get('x-concord-preview-seconds'));
        setState({ url: streamUrl, preview: flagged ? { isPreview: true, seconds: Number.isFinite(secs) && secs > 0 ? secs : 30 } : NONE });
      })
      .catch(() => { /* offline / aborted: no signal, no preview UI */ });
    return () => { live = false; ac.abort(); };
  }, [streamUrl, enabled]);

  return state && state.url === streamUrl ? state.preview : NONE;
}
