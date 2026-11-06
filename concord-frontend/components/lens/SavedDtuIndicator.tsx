'use client';

/**
 * Platform Chrome II — F17, the chrome half: the shared saved-DTU indicator.
 *
 * Renders the record's truth about the current artifact's DTU link, read
 * through useSavedDtu — so it holds across navigation and remounts, where
 * the view-local indicator it replaces reset to "Save the project first"
 * over a DTU that demonstrably persisted (Projects §2b #80).
 *
 * A lens adopts it by mounting it beside its save affordance with its
 * domain + artifact id (and its own link extractor when its record's field
 * name differs — the lens-side half, e.g. Projects' B10 companion slice).
 * The indicator never renders the raw DTU id: it states the fact.
 */

import { CheckCircle2, CircleDashed } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSavedDtu, type SavedDtuExtractor } from '@/hooks/useSavedDtu';

interface SavedDtuIndicatorProps {
  domain: string;
  artifactId: string | null | undefined;
  extractor?: SavedDtuExtractor;
  className?: string;
  /** Render the unsaved state too (default: only the saved state shows). */
  showUnsaved?: boolean;
}

export function SavedDtuIndicator({
  domain,
  artifactId,
  extractor,
  className,
  showUnsaved = false,
}: SavedDtuIndicatorProps) {
  const { settled, isSaved } = useSavedDtu(domain, artifactId, extractor);

  if (!artifactId || !settled) return null;

  if (isSaved) {
    return (
      <span
        className={cn('inline-flex items-center gap-1 text-xs text-emerald-300', className)}
        data-testid="saved-dtu-indicator"
      >
        <CheckCircle2 className="w-3.5 h-3.5" />
        Saved as DTU
      </span>
    );
  }

  if (!showUnsaved) return null;
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-xs text-gray-400', className)}
      data-testid="saved-dtu-indicator"
    >
      <CircleDashed className="w-3.5 h-3.5" />
      Not saved as DTU
    </span>
  );
}
