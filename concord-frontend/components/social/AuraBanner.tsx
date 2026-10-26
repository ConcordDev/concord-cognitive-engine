'use client';

/**
 * AuraBanner — the deterministic Aura of a Social profile, rendered as a
 * STILL inline SVG in the existing profile header's banner slot (job
 * oc-social-5, Social identity / JOB 8).
 *
 * The handle (and the profile's optional accent) are the only inputs;
 * everything else is derived in lib/social/aura.ts. No animation, no
 * drift, no motion — a static blurred-blob image.
 */

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { AURA_BLUR, AURA_HEIGHT, AURA_WIDTH, auraBlobs, fnv1a } from '@/lib/social/aura';

export interface AuraBannerProps {
  /** The profile handle — seeds the Aura deterministically. */
  handle: string;
  /** Optional user-picked accent (#rrggbb); colours one blob and the avatar ring. */
  accent?: string | null;
  className?: string;
}

export function AuraBanner({ handle, accent, className }: AuraBannerProps) {
  // Blob picks come from the pure module so the render is deterministic
  // for a given handle+accent — same input, same pixels, every time.
  const { blobs, filterId } = useMemo(() => {
    const seed = fnv1a(String(handle || '').toLowerCase());
    return {
      blobs: auraBlobs(handle, accent),
      filterId: `aura_blur_${seed.toString(36)}`,
    };
  }, [handle, accent]);

  return (
    <svg
      viewBox={`0 0 ${AURA_WIDTH} ${AURA_HEIGHT}`}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-hidden="true"
      focusable="false"
      className={cn('h-full w-full', className)}
    >
      <defs>
        <filter id={filterId} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation={AURA_BLUR} />
        </filter>
      </defs>
      <rect width={AURA_WIDTH} height={AURA_HEIGHT} fill="#0d0d14" />
      <g filter={`url(#${filterId})`}>
        {blobs.map((blob, index) => (
          <circle
            key={index}
            cx={blob.cx}
            cy={blob.cy}
            r={blob.r}
            fill={blob.color}
            opacity={blob.opacity}
          />
        ))}
      </g>
    </svg>
  );
}

export default AuraBanner;