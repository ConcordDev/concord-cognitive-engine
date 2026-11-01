'use client';

import { useState } from 'react';
import { useStreamPreview } from '@/hooks/useStreamPreview';
import { MediaPreviewNotice } from '@/components/media/MediaPreviewNotice';

/**
 * A native audio/video element for a /api/media/:id/stream URL that knows when
 * the server clamped it to a signed-out preview: shows the Preview badge and,
 * once the preview ends, "Sign in for the full track". Members see the bare
 * element, unchanged. The server is asked once, on first play (a list of items
 * does not probe every row on mount).
 */
export function PreviewAwareMedia({
  src,
  kind,
  className,
}: {
  src: string;
  kind: 'audio' | 'video';
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const preview = useStreamPreview(src, armed);
  const [currentTime, setCurrentTime] = useState(0);
  const [ended, setEnded] = useState(false);
  const common = {
    controls: true,
    preload: 'none' as const,
    src,
    className,
    onTimeUpdate: (e: React.SyntheticEvent<HTMLMediaElement>) => setCurrentTime(e.currentTarget.currentTime),
    onPlay: () => { setArmed(true); setEnded(false); },
    onEnded: () => setEnded(true),
  };
  return (
    <div>
      {kind === 'video' ? <video {...common} /> : <audio {...common} />}
      <MediaPreviewNotice preview={preview} currentTime={currentTime} ended={ended} kind={kind === 'video' ? 'video' : 'track'} />
    </div>
  );
}
