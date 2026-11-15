'use client';

/**
 * DeprecatedLensNotice — the honest status banner for a lens the
 * platform has marked deprecated in lib/lenses/lens-status.ts.
 *
 * FIX-hypothesis-008 / FIX-suffering-013: both lenses are marked
 * deprecated in LENS_STATUS_MAP (merge target: paper) yet their pages
 * loaded as normal current lenses with no notice, redirect, or stub.
 * The registry already owns the truth; this component surfaces it.
 * Render it at the top of a lens page — it renders nothing for any
 * lens that is not deprecated, so pages can adopt it unconditionally
 * and future deprecations surface automatically.
 */

import Link from 'next/link';
import { getLensStatus } from '@/lib/lenses/lens-status';

export function DeprecatedLensNotice({ lensId }: { lensId: string }) {
  const entry = getLensStatus(lensId);
  if (!entry || entry.status !== 'deprecated') return null;
  return (
    <div role="note" className="mb-4 rounded-xl border border-amber-700/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
      <strong className="font-semibold">This lens is deprecated.</strong>{' '}
      It is scheduled to merge into{' '}
      {entry.mergeTarget ? (
        <Link href={`/lenses/${entry.mergeTarget}`} className="underline underline-offset-2 hover:text-amber-50">
          the {entry.mergeTarget} lens
        </Link>
      ) : (
        'another lens'
      )}{' '}
      as a {entry.postMergeRole}. It still works, but new work belongs there.
    </div>
  );
}
