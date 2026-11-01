'use client';

import Link from 'next/link';
import { Lock } from 'lucide-react';
import type { StreamPreview } from '@/hooks/useStreamPreview';

/** Sign-in link that returns the visitor to this same page/item (login validates `from` as a relative path). */
function signInHref(): string {
  if (typeof window === 'undefined') return '/login';
  const here = `${window.location.pathname}${window.location.search}`;
  return `/login?from=${encodeURIComponent(here)}`;
}

/**
 * The signed-out preview affordance for a media player: a small "Preview"
 * badge while it plays, and once the preview is over (the element ended, or
 * its clock reached the server's cut) a clear "Sign in for the full track"
 * prompt. Renders nothing for members or non-preview streams.
 */
export function MediaPreviewNotice({
  preview,
  currentTime = 0,
  ended = false,
  kind = 'track',
}: {
  preview: StreamPreview;
  currentTime?: number;
  ended?: boolean;
  kind?: 'track' | 'video';
}) {
  if (!preview.isPreview) return null;
  const over = ended || (preview.seconds > 0 && currentTime >= preview.seconds - 0.3);
  const noun = kind === 'video' ? 'video' : 'track';
  return (
    <div data-testid="media-preview-notice" className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs">
      <span
        data-testid="media-preview-badge"
        className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 font-medium text-amber-300"
        title={`Signed-out visitors hear the first ${Math.round(preview.seconds)} seconds`}
      >
        Preview
      </span>
      {over ? (
        <Link
          data-testid="media-preview-signin"
          href={signInHref()}
          className="inline-flex items-center gap-1 rounded-md bg-neon-cyan/15 px-2 py-1 font-medium text-neon-cyan hover:bg-neon-cyan/25"
        >
          <Lock className="h-3 w-3" aria-hidden /> Sign in for the full {noun}
        </Link>
      ) : (
        <span className="text-gray-400">First {Math.round(preview.seconds)} s · sign in for the full {noun}</span>
      )}
    </div>
  );
}
